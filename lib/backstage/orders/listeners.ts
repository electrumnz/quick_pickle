/**
 * What the orders area does when it hears that something happened.
 *
 * These run after the change that caused them has been saved
 * (lib/backstage/core/events.ts), and any of them can be run twice for the
 * same event, so each looks at how things stand now before it acts.
 */

import "server-only";

import { eq } from "drizzle-orm";

import { orders } from "@/db/schema";
import {
  expireCheckoutSession,
  StripeError,
  stripeSecretKey,
} from "@/lib/shop/payments/stripe";

import type { Handler } from "../core/events";

type Options = {
  readonly env?: Record<string, string | undefined>;
  readonly fetchImpl?: typeof fetch;
};

/**
 * An order was cancelled. If its buyer had been sent to pay and has not yet,
 * close their payment page, so they cannot pay for an order nobody will
 * pack. (If they beat us to it, the payment lands on a cancelled order and
 * `orders.markPaid` flags it for refund. This just makes that rare.)
 */
export function closePaymentPage(options: Options = {}): Handler {
  return async (event, ctx) => {
    const id = event.entityId;
    if (id === null) return;
    const [order] = await ctx.db
      .select({
        status: orders.status,
        provider: orders.paymentProvider,
        reference: orders.paymentReference,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(eq(orders.id, id));
    if (order === undefined || order.status !== "cancelled") return;
    if (order.provider !== "stripe" || order.paymentStatus !== "unpaid") return;
    const session = order.reference ?? "";
    if (!session.startsWith("cs_")) return;

    try {
      await expireCheckoutSession(
        stripeSecretKey(options.env),
        session,
        options.fetchImpl,
      );
    } catch (error) {
      // Stripe saying no (it is already closed, or already paid) is an
      // answer. Anything else, such as Stripe being unreachable, is worth
      // another try.
      const refused =
        error instanceof StripeError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429;
      if (!refused) throw error;
    }
  };
}
