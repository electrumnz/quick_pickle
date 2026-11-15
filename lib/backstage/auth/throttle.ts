/**
 * Slowing down guesses.
 *
 * Every guess at a password, a PIN or the set-up code is held against one
 * or two counters: the thing being guessed at (an email, or the PIN door)
 * and the address the guess came from. A counter allows so many wrong
 * tries in a stretch of time. One more locks it, for fifteen minutes the
 * first time, and each lock after that is twice the last, up to a day.
 *
 *   an email         five wrong tries in fifteen minutes. A right password
 *                    wipes its slate.
 *   an address       twenty in fifteen minutes: one address is often a
 *                    whole office or a phone network.
 *   the PIN door     five in a day, whoever makes them (pin.ts). A PIN is
 *                    short, and a guesser can come from as many addresses
 *                    as they like. A right PIN wipes the count and not the
 *                    ladder: only the set-up code wipes that.
 *
 * **A try is counted before what was typed is looked at** (`takeTries`), in
 * one statement the database runs by itself, and given back if it turns
 * out right. Looking first and counting after lets a burst through: a
 * hundred guesses sent in the same instant would each read "no wrong tries
 * yet". The PIN door was built that way first, and a test sent thirty
 * guesses at once with the right one twentieth: it walked in (15 November
 * 2026). Every counter here takes its place in the line first now.
 *
 * It is a table, not memory: on a serverless host each request may land on a
 * different machine, and a counter that lives in one of them counts nothing.
 */

import { and, eq, sql } from "drizzle-orm";

import { authThrottle } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

export const FREE_TRIES = 5;
export const WINDOW_MS = 15 * 60_000;
export const FIRST_LOCK_MS = 15 * 60_000;
export const MAX_LOCK_MS = 24 * 60 * 60_000;

/** The one counter for the PIN door. */
export const PIN_KEY = "pin:door";
/** How long the PIN door goes on counting wrong tries towards a lock. */
export const PIN_WINDOW_MS = 24 * 60 * 60_000;
/** The counter for the set-up code when nobody's address is known. */
const SETUP_KEY = "email:__setup__";

const known = (ip: string | null): ip is string => ip !== null && ip !== "";

/** The address a try came from, as its own counter. None, if it is not known. */
export function addressKeys(ip: string | null): string[] {
  return known(ip) ? [`ip:${ip}`] : [];
}

/**
 * The counters a try at an email's password is held against: the address
 * first (see `takeTries` for why the order matters), then the email.
 */
export function throttleKeys(email: string, ip: string | null): string[] {
  return [...addressKeys(ip), `email:${email}`];
}

/** The counters a try at the PIN is held against: the address, then the door. */
export function pinKeys(ip: string | null): string[] {
  return [...addressKeys(ip), PIN_KEY];
}

/**
 * The counters a try at the set-up code is held against: the address it
 * came from, and nothing shared.
 *
 * The set-up code is what gets an owner back in when the PIN door has been
 * locked by somebody else's guessing. A counter everybody shared would let
 * that same somebody lock this as well, for the price of five more tries.
 * It can go without one because the code is long and random (the infra
 * script makes it from 18 random bytes), which a PIN is not. With no
 * address to count against, the shared counter is the fallback, so there is
 * never no limit at all.
 */
export function setUpThrottleKeys(ip: string | null): string[] {
  return known(ip) ? [`ip:${ip}`] : [SETUP_KEY];
}

/** How many wrong tries a counter allows, and over how long. */
function ruleFor(key: string): {
  readonly tries: number;
  readonly windowMs: number;
} {
  // An address is shared by a whole office or a phone network, so it gets
  // four times the room an email does before it is locked.
  if (key.startsWith("ip:")) {
    return { tries: FREE_TRIES * 4, windowMs: WINDOW_MS };
  }
  if (key === PIN_KEY) return { tries: FREE_TRIES, windowMs: PIN_WINDOW_MS };
  return { tries: FREE_TRIES, windowMs: WINDOW_MS };
}

/**
 * A place in the line on every counter a guess is held against, or the
 * moment the caller may try again.
 */
export type Turn =
  | {
      readonly allowed: true;
      /** The counters it was taken on. A right guess gives them back. */
      readonly keys: readonly string[];
      /** Those it was the last place on. A wrong guess locks them. */
      readonly last: readonly string[];
    }
  | { readonly allowed: false; readonly until: Date };

/**
 * Take one try on one counter, before what was typed is looked at.
 *
 * One statement: the count goes up by one unless the counter is locked,
 * and the database hands back what it came to. So of any number of tries
 * that arrive together, each is given its own place in the line, and only
 * as many as the counter allows are ever checked.
 */
async function takeTry(
  db: DbOrTx,
  key: string,
  now: Date,
): Promise<
  | { readonly allowed: true; readonly last: boolean }
  | { readonly allowed: false; readonly until: Date }
> {
  const rule = ruleFor(key);
  // Written out and cast, the way every moment in a piece of raw SQL is
  // here, so both databases read it as the same instant.
  const at = sql`${now.toISOString()}::timestamptz`;
  const windowStart = sql`${new Date(now.getTime() - rule.windowMs).toISOString()}::timestamptz`;
  const windowOver = sql`${authThrottle.windowStartedAt} < ${windowStart}`;
  const [row] = await db
    .insert(authThrottle)
    .values({ key, failures: 1, windowStartedAt: now })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        failures: sql`case when ${windowOver} then 1 else ${authThrottle.failures} + 1 end`,
        windowStartedAt: sql`case when ${windowOver} then ${at} else ${authThrottle.windowStartedAt} end`,
      },
      setWhere: sql`${authThrottle.lockedUntil} is null or ${authThrottle.lockedUntil} <= ${at}`,
    })
    .returning({ failures: authThrottle.failures });

  // Nothing came back: the counter is locked, and was left alone.
  if (row === undefined) {
    return { allowed: false, until: await lockEnd(db, key, now) };
  }
  // One past the last place in the line. Whoever holds the last place may
  // not have locked the counter yet (or never will, if their request
  // died), so this one does.
  if (row.failures > rule.tries) {
    return { allowed: false, until: await lockCounter(db, key, now) };
  }
  return { allowed: true, last: row.failures === rule.tries };
}

/** When a counter's lock ends. Now, if it turns out not to be locked. */
async function lockEnd(db: DbOrTx, key: string, now: Date): Promise<Date> {
  const [row] = await db
    .select({ lockedUntil: authThrottle.lockedUntil })
    .from(authThrottle)
    .where(eq(authThrottle.key, key));
  return row?.lockedUntil != null && row.lockedUntil > now
    ? row.lockedUntil
    : now;
}

/**
 * Lock a counter, one rung further up its ladder, and say until when.
 * Several tries can get here together. Only one of them climbs the rung:
 * the rest find it already locked and are told the same moment.
 */
async function lockCounter(db: DbOrTx, key: string, now: Date): Promise<Date> {
  const [row] = await db
    .select()
    .from(authThrottle)
    .where(eq(authThrottle.key, key));
  if (row === undefined) return now;
  if (row.lockedUntil !== null && row.lockedUntil > now) return row.lockedUntil;

  const lockMs = Math.min(FIRST_LOCK_MS * 2 ** row.lockCount, MAX_LOCK_MS);
  const until = new Date(now.getTime() + lockMs);
  const locked = await db
    .update(authThrottle)
    .set({
      failures: 0,
      windowStartedAt: now,
      lockedUntil: until,
      lockCount: row.lockCount + 1,
    })
    .where(
      and(
        eq(authThrottle.key, key),
        // Still on the rung that was read: nobody else has locked it since.
        eq(authThrottle.lockCount, row.lockCount),
      ),
    )
    .returning({ lockedUntil: authThrottle.lockedUntil });
  return locked[0]?.lockedUntil ?? (await lockEnd(db, key, now));
}

/** Take one try back off a counter: it was not a wrong one after all. */
async function giveBack(db: DbOrTx, key: string): Promise<void> {
  await db
    .update(authThrottle)
    .set({ failures: sql`greatest(${authThrottle.failures} - 1, 0)` })
    .where(eq(authThrottle.key, key));
}

/**
 * Take a try on every counter a guess is held against, in the order they
 * are given, before what was typed is looked at.
 *
 * If one of them says no, the guess is never looked at, so it was not a
 * wrong try on the others either: what was taken from them goes back. That
 * is why the order matters. An address that is locked out is named first,
 * so it does not get to use up an email's tries, or the PIN door's.
 */
export async function takeTries(
  db: DbOrTx,
  keys: readonly string[],
  now: Date,
): Promise<Turn> {
  const taken: string[] = [];
  const last: string[] = [];
  for (const key of keys) {
    const one = await takeTry(db, key, now);
    if (!one.allowed) {
      await giveBackAll(db, taken);
      return one;
    }
    taken.push(key);
    if (one.last) last.push(key);
  }
  return { allowed: true, keys: taken, last };
}

/**
 * A try that was looked at and was wrong. It stays on every count, and
 * locks whichever counters it was the last place on. Says when the caller
 * may try again if that locked something, or null.
 */
export async function wrongTry(
  db: DbOrTx,
  turn: Turn & { readonly allowed: true },
  now: Date,
): Promise<Date | null> {
  let until: Date | null = null;
  for (const key of turn.last) {
    const ends = await lockCounter(db, key, now);
    if (until === null || ends > until) until = ends;
  }
  return until;
}

/** Give a try back on each of these counters: it was not a wrong one. */
export async function giveBackAll(
  db: DbOrTx,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) await giveBack(db, key);
}

/** A right password wipes the slate for that email (not for the address). */
export async function recordSuccess(db: DbOrTx, email: string): Promise<void> {
  await db.delete(authThrottle).where(eq(authThrottle.key, `email:${email}`));
}

/**
 * A right PIN wipes the count of wrong ones and nothing else. The ladder
 * stays (how long the next lock would be), because the door has one
 * counter for everybody: if coming in reset it, a guesser would get a
 * fresh run of short locks every time the owner signed in.
 */
export async function recordPinSuccess(db: DbOrTx): Promise<void> {
  await db
    .update(authThrottle)
    .set({ failures: 0 })
    .where(eq(authThrottle.key, PIN_KEY));
}

/** The set-up code wipes the PIN door's slate, lock and ladder and all. */
export async function forgetPinTries(db: DbOrTx): Promise<void> {
  await db.delete(authThrottle).where(eq(authThrottle.key, PIN_KEY));
}
