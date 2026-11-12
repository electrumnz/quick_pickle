/**
 * The buyer is back from the payment page. Is the order paid?
 *
 * The webhook is how Stripe tells us, but the buyer's browser can get back
 * first, and a webhook can be late or misconfigured. So the page they land on
 * asks Stripe directly and settles the order itself if it is paid, through
 * the same operation the webhook uses. Whichever arrives first does the work
 * and the other finds it done.
 */

import "server-only";

import { systemCaller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  markPaid,
  paymentExpired,
  paymentState,
} from "@/lib/backstage/orders/payments";

import {
  isStripeTestKey,
  retrieveCheckoutSession,
  stripeSecretKey,
} from "./stripe";

export type Settled =
  /** Paid. Something to pack. */
  | "paid"
  /** Not paid yet, as far as anyone can tell. */
  | "awaiting"
  /** Closed without being paid. Nothing was charged. */
  | "closed"
  /** Money arrived but it needs a person (wrong amount, or already cancelled). */
  | "review"
  /** No such order, or it cannot be checked right now. */
  | "unknown";

export async function settleOnReturn(number: string): Promise<Settled> {
  const shop = systemCaller("The shop", "storefront");
  try {
    const state = await execute(paymentState, { number }, shop);
    if (state.status === "cancelled") {
      return state.paymentStatus === "paid" ? "review" : "closed";
    }
    if (state.status !== "pending") return "paid";
    if (state.provider !== "stripe" || state.reference === null) {
      return "awaiting";
    }

    const key = stripeSecretKey();
    const session = await retrieveCheckoutSession(key, state.reference);
    if (session.client_reference_id !== number) return "awaiting";

    if (session.payment_status === "paid") {
      const result = await execute(
        markPaid,
        {
          number,
          provider: "stripe",
          reference: session.id,
          amountCents: session.amount_total ?? -1,
          currency: session.currency ?? "",
          test: isStripeTestKey(key),
        },
        shop,
      );
      return result.outcome === "paid" ? "paid" : "review";
    }
    if (session.status === "expired") {
      await execute(
        paymentExpired,
        { number, reason: "The payment page ran out before it was paid" },
        shop,
      );
      return "closed";
    }
    return "awaiting";
  } catch (error) {
    if (!(error instanceof OpError && error.code === "not_found")) {
      console.error(
        JSON.stringify({
          event: "payments.settle_failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
    return "unknown";
  }
}
