/**
 * What to do when Stripe tells us something.
 *
 * Kept apart from the HTTP route so it can be tested with plain objects: the
 * route checks the signature and hands the event here. Stripe delivers an
 * event at least once, sometimes out of order, and the buyer's return to the
 * site can arrive before any of them, so everything here goes through
 * operations that are safe to repeat.
 */

import { ORDER_NUMBER_PATTERN } from "../order";

type CheckoutSessionObject = {
  readonly id?: unknown;
  readonly client_reference_id?: unknown;
  readonly metadata?: { readonly order_number?: unknown } | null;
  readonly payment_status?: unknown;
  readonly amount_total?: unknown;
  readonly currency?: unknown;
};

export type StripeEvent = {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly livemode?: unknown;
  readonly data?: { readonly object?: CheckoutSessionObject } | null;
};

/** The three things an event can ask of the order book. */
export type OrderBook = {
  markPaid(input: {
    readonly number: string;
    readonly provider: "stripe";
    readonly reference: string;
    readonly amountCents: number;
    readonly currency: string;
    readonly test: boolean;
  }): Promise<{ readonly outcome: "paid" | "mismatch" | "cancelled" }>;
  closeUnpaid(input: {
    readonly number: string;
    readonly reason: string;
  }): Promise<unknown>;
};

export type EventOutcome =
  /** Nothing for us in this kind of event. */
  | { readonly action: "ignored"; readonly why: string }
  | {
      readonly action: "paid";
      readonly number: string;
      readonly outcome: string;
    }
  | { readonly action: "closed"; readonly number: string }
  /** Paid for at Stripe but not yet settled (a bank transfer in flight). */
  | { readonly action: "waiting"; readonly number: string };

function orderNumberOf(session: CheckoutSessionObject): string | null {
  const candidates = [
    session.client_reference_id,
    session.metadata?.order_number,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && ORDER_NUMBER_PATTERN.test(value)) {
      return value;
    }
  }
  return null;
}

export async function handleStripeEvent(
  event: StripeEvent,
  book: OrderBook,
): Promise<EventOutcome> {
  const type = typeof event.type === "string" ? event.type : "";
  const session = event.data?.object;

  const about = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
  ];
  if (!about.includes(type))
    return { action: "ignored", why: `not handled: ${type}` };
  if (session === undefined || session === null) {
    return { action: "ignored", why: "no session in the event" };
  }
  const number = orderNumberOf(session);
  if (number === null)
    return { action: "ignored", why: "not one of our orders" };

  if (
    type === "checkout.session.expired" ||
    type === "checkout.session.async_payment_failed"
  ) {
    await book.closeUnpaid({
      number,
      reason:
        type === "checkout.session.expired"
          ? "The payment page ran out before it was paid"
          : "The payment did not go through",
    });
    return { action: "closed", number };
  }

  if (session.payment_status !== "paid") {
    // Completed, but the money is still on its way (some bank payments).
    // A later event says how that ends.
    return { action: "waiting", number };
  }
  if (
    typeof session.id !== "string" ||
    typeof session.amount_total !== "number" ||
    typeof session.currency !== "string"
  ) {
    return { action: "ignored", why: "the session is missing its amount" };
  }
  const result = await book.markPaid({
    number,
    provider: "stripe",
    reference: session.id,
    amountCents: session.amount_total,
    currency: session.currency,
    // Stripe says which mode the event came from. Trust that, not a guess.
    test: event.livemode !== true,
  });
  return { action: "paid", number, outcome: result.outcome };
}
