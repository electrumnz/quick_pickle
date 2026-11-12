import { describe, expect, it } from "vitest";

import { MAX_PACKS_PER_LINE, PACKS } from "@/content/offer";
import {
  addToCart,
  EMPTY_CART,
  isEmpty,
  normaliseCart,
  packCount,
  removeFromCart,
  setQuantity,
  shotCount,
  swapPack,
} from "@/lib/shop/cart";
import { FILE_OFFER } from "@/lib/shop/offer";

const small = PACKS[0]!;
const big = PACKS[PACKS.length - 1]!;

describe("the jar", () => {
  it("starts empty", () => {
    expect(isEmpty(EMPTY_CART)).toBe(true);
    expect(packCount(EMPTY_CART)).toBe(0);
    expect(shotCount(FILE_OFFER, EMPTY_CART)).toBe(0);
  });

  it("adds a pack, and adds to the same line when it is added again", () => {
    let cart = addToCart(FILE_OFFER, EMPTY_CART, small.sku);
    cart = addToCart(FILE_OFFER, cart, small.sku, 2);
    expect(cart.lines).toEqual([{ sku: small.sku, qty: 3 }]);
    expect(shotCount(FILE_OFFER, cart)).toBe(small.shots * 3);
  });

  it("ignores a SKU that is not on the shelf", () => {
    expect(addToCart(FILE_OFFER, EMPTY_CART, "MADE-UP")).toBe(EMPTY_CART);
  });

  it("clamps a line at the per-order maximum", () => {
    const cart = addToCart(
      FILE_OFFER,
      EMPTY_CART,
      small.sku,
      MAX_PACKS_PER_LINE + 50,
    );
    expect(cart.lines[0]?.qty).toBe(MAX_PACKS_PER_LINE);
  });

  it("removes a line when its quantity is set to zero", () => {
    const cart = setQuantity(
      FILE_OFFER,
      addToCart(FILE_OFFER, EMPTY_CART, small.sku),
      small.sku,
      0,
    );
    expect(isEmpty(cart)).toBe(true);
  });

  it("removes one line and leaves the rest", () => {
    let cart = addToCart(FILE_OFFER, EMPTY_CART, small.sku);
    cart = addToCart(FILE_OFFER, cart, big.sku);
    expect(removeFromCart(cart, small.sku).lines).toEqual([
      { sku: big.sku, qty: 1 },
    ]);
  });

  it("swaps a pack for another size, keeping the count", () => {
    const cart = swapPack(
      FILE_OFFER,
      addToCart(FILE_OFFER, EMPTY_CART, small.sku, 2),
      small.sku,
      big.sku,
    );
    expect(cart.lines).toEqual([{ sku: big.sku, qty: 2 }]);
  });

  it("keeps lines in shelf order whatever order they were added in", () => {
    let cart = addToCart(FILE_OFFER, EMPTY_CART, big.sku);
    cart = addToCart(FILE_OFFER, cart, small.sku);
    expect(cart.lines.map((line) => line.sku)).toEqual([small.sku, big.sku]);
  });
});

describe("normaliseCart, the guard on anything from outside", () => {
  it("turns junk into an empty jar", () => {
    for (const junk of [
      null,
      undefined,
      42,
      "lines",
      [],
      {},
      { lines: "nope" },
      { lines: [null, 3, "x", {}] },
    ]) {
      expect(normaliseCart(FILE_OFFER, junk)).toEqual(EMPTY_CART);
    }
  });

  it("drops unknown SKUs, bad quantities and anything not a line", () => {
    const cart = normaliseCart(FILE_OFFER, {
      lines: [
        { sku: "MADE-UP", qty: 2 },
        { sku: small.sku, qty: "3" },
        { sku: small.sku, qty: -4 },
        { sku: small.sku, qty: Number.NaN },
        { sku: big.sku, qty: 2.9 },
      ],
    });
    expect(cart.lines).toEqual([{ sku: big.sku, qty: 2 }]);
  });

  it("merges duplicate lines and clamps the total", () => {
    const cart = normaliseCart(FILE_OFFER, {
      lines: [
        { sku: small.sku, qty: MAX_PACKS_PER_LINE },
        { sku: small.sku, qty: MAX_PACKS_PER_LINE },
      ],
    });
    expect(cart.lines).toEqual([{ sku: small.sku, qty: MAX_PACKS_PER_LINE }]);
  });

  it("carries no price, whatever the input claimed", () => {
    const cart = normaliseCart(FILE_OFFER, {
      lines: [{ sku: small.sku, qty: 1, priceCents: 1, unitCents: 1 }],
    });
    expect(Object.keys(cart.lines[0]!).sort()).toEqual(["qty", "sku"]);
  });
});
