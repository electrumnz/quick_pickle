/**
 * Slowing down guesses.
 *
 * Two counters per sign-in attempt: one for the email being tried, one for
 * the address it came from. Five wrong tries inside fifteen minutes locks
 * that counter for fifteen minutes, and each further lock-out doubles, up to
 * a day. A right password clears the email's counter.
 *
 * The PIN door (pin.ts) has one counter for the door itself, whoever is
 * trying it, because a PIN is short and a guesser can come from as many
 * addresses as they like. Its wrong tries are counted over a day, not a
 * quarter of an hour: five a day is the most a patient guesser gets. A
 * right PIN clears the count but not how long the next lock will be. Only
 * the set-up code wipes that.
 *
 * **The door's count is taken before the PIN is looked at** (`takePinTry`),
 * in one statement the database runs by itself, and wiped if the PIN turns
 * out right. Looking first and counting after lets a burst through: a
 * hundred guesses sent in the same instant would each read "no wrong tries
 * yet". With a password of twelve characters that costs nothing. With a
 * million PINs it is the whole game.
 *
 * It is a table, not memory: on a serverless host each request may land on a
 * different machine, and a counter that lives in one of them counts nothing.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

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

export function throttleKeys(email: string, ip: string | null): string[] {
  const keys = [`email:${email}`];
  if (known(ip)) keys.push(`ip:${ip}`);
  return keys;
}

/**
 * The address a try at the PIN came from, as its own counter. (The door's
 * counter is everybody's, and is kept by `takePinTry`.)
 */
export function addressKeys(ip: string | null): string[] {
  return known(ip) ? [`ip:${ip}`] : [];
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
  return { tries: FREE_TRIES, windowMs: WINDOW_MS };
}

/** The moment the caller may try again, or null if they may try now. */
export async function lockedUntil(
  db: DbOrTx,
  keys: readonly string[],
  now: Date,
): Promise<Date | null> {
  if (keys.length === 0) return null;
  const rows = await db
    .select()
    .from(authThrottle)
    .where(inArray(authThrottle.key, [...keys]));
  let latest: Date | null = null;
  for (const row of rows) {
    if (row.lockedUntil !== null && row.lockedUntil > now) {
      if (latest === null || row.lockedUntil > latest) latest = row.lockedUntil;
    }
  }
  return latest;
}

export async function recordFailure(
  db: DbOrTx,
  keys: readonly string[],
  now: Date,
): Promise<void> {
  for (const key of keys) {
    const [row] = await db
      .select()
      .from(authThrottle)
      .where(eq(authThrottle.key, key));

    if (row === undefined) {
      await db
        .insert(authThrottle)
        .values({ key, failures: 1, windowStartedAt: now })
        .onConflictDoNothing();
      continue;
    }

    const rule = ruleFor(key);
    const windowOver =
      now.getTime() - row.windowStartedAt.getTime() > rule.windowMs;
    const failures = windowOver ? 1 : row.failures + 1;

    if (failures >= rule.tries) {
      const lockMs = Math.min(FIRST_LOCK_MS * 2 ** row.lockCount, MAX_LOCK_MS);
      await db
        .update(authThrottle)
        .set({
          failures: 0,
          windowStartedAt: now,
          lockedUntil: new Date(now.getTime() + lockMs),
          lockCount: row.lockCount + 1,
        })
        .where(eq(authThrottle.key, key));
    } else {
      await db
        .update(authThrottle)
        .set({
          failures,
          windowStartedAt: windowOver ? now : row.windowStartedAt,
        })
        .where(eq(authThrottle.key, key));
    }
  }
}

/** A right password wipes the slate for that email (not for the address). */
export async function recordSuccess(db: DbOrTx, email: string): Promise<void> {
  await db.delete(authThrottle).where(eq(authThrottle.key, `email:${email}`));
}

export type PinTry =
  /** Go on and look at the PIN. `last`: a wrong one now locks the door. */
  | { readonly allowed: true; readonly last: boolean }
  | { readonly allowed: false; readonly until: Date };

/**
 * Take one try at the PIN door, before the PIN is looked at.
 *
 * One statement: the count goes up by one unless the door is locked, and
 * the database hands back what it came to. So of any number of tries that
 * arrive together, each is given its own place in the line, and only the
 * first five in a day are ever checked against the PIN.
 */
export async function takePinTry(db: DbOrTx, now: Date): Promise<PinTry> {
  // Written out and cast, the way every moment in a piece of raw SQL is
  // here, so both databases read it as the same instant.
  const at = sql`${now.toISOString()}::timestamptz`;
  const windowStart = sql`${new Date(now.getTime() - PIN_WINDOW_MS).toISOString()}::timestamptz`;
  const windowOver = sql`${authThrottle.windowStartedAt} < ${windowStart}`;
  const [row] = await db
    .insert(authThrottle)
    .values({ key: PIN_KEY, failures: 1, windowStartedAt: now })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        failures: sql`case when ${windowOver} then 1 else ${authThrottle.failures} + 1 end`,
        windowStartedAt: sql`case when ${windowOver} then ${at} else ${authThrottle.windowStartedAt} end`,
      },
      setWhere: sql`${authThrottle.lockedUntil} is null or ${authThrottle.lockedUntil} <= ${at}`,
    })
    .returning({ failures: authThrottle.failures });

  // Nothing came back: the door is locked, and the count was left alone.
  if (row === undefined)
    return { allowed: false, until: await pinLock(db, now) };
  // One past the last place in the line. Whoever holds the last place may
  // not have locked the door yet (or never will, if their request died),
  // so this one does.
  if (row.failures > FREE_TRIES) {
    return { allowed: false, until: await lockPinDoor(db, now) };
  }
  return { allowed: true, last: row.failures === FREE_TRIES };
}

/** When the PIN door's lock ends. Now, if it turns out not to be locked. */
async function pinLock(db: DbOrTx, now: Date): Promise<Date> {
  const [row] = await db
    .select({ lockedUntil: authThrottle.lockedUntil })
    .from(authThrottle)
    .where(eq(authThrottle.key, PIN_KEY));
  return row?.lockedUntil != null && row.lockedUntil > now
    ? row.lockedUntil
    : now;
}

/**
 * Lock the PIN door, one rung further up the ladder, and say until when.
 * Several tries can get here together. Only one of them climbs the rung:
 * the rest find the door already locked and are told the same moment.
 */
export async function lockPinDoor(db: DbOrTx, now: Date): Promise<Date> {
  const [row] = await db
    .select()
    .from(authThrottle)
    .where(eq(authThrottle.key, PIN_KEY));
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
        eq(authThrottle.key, PIN_KEY),
        // Still on the rung that was read: nobody else has locked it since.
        eq(authThrottle.lockCount, row.lockCount),
      ),
    )
    .returning({ lockedUntil: authThrottle.lockedUntil });
  return locked[0]?.lockedUntil ?? (await pinLock(db, now));
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
