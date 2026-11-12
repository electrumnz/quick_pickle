/**
 * What in mail needs a person today, for the Today screen.
 *
 * One line for each email of ours that was tried and did not go, oldest
 * first: a customer was told something was on its way to them and it is not.
 * An email that was written down and deliberately not sent (no provider
 * connected, a test order) is not here. Nothing went wrong with it, and the
 * go-live list is where "email is not connected" is said.
 *
 * The shape is the one the Today screen lists (`Need` in today/ops.ts), kept
 * as its own type so that mail does not lean on another area.
 */

import { and, asc, eq, sql } from "drizzle-orm";

import { mailMessages, orders } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

export type MailNeed = {
  /** Stable, so a screen can key on it and a test can find it. */
  readonly key: string;
  readonly urgent: boolean;
  readonly title: string;
  readonly detail: string;
  /** Where to go to deal with it. */
  readonly href: string;
};

export async function mailNeeds(db: DbOrTx): Promise<MailNeed[]> {
  const failed = await db
    .select({
      id: mailMessages.id,
      to: mailMessages.toAddresses,
      error: mailMessages.error,
      number: orders.number,
    })
    .from(mailMessages)
    // An order's email carries the order's id in a note of its own.
    .leftJoin(orders, sql`${orders.id} = ${mailMessages.headers}->>'qp:order'`)
    .where(
      and(eq(mailMessages.direction, "out"), eq(mailMessages.status, "failed")),
    )
    .orderBy(asc(mailMessages.createdAt))
    .limit(20);

  return failed.flatMap((email) => {
    // Until the inbox has a page for it, only an order's email has
    // somewhere to be dealt with.
    if (email.number === null) return [];
    return [
      {
        key: `email-failed:${email.id}`,
        urgent: true,
        title: `An email about ${email.number} did not go`,
        detail: `${email.to.join(", ")} has not had it. ${email.error ?? "The order's page says why."}`,
        href: `/backstage/orders/${email.number}`,
      },
    ];
  });
}
