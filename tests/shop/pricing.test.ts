import { describe, expect, it } from "vitest";

import { PACKS, SHIPPING } from "@/content/offer";
import { addToCart, EMPTY_CART, type Cart } from "@/lib/shop/cart";
import { quote } from "@/lib/shop/pricing";

const small = PACKS[0]!;

/** A jar of the smallest pack, `qty` times. */
function jarOf(qty: number): Cart {
  return { lines: [{ sku: small.sku, qty }] };
}

describe("pricing", () => {
  it("prices an empty jar at nothing, with no delivery", () => {
    const priced = quote(EMPTY_CART);
    expect(priced).toMatchObject({
      subtotalCents: 0,
      shippingCents: 0,
      totalCents: 0,
      freeDelivery: false,
      freeDeliveryGapCents: 0,
      shots: 0,
    });
    expect(quote(EMPTY_CART, { rural: true }).totalCents).toBe(0);
  });

  it("reads every price from the offer", () => {
    for (const pack of PACKS) {
      const priced = quote(addToCart(EMPTY_CART, pack.sku, 2));
      expect(priced.subtotalCents).toBe(pack.priceCents * 2);
      expect(priced.lines[0]?.unitCents).toBe(pack.priceCents);
      expect(priced.shots).toBe(pack.shots * 2);
    }
  });

  it("charges standard delivery under the free-delivery line", () => {
    const priced = quote(jarOf(1));
    if (small.priceCents < SHIPPING.freeOverCents) {
      expect(priced.freeDelivery).toBe(false);
      expect(priced.deliveryCents).toBe(SHIPPING.standardCents);
      expect(priced.freeDeliveryGapCents).toBe(
        SHIPPING.freeOverCents - small.priceCents,
      );
      expect(priced.totalCents).toBe(small.priceCents + SHIPPING.standardCents);
    }
  });

  it("waives standard delivery at or over the line, to the cent", () => {
    // Find the first quantity that reaches the line.
    const needed = Math.ceil(SHIPPING.freeOverCents / small.priceCents);
    const under = quote(jarOf(needed - 1));
    const over = quote(jarOf(needed));
    if (needed > 1) expect(under.freeDelivery).toBe(false);
    expect(over.freeDelivery).toBe(true);
    expect(over.deliveryCents).toBe(0);
    expect(over.freeDeliveryGapCents).toBe(0);
    expect(over.totalCents).toBe(over.subtotalCents);
  });

  it("adds the rural surcharge on its own, even when delivery is free", () => {
    const needed = Math.ceil(SHIPPING.freeOverCents / small.priceCents);
    const free = quote(jarOf(needed), { rural: true });
    expect(free.deliveryCents).toBe(0);
    expect(free.ruralCents).toBe(SHIPPING.ruralSurchargeCents);
    expect(free.totalCents).toBe(
      free.subtotalCents + SHIPPING.ruralSurchargeCents,
    );

    const paid = quote(jarOf(1), { rural: true });
    expect(paid.shippingCents).toBe(paid.deliveryCents + paid.ruralCents);
  });

  it("always adds up, in integers", () => {
    for (const pack of PACKS) {
      for (const qty of [1, 2, 3, 7]) {
        for (const rural of [false, true]) {
          const priced = quote(addToCart(EMPTY_CART, pack.sku, qty), { rural });
          expect(priced.totalCents).toBe(
            priced.subtotalCents + priced.shippingCents,
          );
          for (const value of [
            priced.subtotalCents,
            priced.shippingCents,
            priced.totalCents,
            priced.freeDeliveryGapCents,
          ]) {
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("ignores a price smuggled in on a line", () => {
    const tampered = {
      lines: [{ sku: small.sku, qty: 1, priceCents: 1, unitCents: 1 }],
    } as unknown as Cart;
    expect(quote(tampered).subtotalCents).toBe(small.priceCents);
  });

  it("prices only what is on the shelf", () => {
    const stranger = { lines: [{ sku: "MADE-UP", qty: 5 }] };
    expect(quote(stranger).totalCents).toBe(0);
  });
});
