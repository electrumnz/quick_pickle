/**
 * Signing in with an email and a password.
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
import { createSession, type StaffUser } from "./sessions";
import {
  lockedUntil,
  recordFailure,
  recordSuccess,
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

  const [user] =
    email === ""
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
  const session = await createSession(
    db,
    user.id,
    { ip: attempt.ip, userAgent: attempt.userAgent },
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
