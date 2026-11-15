/**
 * Checking the set-up code somebody typed.
 *
 * The set-up code is the long phrase only whoever hosts the site can read
 * (BACKSTAGE_SETUP_CODE). It makes the first owner. While the door is a PIN
 * door (pin.ts) it also sets a new PIN, and it is asked for again when the
 * PIN is swapped for a proper login, so that somebody who only knows the
 * PIN can never put the back end out of the real owner's reach.
 *
 * One function checks it wherever it is typed, so a wrong one is counted
 * the same way everywhere: against the address it came from (throttle.ts
 * says why not against a counter everybody shares).
 */

import type { DbOrTx } from "@/lib/db/types";
import { formatNzDateTime, formatNzTime, nzDateKey } from "@/lib/time";

import { pinSecret } from "./pin";
import { lockedUntil, recordFailure, setUpThrottleKeys } from "./throttle";
import { sameSecret } from "./tokens";

type Env = Record<string, string | undefined>;

/** What a form shows: a sentence for the whole form, or one beside a field. */
export type Refusal = {
  readonly error: string | null;
  readonly fields: Readonly<Record<string, string>>;
};

export const SET_UP_OFF =
  "Set-up is switched off. BACKSTAGE_SETUP_CODE needs to be set (16 characters or more) where the site is hosted.";

export const NOT_THE_CODE = "That is not the set-up code";

/** True when there is a set-up code long enough to be one. */
export function setUpIsOn(env: Env = process.env): boolean {
  return pinSecret(env) !== null;
}

/**
 * When a lock ends, for a sentence. A lock can run into tomorrow, and a
 * time of day alone would then send somebody back a day early.
 */
export function lockEnds(until: Date, now: Date = new Date()): string {
  return nzDateKey(until) === nzDateKey(now)
    ? formatNzTime(until)
    : formatNzDateTime(until);
}

/** True when what was typed is the set-up code. Never says how close. */
export function isSetUpCode(typed: string, env: Env = process.env): boolean {
  const code = pinSecret(env);
  return code !== null && sameSecret(typed.trim(), code);
}

/**
 * Why the set-up code that was typed opens nothing, as what the form
 * shows, or null when it is the code. A wrong one is counted against the
 * address it came from.
 */
export async function setUpCodeRefused(
  db: DbOrTx,
  typed: string,
  ip: string | null,
  now: Date = new Date(),
  env: Env = process.env,
): Promise<Refusal | null> {
  if (!setUpIsOn(env)) return { error: SET_UP_OFF, fields: {} };
  const keys = setUpThrottleKeys(ip);
  const until = await lockedUntil(db, keys, now);
  if (until !== null) {
    return {
      error: `Too many wrong tries. Have another go after ${lockEnds(until, now)}.`,
      fields: {},
    };
  }
  if (!isSetUpCode(typed, env)) {
    await recordFailure(db, keys, now);
    return { error: null, fields: { code: NOT_THE_CODE } };
  }
  return null;
}
