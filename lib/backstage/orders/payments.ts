/**
 * An order's money arriving, or not.
 *
 * With a processor that sends the buyer away to pay (Stripe's hosted page),
 * an order is written down first as "awaiting payment". These are the
 * operations that settle it afterwards: the payment page is noted on it, the
 * processor says it was paid, or the page runs out unpaid.
 *
 * They are called by the shop and by the processor's webhook, never by a
 * person, and each is safe to call twice: a webhook is delivered at least
 * once, and the buyer's return to the site can race it.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { orders, type OrderStatus, type PaymentStatus } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzd } from "@/lib/shop/money";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";

import { notFound } from "../core/errors";
import { defineOp } from "../core/op";

const orderNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ORDER_NUMBER_PATTERN, "Order numbers look like QP-7K2M9X");

const reference = z.string().trim().min(1).max(200);

async function loadOrder(
  db: DbOrTx,
  number: string,
): Promise<typeof orders.$inferSelect> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.number, number));
  if (order === undefined) throw notFound(`Order ${number}`);
  return order;
}

export const attachPayment = defineOp({
  name: "orders.attachPayment",
  title: "Note the payment page on an order",
  description:
    "Records which payment page (the processor's reference) belongs to an order that is awaiting payment, so that the processor's word can be matched to it later. Called by the checkout straight after the page is made; not something to run by hand.",
  access: "write",
  input: z.object({
    number: orderNumber,
    provider: z.string().trim().min(1).max(40),
    reference,
  }),
  async run(ctx, input): Promise<{ attached: boolean }> {
    const order = await loadOrder(ctx.db, input.number);
    if (order.paymentReference === input.reference) return { attached: true };
    if (order.status !== "pending") {
      // Paid or cancelled in the meantime. Leave it be.
      return { attached: false };
    }
    await ctx.db
      .update(orders)
      .set({
        paymentProvider: input.provider,
        paymentReference: input.reference,
        updatedAt: ctx.now,
      })
      .where(eq(orders.id, order.id));
    await ctx.audit({
      entity: { type: "order", id: order.id },
      summary: `Sent the buyer of ${order.number} to pay ${formatNzd(order.totalCents)}`,
    });
    return { attached: true };
  },
});

export type MarkPaidResult = {
  /**
   *   paid        it is now paid (or already was)
   *   mismatch    money arrived that does not match the order; a person
   *               has to look
   *   cancelled   money arrived for an order that had been cancelled; it
   *               needs refunding
   */
  readonly outcome: "paid" | "mismatch" | "cancelled";
  readonly alreadyPaid: boolean;
};

export const markPaid = defineOp({
  name: "orders.markPaid",
  title: "Record that an order has been paid",
  description:
    "Marks an order that was awaiting payment as paid, on the payment processor's word, and puts it in the queue to pack. It checks the amount and currency against the order and refuses to mark it paid if they differ. Called by the processor's webhook and by the page the buyer returns to; not something to run by hand.",
  access: "write",
  input: z.object({
    number: orderNumber,
    provider: z.string().trim().min(1).max(40),
    reference,
    /** What the processor says was paid. Integer cents. */
    amountCents: z.number().int().min(0).max(100_000_000),
    currency: z.string().trim().toLowerCase().max(8),
    /** True when the processor was in its test mode: no real money moved. */
    test: z.boolean().default(false),
  }),
  async run(ctx, input): Promise<MarkPaidResult> {
    const order = await loadOrder(ctx.db, input.number);
    const entity = { type: "order", id: order.id };

    if (order.paymentStatus === "paid" || order.paymentStatus === "test") {
      if (order.status !== "pending") {
        return {
          outcome: order.status === "cancelled" ? "cancelled" : "paid",
          alreadyPaid: true,
        };
      }
    }

    if (
      input.amountCents !== order.totalCents ||
      input.currency !== order.currency.toLowerCase()
    ) {
      await ctx.audit({
        entity,
        summary: `A payment of ${formatNzd(input.amountCents)} ${input.currency.toUpperCase()} arrived for ${order.number}, which totals ${formatNzd(order.totalCents)} ${order.currency}. Not marked as paid: it needs a person.`,
        data: {
          paidCents: input.amountCents,
          paidCurrency: input.currency,
          totalCents: order.totalCents,
          reference: input.reference,
        },
      });
      await ctx.emit({
        type: "order.payment_mismatch",
        entity,
        payload: {
          number: order.number,
          paidCents: input.amountCents,
          totalCents: order.totalCents,
        },
      });
      return { outcome: "mismatch", alreadyPaid: false };
    }

    const paymentStatus: PaymentStatus = input.test ? "test" : "paid";

    if (order.status === "cancelled") {
      // The money came in after the order was called off. Keep the fact,
      // leave the order cancelled, and make sure somebody gives it back.
      await ctx.db
        .update(orders)
        .set({
          paymentStatus,
          isTest: input.test,
          paymentProvider: input.provider,
          paymentReference: input.reference,
          paidAt: ctx.now,
          updatedAt: ctx.now,
        })
        .where(eq(orders.id, order.id));
      await ctx.audit({
        entity,
        summary: `${formatNzd(order.totalCents)} was paid for ${order.number} after it was cancelled. It needs refunding.`,
        data: { reference: input.reference },
      });
      await ctx.emit({
        type: "order.paid_after_cancel",
        entity,
        payload: { number: order.number, test: input.test },
      });
      return { outcome: "cancelled", alreadyPaid: false };
    }

    // Guarded on the status, so that two callers arriving together (the
    // webhook and the buyer's return) mark it once.
    const moved = await ctx.db
      .update(orders)
      .set({
        status: "paid",
        paymentStatus,
        isTest: input.test,
        paymentProvider: input.provider,
        paymentReference: input.reference,
        paidAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
      .returning({ id: orders.id });
    if (moved.length === 0) return { outcome: "paid", alreadyPaid: true };

    await ctx.audit({
      entity,
      summary: `${input.test ? "Test payment" : "Payment"} of ${formatNzd(order.totalCents)} received for ${order.number}`,
      data: { provider: input.provider, reference: input.reference },
    });
    await ctx.emit({
      type: "order.paid",
      entity,
      payload: { number: order.number, test: input.test },
    });
    return { outcome: "paid", alreadyPaid: false };
  },
});

export const paymentExpired = defineOp({
  name: "orders.paymentExpired",
  title: "Close an order that was never paid",
  description:
    "Cancels an order that is still awaiting payment because its payment page ran out, or could not be made. Does nothing to an order that has been paid. Called by the processor's webhook and by the checkout; to cancel an order for any other reason use orders.cancel.",
  access: "write",
  input: z.object({
    number: orderNumber,
    reason: z.string().trim().min(3).max(280),
  }),
  async run(ctx, input): Promise<{ status: OrderStatus }> {
    const order = await loadOrder(ctx.db, input.number);
    if (order.status !== "pending") return { status: order.status };
    const moved = await ctx.db
      .update(orders)
      .set({
        status: "cancelled",
        paymentStatus: "failed",
        cancelledAt: ctx.now,
        cancelReason: input.reason,
        updatedAt: ctx.now,
      })
      .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
      .returning({ id: orders.id });
    if (moved.length === 0) {
      const again = await loadOrder(ctx.db, input.number);
      return { status: again.status };
    }
    const entity = { type: "order", id: order.id };
    await ctx.audit({
      entity,
      summary: `Closed ${order.number} unpaid: ${input.reason}`,
    });
    await ctx.emit({
      type: "order.payment_expired",
      entity,
      payload: { number: order.number },
    });
    return { status: "cancelled" };
  },
});

export type PaymentState = {
  readonly number: string;
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentStatus;
  readonly provider: string;
  readonly reference: string | null;
  readonly totalCents: number;
  readonly currency: string;
};

export const paymentState = defineOp({
  name: "orders.paymentState",
  title: "Where an order's payment is up to",
  description:
    "Says whether an order is awaiting payment, paid or closed unpaid, with the processor's reference. Used by the page a buyer returns to after paying.",
  access: "read",
  input: z.object({ number: orderNumber }),
  async run(ctx, input): Promise<PaymentState> {
    const order = await loadOrder(ctx.db, input.number);
    return {
      number: order.number,
      status: order.status,
      paymentStatus: order.paymentStatus,
      provider: order.paymentProvider,
      reference: order.paymentReference,
      totalCents: order.totalCents,
      currency: order.currency,
    };
  },
});
