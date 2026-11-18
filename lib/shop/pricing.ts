/**
 * Pricing. The only place a total is ever worked out.
 *
 * It takes the offer, a cart and a delivery answer, and reads every price
 * from the offer. The browser calls it with the offer its page was drawn
 * from, to show a running total; the server calls it again, from scratch and
 * with its own copy of the offer, when an order is placed, and that second
 * answer is the one that is charged. Nothing the browser computed is sent,
 * so there is nothing to tamper with.
 */

import type { Flavour, Pack } from "@/content/offer";

import { normaliseCart, type Cart } from "./cart";
import { itemBySku } from "./catalogue";
import type { Offer } from "./offer";

/** The part of the offer a total depends on. */
export type Priced = Pick<Offer, "packs" | "flavours" | "shipping">;

export type QuoteLine = {
  readonly sku: string;
  readonly pack: Pack;
  /** A flavour never moves a price: the pack's is the line's. */
  readonly flavour: Flavour;
  readonly qty: number;
  readonly unitCents: number;
  readonly lineCents: number;
};

export type Quote = {
  readonly lines: readonly QuoteLine[];
  readonly shots: number;
  readonly subtotalCents: number;
  /**
   * Standard delivery after the free-delivery rule, before any rural extra
   * and before a code. This is the figure a delivery code is worth.
   */
  readonly deliveryCents: number;
  readonly ruralCents: number;
  /** What a code takes off the goods. Zero with no code. */
  readonly discountCents: number;
  /** What a code takes off standard delivery. Zero with no code. */
  readonly deliveryDiscountCents: number;
  /** Delivery as charged: standard, less a code, plus any rural extra. */
  readonly shippingCents: number;
  readonly totalCents: number;
  /**
   * True when the order value has earned free standard delivery. False
   * when there was nothing to earn (lib/shop/pricing.ts: freeDeliveryFrom).
   */
  readonly freeDelivery: boolean;
  /**
   * Cents still to spend to earn it. Zero once earned, with an empty jar,
   * or when there is nothing to earn.
   */
  readonly freeDeliveryGapCents: number;
};

export type DeliveryAnswer = { readonly rural: boolean };

/**
 * What a promo code takes off. The server works it out from the code's own
 * terms (lib/backstage/marketing/promo.ts) and hands it here. It is never a
 * number the browser sent: the browser sends the code, and only the code.
 */
export type Saving = {
  readonly discountCents: number;
  readonly deliveryDiscountCents: number;
};

const NO_SAVING: Saving = { discountCents: 0, deliveryDiscountCents: 0 };

/**
 * The spend that earns free standard delivery, or null when there is none
 * to earn: delivery is free for everybody, or is never waived.
 */
export function freeDeliveryFrom(
  shipping: Pick<Priced["shipping"], "standardCents" | "freeOverCents">,
): number | null {
  return shipping.standardCents === 0 ? null : shipping.freeOverCents;
}

/**
 * Standard delivery for an order of this value, before any rural extra and
 * before a code. The shop and the back end both ask here, so they agree.
 */
export function standardDeliveryCents(
  shipping: Pick<Priced["shipping"], "standardCents" | "freeOverCents">,
  subtotalCents: number,
): number {
  const from = freeDeliveryFrom(shipping);
  return from !== null && subtotalCents >= from ? 0 : shipping.standardCents;
}

/** A whole number of cents between nothing and `most`. */
function within(cents: number, most: number): number {
  return Number.isInteger(cents) ? Math.max(0, Math.min(cents, most)) : 0;
}

export function quote(
  offer: Priced,
  cartInput: Cart,
  delivery: DeliveryAnswer = { rural: false },
  saving: Saving = NO_SAVING,
): Quote {
  const cart = normaliseCart(offer, cartInput);
  const shipping = offer.shipping;

  const lines: QuoteLine[] = [];
  for (const line of cart.lines) {
    const item = itemBySku(offer, line.sku);
    if (item === null) continue;
    const { pack, flavour } = item;
    lines.push({
      sku: line.sku,
      pack,
      flavour,
      qty: line.qty,
      unitCents: pack.priceCents,
      lineCents: pack.priceCents * line.qty,
    });
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  const shots = lines.reduce(
    (sum, line) => sum + line.qty * line.pack.shots,
    0,
  );
  const empty = lines.length === 0;

  const freeFrom = freeDeliveryFrom(shipping);
  const freeDelivery = !empty && freeFrom !== null && subtotalCents >= freeFrom;
  const deliveryCents = empty
    ? 0
    : standardDeliveryCents(shipping, subtotalCents);
  // A rural address costs the courier more whether or not the base rate was
  // waived, so the surcharge stands on its own.
  const ruralCents =
    !empty && delivery.rural ? shipping.ruralSurchargeCents : 0;
  // A code can take off no more than there is: never below nothing for the
  // goods, and standard delivery only (the rural extra always stands).
  const discountCents = within(saving.discountCents, subtotalCents);
  const deliveryDiscountCents = within(
    saving.deliveryDiscountCents,
    deliveryCents,
  );
  const shippingCents = deliveryCents - deliveryDiscountCents + ruralCents;

  return {
    lines,
    shots,
    subtotalCents,
    deliveryCents,
    ruralCents,
    discountCents,
    deliveryDiscountCents,
    shippingCents,
    totalCents: subtotalCents - discountCents + shippingCents,
    freeDelivery,
    freeDeliveryGapCents:
      empty || freeDelivery || freeFrom === null ? 0 : freeFrom - subtotalCents,
  };
}
