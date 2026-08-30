/**
 * What it costs to get a bottle to a doorstep, and when it leaves.
 *
 * This is the only place the storefront states a delivery charge. It is held in
 * integer minor units, like every other price in this build, and it is read by
 * the shop page, the product pages, the delivery page and the footer — so the
 * number cannot be right in one place and stale in another.
 *
 * **It must agree with the checkout.** `lib/commerce/mock/pricing.ts` holds the
 * rate the simulated checkout actually applies
 * (`NZ_STANDARD_SHIPPING_CENTS`, `NZ_FREE_SHIPPING_THRESHOLD_CENTS`), and
 * `tests/site/delivery-rate.test.ts` fails if the two ever drift apart. A
 * delivery charge published on a product page and contradicted at step three of
 * a checkout is a misleading representation under Fair Trading Act 1986 s 9,
 * not a copy inconsistency — which is why the agreement is a test and not a
 * comment.
 *
 * **What is deliberately NOT here.** `legal/shipping-returns.md` still carries
 * `[SQUARE BRACKET]` placeholders for the rural surcharge, the overnight
 * option, the courier's cut-off and the Australian start date. None of those
 * appear on a published page in any form: an unconfirmed rate is not written as
 * a fact, and it is not written as a placeholder either. The page says what is
 * settled and says nothing about what is not.
 */

import { money, type Money } from "@/lib/commerce";

/** One parcel to a New Zealand address, in cents. */
export const NZ_DELIVERY_CENTS = 850;

/** Order value at or above which the parcel is carried at no charge, in cents. */
export const NZ_DELIVERY_FREE_FROM_CENTS = 9_000;

export function deliveryCharge(): Money {
  return money(NZ_DELIVERY_CENTS);
}

export function deliveryFreeFrom(): Money {
  return money(NZ_DELIVERY_FREE_FROM_CENTS);
}

/**
 * What this cart's parcel costs, by the rule the page publishes.
 *
 * The simulated checkout shows a buyer a line for delivery before it asks them
 * to place the order, and this is where that figure comes from — the
 * storefront's own rate card, not the provider's internals. The provider still
 * computes the charge it actually writes onto the order
 * (`defaultShippingCents` in `lib/commerce/mock/pricing.ts`, applied inside the
 * transaction that converts the cart), and `tests/site/delivery-rate.test.ts`
 * is the join that fails if the two ever say different things — including the
 * boundary, which is "at or above the threshold" and not "over" it.
 *
 * Integer minor units in, integer minor units out. Nothing here divides.
 */
export function deliveryChargeFor(merchandiseTotal: Money): Money {
  return merchandiseTotal.amountInMinorUnits >= NZ_DELIVERY_FREE_FROM_CENTS
    ? money(0, merchandiseTotal.currencyCode)
    : money(NZ_DELIVERY_CENTS, merchandiseTotal.currencyCode);
}
