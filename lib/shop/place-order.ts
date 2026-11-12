/**
 * Placing an order: the one path from a submitted checkout form to a record.
 *
 * Kept free of anything Next-specific (no cookies, no redirects) so it can be
 * tested directly. The Server Action in components/checkout/actions.ts is a
 * thin wrapper that feeds it the form and deals with the response.
 *
 * The order of work matters:
 *   1. validate every field, including each jar line against the offer;
 *   2. price the jar from the offer (the server's own copy, handed in as
 *      `deps.offer`), here, ignoring anything the browser thought it cost;
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

import { CODES, SHOP, SPECIAL } from "@/content/site";

import { normaliseCart } from "./cart";
import { normalisePromoCode } from "./code";
import { forPage, type Offer, type OfferOnPage } from "./offer";
import {
  checkoutSchema,
  fieldErrors,
  newOrderNumber,
  type FieldErrors,
  type Order,
} from "./order";
import type { PaymentRecord } from "./order";
import type { ChargeRequest, PaymentProvider } from "./payments";
import { quote, type Saving } from "./pricing";
import type { CodeCheck, SpecialCheck } from "./store";

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
  checkCode?(
    code: string,
    order: {
      readonly subtotalCents: number;
      readonly deliveryCents: number;
      readonly email?: string;
    },
  ): Promise<CodeCheck>;
  special?(order: {
    readonly subtotalCents: number;
    readonly deliveryCents: number;
  }): Promise<SpecialCheck>;
};

/** The least an order may come to once a code is off it. One dollar. */
const LEAST_TOTAL_CENTS = 100;

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
      /**
       * Set when the order was handed back because the shop itself had
       * changed (`errors.offer` says how): the offer as it stands, for the
       * page to draw the new total from.
       */
      readonly offer?: OfferOnPage;
    }
  | { readonly ok: false; readonly reason: "failed" };

export type RawCheckout = Readonly<Record<string, unknown>>;

export type PlaceOrderDeps = {
  /**
   * What is on sale, for how much: the server's own copy, read as the order
   * is placed. Every price on the order comes from here.
   */
  readonly offer: Offer;
  /**
   * The same question asked again, after a save was refused: has the offer
   * moved since? Left out, a refused save is only ever "something went
   * wrong".
   */
  readonly offerAgain?: () => Promise<Offer>;
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

  const { offer } = deps;
  /** Handed back, with the offer as it stands, for the page to redraw from. */
  const shopChanged = (message: string, now: Offer): PlaceOrderResult => ({
    ok: false,
    reason: "invalid",
    errors: { offer: message },
    offer: forPage(now),
  });
  // Shut for now (the back end's own switch): no order is taken.
  if (!offer.open) return shopChanged(SHOP.closed, offer);
  // The page says which offer it was drawn from, by its word. If that is
  // not the offer any more, a price, a delivery rate or pre-order-or-live
  // has changed since, and the total on the button is not the total now.
  // The buyer is shown the new one before anything else happens.
  const drawnFrom = (input.offer ?? "").trim();
  if (drawnFrom !== "" && drawnFrom !== offer.version) {
    return shopChanged(SHOP.moved, offer);
  }

  // Price it here, from the offer. Duplicate lines merge, quantities clamp.
  const cart = normaliseCart(offer, { lines: input.lines });
  const before = quote(offer, cart, { rural: input.rural });
  if (before.lines.length === 0) {
    return {
      ok: false,
      reason: "invalid",
      errors: { lines: "Your jar is empty" },
    };
  }

  // A code: the buyer sends the word, nothing else. What it is worth comes
  // from the code's own terms, here, and is worked out a second time when
  // the order is saved (in the same transaction that counts the use).
  const noCode = (message: string): PlaceOrderResult => ({
    ok: false,
    reason: "invalid",
    errors: { promoCode: message },
  });
  const typed = (input.promoCode ?? "").trim();
  let code: Extract<CodeCheck, { ok: true }> | null = null;
  if (typed !== "") {
    if (deps.store.checkCode === undefined) return noCode(CODES.unavailable);
    let check: CodeCheck;
    try {
      check = await deps.store.checkCode(typed, {
        subtotalCents: before.subtotalCents,
        deliveryCents: before.deliveryCents,
        email: input.email,
      });
    } catch {
      return noCode(CODES.unavailable);
    }
    if (!check.ok) return noCode(check.reason);
    code = check;
  }
  // A special: a saving that comes off by itself, with nothing typed. One
  // saving an order, so with a code as well the buyer gets whichever takes
  // more off, and a code that only draws level wins because they asked for it.
  const readSpecial = async (): Promise<Extract<
    SpecialCheck,
    { ok: true }
  > | null> => {
    if (deps.store.special === undefined) return null;
    try {
      const answer = await deps.store.special({
        subtotalCents: before.subtotalCents,
        deliveryCents: before.deliveryCents,
      });
      return answer.ok ? answer : null;
    } catch {
      // A special that cannot be read is no special. A buyer who was shown
      // one is told the total has changed, just below.
      return null;
    }
  };
  const savedBy = (worth: Saving) =>
    worth.discountCents + worth.deliveryDiscountCents;
  const special = await readSpecial();
  const bySpecial =
    special !== null && (code === null || savedBy(special) > savedBy(code));
  const specialGone: PlaceOrderResult = {
    ok: false,
    reason: "invalid",
    errors: { special: SPECIAL.gone },
  };
  // The buyer was shown a special coming off. If that is not what comes off
  // now, the total they pressed the button on is not the total any more, so
  // they are shown the new one first. (Paying LESS than was shown, because
  // a special started in the meantime, needs nobody's leave.)
  const shown = normalisePromoCode(input.special ?? "");
  if (shown !== "" && !(bySpecial && special.code === shown)) {
    return specialGone;
  }
  const applied = bySpecial ? special : code;

  const saving: Saving =
    applied === null
      ? { discountCents: 0, deliveryDiscountCents: 0 }
      : {
          discountCents: applied.discountCents,
          deliveryDiscountCents: applied.deliveryDiscountCents,
        };
  const priced = quote(offer, cart, { rural: input.rural }, saving);
  if (applied !== null && priced.totalCents < LEAST_TOTAL_CENTS) {
    return bySpecial ? specialGone : noCode(CODES.wouldBeFree);
  }
  /** What to call a special on the receipt and the payment page. */
  const specialCalled =
    bySpecial && special !== null
      ? special.name !== ""
        ? special.name
        : special.label
      : null;
  const promo =
    applied === null
      ? null
      : {
          code: applied.code,
          deliveryDiscountCents: priced.deliveryDiscountCents,
          ...(specialCalled === null ? {} : { special: specialCalled }),
        };
  // The special beat a code the buyer typed. Nothing comes off for the code
  // and its use is not counted, but whoever it belongs to still brought the
  // order in.
  const creditCode = bySpecial && code !== null ? code.code : null;

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
    discountCents: priced.discountCents,
    discountLabel:
      applied === null
        ? ""
        : specialCalled !== null
          ? `${SPECIAL.tag}: ${specialCalled}`
          : `${CODES.codeLine} ${applied.code}`,
    successUrl: deps.returnUrls?.success ?? "",
    cancelUrl: deps.returnUrls?.cancel ?? "",
  };

  const orderWith = (payment: PaymentRecord): Order => ({
    number,
    placedAt,
    mode: offer.launchMode,
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
    discountCents: priced.discountCents,
    shippingCents: priced.shippingCents,
    totalCents: priced.totalCents,
    currency: "NZD",
    promo,
    payment,
    joinCrew: input.joinCrew,
    offerVersion: offer.version,
    ...(creditCode === null ? {} : { creditCode }),
    ...(input.source === undefined ? {} : { source: input.source }),
  });

  // Saving can refuse a code or a special that was fine a moment ago
  // (somebody else took its last use, or it was switched off), and it
  // refuses an order priced from an offer that has moved since. Ask once
  // more, so the buyer is told that and not just that something went wrong.
  const refusedCode = async (): Promise<PlaceOrderResult | null> => {
    if (deps.offerAgain !== undefined) {
      try {
        const now = await deps.offerAgain();
        if (!now.open) return shopChanged(SHOP.closed, now);
        if (now.version !== offer.version) return shopChanged(SHOP.moved, now);
      } catch {
        // Not knowing is not a reason to say the shop changed.
      }
    }
    if (applied === null) return null;
    if (bySpecial) {
      const again = await readSpecial();
      return again === null ||
        again.code !== applied.code ||
        again.discountCents !== applied.discountCents ||
        again.deliveryDiscountCents !== applied.deliveryDiscountCents
        ? specialGone
        : null;
    }
    if (deps.store.checkCode === undefined) return null;
    try {
      const again = await deps.store.checkCode(typed, {
        subtotalCents: before.subtotalCents,
        deliveryCents: before.deliveryCents,
        email: input.email,
      });
      if (!again.ok) return noCode(again.reason);
      if (
        again.discountCents !== applied.discountCents ||
        again.deliveryDiscountCents !== applied.deliveryDiscountCents
      ) {
        return noCode(CODES.changed);
      }
    } catch {
      return null;
    }
    return null;
  };

  if (deps.payments.savesFirst) {
    return payElsewhere(deps, request, orderWith, now, refusedCode);
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
    return (await refusedCode()) ?? { ok: false, reason: "failed" };
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
  refusedCode: () => Promise<PlaceOrderResult | null>,
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
    return (await refusedCode()) ?? { ok: false, reason: "failed" };
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
