/**
 * Slowing down guesses.
 *
 * Two counters per sign-in attempt: one for the email being tried, one for
 * the address it came from. Five wrong tries inside fifteen minutes locks
 * that counter for fifteen minutes, and each further lock-out doubles, up to
 * a day. A right password clears the email's counter.
 *
 * It is a table, not memory: on a serverless host each request may land on a
 * different machine, and a counter that lives in one of them counts nothing.
 */

import { eq, inArray } from "drizzle-orm";

import { authThrottle } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

export const FREE_TRIES = 5;
export const WINDOW_MS = 15 * 60_000;
export const FIRST_LOCK_MS = 15 * 60_000;
export const MAX_LOCK_MS = 24 * 60 * 60_000;

export function throttleKeys(email: string, ip: string | null): string[] {
  const keys = [`email:${email}`];
  if (ip !== null && ip !== "") keys.push(`ip:${ip}`);
  return keys;
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

    const windowOver =
      now.getTime() - row.windowStartedAt.getTime() > WINDOW_MS;
    const failures = windowOver ? 1 : row.failures + 1;
    // An address is shared by a whole office or a phone network, so it gets
    // four times the room an email does before it is locked.
    const limit = key.startsWith("ip:") ? FREE_TRIES * 4 : FREE_TRIES;

    if (failures >= limit) {
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
