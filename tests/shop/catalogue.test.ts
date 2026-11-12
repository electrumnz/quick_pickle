import { describe, expect, it } from "vitest";

import { MAX_PACKS_PER_LINE, PACKS, SHIPPING } from "@/content/offer";
import {
  bestValuePack,
  featuredPack,
  nextSizeUp,
  packBySku,
  perShotCents,
  savingCents,
} from "@/lib/shop/catalogue";

/**
 * These hold for whatever the offer says, so they keep passing when the
 * stand-in prices are replaced with the real ones. A change that breaks one
 * is a change to how the page talks about price, not just to a number.
 */
describe("the offer", () => {
  it("has packs, smallest first, with unique SKUs", () => {
    expect(PACKS.length).toBeGreaterThan(0);
    const shots = PACKS.map((pack) => pack.shots);
    expect([...shots].sort((a, b) => a - b)).toEqual(shots);
    expect(new Set(PACKS.map((pack) => pack.sku)).size).toBe(PACKS.length);
  });

  it("prices every pack in whole, positive cents", () => {
    for (const pack of PACKS) {
      expect(Number.isInteger(pack.priceCents)).toBe(true);
      expect(pack.priceCents).toBeGreaterThan(0);
      expect(Number.isInteger(pack.shots)).toBe(true);
      expect(pack.shots).toBeGreaterThan(0);
    }
  });

  it("has exactly one featured pack", () => {
    expect(PACKS.filter((pack) => pack.featured).length).toBe(1);
    expect(featuredPack().featured).toBe(true);
  });

  it("never charges more per shot for a bigger pack", () => {
    // The page says "the bigger the pack, the less each shot costs".
    for (let i = 1; i < PACKS.length; i += 1) {
      const smaller = PACKS[i - 1]!;
      const bigger = PACKS[i]!;
      expect(bigger.priceCents * smaller.shots).toBeLessThanOrEqual(
        smaller.priceCents * bigger.shots,
      );
    }
  });

  it("keeps shipping in whole cents, with a sane free-delivery line", () => {
    for (const value of [
      SHIPPING.standardCents,
      SHIPPING.ruralSurchargeCents,
      SHIPPING.freeOverCents,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(MAX_PACKS_PER_LINE).toBeGreaterThanOrEqual(1);
  });
});

describe("catalogue helpers", () => {
  it("finds a pack by SKU and nothing for a stranger", () => {
    const first = PACKS[0]!;
    expect(packBySku(first.sku)).toBe(first);
    expect(packBySku("NOT-A-SKU")).toBeNull();
    expect(packBySku("")).toBeNull();
  });

  it("names the pack with the lowest price per shot as best value", () => {
    const best = bestValuePack();
    for (const pack of PACKS) {
      expect(best.priceCents * pack.shots).toBeLessThanOrEqual(
        pack.priceCents * best.shots,
      );
    }
  });

  it("computes a saving against the smallest pack's rate, never negative", () => {
    const smallest = PACKS[0]!;
    expect(savingCents(smallest)).toBe(0);
    for (const pack of PACKS) {
      const saving = savingCents(pack);
      expect(saving).toBeGreaterThanOrEqual(0);
      const atSmallestRate = Math.round(
        (pack.shots * smallest.priceCents) / smallest.shots,
      );
      expect(saving).toBe(Math.max(0, atSmallestRate - pack.priceCents));
    }
  });

  it("rounds the per-shot price to the cent", () => {
    for (const pack of PACKS) {
      expect(perShotCents(pack)).toBe(Math.round(pack.priceCents / pack.shots));
    }
  });

  it("walks up the sizes and stops at the top", () => {
    for (let i = 0; i < PACKS.length; i += 1) {
      expect(nextSizeUp(PACKS[i]!)).toBe(PACKS[i + 1] ?? null);
    }
  });
});
