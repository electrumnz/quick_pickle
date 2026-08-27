/**
 * The commerce conformance suite.
 *
 * Written once, against {@link CommerceProvider}, and run against every
 * provider. It is the artefact that will prove the Shopify implementation
 * correct later, so it asserts on *behaviour the contract promises* — totals
 * recompute from the catalogue, an expired cart cannot be mutated, an
 * inapplicable code comes back with a reason — and never on anything only one
 * implementation could satisfy.
 *
 * Cases are plain data with `node:assert` inside, not `describe`/`it`, so the
 * same list runs under Vitest, under Playwright's runner, or from a bare Node
 * script with no framework at all. See `./run.ts` and the bindings in `tests/`
 * and `./playwright.spec.ts`.
 */

import assert from "node:assert/strict";

import { isCommerceError, type CommerceErrorCode } from "../errors";
import { formatMoney, type Money } from "../money";
import type { Cart, CartMutationResult, Order, Product } from "../types";
import type { ConformanceContext } from "./harness";

/** Thrown by a case whose harness cannot provide a hook it needs. */
export class ConformanceSkip extends Error {
  override readonly name = "ConformanceSkip";
}

export type ConformanceCase = {
  readonly group: string;
  readonly name: string;
  run(context: ConformanceContext): Promise<void>;
};

// ---------------------------------------------------------------------------
// Assertions shared by the cases
// ---------------------------------------------------------------------------

function skipIfUnsupported(result: string, what: string): void {
  if (result === "unsupported") {
    throw new ConformanceSkip(`${what} is not reachable on this provider`);
  }
}

function requireFirst<T>(items: readonly T[], what: string): T {
  const first = items[0];
  assert.ok(first !== undefined, `expected at least one ${what}`);
  return first;
}

function assertExactMoney(
  value: Money,
  currencyCode: string,
  label: string,
): void {
  assert.equal(value.currencyCode, currencyCode, `${label}: wrong currency`);
  assert.ok(
    Number.isSafeInteger(value.amountInMinorUnits),
    `${label}: ${String(value.amountInMinorUnits)} is not an integer number of minor units`,
  );
}

async function expectCommerceError(
  action: () => Promise<unknown>,
  code: CommerceErrorCode,
  label: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!isCommerceError(error)) throw error;
    assert.equal(
      error.code,
      code,
      `${label}: wrong error code (${error.message})`,
    );
    return;
  }
  assert.fail(`${label}: expected a ${code} CommerceError, nothing was thrown`);
}

/**
 * Adding stock that is not there may either throw or come back as a
 * non-blocking warning with nothing added — Shopify does the latter, this mock
 * does the former. Both are correct; silently taking the order is not.
 */
async function expectStockRefusal(
  action: () => Promise<CartMutationResult>,
  label: string,
): Promise<void> {
  let result: CartMutationResult;
  try {
    result = await action();
  } catch (error) {
    if (!isCommerceError(error)) throw error;
    assert.ok(
      error.code === "OUT_OF_STOCK" || error.code === "INSUFFICIENT_STOCK",
      `${label}: expected an out-of-stock error, got ${error.code}`,
    );
    return;
  }
  const warned = result.warnings.some(
    (warning) =>
      warning.code === "OUT_OF_STOCK" || warning.code === "INSUFFICIENT_STOCK",
  );
  assert.ok(warned, `${label}: the line was accepted with no stock warning`);
}

async function newCart(
  context: ConformanceContext,
  lines: readonly { variantId: string; quantity: number }[] = [],
): Promise<Cart> {
  const created = await context.provider.createCart({ lines });
  return created.cart;
}

function cartSubtotal(cart: Cart): number {
  return cart.lines.reduce(
    (sum, line) => sum + line.cost.subtotalAmount.amountInMinorUnits,
    0,
  );
}

const CHECKOUT_QUANTITY = 3;

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const providerCases: readonly ConformanceCase[] = [
  {
    group: "provider",
    name: "declares a name, a currency and self-consistent capabilities",
    async run({ provider }) {
      assert.ok(provider.name.length > 0);
      assert.match(provider.currencyCode, /^[A-Z]{3}$/);
      const caps = provider.capabilities;
      assert.ok(caps.cartTtlDays > 0, "cartTtlDays must be positive");
      assert.ok(caps.maxCartLines > 0, "maxCartLines must be positive");
      assert.ok(
        caps.maxPageSize > 0 && caps.maxPageSize <= 250,
        "maxPageSize must be within Shopify's 250 ceiling",
      );
    },
  },
  {
    group: "provider",
    name: "exposes a checkout simulator exactly when it claims to",
    async run({ provider }) {
      assert.equal(
        provider.checkoutSimulator !== null,
        provider.capabilities.simulatesCheckout,
        "capabilities.simulatesCheckout must match checkoutSimulator",
      );
    },
  },
];

const catalogueCases: readonly ConformanceCase[] = [
  {
    group: "catalogue",
    name: "lists products with page info",
    async run({ provider }) {
      const page = await provider.listProducts({ first: 2 });
      assert.ok(page.nodes.length > 0, "expected at least one product");
      assert.ok(page.nodes.length <= 2, "first: 2 returned more than two");
      assert.equal(page.pageInfo.hasPreviousPage, false);
      assert.ok(page.pageInfo.endCursor !== null);
    },
  },
  {
    group: "catalogue",
    name: "every product has variants and a price range that brackets them",
    async run({ provider }) {
      const page = await provider.listProducts({ first: 50 });
      for (const product of page.nodes) {
        assert.ok(
          product.variants.length > 0,
          `${product.handle} has no purchasable variant`,
        );
        const prices = product.variants.map((v) => v.price.amountInMinorUnits);
        assert.equal(
          product.priceRange.min.amountInMinorUnits,
          Math.min(...prices),
          `${product.handle} priceRange.min disagrees with its variants`,
        );
        assert.equal(
          product.priceRange.max.amountInMinorUnits,
          Math.max(...prices),
          `${product.handle} priceRange.max disagrees with its variants`,
        );
      }
    },
  },
  {
    group: "catalogue",
    name: "every catalogue price is an exact integer in the store currency",
    async run({ provider }) {
      const page = await provider.listProducts({ first: 50 });
      for (const product of page.nodes) {
        assertExactMoney(
          product.priceRange.min,
          provider.currencyCode,
          `${product.handle} min`,
        );
        for (const variant of product.variants) {
          assertExactMoney(
            variant.price,
            provider.currencyCode,
            `${variant.sku} price`,
          );
          if (variant.compareAtPrice !== null) {
            assert.ok(
              variant.compareAtPrice.amountInMinorUnits >=
                variant.price.amountInMinorUnits,
              `${variant.sku}: compare-at is below the price`,
            );
          }
          // A formatted price must round-trip to two decimals, not 12.500000001.
          assert.match(
            formatMoney(variant.price),
            /^-?\$[\d,]+\.\d{2}$/,
            `${variant.sku}: ${formatMoney(variant.price)} is not a clean NZD amount`,
          );
        }
      }
    },
  },
  {
    group: "catalogue",
    name: "paginates forward without repeating or dropping a product",
    async run({ provider }) {
      const all = await provider.listProducts({ first: 100, sortKey: "TITLE" });
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page += 1) {
        const result = await provider.listProducts({
          first: 1,
          after: cursor,
          sortKey: "TITLE",
        });
        if (result.nodes.length === 0) break;
        seen.push(...result.nodes.map((node) => node.id));
        if (!result.pageInfo.hasNextPage) break;
        cursor = result.pageInfo.endCursor ?? undefined;
      }
      assert.deepEqual(
        seen,
        all.nodes.map((node) => node.id),
        "one-at-a-time paging did not reproduce the full ordered list",
      );
      assert.equal(new Set(seen).size, seen.length, "a product appeared twice");
    },
  },
  {
    group: "catalogue",
    name: "paginates backwards to the same page",
    async run({ provider }) {
      const forward = await provider.listProducts({
        first: 2,
        sortKey: "TITLE",
      });
      if (!forward.pageInfo.hasNextPage) return;
      const second = await provider.listProducts({
        first: 2,
        after: forward.pageInfo.endCursor ?? undefined,
        sortKey: "TITLE",
      });
      const back = await provider.listProducts({
        last: 2,
        before: second.pageInfo.startCursor ?? undefined,
        sortKey: "TITLE",
      });
      assert.deepEqual(
        back.nodes.map((node) => node.id),
        forward.nodes.map((node) => node.id),
        "paging back did not return the previous page",
      );
    },
  },
  {
    group: "catalogue",
    name: "refuses contradictory and oversized page arguments",
    async run({ provider }) {
      await expectCommerceError(
        () => provider.listProducts({ first: 1, last: 1 }),
        "INVALID_INPUT",
        "first+last",
      );
      await expectCommerceError(
        () => provider.listProducts({ first: 0 }),
        "INVALID_INPUT",
        "first: 0",
      );
      await expectCommerceError(
        () => provider.listProducts({ first: 5000 }),
        "INVALID_INPUT",
        "first: 5000",
      );
    },
  },
  {
    group: "catalogue",
    name: "refuses a cursor minted for a different list",
    async run({ provider }) {
      const orders = await provider.listOrders({ first: 1 });
      const cursor = orders.pageInfo.endCursor;
      if (cursor === null) return;
      await expectCommerceError(
        () => provider.listProducts({ first: 1, after: cursor }),
        "INVALID_INPUT",
        "cross-list cursor",
      );
    },
  },
  {
    group: "catalogue",
    name: "gets a product by handle and by id, and null for neither",
    async run({ provider, fixtures }) {
      const byHandle = await provider.getProductByHandle(
        fixtures.productHandle,
      );
      assert.ok(byHandle !== null, "known handle returned null");
      const byId = await provider.getProductById(byHandle.id);
      assert.ok(byId !== null, "known id returned null");
      assert.equal(byId.handle, byHandle.handle);
      assert.equal(
        await provider.getProductByHandle("no-such-handle-9x"),
        null,
      );
      assert.equal(await provider.getProductById("not-an-id"), null);
    },
  },
  {
    group: "catalogue",
    name: "filters by availability, tag and price",
    async run({ provider, fixtures }) {
      const available = await provider.listProducts({
        first: 50,
        filter: { availableForSale: true },
      });
      for (const product of available.nodes) {
        assert.ok(
          product.availableForSale,
          `${product.handle} is not available`,
        );
      }

      const tagged = await provider.listProducts({
        first: 50,
        filter: { tags: [fixtures.commonTag] },
      });
      assert.ok(tagged.nodes.length > 0, "common tag matched nothing");
      for (const product of tagged.nodes) {
        assert.ok(
          product.tags.includes(fixtures.commonTag),
          `${product.handle} lacks the tag it was filtered by`,
        );
      }

      const excluded = await provider.listProducts({
        first: 50,
        filter: { excludeTags: [fixtures.commonTag] },
      });
      for (const product of excluded.nodes) {
        assert.ok(
          !product.tags.includes(fixtures.commonTag),
          `${product.handle} carries an excluded tag`,
        );
      }

      const all = await provider.listProducts({ first: 50 });
      const cheapest = Math.min(
        ...all.nodes.map((node) => node.priceRange.min.amountInMinorUnits),
      );
      const dear = await provider.listProducts({
        first: 50,
        filter: { minPrice: cheapest + 1 },
      });
      for (const product of dear.nodes) {
        assert.ok(
          product.priceRange.max.amountInMinorUnits >= cheapest + 1,
          `${product.handle} is below the price floor asked for`,
        );
      }
    },
  },
  {
    group: "catalogue",
    name: "free-text search finds the product it describes",
    async run({ provider, fixtures }) {
      const found = await provider.listProducts({
        first: 20,
        filter: { search: fixtures.searchTerm },
      });
      assert.ok(
        found.nodes.length > 0,
        `search for "${fixtures.searchTerm}" matched nothing`,
      );
    },
  },
  {
    group: "catalogue",
    name: "sorts by price, and reverse actually reverses",
    async run({ provider }) {
      const up = await provider.listProducts({ first: 50, sortKey: "PRICE" });
      const prices = up.nodes.map(
        (node) => node.priceRange.min.amountInMinorUnits,
      );
      assert.deepEqual(
        prices,
        [...prices].sort((a, b) => a - b),
        "PRICE ascending was not ascending",
      );
      const down = await provider.listProducts({
        first: 50,
        sortKey: "PRICE",
        reverse: true,
      });
      assert.deepEqual(
        down.nodes.map((node) => node.priceRange.min.amountInMinorUnits),
        [...prices].reverse(),
        "PRICE reversed did not reverse",
      );
    },
  },
  {
    group: "catalogue",
    name: "getVariantsById returns what exists and drops what does not",
    async run({ provider, fixtures }) {
      const variants = await provider.getVariantsById([
        fixtures.stockedVariantId,
        "00000000-0000-4000-8000-000000000000",
        fixtures.secondVariantId,
      ]);
      assert.deepEqual(
        variants.map((variant) => variant.id),
        [fixtures.stockedVariantId, fixtures.secondVariantId],
      );
    },
  },
  {
    group: "catalogue",
    name: "lists collections and reads one with its products",
    async run({ provider, fixtures }) {
      const collections = await provider.listCollections({ first: 20 });
      assert.ok(collections.nodes.length > 0, "no published collections");

      const found = await provider.getCollectionByHandle(
        fixtures.collectionHandle,
        {
          first: 3,
        },
      );
      assert.ok(found !== null, "known collection handle returned null");
      assert.equal(found.collection.handle, fixtures.collectionHandle);
      assert.ok(found.products.nodes.length > 0, "collection has no products");
      assert.equal(
        await provider.getCollectionByHandle("no-such-collection"),
        null,
      );
    },
  },
];

const cartCases: readonly ConformanceCase[] = [
  {
    group: "cart",
    name: "creates an empty cart that costs nothing and has a checkout URL",
    async run(context) {
      const cart = await newCart(context);
      assert.equal(cart.totalQuantity, 0);
      assert.equal(cart.lines.length, 0);
      assert.equal(cart.cost.totalAmount.amountInMinorUnits, 0);
      assert.equal(cart.cost.subtotalAmount.amountInMinorUnits, 0);
      assert.match(
        cart.checkoutUrl,
        /^https?:\/\//,
        "checkoutUrl is not absolute",
      );
      assert.equal(cart.currencyCode, context.provider.currencyCode);
    },
  },
  {
    group: "cart",
    name: "a cart id round-trips, and a bogus one is simply not found",
    async run(context) {
      const cart = await newCart(context);
      const fetched = await context.provider.getCart(cart.id);
      assert.ok(fetched !== null, "getCart lost a cart it had just created");
      assert.equal(fetched.id, cart.id);
      assert.equal(await context.provider.getCart("nonsense"), null);
    },
  },
  {
    group: "cart",
    name: "adds a line priced from the catalogue, not from the request",
    async run(context) {
      const { fixtures, provider } = context;
      const variant = requireFirst(
        await provider.getVariantsById([fixtures.stockedVariantId]),
        "variant",
      );
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 2 },
      ]);
      const line = requireFirst(cart.lines, "cart line");
      assert.equal(line.quantity, 2);
      assert.equal(
        line.cost.amountPerQuantity.amountInMinorUnits,
        variant.price.amountInMinorUnits,
        "line unit price is not the catalogue price",
      );
      assert.equal(
        line.cost.subtotalAmount.amountInMinorUnits,
        variant.price.amountInMinorUnits * 2,
        "line subtotal is not unit x quantity",
      );
      assert.equal(
        cart.cost.subtotalAmount.amountInMinorUnits,
        line.cost.subtotalAmount.amountInMinorUnits,
      );
      assert.equal(cart.totalQuantity, 2);
    },
  },
  {
    group: "cart",
    name: "adding the same variant twice merges into one line",
    async run(context) {
      const { fixtures, provider } = context;
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 1 },
      ]);
      const after = await provider.addCartLines(cart.id, [
        { variantId: fixtures.stockedVariantId, quantity: 2 },
      ]);
      assert.equal(
        after.cart.lines.length,
        1,
        "the cart grew a duplicate line",
      );
      assert.equal(requireFirst(after.cart.lines, "line").quantity, 3);
      assert.equal(after.cart.totalQuantity, 3);
    },
  },
  {
    group: "cart",
    name: "updates a quantity, and quantity 0 removes the line",
    async run(context) {
      const { fixtures, provider } = context;
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 2 },
        { variantId: fixtures.secondVariantId, quantity: 1 },
      ]);
      const target = requireFirst(cart.lines, "line");
      const updated = await provider.updateCartLines(cart.id, [
        { lineId: target.id, quantity: 5 },
      ]);
      const found = updated.cart.lines.find((line) => line.id === target.id);
      assert.ok(found !== undefined, "the updated line disappeared");
      assert.equal(found.quantity, 5);
      assert.equal(
        found.cost.subtotalAmount.amountInMinorUnits,
        found.cost.amountPerQuantity.amountInMinorUnits * 5,
      );

      const removed = await provider.updateCartLines(cart.id, [
        { lineId: target.id, quantity: 0 },
      ]);
      assert.equal(
        removed.cart.lines.length,
        1,
        "quantity 0 did not remove the line",
      );
    },
  },
  {
    group: "cart",
    name: "removes a line by id and rejects unknown line ids",
    async run(context) {
      const { fixtures, provider } = context;
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 1 },
      ]);
      const line = requireFirst(cart.lines, "line");
      const after = await provider.removeCartLines(cart.id, [line.id]);
      assert.equal(after.cart.lines.length, 0);
      assert.equal(after.cart.cost.totalAmount.amountInMinorUnits, 0);

      await expectCommerceError(
        () =>
          provider.removeCartLines(cart.id, [
            "11111111-2222-4333-8444-555555555555",
          ]),
        "CART_LINE_NOT_FOUND",
        "remove unknown line",
      );
      await expectCommerceError(
        () =>
          provider.updateCartLines(cart.id, [
            { lineId: "11111111-2222-4333-8444-555555555555", quantity: 1 },
          ]),
        "CART_LINE_NOT_FOUND",
        "update unknown line",
      );
    },
  },
  {
    group: "cart",
    name: "refuses bad quantities, unknown variants and unknown carts",
    async run(context) {
      const { fixtures, provider } = context;
      const cart = await newCart(context);
      await expectCommerceError(
        () =>
          provider.addCartLines(cart.id, [
            { variantId: fixtures.stockedVariantId, quantity: 0 },
          ]),
        "INVALID_QUANTITY",
        "quantity 0 on add",
      );
      await expectCommerceError(
        () =>
          provider.addCartLines(cart.id, [
            { variantId: fixtures.stockedVariantId, quantity: -3 },
          ]),
        "INVALID_QUANTITY",
        "negative quantity",
      );
      await expectCommerceError(
        () =>
          provider.addCartLines(cart.id, [
            { variantId: "00000000-0000-4000-8000-000000000000", quantity: 1 },
          ]),
        "VARIANT_NOT_FOUND",
        "unknown variant",
      );
      await expectCommerceError(
        () =>
          provider.addCartLines("not-a-cart", [
            { variantId: fixtures.stockedVariantId, quantity: 1 },
          ]),
        "CART_NOT_FOUND",
        "unknown cart",
      );
    },
  },
  {
    group: "cart",
    name: "note, attributes and buyer identity round-trip",
    async run(context) {
      const { fixtures, provider } = context;
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 1 },
      ]);
      const noted = await provider.updateCartNote(cart.id, "Leave at the door");
      assert.equal(noted.cart.note, "Leave at the door");

      const attributed = await provider.updateCartAttributes(cart.id, [
        { key: "gift_message", value: "Happy birthday, Tama" },
      ]);
      const attribute = attributed.cart.attributes.find(
        (item) => item.key === "gift_message",
      );
      assert.ok(attribute !== undefined, "attribute did not persist");
      assert.equal(attribute.value, "Happy birthday, Tama");

      const identified = await provider.updateCartBuyerIdentity(cart.id, {
        email: fixtures.checkoutEmail,
        countryCode: "NZ",
      });
      assert.equal(identified.cart.buyerIdentity.email, fixtures.checkoutEmail);
      assert.equal(identified.cart.buyerIdentity.countryCode, "NZ");
      // Internal bookkeeping must not leak into the public attribute list.
      for (const item of identified.cart.attributes) {
        assert.ok(
          !item.key.startsWith("__"),
          `internal attribute ${item.key} leaked to the client`,
        );
      }
    },
  },
  {
    group: "cart",
    name: "an expired cart reads as gone and refuses mutation",
    async run(context) {
      const { fixtures, provider } = context;
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 1 },
      ]);
      skipIfUnsupported(await context.expireCart(cart.id), "cart expiry");

      assert.equal(
        await provider.getCart(cart.id),
        null,
        "expired cart still readable",
      );
      await expectCommerceError(
        () =>
          provider.addCartLines(cart.id, [
            { variantId: fixtures.stockedVariantId, quantity: 1 },
          ]),
        "CART_EXPIRED",
        "mutate an expired cart",
      );
    },
  },
];

const tamperCases: readonly ConformanceCase[] = [
  {
    group: "tamper",
    name: "a price supplied by the client is ignored entirely",
    async run(context) {
      const { fixtures, provider } = context;
      const variant = requireFirst(
        await provider.getVariantsById([fixtures.stockedVariantId]),
        "variant",
      );
      // The interface has no price field, so this is what a malicious client
      // can actually do: send one anyway and hope something reads it.
      const hostile = {
        variantId: fixtures.stockedVariantId,
        quantity: 2,
        unitPriceCents: 1,
        price: "0.01",
        cost: {
          amountPerQuantity: { amountInMinorUnits: 1, currencyCode: "NZD" },
        },
      };
      const cart = await newCart(context, [hostile]);
      const line = requireFirst(cart.lines, "line");
      assert.equal(
        line.cost.amountPerQuantity.amountInMinorUnits,
        variant.price.amountInMinorUnits,
        "a client-supplied price reached the line",
      );
      assert.equal(
        cart.cost.totalAmount.amountInMinorUnits,
        variant.price.amountInMinorUnits * 2,
        "a client-supplied price reached the total",
      );
    },
  },
  {
    group: "tamper",
    name: "a price written straight into storage is corrected on the next read",
    async run(context) {
      const { fixtures, provider } = context;
      const variant = requireFirst(
        await provider.getVariantsById([fixtures.stockedVariantId]),
        "variant",
      );
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 2 },
      ]);
      skipIfUnsupported(
        await context.tamperLinePrice(cart.id, fixtures.stockedVariantId, 1),
        "stored line prices",
      );

      const reread = await provider.getCart(cart.id);
      assert.ok(reread !== null);
      const line = requireFirst(reread.lines, "line");
      assert.equal(
        line.cost.amountPerQuantity.amountInMinorUnits,
        variant.price.amountInMinorUnits,
        "the tampered unit price survived a read",
      );
      assert.equal(
        reread.cost.totalAmount.amountInMinorUnits,
        variant.price.amountInMinorUnits * 2,
        "the cart total was computed from the tampered price",
      );
    },
  },
  {
    group: "tamper",
    name: "tampered cached totals are overwritten, not trusted",
    async run(context) {
      const { fixtures, provider } = context;
      const variant = requireFirst(
        await provider.getVariantsById([fixtures.stockedVariantId]),
        "variant",
      );
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 3 },
      ]);
      skipIfUnsupported(
        await context.tamperCartTotals(cart.id, 1),
        "stored cart totals",
      );
      const reread = await provider.getCart(cart.id);
      assert.ok(reread !== null);
      assert.equal(
        reread.cost.totalAmount.amountInMinorUnits,
        variant.price.amountInMinorUnits * 3,
        "the tampered cached total was served to the client",
      );
    },
  },
  {
    group: "tamper",
    name: "a tampered cart is charged the catalogue price at checkout",
    async run(context) {
      const { fixtures, provider } = context;
      if (provider.checkoutSimulator === null) {
        throw new ConformanceSkip(
          "this provider cannot complete a checkout itself",
        );
      }
      const variant = requireFirst(
        await provider.getVariantsById([fixtures.stockedVariantId]),
        "variant",
      );
      await context.setStock(fixtures.stockedVariantId, 50);
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 2 },
      ]);
      const tampered = await context.tamperLinePrice(
        cart.id,
        fixtures.stockedVariantId,
        1,
      );
      skipIfUnsupported(tampered, "stored line prices");
      await context.tamperCartTotals(cart.id, 2);

      const order = await context.completeCheckout(cart.id);
      const expected = variant.price.amountInMinorUnits * 2;
      assert.equal(
        order.subtotal.amountInMinorUnits,
        expected,
        "the order was written at the tampered price",
      );
      const item = requireFirst(order.lineItems, "order line");
      assert.equal(
        item.unitPrice.amountInMinorUnits,
        variant.price.amountInMinorUnits,
        "the order line was written at the tampered price",
      );
      assert.equal(
        order.total.amountInMinorUnits,
        order.subtotal.amountInMinorUnits -
          order.discountTotal.amountInMinorUnits +
          order.shippingTotal.amountInMinorUnits,
        "the order total does not add up",
      );
    },
  },
  {
    group: "tamper",
    name: "cart arithmetic is exact: lines sum to the subtotal, every value an integer",
    async run(context) {
      const { fixtures, provider } = context;
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 3 },
        { variantId: fixtures.secondVariantId, quantity: 7 },
      ]);
      assert.equal(
        cart.cost.subtotalAmount.amountInMinorUnits,
        cartSubtotal(cart),
        "cart subtotal is not the sum of its lines",
      );
      assertExactMoney(
        cart.cost.subtotalAmount,
        provider.currencyCode,
        "subtotal",
      );
      assertExactMoney(cart.cost.totalAmount, provider.currencyCode, "total");
      for (const line of cart.lines) {
        assertExactMoney(
          line.cost.totalAmount,
          provider.currencyCode,
          "line total",
        );
        assert.equal(
          line.cost.subtotalAmount.amountInMinorUnits,
          line.cost.amountPerQuantity.amountInMinorUnits * line.quantity,
          "line subtotal is not unit x quantity",
        );
      }
    },
  },
];

const stockCases: readonly ConformanceCase[] = [
  {
    group: "stock",
    name: "an out-of-stock variant cannot be added",
    async run(context) {
      const { fixtures, provider } = context;
      skipIfUnsupported(
        await context.setStock(fixtures.scarceVariantId, 0),
        "setting stock",
      );
      const cart = await newCart(context);
      await expectStockRefusal(
        () =>
          provider.addCartLines(cart.id, [
            { variantId: fixtures.scarceVariantId, quantity: 1 },
          ]),
        "adding an out-of-stock variant",
      );
      const reread = await provider.getCart(cart.id);
      assert.equal(reread?.lines.length ?? 0, 0, "the line was added anyway");
    },
  },
  {
    group: "stock",
    name: "asking for more than exists never yields more than exists",
    async run(context) {
      const { fixtures, provider } = context;
      skipIfUnsupported(
        await context.setStock(fixtures.scarceVariantId, 2),
        "setting stock",
      );
      const cart = await newCart(context);
      try {
        const result = await provider.addCartLines(cart.id, [
          { variantId: fixtures.scarceVariantId, quantity: 9 },
        ]);
        const line = result.cart.lines.find(
          (candidate) => candidate.merchandise.id === fixtures.scarceVariantId,
        );
        assert.ok(line !== undefined, "no line and no error");
        assert.ok(
          line.quantity <= 2,
          `cart holds ${String(line.quantity)} of 2 in stock`,
        );
        assert.ok(
          result.warnings.length > 0,
          "the quantity was capped with no warning to show the shopper",
        );
      } catch (error) {
        if (!isCommerceError(error)) throw error;
        assert.equal(error.code, "INSUFFICIENT_STOCK");
      }
    },
  },
  {
    group: "stock",
    name: "quantityAvailable reflects what is actually on the shelf",
    async run(context) {
      const { fixtures, provider } = context;
      skipIfUnsupported(
        await context.setStock(fixtures.scarceVariantId, 7),
        "setting stock",
      );
      if (!provider.capabilities.exposesInventoryQuantities) {
        throw new ConformanceSkip(
          "this provider does not expose inventory quantities",
        );
      }
      const variant = requireFirst(
        await provider.getVariantsById([fixtures.scarceVariantId]),
        "variant",
      );
      assert.equal(variant.quantityAvailable, 7);
      assert.equal(variant.availableForSale, true);
    },
  },
];

const discountCases: readonly ConformanceCase[] = [
  {
    group: "discount",
    name: "a valid percentage code reduces the total by exactly its value",
    async run(context) {
      const { fixtures, provider } = context;
      const variant = requireFirst(
        await provider.getVariantsById([fixtures.stockedVariantId]),
        "variant",
      );
      const quantity = Math.max(
        1,
        Math.ceil(
          fixtures.percentageMinimumCents / variant.price.amountInMinorUnits,
        ),
      );
      await context.setStock(fixtures.stockedVariantId, quantity + 20);
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity },
      ]);
      const applied = await provider.updateCartDiscountCodes(cart.id, [
        fixtures.percentageCode,
      ]);

      const code = requireFirst(applied.cart.discountCodes, "discount code");
      assert.equal(
        code.applicable,
        true,
        `${fixtures.percentageCode} did not apply`,
      );

      const subtotal = applied.cart.cost.subtotalAmount.amountInMinorUnits;
      const expectedOff = Math.round(
        (subtotal * fixtures.percentageBasisPoints) / 10_000,
      );
      assert.equal(
        subtotal - applied.cart.cost.totalAmount.amountInMinorUnits,
        expectedOff,
        "the discount taken off is not the percentage of the subtotal",
      );

      const allocation = requireFirst(
        applied.cart.discountAllocations,
        "discount allocation",
      );
      assert.equal(allocation.discountedAmount.amountInMinorUnits, expectedOff);

      const cleared = await provider.updateCartDiscountCodes(cart.id, []);
      assert.equal(cleared.cart.discountCodes.length, 0);
      assert.equal(cleared.cart.cost.totalAmount.amountInMinorUnits, subtotal);
    },
  },
  {
    group: "discount",
    name: "an unknown code is kept, marked inapplicable and explained",
    async run(context) {
      const { fixtures, provider } = context;
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 1 },
      ]);
      const before = (await provider.getCart(cart.id))?.cost.totalAmount
        .amountInMinorUnits;
      const result = await provider.updateCartDiscountCodes(cart.id, [
        fixtures.unknownCode,
      ]);
      const code = requireFirst(result.cart.discountCodes, "discount code");
      assert.equal(code.applicable, false);
      assert.ok(
        result.warnings.some(
          (warning) => warning.code === "DISCOUNT_NOT_FOUND",
        ),
        "no warning explained why the code did nothing",
      );
      assert.equal(
        result.cart.cost.totalAmount.amountInMinorUnits,
        before,
        "an unknown code changed the total",
      );
    },
  },
  {
    group: "discount",
    name: "validateDiscountCode explains a rejection without applying anything",
    async run(context) {
      const { fixtures, provider } = context;
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 1 },
      ]);

      const expired = await provider.validateDiscountCode(
        cart.id,
        fixtures.expiredCode,
      );
      assert.equal(expired.applicable, false);
      assert.equal(expired.rejectionCode, "DISCOUNT_EXPIRED");
      assert.equal(expired.amountOff.amountInMinorUnits, 0);

      const unknown = await provider.validateDiscountCode(
        cart.id,
        fixtures.unknownCode,
      );
      assert.equal(unknown.applicable, false);
      assert.equal(unknown.rejectionCode, "DISCOUNT_NOT_FOUND");
      assert.equal(unknown.discount, null);

      const after = await provider.getCart(cart.id);
      assert.equal(
        after?.discountCodes.length ?? 0,
        0,
        "validating a code left it applied to the cart",
      );
    },
  },
  {
    group: "discount",
    name: "getDiscountByCode reads a code, and returns null for one that does not exist",
    async run({ provider, fixtures }) {
      const found = await provider.getDiscountByCode(fixtures.percentageCode);
      assert.ok(found !== null, "known code not found");
      assert.equal(found.valueType, "percentage");
      assert.equal(found.percentageBasisPoints, fixtures.percentageBasisPoints);
      assert.equal(
        await provider.getDiscountByCode(fixtures.unknownCode),
        null,
      );
    },
  },
  {
    group: "discount",
    name: "a below-minimum cart is told what it is short of",
    async run(context) {
      const { fixtures, provider } = context;
      const variant = requireFirst(
        await provider.getVariantsById([fixtures.stockedVariantId]),
        "variant",
      );
      if (variant.price.amountInMinorUnits >= fixtures.percentageMinimumCents) {
        throw new ConformanceSkip("a single unit already meets the minimum");
      }
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 1 },
      ]);
      const validation = await provider.validateDiscountCode(
        cart.id,
        fixtures.percentageCode,
      );
      assert.equal(validation.applicable, false);
      assert.equal(validation.rejectionCode, "DISCOUNT_MINIMUM_NOT_MET");
      assert.ok(
        (validation.rejectionMessage ?? "").length > 0,
        "no message to show the shopper",
      );
    },
  },
];

const checkoutCases: readonly ConformanceCase[] = [
  {
    group: "checkout",
    name: "beginCheckout hands back an absolute URL and the cart's own total",
    async run(context) {
      const { fixtures, provider } = context;
      await context.setStock(fixtures.stockedVariantId, 50);
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: CHECKOUT_QUANTITY },
      ]);
      const handoff = await provider.beginCheckout(cart.id);
      assert.match(handoff.checkoutUrl, /^https?:\/\/\S+$/);
      assert.equal(handoff.cartId, cart.id);
      assert.equal(handoff.totalQuantity, CHECKOUT_QUANTITY);
      assert.equal(
        handoff.estimatedTotal.amountInMinorUnits,
        cart.cost.totalAmount.amountInMinorUnits,
      );
      assert.equal(handoff.currencyCode, provider.currencyCode);
    },
  },
  {
    group: "checkout",
    name: "an empty cart cannot be checked out",
    async run(context) {
      const cart = await newCart(context);
      await expectCommerceError(
        () => context.provider.beginCheckout(cart.id),
        "CART_EMPTY",
        "beginCheckout on an empty cart",
      );
    },
  },
  {
    group: "checkout",
    name: "checkout produces an order that matches the cart and adds up",
    async run(context) {
      const { fixtures, provider } = context;
      if (provider.checkoutSimulator === null) {
        throw new ConformanceSkip(
          "this provider cannot complete a checkout itself",
        );
      }
      await context.setStock(fixtures.stockedVariantId, 60);
      await context.setStock(fixtures.secondVariantId, 60);
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 2 },
        { variantId: fixtures.secondVariantId, quantity: 1 },
      ]);
      const order = await context.completeCheckout(cart.id);

      assert.equal(order.currencyCode, provider.currencyCode);
      assert.equal(order.lineItems.length, 2);
      assert.equal(
        order.subtotal.amountInMinorUnits,
        cart.cost.subtotalAmount.amountInMinorUnits,
        "the order subtotal is not the cart subtotal",
      );
      assert.equal(
        order.total.amountInMinorUnits,
        order.subtotal.amountInMinorUnits -
          order.discountTotal.amountInMinorUnits +
          order.shippingTotal.amountInMinorUnits,
        "order total does not equal subtotal - discount + shipping",
      );

      const lineSum = order.lineItems.reduce(
        (sum, item) => sum + item.lineTotal.amountInMinorUnits,
        0,
      );
      assert.equal(
        lineSum,
        order.subtotal.amountInMinorUnits -
          order.discountTotal.amountInMinorUnits,
        "the line items do not sum to the discounted subtotal",
      );
      for (const item of order.lineItems) {
        assert.equal(
          item.lineTotal.amountInMinorUnits,
          item.unitPrice.amountInMinorUnits * item.quantity -
            item.discountTotal.amountInMinorUnits,
          `${item.sku}: line total does not add up`,
        );
      }
      assert.ok(order.orderNumber.length > 0, "the order has no number");
      assert.equal(
        order.cartId !== null,
        true,
        "the order is not linked to its cart",
      );
    },
  },
  {
    group: "checkout",
    name: "GST is the component already inside the total, not added to it",
    async run(context) {
      const { fixtures, provider } = context;
      if (provider.checkoutSimulator === null) {
        throw new ConformanceSkip(
          "this provider cannot complete a checkout itself",
        );
      }
      await context.setStock(fixtures.stockedVariantId, 60);
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 2 },
      ]);
      const order = await context.completeCheckout(cart.id);
      if (!order.taxIncluded) {
        throw new ConformanceSkip(
          "this store does not quote tax-inclusive prices",
        );
      }
      const rate = order.taxRateBasisPoints;
      const expected = Math.round(
        (order.total.amountInMinorUnits * rate) / (10_000 + rate),
      );
      assert.equal(
        order.taxTotal.amountInMinorUnits,
        expected,
        "GST is not total x rate / (1 + rate)",
      );
      assert.ok(
        order.taxTotal.amountInMinorUnits < order.total.amountInMinorUnits,
        "tax exceeds the total it is supposed to be inside",
      );
    },
  },
  {
    group: "checkout",
    name: "checkout takes the stock it sold",
    async run(context) {
      const { fixtures, provider } = context;
      if (provider.checkoutSimulator === null) {
        throw new ConformanceSkip(
          "this provider cannot complete a checkout itself",
        );
      }
      skipIfUnsupported(
        await context.setStock(fixtures.scarceVariantId, 12),
        "setting stock",
      );
      const cart = await newCart(context, [
        { variantId: fixtures.scarceVariantId, quantity: 4 },
      ]);
      await context.completeCheckout(cart.id);
      const variant = requireFirst(
        await provider.getVariantsById([fixtures.scarceVariantId]),
        "variant",
      );
      assert.equal(
        variant.quantityAvailable,
        8,
        "stock did not fall by the quantity ordered",
      );
    },
  },
  {
    group: "checkout",
    name: "a cart cannot be checked out twice",
    async run(context) {
      const { fixtures, provider } = context;
      if (provider.checkoutSimulator === null) {
        throw new ConformanceSkip(
          "this provider cannot complete a checkout itself",
        );
      }
      await context.setStock(fixtures.stockedVariantId, 60);
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 1 },
      ]);
      await context.completeCheckout(cart.id);
      await expectCommerceError(
        () => context.completeCheckout(cart.id),
        "CART_ALREADY_COMPLETED",
        "second checkout",
      );
      assert.equal(
        await provider.getCart(cart.id),
        null,
        "a converted cart is still readable as a live cart",
      );
    },
  },
  {
    group: "checkout",
    name: "the order can be read back by id and by number",
    async run(context) {
      const { fixtures, provider } = context;
      if (provider.checkoutSimulator === null) {
        throw new ConformanceSkip(
          "this provider cannot complete a checkout itself",
        );
      }
      await context.setStock(fixtures.stockedVariantId, 60);
      const cart = await newCart(context, [
        { variantId: fixtures.stockedVariantId, quantity: 1 },
      ]);
      const order = await context.completeCheckout(cart.id);
      const byId = await provider.getOrder(order.id);
      assert.ok(byId !== null, "getOrder lost the order it had just created");
      assert.equal(byId.orderNumber, order.orderNumber);
      const byNumber = await provider.getOrderByNumber(order.orderNumber);
      assert.equal(byNumber?.id, order.id);
      assert.equal(
        await provider.getOrder("00000000-0000-4000-8000-000000000000"),
        null,
      );
    },
  },
];

const orderCases: readonly ConformanceCase[] = [
  {
    group: "orders",
    name: "lists orders, pages them and filters by email",
    async run({ provider, fixtures }) {
      const page = await provider.listOrders({
        first: 2,
        sortKey: "PROCESSED_AT",
      });
      assert.ok(page.nodes.length > 0, "no orders to list");
      assert.ok(page.nodes.length <= 2);

      const filtered = await provider.listOrders({
        first: 50,
        filter: { email: fixtures.checkoutEmail },
      });
      for (const order of filtered.nodes) {
        assert.equal(
          order.email.toLowerCase(),
          fixtures.checkoutEmail.toLowerCase(),
        );
      }
    },
  },
  {
    group: "orders",
    name: "updateOrder changes only what Shopify's OrderInput allows",
    async run(context) {
      const order = await placeOrder(context);
      const updated = await context.provider.updateOrder(order.id, {
        note: "Called about the courier",
        tags: ["priority", "phoned"],
      });
      assert.equal(updated.note, "Called about the courier");
      assert.deepEqual([...updated.tags].sort(), ["phoned", "priority"]);
      assert.equal(
        updated.total.amountInMinorUnits,
        order.total.amountInMinorUnits,
        "an order update moved the money",
      );
      assert.equal(updated.lineItems.length, order.lineItems.length);
    },
  },
  {
    group: "orders",
    name: "fulfilment records tracking and moves the status",
    async run(context) {
      const order = await placeOrder(context);
      const fulfilled = await context.provider.fulfillOrder(order.id, {
        carrier: "NZ Post",
        trackingNumber: "NZ0000000001NZ",
        trackingUrl:
          "https://www.nzpost.co.nz/tools/tracking/item/NZ0000000001NZ",
      });
      assert.equal(fulfilled.fulfillmentStatus, "fulfilled");
      assert.equal(fulfilled.tracking?.number, "NZ0000000001NZ");
      assert.ok(fulfilled.fulfilledAt !== null, "fulfilledAt was not stamped");
      for (const item of fulfilled.lineItems) {
        assert.equal(item.quantityFulfilled, item.quantity);
      }
    },
  },
  {
    group: "orders",
    name: "cancelling restocks, refunds, and cannot happen twice",
    async run(context) {
      const { fixtures, provider } = context;
      skipIfUnsupported(
        await context.setStock(fixtures.scarceVariantId, 10),
        "setting stock",
      );
      const cart = await newCart(context, [
        { variantId: fixtures.scarceVariantId, quantity: 3 },
      ]);
      if (provider.checkoutSimulator === null) {
        throw new ConformanceSkip(
          "this provider cannot complete a checkout itself",
        );
      }
      const order = await context.completeCheckout(cart.id);

      const cancelled = await provider.cancelOrder(order.id, {
        reason: "customer",
        restock: true,
        refund: true,
      });
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.cancelReason, "customer");
      assert.ok(cancelled.cancelledAt !== null);
      assert.equal(
        cancelled.refundedTotal.amountInMinorUnits,
        order.total.amountInMinorUnits,
        "a full refund did not refund the full total",
      );

      const variant = requireFirst(
        await provider.getVariantsById([fixtures.scarceVariantId]),
        "variant",
      );
      assert.equal(
        variant.quantityAvailable,
        10,
        "restock did not return the stock",
      );

      await expectCommerceError(
        () => provider.cancelOrder(order.id, { reason: "customer" }),
        "ORDER_ALREADY_CANCELLED",
        "second cancel",
      );
      await expectCommerceError(
        () => provider.updateOrder(order.id, { note: "too late" }),
        "ORDER_NOT_EDITABLE",
        "edit a cancelled order",
      );
    },
  },
  {
    group: "orders",
    name: "unknown order ids are reported, not guessed at",
    async run({ provider }) {
      assert.equal(
        await provider.getOrder("00000000-0000-4000-8000-000000000000"),
        null,
      );
      assert.equal(await provider.getOrderByNumber("HS-NOPE"), null);
      await expectCommerceError(
        () =>
          provider.updateOrder("00000000-0000-4000-8000-000000000000", {
            note: "x",
          }),
        "ORDER_NOT_FOUND",
        "update a missing order",
      );
    },
  },
];

const inventoryCases: readonly ConformanceCase[] = [
  {
    group: "inventory",
    name: "there is at least one active location that ships orders",
    async run({ provider }) {
      const locations = await provider.listLocations();
      assert.ok(locations.length > 0, "no locations");
      assert.ok(
        locations.some((location) => location.isActive && location.shipsOrders),
        "nothing can ship an order",
      );
      assert.equal(
        locations.filter((location) => location.isDefault).length,
        1,
        "there must be exactly one default location",
      );
    },
  },
  {
    group: "inventory",
    name: "inventory levels read back per variant and per location",
    async run({ provider, fixtures }) {
      const levels = await provider.getInventoryLevels({
        variantIds: [fixtures.stockedVariantId],
        first: 20,
      });
      assert.ok(levels.nodes.length > 0, "the stocked variant has no levels");
      for (const level of levels.nodes) {
        assert.equal(level.variantId, fixtures.stockedVariantId);
        assert.equal(
          level.available,
          level.onHand - level.committed,
          "available is not on-hand minus committed",
        );
      }
    },
  },
  {
    group: "inventory",
    name: "an adjustment applies its delta and reports the new quantity",
    async run({ provider, fixtures }) {
      const levels = await provider.getInventoryLevels({
        variantIds: [fixtures.stockedVariantId],
        first: 1,
      });
      const level = requireFirst(levels.nodes, "inventory level");
      const result = await provider.adjustInventory({
        reason: "stocktake",
        note: "Conformance suite",
        changes: [
          {
            variantId: level.variantId,
            locationId: level.locationId,
            delta: 5,
            changeFromQuantity: level.onHand,
          },
        ],
      });
      const change = requireFirst(result.changes, "applied change");
      assert.equal(change.delta, 5);
      assert.equal(change.quantityAfterChange, level.onHand + 5);

      const after = await provider.getInventoryLevels({
        variantIds: [fixtures.stockedVariantId],
        locationId: level.locationId,
        first: 1,
      });
      assert.equal(requireFirst(after.nodes, "level").onHand, level.onHand + 5);
    },
  },
  {
    group: "inventory",
    name: "a stale compare-and-swap read is refused rather than applied",
    async run({ provider, fixtures }) {
      const levels = await provider.getInventoryLevels({
        variantIds: [fixtures.stockedVariantId],
        first: 1,
      });
      const level = requireFirst(levels.nodes, "inventory level");
      await expectCommerceError(
        () =>
          provider.adjustInventory({
            reason: "correction",
            changes: [
              {
                variantId: level.variantId,
                locationId: level.locationId,
                delta: 1,
                changeFromQuantity: level.onHand + 999,
              },
            ],
          }),
        "INVENTORY_STALE_READ",
        "stale compare-and-swap",
      );
    },
  },
  {
    group: "inventory",
    name: "stock cannot be driven below zero, and a zero delta is meaningless",
    async run({ provider, fixtures }) {
      const levels = await provider.getInventoryLevels({
        variantIds: [fixtures.stockedVariantId],
        first: 1,
      });
      const level = requireFirst(levels.nodes, "inventory level");
      await expectCommerceError(
        () =>
          provider.adjustInventory({
            reason: "damage",
            changes: [
              {
                variantId: level.variantId,
                locationId: level.locationId,
                delta: -(level.onHand + 1000),
              },
            ],
          }),
        "INVENTORY_WOULD_GO_NEGATIVE",
        "negative on-hand",
      );
      await expectCommerceError(
        () =>
          provider.adjustInventory({
            reason: "correction",
            changes: [
              {
                variantId: level.variantId,
                locationId: level.locationId,
                delta: 0,
              },
            ],
          }),
        "INVALID_INPUT",
        "zero delta",
      );
    },
  },
  {
    group: "inventory",
    name: "adjustments against unknown variants and locations are rejected",
    async run({ provider, fixtures }) {
      await expectCommerceError(
        () =>
          provider.adjustInventory({
            reason: "correction",
            changes: [
              {
                variantId: "00000000-0000-4000-8000-000000000000",
                locationId: "00000000-0000-4000-8000-000000000000",
                delta: 1,
              },
            ],
          }),
        "VARIANT_NOT_FOUND",
        "unknown variant",
      );
      await expectCommerceError(
        () =>
          provider.adjustInventory({
            reason: "correction",
            changes: [
              {
                variantId: fixtures.stockedVariantId,
                locationId: "00000000-0000-4000-8000-000000000000",
                delta: 1,
              },
            ],
          }),
        "LOCATION_NOT_FOUND",
        "unknown location",
      );
    },
  },
];

const customerCases: readonly ConformanceCase[] = [
  {
    group: "customers",
    name: "a customer can be found by email and by id",
    async run(context) {
      const { provider, fixtures } = context;
      await placeOrder(context);
      const byEmail = await provider.getCustomerByEmail(fixtures.checkoutEmail);
      assert.ok(byEmail !== null, "the checkout customer was not created");
      const byId = await provider.getCustomer(byEmail.id);
      assert.equal(
        byId?.email.toLowerCase(),
        fixtures.checkoutEmail.toLowerCase(),
      );
      assert.ok(byId.ordersCount >= 1, "the customer has no orders recorded");
      assertExactMoney(byId.totalSpent, provider.currencyCode, "totalSpent");
      assert.equal(
        await provider.getCustomer("00000000-0000-4000-8000-000000000000"),
        null,
      );
    },
  },
  {
    group: "customers",
    name: "customers can be listed and searched",
    async run({ provider, fixtures }) {
      const page = await provider.listCustomers({ first: 5 });
      assert.ok(page.nodes.length > 0, "no customers");
      const searched = await provider.listCustomers({
        first: 5,
        search: fixtures.checkoutEmail,
      });
      assert.ok(
        searched.nodes.some(
          (customer) =>
            customer.email.toLowerCase() ===
            fixtures.checkoutEmail.toLowerCase(),
        ),
        "search did not find the customer by email",
      );
    },
  },
];

async function placeOrder(context: ConformanceContext): Promise<Order> {
  if (context.provider.checkoutSimulator === null) {
    throw new ConformanceSkip(
      "this provider cannot complete a checkout itself",
    );
  }
  await context.setStock(context.fixtures.stockedVariantId, 60);
  const cart = await newCart(context, [
    { variantId: context.fixtures.stockedVariantId, quantity: 1 },
  ]);
  return context.completeCheckout(cart.id);
}

export const conformanceCases: readonly ConformanceCase[] = [
  ...providerCases,
  ...catalogueCases,
  ...cartCases,
  ...tamperCases,
  ...stockCases,
  ...discountCases,
  ...checkoutCases,
  ...orderCases,
  ...inventoryCases,
  ...customerCases,
];

/** Every distinct group, in declaration order. */
export const conformanceGroups: readonly string[] = [
  ...new Set(conformanceCases.map((entry) => entry.group)),
];

export type { Product };
