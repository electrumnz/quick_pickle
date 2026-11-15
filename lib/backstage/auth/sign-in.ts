/**
 * Signing in: with an email and a password, or with the PIN while the door
 * is a PIN door (pin.ts).
 *
 * Free of anything Next-specific, so it is tested directly. The Server Action
 * in app/backstage/sign-in sets the cookie.
 *
 * It answers the same way, and takes about the same time, whether the email
 * is unknown, the password is wrong or the account is switched off: the page
 * never confirms that an address has an account.
 */

import { eq } from "drizzle-orm";

import { auditLog, users } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import { verifyPassword } from "./password";
import { PIN_LOGIN, pinSecret, seasoned } from "./pin";
import { createSession, type StaffUser } from "./sessions";
import {
  addressKeys,
  lockedUntil,
  lockPinDoor,
  recordFailure,
  recordPinSuccess,
  recordSuccess,
  takePinTry,
  throttleKeys,
} from "./throttle";

export type SignInResult =
  | {
      readonly ok: true;
      readonly token: string;
      readonly expiresAt: Date;
      readonly user: StaffUser;
    }
  | { readonly ok: false; readonly reason: "invalid" }
  | { readonly ok: false; readonly reason: "locked"; readonly until: Date };

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function signIn(
  db: DbOrTx,
  attempt: {
    readonly email: string;
    readonly password: string;
    readonly ip: string | null;
    readonly userAgent: string | null;
  },
  now: Date,
): Promise<SignInResult> {
  const email = normaliseEmail(attempt.email);
  const keys = throttleKeys(email, attempt.ip);

  const until = await lockedUntil(db, keys, now);
  if (until !== null) return { ok: false, reason: "locked", until };

  // The PIN login has a stand-in for an email. It is never let in this
  // way: its tries belong on the door's own counter.
  const [user] =
    email === "" || email === PIN_LOGIN
      ? []
      : await db.select().from(users).where(eq(users.email, email));

  const passwordOk = await verifyPassword(
    attempt.password,
    user?.passwordHash ?? null,
  );

  if (user === undefined || !passwordOk || user.disabledAt !== null) {
    await recordFailure(db, keys, now);
    const nowLocked = await lockedUntil(db, keys, now);
    return nowLocked === null
      ? { ok: false, reason: "invalid" }
      : { ok: false, reason: "locked", until: nowLocked };
  }

  await recordSuccess(db, email);
  return letIn(db, user, attempt, now);
}

/** What is known about whoever is at the door, kept with their session. */
type Caller = {
  readonly ip: string | null;
  readonly userAgent: string | null;
};

/** Start a session for somebody who has just proved who they are. */
async function letIn(
  db: DbOrTx,
  user: typeof users.$inferSelect,
  caller: Caller,
  now: Date,
): Promise<SignInResult> {
  const session = await createSession(
    db,
    user.id,
    { ip: caller.ip, userAgent: caller.userAgent },
    now,
  );
  await db.update(users).set({ lastSeenAt: now }).where(eq(users.id, user.id));
  await db.insert(auditLog).values({
    id: newId("aud"),
    at: now,
    actorType: user.kind === "bot" ? "bot" : "human",
    actorId: user.id,
    actorName: user.name,
    via: "ui",
    operation: "auth.signIn",
    entityType: "user",
    entityId: user.id,
    summary: `${user.name} signed in`,
    data: null,
  });

  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      kind: user.kind,
    },
  };
}

/**
 * Signing in with the PIN.
 *
 * Every try is counted against the door itself, whoever made it, and it is
 * counted before the PIN is looked at (`takePinTry` says why). Only the
 * first five in a day are ever checked. While the door is locked the right
 * PIN is turned away with the rest: a lock that let the right one through
 * would not slow a guesser at all. With no set-up code there is nothing to
 * check a PIN against, and every try is a wrong one.
 */
export async function signInWithPin(
  db: DbOrTx,
  attempt: Caller & { readonly pin: string },
  now: Date,
  env: Record<string, string | undefined> = process.env,
): Promise<SignInResult> {
  // An address that is locked out does not get to use up the door's tries.
  const address = addressKeys(attempt.ip);
  const addressLocked = await lockedUntil(db, address, now);
  if (addressLocked !== null) {
    return { ok: false, reason: "locked", until: addressLocked };
  }

  const turn = await takePinTry(db, now);
  if (!turn.allowed) return { ok: false, reason: "locked", until: turn.until };

  const secret = pinSecret(env);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, PIN_LOGIN));

  const pin = attempt.pin.trim();
  // Asked whatever was typed, so a try that could never be a PIN takes as
  // long to turn away as one that could.
  const pinOk = await verifyPassword(
    seasoned(pin, secret ?? ""),
    secret === null ? null : (user?.passwordHash ?? null),
  );

  if (user === undefined || !pinOk || user.disabledAt !== null) {
    await recordFailure(db, address, now);
    if (turn.last) {
      return { ok: false, reason: "locked", until: await lockPinDoor(db, now) };
    }
    const nowLocked = await lockedUntil(db, address, now);
    return nowLocked === null
      ? { ok: false, reason: "invalid" }
      : { ok: false, reason: "locked", until: nowLocked };
  }

  await recordPinSuccess(db);
  return letIn(db, user, attempt, now);
}
