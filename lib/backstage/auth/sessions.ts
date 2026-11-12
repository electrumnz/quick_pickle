/**
 * Sessions: a signed-in browser.
 *
 * A session ends when the person signs out, when it has not been used for a
 * week, or thirty days after it started, whichever comes first. An owner can
 * end anyone's from the staff page.
 */

import { and, eq, gt, isNull } from "drizzle-orm";

import { sessions, users, type Role } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

import { hashToken, newToken } from "./tokens";

export const IDLE_MS = 7 * 24 * 60 * 60_000;
export const ABSOLUTE_MS = 30 * 24 * 60 * 60_000;
/** How stale "last seen" may get before a request bothers to update it. */
const TOUCH_AFTER_MS = 5 * 60_000;

export type StaffUser = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly kind: "person" | "bot";
};

export async function createSession(
  db: DbOrTx,
  userId: string,
  meta: { readonly ip: string | null; readonly userAgent: string | null },
  now: Date,
): Promise<{ readonly token: string; readonly expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + ABSOLUTE_MS);
  await db.insert(sessions).values({
    id: await hashToken(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

/** The user a cookie token belongs to, or null if it is no good any more. */
export async function readSession(
  db: DbOrTx,
  token: string | undefined,
  now: Date,
): Promise<StaffUser | null> {
  if (token === undefined || token.length < 20 || token.length > 200) {
    return null;
  }
  const id = await hashToken(token);
  const [row] = await db
    .select({
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      kind: users.kind,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, id),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    );
  if (row === undefined || row.disabledAt !== null) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > IDLE_MS) return null;

  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, id));
    await db
      .update(users)
      .set({ lastSeenAt: now })
      .where(eq(users.id, row.userId));
  }
  return {
    id: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
    kind: row.kind,
  };
}

export async function revokeSession(
  db: DbOrTx,
  token: string,
  now: Date,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(eq(sessions.id, await hashToken(token)));
}

/** Sign a user out everywhere: a changed password, or an owner's say-so. */
export async function revokeAllSessions(
  db: DbOrTx,
  userId: string,
  now: Date,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
