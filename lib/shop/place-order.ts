/**
 * Placing an order: the one path from a submitted checkout form to a record.
 *
 * Kept free of anything Next-specific (no cookies, no redirects) so it can be
 * tested directly. The Server Action in components/checkout/actions.ts is a
 * thin wrapper that feeds it the form and deals with the response.
 *
 * The order of work matters:
 *   1. validate every field, including each jar line against the offer;
 *   2. price the jar from the offer, here, ignoring anything the browser
 *      thought it cost;
 *   3. take payment for exactly that amount;
 *   4. only then write the order down.
 * A failure at any step leaves nothing behind.
 *
 * A processor that sends the buyer away to pay (Stripe's hosted page) turns
 * 3 and 4 round: the order is written down first, as awaiting payment, so
 * that the processor's "paid" has an order to land on; then the payment page
 * is made for exactly that order's total. If the page cannot be made, the
 * order is closed again, unpaid, and says why.
 */

import { STORE } from "@/content/offer";

import { normaliseCart } from "./cart";
import {
  checkoutSchema,
  fieldErrors,
  newOrderNumber,
  type FieldErrors,
  type Order,
} from "./order";
import type { PaymentRecord } from "./order";
import type { ChargeRequest, PaymentProvider } from "./payments";
import { quote } from "./pricing";

/** The slice of the store an order needs. Easy to fake in a test. */
export type OrderSink = {
  saveOrder(order: Order): Promise<void>;
  saveSignup(signup: {
    readonly email: string;
    readonly source: "crew-form" | "checkout";
    readonly joinedAt: string;
  }): Promise<void>;
  attachPayment?(
    number: string,
    payment: { readonly provider: string; readonly reference: string },
  ): Promise<void>;
  closeUnpaid?(number: string, reason: string): Promise<void>;
};

export type PlaceOrderResult =
  | {
      readonly ok: true;
      readonly order: Order;
      /** Set when the buyer still has to pay: send them here. */
      readonly payAt?: string;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid";
      readonly errors: FieldErrors;
    }
  | { readonly ok: false; readonly reason: "failed" };

export type RawCheckout = Readonly<Record<string, unknown>>;

export type PlaceOrderDeps = {
  readonly payments: PaymentProvider;
  readonly store: OrderSink;
  readonly now?: () => Date;
  readonly orderNumber?: () => string;
  /** Where a payment page sends the buyer back to. Full addresses. */
  readonly returnUrls?: { readonly success: string; readonly cancel: string };
};

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

export async function placeOrder(
  raw: RawCheckout,
  deps: PlaceOrderDeps,
): Promise<PlaceOrderResult> {
  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "invalid", errors: fieldErrors(parsed.error) };
  }
  const input = parsed.data;

  // Price it here, from the offer. Duplicate lines merge, quantities clamp.
  const cart = normaliseCart({ lines: input.lines });
  const priced = quote(cart, { rural: input.rural });
  if (priced.lines.length === 0) {
    return {
      ok: false,
      reason: "invalid",
      errors: { lines: "Your jar is empty" },
    };
  }

  const number = (deps.orderNumber ?? newOrderNumber)();
  const now = (deps.now ?? (() => new Date()))();
  const placedAt = now.toISOString();

  const request: ChargeRequest = {
    orderNumber: number,
    amountCents: priced.totalCents,
    currency: "NZD",
    email: input.email,
    lines: priced.lines.map((line) => ({
      name: line.pack.name,
      qty: line.qty,
      unitCents: line.unitCents,
    })),
    shippingCents: priced.shippingCents,
    successUrl: deps.returnUrls?.success ?? "",
    cancelUrl: deps.returnUrls?.cancel ?? "",
  };

  const orderWith = (payment: PaymentRecord): Order => ({
    number,
    placedAt,
    mode: STORE.launchMode,
    customer: {
      email: input.email,
      phone: emptyToNull(input.phone),
      firstName: input.firstName,
      lastName: input.lastName,
    },
    delivery: {
      line1: input.line1,
      line2: emptyToNull(input.line2),
      suburb: emptyToNull(input.suburb),
      city: input.city,
      region: input.region,
      postcode: input.postcode,
      rural: input.rural,
      notes: emptyToNull(input.notes),
    },
    lines: priced.lines.map((line) => ({
      sku: line.sku,
      name: line.pack.name,
      shots: line.pack.shots,
      qty: line.qty,
      unitCents: line.unitCents,
      lineCents: line.lineCents,
    })),
    subtotalCents: priced.subtotalCents,
    shippingCents: priced.shippingCents,
    totalCents: priced.totalCents,
    currency: "NZD",
    payment,
    joinCrew: input.joinCrew,
  });

  if (deps.payments.savesFirst) {
    return payElsewhere(deps, request, orderWith, now);
  }

  try {
    const started = await deps.payments.begin(request, now);
    // A provider that settles at once must say so. Anything else here would
    // be an unpaid order recorded as if it were paid.
    if (started.kind !== "done") return { ok: false, reason: "failed" };
    const order = orderWith(started.payment);

    await deps.store.saveOrder(order);
    if (input.joinCrew) {
      // Losing a newsletter opt-in must never lose the order it came with.
      await deps.store
        .saveSignup({
          email: input.email,
          source: "checkout",
          joinedAt: placedAt,
        })
        .catch(() => {});
    }
    return { ok: true, order };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/**
 * The order goes down first, awaiting payment; then the payment page is made
 * for it. Whatever goes wrong after the order is saved, it is closed again
 * rather than left looking as though someone might still pay it.
 */
async function payElsewhere(
  deps: PlaceOrderDeps,
  request: ChargeRequest,
  orderWith: (payment: PaymentRecord) => Order,
  now: Date,
): Promise<PlaceOrderResult> {
  const { store, payments } = deps;
  // Only a store that can find the order again can finish this.
  if (store.attachPayment === undefined || store.closeUnpaid === undefined) {
    return { ok: false, reason: "failed" };
  }
  if (request.successUrl === "" || request.cancelUrl === "") {
    return { ok: false, reason: "failed" };
  }

  const order = orderWith({
    provider: payments.name,
    status: "pending",
    reference: "",
  });
  try {
    await store.saveOrder(order);
  } catch {
    return { ok: false, reason: "failed" };
  }

  try {
    const started = await payments.begin(request, now);
    if (started.kind !== "redirect") {
      throw new Error("The payment provider did not give a payment page.");
    }
    await store.attachPayment(order.number, {
      provider: started.payment.provider,
      reference: started.payment.reference,
    });
    return {
      ok: true,
      order: { ...order, payment: started.payment },
      payAt: started.url,
    };
  } catch {
    await store
      .closeUnpaid(order.number, "The payment page could not be opened")
      .catch(() => {});
    return { ok: false, reason: "failed" };
  }
}
