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

/**
 * A charge, as far as a refund on it concerns us. A refund names its
 * payment the same way, so news about a refund itself is read with this
 * too.
 */
type ChargeObject = {
  readonly payment_intent?: unknown;
  /** Whatever was put there. Only `order_number` is ever read. */
  readonly metadata?: Readonly<Record<string, unknown>> | null;
};

/**
 * The kinds of news Stripe sends when money goes back, or does not after
 * all. `charge.refunded` says a refund was made. The rest are about a
 * refund that has changed since: above all one that left and then failed,
 * because the card it was going to has been closed. They only ever say
 * "look again": what Stripe holds for the payment is what gets read.
 * (`charge.refund.updated` is the older name for `refund.updated`, kept in
 * case an endpoint still sends it.)
 */
const REFUND_NEWS = [
  "charge.refunded",
  "refund.updated",
  "refund.failed",
  "charge.refund.updated",
] as const;

/**
 * A dispute, as the news shows it. Only its id is ever taken: how it stands
 * is asked of Stripe, because news can arrive late or out of order.
 */
type DisputeObject = {
  readonly id?: unknown;
  readonly status?: unknown;
};

/** The kinds of news Stripe sends about a card dispute. */
const DISPUTE_NEWS = [
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;

export type StripeEvent = {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly livemode?: unknown;
  readonly data?: {
    readonly object?: CheckoutSessionObject & ChargeObject & DisputeObject;
  } | null;
};

/** The things an event can ask of the order book. */
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
  /**
   * Money went back on a payment, by whoever's hand, or a refund that had
   * left has changed. The event only says that something did: the book asks
   * Stripe what, writes down any refund it did not already know about, and
   * takes back any it holds as given that has since come back. `number` is
   * the order the payment says it belongs to, when it says.
   */
  seeRefunds(input: {
    readonly number: string | null;
    readonly paymentIntent: string | null;
  }): Promise<{
    readonly number: string | null;
    readonly written: number;
    /** Refunds that had left and are now known to have come back. */
    readonly returned?: number;
  }>;
  /**
   * A cardholder's bank has opened, moved or closed a dispute. The event
   * only names it: the book asks Stripe how it stands now and writes that
   * onto the order the payment belongs to.
   */
  seeDispute(input: {
    readonly reference: string;
  }): Promise<{ readonly number: string | null; readonly status: string }>;
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
  | { readonly action: "waiting"; readonly number: string }
  /** A refund on one of our orders, read and written down if it was news. */
  | {
      readonly action: "refunds";
      readonly number: string;
      readonly written: number;
      /** How many that had left were found to have come back. */
      readonly returned: number;
    }
  /** A card dispute on one of our orders, as it stands now. */
  | {
      readonly action: "dispute";
      readonly number: string;
      readonly status: string;
    };

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

  // A refund, made from the back end or from Stripe's own dashboard, or one
  // that has changed since it was made. The same news arrives either way,
  // and reading it twice writes nothing twice.
  if ((REFUND_NEWS as readonly string[]).includes(type)) {
    const said = session?.metadata?.order_number;
    const number =
      typeof said === "string" && ORDER_NUMBER_PATTERN.test(said) ? said : null;
    const paymentIntent =
      typeof session?.payment_intent === "string" &&
      session.payment_intent !== ""
        ? session.payment_intent
        : null;
    if (number === null && paymentIntent === null) {
      return { action: "ignored", why: "a refund with no payment to its name" };
    }
    const seen = await book.seeRefunds({ number, paymentIntent });
    return seen.number === null
      ? { action: "ignored", why: "not one of our orders" }
      : {
          action: "refunds",
          number: seen.number,
          written: seen.written,
          returned: seen.returned ?? 0,
        };
  }

  const about = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
  ];
  if ((DISPUTE_NEWS as readonly string[]).includes(type)) {
    const reference = session?.id;
    if (typeof reference !== "string" || !reference.startsWith("dp_")) {
      return { action: "ignored", why: "a dispute with no id" };
    }
    const seen = await book.seeDispute({ reference });
    return seen.number === null
      ? { action: "ignored", why: "not one of our orders" }
      : { action: "dispute", number: seen.number, status: seen.status };
  }

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
