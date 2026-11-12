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
import type { PaymentProvider } from "./payments";
import { quote } from "./pricing";

/** The slice of the store an order needs. Easy to fake in a test. */
export type OrderSink = {
  saveOrder(order: Order): Promise<void>;
  saveSignup(signup: {
    readonly email: string;
    readonly source: "crew-form" | "checkout";
    readonly joinedAt: string;
  }): Promise<void>;
};

export type PlaceOrderResult =
  | { readonly ok: true; readonly order: Order }
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

  try {
    const started = await deps.payments.begin(
      {
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
      },
      now,
    );
    // A provider that sends the buyer away to pay needs the order saved
    // first and finished later. That path is not wired in yet, so such a
    // provider cannot take an order here: better no order than an unpaid one
    // that looks paid.
    if (started.kind !== "done") return { ok: false, reason: "failed" };
    const payment = started.payment;

    const order: Order = {
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
    };

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
