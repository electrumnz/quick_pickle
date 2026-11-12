/**
 * Pricing. The only place a total is ever worked out.
 *
 * It takes a cart and a delivery answer and reads every price from the offer.
 * The browser calls it to show a running total; the server calls it again,
 * from scratch, when an order is placed, and that second answer is the one
 * that is charged. Nothing the browser computed is sent, so there is nothing
 * to tamper with.
 */

import { SHIPPING, type Pack } from "@/content/offer";

import { normaliseCart, type Cart } from "./cart";
import { packBySku } from "./catalogue";

export type QuoteLine = {
  readonly sku: string;
  readonly pack: Pack;
  readonly qty: number;
  readonly unitCents: number;
  readonly lineCents: number;
};

export type Quote = {
  readonly lines: readonly QuoteLine[];
  readonly shots: number;
  readonly subtotalCents: number;
  /** Standard delivery after the free-delivery rule, before any rural extra. */
  readonly deliveryCents: number;
  readonly ruralCents: number;
  readonly shippingCents: number;
  readonly totalCents: number;
  /** True when the order value has earned free standard delivery. */
  readonly freeDelivery: boolean;
  /** Cents still to spend to earn it. Zero once earned or with an empty jar. */
  readonly freeDeliveryGapCents: number;
};

export type DeliveryAnswer = { readonly rural: boolean };

export function quote(
  cartInput: Cart,
  delivery: DeliveryAnswer = { rural: false },
): Quote {
  const cart = normaliseCart(cartInput);

  const lines: QuoteLine[] = [];
  for (const line of cart.lines) {
    const pack = packBySku(line.sku);
    if (pack === null) continue;
    lines.push({
      sku: line.sku,
      pack,
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

  const freeDelivery = !empty && subtotalCents >= SHIPPING.freeOverCents;
  const deliveryCents = empty || freeDelivery ? 0 : SHIPPING.standardCents;
  // A rural address costs the courier more whether or not the base rate was
  // waived, so the surcharge stands on its own.
  const ruralCents =
    !empty && delivery.rural ? SHIPPING.ruralSurchargeCents : 0;
  const shippingCents = deliveryCents + ruralCents;

  return {
    lines,
    shots,
    subtotalCents,
    deliveryCents,
    ruralCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
    freeDelivery,
    freeDeliveryGapCents:
      empty || freeDelivery ? 0 : SHIPPING.freeOverCents - subtotalCents,
  };
}
