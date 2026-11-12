/**
 * Giving money back.
 *
 * A refund is written down by `orders.recordRefund` (./ops.ts). For an order
 * that was paid by card through Stripe that is only half of it: the money
 * still has to go back to the card. That is an outward call, so it is not
 * made inside the operation. The refund is saved as "pending", an event is
 * left behind, and the listener here sends it and writes down how it went.
 *
 * The refund's own row is the record of whether the money went. Stripe is
 * asked to refund by our refund's id, so asking twice refunds once; and
 * before asking at all, Stripe's own list of refunds for the payment is
 * checked for that id, because Stripe only remembers a request for a day and
 * a retry can come later than that.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { orders, refunds, type PaymentStatus } from "@/db/schema";
import { formatNzd } from "@/lib/shop/money";
import {
  createRefund,
  listRefunds,
  retrieveCheckoutSession,
  StripeError,
  stripeSecretKey,
} from "@/lib/shop/payments/stripe";

import { systemCaller } from "../core/actor";
import type { Handler } from "../core/events";
import { notFound } from "../core/errors";
import { defineOp, execute } from "../core/op";

/**
 * Does the money for this order go back through Stripe? Only when it came in
 * through Stripe's payment page. Anything else (the practice checkout, a
 * payment taken some other way) is written down and sent back by hand.
 */
export function refundsThroughStripe(order: {
  readonly paymentProvider: string;
  readonly paymentReference: string | null;
}): boolean {
  return (
    order.paymentProvider === "stripe" &&
    (order.paymentReference ?? "").startsWith("cs_")
  );
}

/** What the order's payment reads as, given how much has gone back. */
export function paymentStatusAfter(order: {
  readonly isTest: boolean;
  readonly totalCents: number;
  readonly refundedCents: number;
}): PaymentStatus {
  if (order.isTest) return "test";
  if (order.refundedCents <= 0) return "paid";
  return order.refundedCents >= order.totalCents ? "refunded" : "part_refunded";
}

export const refundSettled = defineOp({
  name: "orders.refundSettled",
  title: "Write down how a refund went",
  description:
    "Records the payment processor's answer to a refund that was waiting: it went, or it was refused. A refused refund is taken back off the order so it can be tried again or sent another way. Called by the back end itself once the processor has answered; not something to run by hand.",
  access: "write",
  input: z.object({
    refundId: z.string().trim().min(1).max(40),
    outcome: z.enum(["done", "failed"]),
    /** The processor's own id for the refund, when it went. */
    providerReference: z.string().trim().max(200).optional(),
    /** Why it was refused, in the processor's words. */
    reason: z.string().trim().max(500).optional(),
  }),
  async run(ctx, input): Promise<{ status: "pending" | "done" | "failed" }> {
    const [found] = await ctx.db
      .select({ orderId: refunds.orderId })
      .from(refunds)
      .where(eq(refunds.id, input.refundId));
    if (found === undefined) throw notFound(`Refund ${input.refundId}`);

    // The order first, held, so this takes its turn with anything else
    // changing it. Then the refund as it stands now.
    const [order] = await ctx.db
      .select()
      .from(orders)
      .where(eq(orders.id, found.orderId))
      .for("update");
    if (order === undefined) throw notFound(`Refund ${input.refundId}`);
    const [refund] = await ctx.db
      .select()
      .from(refunds)
      .where(eq(refunds.id, input.refundId));
    if (refund === undefined) throw notFound(`Refund ${input.refundId}`);
    if (refund.status !== "pending") {
      ctx.nothingChanged();
      return { status: refund.status };
    }

    const entity = { type: "order", id: order.id };
    const amount = formatNzd(refund.amountCents);

    if (input.outcome === "done") {
      await ctx.db
        .update(refunds)
        .set({
          status: "done",
          providerReference: input.providerReference ?? null,
        })
        .where(eq(refunds.id, refund.id));
      await ctx.audit({
        entity,
        summary: `${amount} went back to the customer's card for ${order.number}`,
        data: { refundId: refund.id, reference: input.providerReference },
      });
      await ctx.emit({
        type: "order.refunded",
        entity,
        payload: {
          number: order.number,
          amountCents: refund.amountCents,
          refundId: refund.id,
          test: order.isTest,
        },
      });
      return { status: "done" };
    }

    // Refused. The amount comes back off the order, so what is left to
    // refund is right again and the refund can be tried another way.
    const refundedCents = Math.max(0, order.refundedCents - refund.amountCents);
    await ctx.db
      .update(refunds)
      .set({ status: "failed" })
      .where(eq(refunds.id, refund.id));
    await ctx.db
      .update(orders)
      .set({
        refundedCents,
        paymentStatus: paymentStatusAfter({ ...order, refundedCents }),
        updatedAt: ctx.now,
      })
      .where(eq(orders.id, order.id));
    await ctx.audit({
      entity,
      summary: `The refund of ${amount} on ${order.number} did not go through. Nothing was sent back.${input.reason ? ` Stripe said: ${input.reason}` : ""}`,
      data: { refundId: refund.id },
    });
    await ctx.emit({
      type: "order.refund_failed",
      entity,
      payload: { number: order.number, amountCents: refund.amountCents },
    });
    return { status: "failed" };
  },
});

type Options = {
  readonly env?: Record<string, string | undefined>;
  readonly fetchImpl?: typeof fetch;
};

const refundsDesk = systemCaller("Stripe", "automation");

/** Stripe's no, as opposed to Stripe being unreachable or busy. */
function refusal(error: unknown): StripeError | null {
  return error instanceof StripeError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 409 &&
    error.status !== 429
    ? error
    : null;
}

/**
 * A refund is waiting to be sent: send it.
 *
 * Safe to run twice. A refund that is no longer pending is left alone; one
 * Stripe already has is written down, not sent again.
 */
export function sendRefund(options: Options = {}): Handler {
  return async (event, ctx) => {
    const refundId =
      typeof event.payload.refundId === "string" ? event.payload.refundId : "";
    if (refundId === "") return;
    const [row] = await ctx.db
      .select({
        id: refunds.id,
        status: refunds.status,
        amountCents: refunds.amountCents,
        number: orders.number,
        provider: orders.paymentProvider,
        reference: orders.paymentReference,
      })
      .from(refunds)
      .innerJoin(orders, eq(orders.id, refunds.orderId))
      .where(eq(refunds.id, refundId));
    if (row === undefined || row.status !== "pending") return;

    const settle = (
      outcome: "done" | "failed",
      detail: { providerReference?: string; reason?: string },
    ) =>
      execute(refundSettled, { refundId, outcome, ...detail }, refundsDesk, {
        db: ctx.db,
        now: ctx.now,
      });

    if (
      !refundsThroughStripe({
        paymentProvider: row.provider,
        paymentReference: row.reference,
      })
    ) {
      await settle("failed", {
        reason: "This order was not paid through Stripe.",
      });
      return;
    }

    const key = stripeSecretKey(options.env);
    try {
      const session = await retrieveCheckoutSession(
        key,
        row.reference ?? "",
        options.fetchImpl,
      );
      const payment = session.payment_intent;
      if (typeof payment !== "string" || payment === "") {
        await settle("failed", {
          reason: "Stripe has no payment against this order.",
        });
        return;
      }

      const sentBefore = (
        await listRefunds(key, payment, options.fetchImpl)
      ).find(
        (refund) =>
          refund.metadata?.refund_id === refundId &&
          refund.status !== "failed" &&
          refund.status !== "canceled",
      );
      const made =
        sentBefore ??
        (await createRefund(
          key,
          {
            paymentIntent: payment,
            amountCents: row.amountCents,
            refundId,
            orderNumber: row.number,
          },
          options.fetchImpl,
        ));

      if (made.status === "failed" || made.status === "canceled") {
        await settle("failed", {
          reason: "Stripe could not send the money back to that card.",
        });
        return;
      }
      // "succeeded", or "pending" for a bank that takes its time: either
      // way it has left us and is on its way.
      await settle("done", { providerReference: made.id });
    } catch (error) {
      const no = refusal(error);
      // Unreachable, busy or mid-request: the dispatcher tries again.
      if (no === null) throw error;
      await settle("failed", { reason: no.message.slice(0, 400) });
    }
  };
}
