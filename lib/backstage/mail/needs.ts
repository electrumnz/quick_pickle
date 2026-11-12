/**
 * What in mail needs a person today, for the Today screen.
 *
 *   - One line saying how many conversations are waiting for a reply, and how
 *     long the oldest has waited. It is the day's ordinary work until one has
 *     waited two working days, and urgent after that.
 *   - One line for each email of ours that was tried and did not go, or went
 *     and came back, oldest first: somebody was told something was on its way
 *     to them and it is not. One the queue is still trying by itself (the
 *     provider was busy) is not listed until the queue has given up.
 *
 * An email that was written down and deliberately not sent (no provider
 * connected, a test order) is not here. Nothing went wrong with it, and the
 * go-live list is where "email is not connected" is said.
 *
 * The shape is the one the Today screen lists (`Need` in today/ops.ts), kept
 * as its own type so that mail does not lean on another area.
 */

import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { mailConversations, mailMessages, orders } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

import { NUDGE_AFTER_WORKING_DAYS, workingDaysBetween } from "./status";

export type MailNeed = {
  /** Stable, so a screen can key on it and a test can find it. */
  readonly key: string;
  readonly urgent: boolean;
  readonly title: string;
  readonly detail: string;
  /** Where to go to deal with it. */
  readonly href: string;
};

const days = (n: number) =>
  n === 1 ? "1 working day" : `${String(n)} working days`;

export async function mailNeeds(db: DbOrTx, now: Date): Promise<MailNeed[]> {
  const needs: MailNeed[] = [];

  // Waiting on us: needing a reply and not put away until later.
  const waiting = await db
    .select({ lastInboundAt: mailConversations.lastInboundAt })
    .from(mailConversations)
    .where(
      and(
        eq(mailConversations.status, "needs-reply"),
        or(
          isNull(mailConversations.snoozedUntil),
          lte(mailConversations.snoozedUntil, now),
        ),
      ),
    )
    .orderBy(asc(mailConversations.lastInboundAt))
    .limit(500);
  if (waiting.length > 0) {
    const longest = waiting.reduce(
      (most, row) =>
        row.lastInboundAt === null
          ? most
          : Math.max(most, workingDaysBetween(row.lastInboundAt, now)),
      0,
    );
    needs.push({
      key: "inbox-needs-reply",
      urgent: longest >= NUDGE_AFTER_WORKING_DAYS,
      title:
        waiting.length === 1
          ? "An email is waiting for a reply"
          : `${String(waiting.length)} emails are waiting for a reply`,
      detail:
        longest === 0
          ? waiting.length === 1
            ? "It came in today."
            : "The oldest came in today."
          : waiting.length === 1
            ? `It has waited ${days(longest)}.`
            : `The oldest has waited ${days(longest)}.`,
      href: "/backstage/inbox",
    });
  }

  // Ours that did not get there, and that nobody has said is dealt with.
  const undelivered = await db
    .select({
      id: mailMessages.id,
      conversationId: mailMessages.conversationId,
      status: mailMessages.status,
      to: mailMessages.toAddresses,
      error: mailMessages.error,
      at: mailMessages.at,
      number: orders.number,
    })
    .from(mailMessages)
    // An order's email carries the order's id in a note of its own.
    .leftJoin(orders, sql`${orders.id} = ${mailMessages.headers}->>'qp:order'`)
    .where(
      and(
        eq(mailMessages.direction, "out"),
        inArray(mailMessages.status, ["failed", "bounced"]),
        sql`(${mailMessages.headers}->>'qp:seen') is null`,
        sql`(${mailMessages.headers}->>'qp:retrying') is null`,
      ),
    )
    .orderBy(asc(mailMessages.createdAt))
    .limit(40);

  for (const email of undelivered) {
    const to = email.to.join(", ");
    if (email.number !== null && email.status === "failed") {
      // An order's own email: its page is where it is tried again.
      needs.push({
        key: `email-failed:${email.id}`,
        urgent: true,
        title: `An email about ${email.number} did not go`,
        detail: `${to} has not had it. ${email.error ?? "The order's page says why."}`,
        href: `/backstage/orders/${email.number}`,
      });
      continue;
    }
    // A later email in the same conversation that went has overtaken it:
    // the inbox stops listing it then, and so does this.
    const [later] = await db
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.conversationId, email.conversationId),
          eq(mailMessages.direction, "out"),
          eq(mailMessages.status, "sent"),
          gt(mailMessages.at, email.at),
        ),
      )
      .limit(1);
    if (later !== undefined) continue;
    const about = email.number === null ? "" : ` about ${email.number}`;
    needs.push({
      key: `email-${email.status}:${email.id}`,
      urgent: true,
      title:
        email.status === "bounced"
          ? `An email${about} to ${to} came back`
          : `An email to ${to} did not go`,
      detail:
        email.error ??
        (email.status === "bounced"
          ? "It came back undelivered."
          : "The conversation says why."),
      href: `/backstage/inbox/${email.conversationId}`,
    });
  }

  return needs.slice(0, 21);
}
