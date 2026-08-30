import { describe, expect, it } from "vitest";

import {
  NZ_DELIVERY_CENTS,
  NZ_DELIVERY_FREE_FROM_CENTS,
} from "@/components/site/delivery";
import {
  NZ_FREE_SHIPPING_THRESHOLD_CENTS,
  NZ_STANDARD_SHIPPING_CENTS,
  defaultShippingCents,
} from "@/lib/commerce/mock/pricing";

/**
 * The published delivery charge has to be the charged delivery charge.
 *
 * The storefront prints a courier charge on the shop page, on every product
 * page and on /delivery, because the avatar audit found that not printing it is
 * the commonest abandoned cart in New Zealand direct-to-consumer. A printed
 * charge that the checkout then contradicts is not a copy inconsistency — under
 * Fair Trading Act 1986 s 9 it is a misleading representation, and s 13(g)
 * catches it again if the "free over" threshold does not hold.
 *
 * The two numbers therefore live in two places on purpose:
 *
 *   `components/site/delivery.ts`      what the storefront SAYS. It belongs to
 *                                      the storefront because a rate card is a
 *                                      published offer term, not a property of
 *                                      whichever commerce provider is wired up.
 *   `lib/commerce/mock/pricing.ts`     what the checkout CHARGES.
 *
 * This test is the join. If somebody changes one, this fails and names the
 * other — which is the only way a number that must agree in two layers stays
 * agreed without one layer reaching into the other.
 */
describe("the delivery charge the storefront publishes", () => {
  it("is the charge the checkout applies", () => {
    expect(NZ_DELIVERY_CENTS).toBe(NZ_STANDARD_SHIPPING_CENTS);
  });

  it("frees the parcel at the threshold the checkout frees it at", () => {
    expect(NZ_DELIVERY_FREE_FROM_CENTS).toBe(NZ_FREE_SHIPPING_THRESHOLD_CENTS);
  });

  it("is charged below the threshold and not at or above it", () => {
    // The claim on the page, in the words it is written in: this much a parcel,
    // and nothing at or over the threshold. Both boundaries, because "over $90"
    // and "$90 or more" are different offers and only one of them is published.
    expect(defaultShippingCents(NZ_DELIVERY_FREE_FROM_CENTS - 1)).toBe(
      NZ_DELIVERY_CENTS,
    );
    expect(defaultShippingCents(NZ_DELIVERY_FREE_FROM_CENTS)).toBe(0);
    expect(defaultShippingCents(NZ_DELIVERY_FREE_FROM_CENTS + 1)).toBe(0);
  });

  it("is a whole number of cents, never a float", () => {
    expect(Number.isSafeInteger(NZ_DELIVERY_CENTS)).toBe(true);
    expect(Number.isSafeInteger(NZ_DELIVERY_FREE_FROM_CENTS)).toBe(true);
  });
});
