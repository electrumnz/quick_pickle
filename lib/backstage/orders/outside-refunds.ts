/**
 * Refunds that were not started here.
 *
 * Money can go back to a customer from Stripe's own dashboard, with the
 * back end none the wiser: the order would go on saying "paid", the customer
 * would be told nothing by us, and the books would be out by that much.
 *
 * So when Stripe says a payment was refunded, the refunds Stripe holds for
 * that payment are read, and any the order does not already have are written
 * onto it. Stripe's list is the record, the news is only the nudge, so it is
 * safe to be told twice, late or out of order.
 *
 * A refund started from the back end comes round this way too (Stripe sends
 * the same news for it). It is known by our own id, which Stripe carries on
 * the refund, and is left alone.
 *
 * A refund can also come back. It leaves, the customer is told, and days
 * later the bank says the card it was going to has been closed: Stripe marks
 * the refund failed and puts the money back in the balance. That is read the
 * same way, off Stripe's list. A refund the order holds as given, which
 * Stripe now says failed, is written down as returned: it comes back off
 * what the order has given back, and keeps both its dates, because money
 * moved twice. Nobody is told by us. A person has to send it another way.
 */

import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { orders, refunds } from "@/db/schema";
import { newId } from "@/lib/db/id";
import { formatNzd } from "@/lib/shop/money";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";
import {
  listRefunds,
  retrieveCheckoutSession,
  retrievePaymentIntent,
  stripeSecretKey,
} from "@/lib/shop/payments/stripe";

import { systemCaller } from "../core/actor";
import { defineOp, execute, type ExecuteOptions } from "../core/op";
import { loadOrder } from "./load";
import { paymentStatusAfter, refundsThroughStripe } from "./refunds";

/** Stripe's reasons, in our words. Anything else is left out. */
const WHY: Readonly<Record<string, string>> = {
  requested_by_customer: "the customer asked",
  duplicate: "it was paid twice",
  fraudulent: "the payment was not the cardholder's",
};

/** Why Stripe says a refund failed, in our words. Anything else: no reason. */
const WHY_NOT: Readonly<Record<string, string>> = {
  lost_or_stolen_card: "the card was reported lost or stolen",
  expired_or_canceled_card: "the card has expired or been closed",
  charge_for_pending_refund_disputed:
    "the customer disputed the payment while the refund was on its way",
  insufficient_funds: "there was not enough in the Stripe balance to cover it",
  declined: "the customer's bank would not take it",
  merchant_request: "it was stopped from Stripe's dashboard",
};

/** A sentence saying why a refund came back, or nothing. */
export function whyItCameBack(reason: string | null | undefined): string {
  const why = reason == null ? undefined : WHY_NOT[reason];
  return why === undefined ? "" : ` Stripe says ${why}.`;
}

const seenRefund = z.object({
  /** The processor's own id for the refund: re_... */
  reference: z.string().trim().min(1).max(200),
  amountCents: z.number().int().min(1).max(100_000_000),
  /** When the processor made it. */
  at: z.date(),
  /** Our own refund's id, if the processor carries one: it is ours. */
  ours: z.string().trim().max(40).optional(),
  /** The processor's word for why, if it gave one. */
  why: z.string().trim().max(60).optional(),
});

/** A refund the processor says failed or was called off. */
const failedRefund = z.object({
  /** The processor's own id for the refund: re_... */
  reference: z.string().trim().min(1).max(200),
  /** Our own refund's id, if the processor carries one. */
  ours: z.string().trim().max(40).optional(),
  /** The processor's word for why it failed, if it gave one. */
  why: z.string().trim().max(60).optional(),
});

export const refundsSeen = defineOp({
  name: "orders.refundsSeen",
  title: "Write down refunds made at the payment processor",
  description:
    "Given the refunds the payment processor holds for an order's payment, writes onto the order any that the back end does not already have: ones made from the processor's own dashboard. A refund the back end started itself is known by its id and left alone, so this is safe to run as often as the processor sends news. Each new one is recorded as given, counts against what is left to refund, and raises the same event as any other refund. It sends no money anywhere: the money has already gone. `returned` lists refunds the processor says failed or were called off: one the order holds as given is written down as returned (it left and came back, so the customer has not had it), comes back off what the order has given back, and raises order.refund_failed so a person sends it another way.",
  access: "write",
  input: z.object({
    number: z.string().trim().toUpperCase().regex(ORDER_NUMBER_PATTERN),
    refunds: z.array(seenRefund).max(100),
    returned: z.array(failedRefund).max(100).default([]),
  }),
  async run(
    ctx,
    input,
  ): Promise<{ written: number; returned: number; refundedCents: number }> {
    const order = await loadOrder(ctx.db, input.number, { forChange: true });
    const known = await ctx.db
      .select({
        id: refunds.id,
        reference: refunds.providerReference,
        status: refunds.status,
        amountCents: refunds.amountCents,
        createdAt: refunds.createdAt,
      })
      .from(refunds)
      .where(eq(refunds.orderId, order.id));
    const news = input.refunds
      .filter(
        (seen) =>
          !known.some(
            (row) => row.reference === seen.reference || row.id === seen.ours,
          ),
      )
      // Oldest first, so the order's history reads in the order it happened.
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    // The same refund twice in one list is one refund.
    const fresh = news.filter(
      (seen, at) =>
        news.findIndex((other) => other.reference === seen.reference) === at,
    );
    // Refunds we hold as given that the processor now says did not get
    // there. One still waiting for its first answer is not ours to settle
    // here (orders.refundSettled does that), and one already written down
    // as failed or returned is old news.
    const back = input.returned.flatMap((gone) => {
      const row = known.find(
        (each) => each.reference === gone.reference || each.id === gone.ours,
      );
      return row !== undefined && row.status === "done"
        ? [{ row, why: gone.why }]
        : [];
    });
    const cameBack = back.filter(
      (one, at) =>
        back.findIndex((other) => other.row.id === one.row.id) === at,
    );
    if (fresh.length === 0 && cameBack.length === 0) {
      ctx.nothingChanged();
      return { written: 0, returned: 0, refundedCents: order.refundedCents };
    }

    const entity = { type: "order", id: order.id };
    let refundedCents = order.refundedCents;
    for (const seen of fresh) {
      const refundId = newId("rfd");
      await ctx.db.insert(refunds).values({
        id: refundId,
        orderId: order.id,
        amountCents: seen.amountCents,
        reason: `Refunded from Stripe's dashboard${seen.why === undefined || WHY[seen.why] === undefined ? "" : `: ${WHY[seen.why] ?? ""}`}`,
        status: "done",
        providerReference: seen.reference,
        createdBy: null,
        createdAt: seen.at,
      });
      refundedCents += seen.amountCents;
      const over = refundedCents > order.totalCents;
      await ctx.audit({
        entity,
        summary: `${formatNzd(seen.amountCents)} was refunded on ${order.number} from Stripe's dashboard. Written onto the order.${over ? ` That makes more given back than the ${formatNzd(order.totalCents)} that was paid: have a look in Stripe.` : ""}`,
        data: { amountCents: seen.amountCents, reference: seen.reference },
      });
      await ctx.emit({
        type: "order.refunded",
        entity,
        payload: {
          number: order.number,
          // Which refund, so the email about it is written once and for
          // this one (lib/backstage/orders/emails.ts).
          refundId,
          amountCents: seen.amountCents,
          test: order.isTest,
        },
      });
    }

    let returned = 0;
    for (const { row, why } of cameBack) {
      // Guarded: told twice at the same moment, one of them writes it.
      const taken = await ctx.db
        .update(refunds)
        .set({ status: "returned", returnedAt: ctx.now })
        .where(and(eq(refunds.id, row.id), eq(refunds.status, "done")))
        .returning({ id: refunds.id });
      if (taken.length === 0) continue;
      returned += 1;
      refundedCents = Math.max(0, refundedCents - row.amountCents);
      await ctx.audit({
        entity,
        summary: `The refund of ${formatNzd(row.amountCents)} on ${order.number} did not reach the customer and has come back.${whyItCameBack(why)} They have not had the money`,
        data: { refundId: row.id, amountCents: row.amountCents, why },
      });
      await ctx.emit({
        type: "order.refund_failed",
        entity,
        payload: {
          number: order.number,
          amountCents: row.amountCents,
          refundId: row.id,
          returned: true,
        },
      });
    }
    if (fresh.length === 0 && returned === 0) {
      ctx.nothingChanged();
      return { written: 0, returned: 0, refundedCents: order.refundedCents };
    }

    await ctx.db
      .update(orders)
      .set({
        refundedCents,
        paymentStatus: paymentStatusAfter({ ...order, refundedCents }),
        updatedAt: ctx.now,
      })
      .where(eq(orders.id, order.id));
    return { written: fresh.length, returned, refundedCents };
  },
});

type Options = ExecuteOptions & {
  readonly env?: Record<string, string | undefined>;
  readonly fetchImpl?: typeof fetch;
};

const stripeDesk = systemCaller("Stripe", "webhook");

/**
 * Stripe says money went back on a payment: find the order, read the
 * refunds Stripe holds for it, and write down any that are news.
 *
 * The order is found from what the payment says about itself, and then
 * checked the other way: the payment Stripe names has to be the one the
 * order was paid with. A payment that is not one of ours is nobody's
 * business here, and the answer is no order.
 *
 * It asks Stripe things, so it is never called inside a transaction. If
 * Stripe cannot be reached it throws, and whoever brought the news is asked
 * to bring it again.
 */
export async function refundsFromStripe(
  input: {
    readonly number: string | null;
    readonly paymentIntent: string | null;
  },
  options: Options = {},
): Promise<{ number: string | null; written: number; returned: number }> {
  const key = stripeSecretKey(options.env);
  const run = {
    ...(options.db === undefined ? {} : { db: options.db }),
    ...(options.now === undefined ? {} : { now: options.now }),
  };

  let number = input.number;
  if (number === null && input.paymentIntent !== null) {
    const payment = await retrievePaymentIntent(
      key,
      input.paymentIntent,
      options.fetchImpl,
    );
    const said = payment.metadata?.order_number ?? "";
    number = ORDER_NUMBER_PATTERN.test(said) ? said : null;
  }
  if (number === null) return { number: null, written: 0, returned: 0 };

  const db = options.db ?? (await (await import("@/lib/db/client")).getDb());
  const [order] = await db
    .select({
      paymentProvider: orders.paymentProvider,
      paymentReference: orders.paymentReference,
    })
    .from(orders)
    .where(eq(orders.number, number));
  // Not an order of ours, or not one that was paid on Stripe's page.
  if (order === undefined || !refundsThroughStripe(order)) {
    return { number: null, written: 0, returned: 0 };
  }
  const session = await retrieveCheckoutSession(
    key,
    order.paymentReference ?? "",
    options.fetchImpl,
  );
  const payment = session.payment_intent;
  if (typeof payment !== "string" || payment === "") {
    return { number: null, written: 0, returned: 0 };
  }
  // The news has to be about the payment this order was paid with.
  if (input.paymentIntent !== null && input.paymentIntent !== payment) {
    return { number: null, written: 0, returned: 0 };
  }

  const held = await listRefunds(key, payment, options.fetchImpl);
  const seen = held
    // Only money that has gone, or is on its way. In New Zealand dollars:
    // the page only ever charged in those.
    .filter(
      (refund) =>
        (refund.status === "succeeded" || refund.status === "pending") &&
        (refund.currency ?? "nzd").toLowerCase() === "nzd" &&
        Number.isInteger(refund.amount) &&
        refund.amount > 0,
    )
    .map((refund) => ({
      reference: refund.id,
      amountCents: refund.amount,
      at:
        typeof refund.created === "number"
          ? new Date(refund.created * 1000)
          : (options.now ?? new Date()),
      ...(refund.metadata?.refund_id === undefined
        ? {}
        : { ours: refund.metadata.refund_id }),
      ...(refund.reason == null ? {} : { why: refund.reason }),
    }));
  // And the ones that did not get there: failed, or called off before they
  // left. Only one the order holds as given back is changed by this.
  const returned = held
    .filter(
      (refund) => refund.status === "failed" || refund.status === "canceled",
    )
    .map((refund) => ({
      reference: refund.id,
      ...(refund.metadata?.refund_id === undefined
        ? {}
        : { ours: refund.metadata.refund_id }),
      ...(refund.failure_reason == null ? {} : { why: refund.failure_reason }),
    }));
  const done = await execute(
    refundsSeen,
    { number, refunds: seen, returned },
    stripeDesk,
    run,
  );
  return { number, written: done.written, returned: done.returned };
}
