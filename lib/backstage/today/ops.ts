/**
 * Today: what needs a person, now.
 *
 * One list, built from every area of the back end, of the things that will
 * not sort themselves out: money that arrived and does not match, a refund
 * that would not go, a step that has run out of tries. Packing is not on it;
 * that is the day's ordinary work and has its own block.
 *
 * It is an operation so that the screen and a bot asking "what needs doing?"
 * read the same list. Each area adds its own kind as it lands.
 */

import { and, asc, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { orders, refunds } from "@/db/schema";
import { formatNzd } from "@/lib/shop/money";
import { minutesSince } from "@/lib/time";

import { lastTick } from "../clock/tick";
import { listStuckEvents } from "../core/events";
import { defineOp } from "../core/op";
import { marketingNeedsYou } from "../marketing/overview";
import { plansNeeds } from "../plans/needs";

export type Need = {
  /** Stable, so a screen can key on it and a test can find it. */
  readonly key: string;
  /** Money or a customer is waiting on it. Shown first. */
  readonly urgent: boolean;
  readonly title: string;
  readonly detail: string;
  /** Where to go to deal with it. */
  readonly href: string;
};

const orderLink = (number: string) => `/backstage/orders/${number}`;

/** A refund that failed this long ago has been seen, or no longer matters. */
const FAILED_REFUND_DAYS = 30;

/** The clock comes round every five minutes. Quiet for this long is stopped. */
const CLOCK_QUIET_MINUTES = 20;

export const needsYou = defineOp({
  name: "today.needs",
  title: "What needs a person now",
  description:
    "The things that will not sort themselves out: a payment that does not match its order, an order paid for after it was cancelled, a refund that did not go through, steps that have failed and run out of tries, a clock that has stopped, and whatever marketing has waiting (a campaign that stopped itself, reviews to read, posts due, partners to follow up). Most urgent first. Empty when nothing needs anyone.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<Need[]> {
    const needs: Need[] = [];

    // Money arrived that does not match the order.
    const inReview = await ctx.db
      .select({ number: orders.number, totalCents: orders.totalCents })
      .from(orders)
      .where(eq(orders.paymentStatus, "review"))
      .orderBy(asc(orders.createdAt))
      .limit(20);
    for (const order of inReview) {
      needs.push({
        key: `payment-review:${order.number}`,
        urgent: true,
        title: `The payment for ${order.number} does not match`,
        detail: `Money arrived, but not the ${formatNzd(order.totalCents)} the order comes to. It has not been marked as paid.`,
        href: orderLink(order.number),
      });
    }

    // Paid through Stripe after the order was called off.
    const paidAfterCancel = await ctx.db
      .select({
        number: orders.number,
        totalCents: orders.totalCents,
        refundedCents: orders.refundedCents,
      })
      .from(orders)
      .where(
        and(
          eq(orders.status, "cancelled"),
          eq(orders.paymentProvider, "stripe"),
          isNotNull(orders.paidAt),
          inArray(orders.paymentStatus, ["paid", "part_refunded", "test"]),
          lt(orders.refundedCents, orders.totalCents),
        ),
      )
      .orderBy(asc(orders.createdAt))
      .limit(20);
    for (const order of paidAfterCancel) {
      needs.push({
        key: `paid-after-cancel:${order.number}`,
        urgent: true,
        title: `${order.number} was paid for after it was cancelled`,
        detail: `${formatNzd(order.totalCents - order.refundedCents)} needs to go back to the customer.`,
        href: orderLink(order.number),
      });
    }

    // A refund Stripe refused, on an order that still has money to give back.
    const since = new Date(
      ctx.now.getTime() - FAILED_REFUND_DAYS * 24 * 60 * 60_000,
    );
    const failedRefunds = await ctx.db
      .select({
        number: orders.number,
        amountCents: sql<number>`max(${refunds.amountCents})::int`,
      })
      .from(refunds)
      .innerJoin(orders, eq(orders.id, refunds.orderId))
      .where(
        and(
          eq(refunds.status, "failed"),
          gt(refunds.createdAt, since),
          lt(orders.refundedCents, orders.totalCents),
          // Sorted since: a later refund on the same order went through.
          sql`not exists (select 1 from ${refunds} as later where later.order_id = "orders"."id" and later.status in ('done', 'pending') and later.created_at > ${refunds.createdAt})`,
        ),
      )
      .groupBy(orders.number)
      .limit(20);
    for (const refund of failedRefunds) {
      // Already listed for a bigger reason.
      if (needs.some((need) => need.href === orderLink(refund.number)))
        continue;
      needs.push({
        key: `refund-failed:${refund.number}`,
        urgent: true,
        title: `A refund on ${refund.number} did not go through`,
        detail: `${formatNzd(refund.amountCents)} was not sent back. The order's history says why.`,
        href: orderLink(refund.number),
      });
    }

    // Steps that have had all their tries.
    const stuck = await listStuckEvents(ctx.db, 200);
    const gaveUp = stuck.filter((step) => step.gaveUp).length;
    if (gaveUp > 0) {
      needs.push({
        key: "steps-out-of-tries",
        urgent: true,
        title:
          gaveUp === 1
            ? "A step has failed and run out of tries"
            : `${String(gaveUp)} steps have failed and run out of tries`,
        detail:
          "Something that should have happened after a change has not. Have a look and try it again.",
        href: "/backstage/settings/clock",
      });
    }

    // The clock, once it has ever run, going quiet.
    const pulse = await lastTick(ctx.db);
    if (
      pulse !== null &&
      minutesSince(new Date(pulse.at), ctx.now) >= CLOCK_QUIET_MINUTES
    ) {
      needs.push({
        key: "clock-stopped",
        urgent: false,
        title: "The clock has stopped",
        detail:
          "Nothing is being tried again and unpaid orders are not being closed. You can run it by hand while it is looked into.",
        href: "/backstage/settings/clock",
      });
    }

    // Marketing keeps its own list of what is waiting: a campaign that has
    // stopped itself is urgent, the rest is the week's ordinary work.
    const marketing = await marketingNeedsYou.run(ctx, {});
    for (const item of marketing.items) {
      needs.push({
        key: `marketing-${item.key}`,
        urgent: item.key === "held",
        title: item.sentence,
        detail: "In Marketing.",
        href: item.href,
      });
    }

    // Plans: tasks that are due, and a compliance check that has come round.
    for (const item of await plansNeeds(ctx.db, ctx.now)) {
      needs.push({
        key: `plans-${item.key}`,
        urgent: item.urgent,
        title: item.title,
        detail: item.detail,
        href: item.href,
      });
    }

    return [...needs].sort((a, b) => Number(b.urgent) - Number(a.urgent));
  },
});
