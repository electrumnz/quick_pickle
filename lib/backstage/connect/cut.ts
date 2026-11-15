/**
 * Ending every connection made under one person's login.
 *
 * A person's Claude is let in by that person's yes, given while they were
 * signed in. When the way they sign in is set again because it may be in
 * somebody else's hands (a new PIN by the set-up code, a new password link,
 * a PIN swapped for a proper login), a yes given under the old one cannot
 * be told from the person's own. Signing every browser out is not enough:
 * a connection renews itself and never asks for the password or the PIN
 * again. So every connection under the login ends as well, and so does a
 * yes that was given and has not been collected. The person connects again
 * from Claude. (An independent review found the gap, 15 November 2026.)
 *
 * It imports nothing but the tables, so the staff operations can call it
 * without pulling the rest of the connection in.
 */

import { and, eq, isNull } from "drizzle-orm";

import { connections, oauthCodes } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

/** Cuts them off, and says how many there were. */
export async function cutConnectionsOf(
  db: DbOrTx,
  userId: string,
  now: Date,
  why: string,
): Promise<number> {
  const cut = await db
    .update(connections)
    .set({ revokedAt: now, revokedWhy: why })
    .where(and(eq(connections.userId, userId), isNull(connections.revokedAt)))
    .returning({ id: connections.id });
  // A yes that was given a moment ago and is waiting to be swapped for
  // keys: spent, so it can never become a connection.
  await db
    .update(oauthCodes)
    .set({ usedAt: now })
    .where(and(eq(oauthCodes.userId, userId), isNull(oauthCodes.usedAt)));
  return cut.length;
}
