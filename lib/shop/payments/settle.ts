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

import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
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

export type Settlement = {
  readonly state: Settled;
  /**
   * Set while the payment page is still open and nothing has been paid: its
   * address, so the buyer can go back and finish. It comes from Stripe's own
   * answer, never from the browser.
   */
  readonly payAt?: string;
};

/** Only ever link a buyer to a payment page that is really Stripe's. */
function stripePage(url: string | null): string | undefined {
  if (url === null) return undefined;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const stripes = host === "stripe.com" || host.endsWith(".stripe.com");
    return parsed.protocol === "https:" && stripes ? url : undefined;
  } catch {
    return undefined;
  }
}

export async function settleOnReturn(
  number: string,
  options: {
    readonly env?: Record<string, string | undefined>;
    readonly fetchImpl?: typeof fetch;
    /** Who is asking. The shop, unless the clock is doing its rounds. */
    readonly as?: Caller;
  } = {},
): Promise<Settlement> {
  const shop = options.as ?? systemCaller("The shop", "storefront");
  try {
    const state = await execute(paymentState, { number }, shop);
    if (state.status === "cancelled") {
      return { state: state.paymentStatus === "paid" ? "review" : "closed" };
    }
    if (state.status !== "pending") return { state: "paid" };
    if (state.provider !== "stripe" || state.reference === null) {
      return { state: "awaiting" };
    }

    const key = stripeSecretKey(options.env);
    const session = await retrieveCheckoutSession(
      key,
      state.reference,
      options.fetchImpl,
    );
    if (session.client_reference_id !== number) return { state: "awaiting" };

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
      return { state: result.outcome === "paid" ? "paid" : "review" };
    }
    if (session.status === "expired") {
      await execute(
        paymentExpired,
        { number, reason: "The payment page ran out before it was paid" },
        shop,
      );
      return { state: "closed" };
    }
    // "complete" but unpaid is a payment still on its way (a bank transfer,
    // say). "open" is a buyer who has not paid: show them the way back.
    return session.status === "open"
      ? { state: "awaiting", payAt: stripePage(session.url) }
      : { state: "awaiting" };
  } catch (error) {
    if (!(error instanceof OpError && error.code === "not_found")) {
      console.error(
        JSON.stringify({
          event: "payments.settle_failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
    return { state: "unknown" };
  }
}
