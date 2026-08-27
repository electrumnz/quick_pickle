/**
 * Acceptance check: cart totals are recomputed server-side, and a client that
 * tampers with a price or a quantity is rejected.
 *
 * These run against the real schema in PGlite, so "the database says" below
 * means an actual `select` against the actual `orders` table, not a mocked
 * return value.
 *
 * Five routes are tried, from the most naive to the one that requires having
 * already compromised the database:
 *
 *   1. send a price in the request
 *   2. edit the stored line price
 *   3. edit the stored cart totals
 *   4. ask for more stock than exists
 *   5. attach a discount the cart is not entitled to
 *
 * In every case the money that ends up on the order is the money in the
 * catalogue.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isCommerceError } from "@/lib/commerce/errors";
import { MockProvider } from "@/lib/commerce/mock/provider";
import { SEED_VARIANTS, seedCatalogue } from "@/lib/commerce/seed";
import type { SqlExecutor } from "@/lib/commerce/sql/executor";
import { createSchemaDatabase } from "@/lib/commerce/testing/pglite";

/** HS-01-500, No 01 HOUSE. $18.00 in the catalogue. */
const HOUSE_PRICE_CENTS = 1800;

const BUYER = {
  email: "tamper.test@example.co.nz",
  shippingAddress: {
    firstName: "Ngaire",
    lastName: "Hollis",
    line1: "18 Wallace Street",
    suburb: "Newtown",
    city: "Wellington",
    region: "Wellington",
    postcode: "6021",
    countryCode: "NZ",
  },
} as const;

let sql: SqlExecutor;
let provider: MockProvider;

beforeAll(async () => {
  const database = await createSchemaDatabase();
  sql = database.sql;
  provider = new MockProvider({ sql, siteUrl: "https://halfsour.test" });
  await seedCatalogue(sql);
}, 180_000);

afterAll(async () => {
  await provider.close();
});

function cartRowId(cartId: string): string {
  const [id] = cartId.split("?key=");
  if (id === undefined) throw new Error(`unparseable cart id: ${cartId}`);
  return id;
}

async function storedCart(cartId: string): Promise<{
  subtotal_cents: number;
  total_cents: number;
  discount_cents: number;
}> {
  const result = await sql.query<{
    subtotal_cents: number;
    total_cents: number;
    discount_cents: number;
  }>(
    `select subtotal_cents, total_cents, discount_cents
       from public.carts where id = $1`,
    [cartRowId(cartId)],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("cart row vanished");
  return row;
}

describe("server-side total recomputation", () => {
  it("ignores a price sent by the client", async () => {
    // The interface has no price field. A hostile client sends one anyway.
    const hostileLine = {
      variantId: SEED_VARIANTS.house,
      quantity: 2,
      unitPriceCents: 1,
      unit_price_cents: 1,
      price: { amount: "0.01", currencyCode: "NZD" },
      lineTotalCents: 2,
    };
    const { cart } = await provider.createCart({ lines: [hostileLine] });

    expect(cart.lines[0]?.cost.amountPerQuantity.amountInMinorUnits).toBe(
      HOUSE_PRICE_CENTS,
    );
    expect(cart.cost.totalAmount.amountInMinorUnits).toBe(
      HOUSE_PRICE_CENTS * 2,
    );

    const stored = await storedCart(cart.id);
    expect(stored.total_cents).toBe(HOUSE_PRICE_CENTS * 2);
  });

  it("overwrites a line price edited directly in the database", async () => {
    const { cart } = await provider.createCart({
      lines: [{ variantId: SEED_VARIANTS.house, quantity: 3 }],
    });

    // Simulate a compromised write path: one cent a bottle.
    await sql.query(
      `update public.cart_items set unit_price_cents = 1 where cart_id = $1`,
      [cartRowId(cart.id)],
    );
    const beforeRead = await sql.query<{ unit_price_cents: number }>(
      `select unit_price_cents from public.cart_items where cart_id = $1`,
      [cartRowId(cart.id)],
    );
    expect(beforeRead.rows[0]?.unit_price_cents).toBe(1);

    const reread = await provider.getCart(cart.id);
    expect(reread?.cost.totalAmount.amountInMinorUnits).toBe(
      HOUSE_PRICE_CENTS * 3,
    );
    expect(reread?.lines[0]?.cost.amountPerQuantity.amountInMinorUnits).toBe(
      HOUSE_PRICE_CENTS,
    );

    // The tampered row itself is repaired, not merely ignored.
    const afterRead = await sql.query<{ unit_price_cents: number }>(
      `select unit_price_cents from public.cart_items where cart_id = $1`,
      [cartRowId(cart.id)],
    );
    expect(afterRead.rows[0]?.unit_price_cents).toBe(HOUSE_PRICE_CENTS);
  });

  it("overwrites cached cart totals edited directly in the database", async () => {
    const { cart } = await provider.createCart({
      lines: [{ variantId: SEED_VARIANTS.house, quantity: 2 }],
    });
    await sql.query(
      `update public.carts
          set subtotal_cents = 1, total_cents = 1, discount_cents = 0
        where id = $1`,
      [cartRowId(cart.id)],
    );

    const reread = await provider.getCart(cart.id);
    expect(reread?.cost.totalAmount.amountInMinorUnits).toBe(
      HOUSE_PRICE_CENTS * 2,
    );
    expect((await storedCart(cart.id)).total_cents).toBe(HOUSE_PRICE_CENTS * 2);
  });

  it("rejects a quantity that is not a positive whole number", async () => {
    const { cart } = await provider.createCart();
    for (const quantity of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        provider.addCartLines(cart.id, [
          { variantId: SEED_VARIANTS.house, quantity },
        ]),
      ).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
    }
  });

  it("refuses to sell more than the shelf holds", async () => {
    await sql.query(
      `update public.inventory_levels set on_hand = 0 where variant_id = $1`,
      [SEED_VARIANTS.smoke],
    );
    const { cart } = await provider.createCart();
    await expect(
      provider.addCartLines(cart.id, [
        { variantId: SEED_VARIANTS.smoke, quantity: 1 },
      ]),
    ).rejects.toMatchObject({ code: "OUT_OF_STOCK" });

    await sql.query(
      `update public.inventory_levels set on_hand = 2
        where variant_id = $1 and location_id = $2`,
      [SEED_VARIANTS.smoke, "44444444-0000-4000-8000-000000000001"],
    );
    const capped = await provider.addCartLines(cart.id, [
      { variantId: SEED_VARIANTS.smoke, quantity: 99 },
    ]);
    expect(capped.cart.lines[0]?.quantity).toBe(2);
    expect(capped.warnings.map((warning) => warning.code)).toContain(
      "INSUFFICIENT_STOCK",
    );
  });

  it("re-evaluates a discount attached behind the application's back", async () => {
    const { cart } = await provider.createCart({
      lines: [{ variantId: SEED_VARIANTS.house, quantity: 3 }],
    });
    // LAUNCH20 is 20% off, and expired 233 days ago. Attach it by hand.
    await sql.query(
      `update public.carts
          set discount_code = 'LAUNCH20',
              discount_id = '77777777-0000-4000-8000-000000000005',
              discount_cents = 1080,
              total_cents = 4320
        where id = $1`,
      [cartRowId(cart.id)],
    );

    const reread = await provider.getCart(cart.id);
    expect(reread?.discountCodes[0]?.applicable).toBe(false);
    expect(reread?.cost.totalAmount.amountInMinorUnits).toBe(
      HOUSE_PRICE_CENTS * 3,
    );
    expect((await storedCart(cart.id)).discount_cents).toBe(0);
  });

  it("charges the catalogue price even when the cart was tampered with", async () => {
    await sql.query(
      `update public.inventory_levels set on_hand = 50 where variant_id = $1`,
      [SEED_VARIANTS.house],
    );
    const { cart } = await provider.createCart({
      lines: [{ variantId: SEED_VARIANTS.house, quantity: 4 }],
    });

    await sql.query(
      `update public.cart_items set unit_price_cents = 1 where cart_id = $1`,
      [cartRowId(cart.id)],
    );
    await sql.query(
      `update public.carts set subtotal_cents = 4, total_cents = 4 where id = $1`,
      [cartRowId(cart.id)],
    );

    const order = await provider.completeCheckout(cart.id, BUYER);
    const expectedSubtotal = HOUSE_PRICE_CENTS * 4;

    expect(order.subtotal.amountInMinorUnits).toBe(expectedSubtotal);
    expect(order.lineItems[0]?.unitPrice.amountInMinorUnits).toBe(
      HOUSE_PRICE_CENTS,
    );
    expect(order.lineItems[0]?.lineTotal.amountInMinorUnits).toBe(
      expectedSubtotal,
    );

    // And what the database actually stored, not just what the API returned.
    const stored = await sql.query<{
      subtotal_cents: number;
      total_cents: number;
      tax_cents: number;
      shipping_cents: number;
      discount_cents: number;
    }>(
      `select subtotal_cents, total_cents, tax_cents, shipping_cents, discount_cents
         from public.orders where id = $1`,
      [order.id],
    );
    const row = stored.rows[0];
    expect(row?.subtotal_cents).toBe(expectedSubtotal);
    expect(row?.total_cents).toBe(
      expectedSubtotal -
        (row?.discount_cents ?? 0) +
        (row?.shipping_cents ?? 0),
    );
    // GST is the 15% already inside the total, per NZ tax-inclusive pricing.
    expect(row?.tax_cents).toBe(
      Math.round(((row?.total_cents ?? 0) * 1500) / 11500),
    );
  });

  it("reports every rejection as a typed domain error, never a string", async () => {
    const { cart } = await provider.createCart();
    try {
      await provider.addCartLines(cart.id, [
        { variantId: "00000000-0000-4000-8000-000000000000", quantity: 1 },
      ]);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(isCommerceError(error)).toBe(true);
      if (!isCommerceError(error)) return;
      expect(error.code).toBe("VARIANT_NOT_FOUND");
      expect(error.retryable).toBe(false);
      expect(error.toJSON()).toMatchObject({ code: "VARIANT_NOT_FOUND" });
    }
  });
});
