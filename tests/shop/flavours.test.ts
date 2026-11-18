import { describe, expect, it } from "vitest";

import { FLAVOURS, PACKS } from "@/content/offer";
import {
  addToCart,
  normaliseCart,
  setQuantity,
  shotCount,
} from "@/lib/shop/cart";
import {
  firstFlavour,
  flavourBySku,
  isKnownSku,
  itemBySku,
  itemName,
  itemSku,
  nextItemUp,
  packBySku,
  shelfItems,
} from "@/lib/shop/catalogue";
import { FILE_OFFER, forPage, offerVersion } from "@/lib/shop/offer";
import { offerWith } from "@/lib/shop/offer-changes";
import { quote } from "@/lib/shop/pricing";

/**
 * Two flavours, Original and Mango Chilli Lime. Every pack comes in each, at
 * the pack's own price. What goes in the jar is a pack in a flavour, named
 * by its SKU, and the first flavour's SKUs are the packs' own, so every jar
 * and order from before there were two still means what it meant.
 */

const ORIGINAL = FLAVOURS[0];
const MCL = FLAVOURS[1];
const STARTER = PACKS.find((pack) => pack.sku === "QP-SHOT-12");

describe("the flavours", () => {
  it("are Original first, then Mango Chilli Lime, with keys never shared", () => {
    expect(FLAVOURS.map((flavour) => flavour.name)).toEqual([
      "Original",
      "Mango Chilli Lime",
    ]);
    expect(new Set(FLAVOURS.map((flavour) => flavour.key)).size).toBe(
      FLAVOURS.length,
    );
    expect(firstFlavour(FILE_OFFER)).toBe(ORIGINAL);
    // Only the first keeps the packs' own SKUs.
    expect(FLAVOURS.filter((flavour) => flavour.skuSuffix === "")).toEqual([
      ORIGINAL,
    ]);
  });

  it("give every pack a SKU in every flavour, and no two the same", () => {
    const items = shelfItems(FILE_OFFER);
    expect(items).toHaveLength(PACKS.length * FLAVOURS.length);
    expect(new Set(items.map((item) => item.sku)).size).toBe(items.length);
    // Original's are the packs' own; the rest gain the flavour's mark.
    expect(items.map((item) => item.sku)).toEqual([
      "QP-SHOT-06",
      "QP-SHOT-12",
      "QP-SHOT-24",
      "QP-SHOT-06-MCL",
      "QP-SHOT-12-MCL",
      "QP-SHOT-24-MCL",
    ]);
  });

  it("read a SKU back as its pack and its flavour", () => {
    if (STARTER === undefined || MCL === undefined) throw new Error("no shelf");
    expect(itemSku(STARTER, MCL)).toBe("QP-SHOT-12-MCL");
    expect(itemBySku(FILE_OFFER, "QP-SHOT-12-MCL")).toEqual({
      sku: "QP-SHOT-12-MCL",
      pack: STARTER,
      flavour: MCL,
    });
    // The pack is what the price and the shots come from.
    expect(packBySku(FILE_OFFER, "QP-SHOT-12-MCL")).toBe(STARTER);
    expect(flavourBySku(FILE_OFFER, "QP-SHOT-12")).toBe(ORIGINAL);
    for (const stranger of ["QP-SHOT-12-XYZ", "QP-SHOT-12-", "MCL", ""]) {
      expect(isKnownSku(FILE_OFFER, stranger)).toBe(false);
    }
  });

  it("are always said in a line's name", () => {
    const line = itemBySku(FILE_OFFER, "QP-SHOT-24-MCL");
    if (line === null) throw new Error("no such item");
    expect(itemName(line)).toBe("The Squad, Mango Chilli Lime");
    const plain = itemBySku(FILE_OFFER, "QP-SHOT-06");
    if (plain === null) throw new Error("no such item");
    expect(itemName(plain)).toBe("The Trial, Original");
  });

  it("go up a size without changing flavour, and stop at the top", () => {
    const small = itemBySku(FILE_OFFER, "QP-SHOT-06-MCL");
    if (small === null) throw new Error("no such item");
    expect(nextItemUp(FILE_OFFER, small)?.sku).toBe("QP-SHOT-12-MCL");
    const top = itemBySku(FILE_OFFER, "QP-SHOT-24-MCL");
    if (top === null) throw new Error("no such item");
    expect(nextItemUp(FILE_OFFER, top)).toBeNull();
  });
});

describe("a jar with both flavours", () => {
  it("keeps a line for each pack in each flavour, a flavour at a time", () => {
    let jar = addToCart(FILE_OFFER, { lines: [] }, "QP-SHOT-24-MCL", 1);
    jar = addToCart(FILE_OFFER, jar, "QP-SHOT-12", 2);
    jar = addToCart(FILE_OFFER, jar, "QP-SHOT-06-MCL", 1);
    jar = addToCart(FILE_OFFER, jar, "QP-SHOT-12-MCL", 1);
    expect(jar.lines).toEqual([
      { sku: "QP-SHOT-12", qty: 2 },
      { sku: "QP-SHOT-06-MCL", qty: 1 },
      { sku: "QP-SHOT-12-MCL", qty: 1 },
      { sku: "QP-SHOT-24-MCL", qty: 1 },
    ]);
    // One pool of shots for the count on the jar.
    expect(shotCount(FILE_OFFER, jar)).toBe(24 + 6 + 12 + 24);
    // A line is changed on its own, flavour and all.
    expect(
      setQuantity(FILE_OFFER, jar, "QP-SHOT-12-MCL", 0).lines,
    ).toHaveLength(3);
  });

  it("drops a flavour that is not on the shelf", () => {
    expect(
      normaliseCart(FILE_OFFER, {
        lines: [
          { sku: "QP-SHOT-12-GHERKIN", qty: 1 },
          { sku: "QP-SHOT-12-MCL", qty: 1 },
        ],
      }).lines,
    ).toEqual([{ sku: "QP-SHOT-12-MCL", qty: 1 }]);
  });

  it("charges the pack's own price in every flavour", () => {
    const priced = quote(FILE_OFFER, {
      lines: [
        { sku: "QP-SHOT-12", qty: 1 },
        { sku: "QP-SHOT-12-MCL", qty: 1 },
      ],
    });
    expect(priced.lines.map((line) => line.flavour.name)).toEqual([
      "Original",
      "Mango Chilli Lime",
    ]);
    expect(priced.lines.map((line) => line.unitCents)).toEqual([
      STARTER?.priceCents,
      STARTER?.priceCents,
    ]);
    expect(priced.subtotalCents).toBe((STARTER?.priceCents ?? 0) * 2);
    // A price moved in the back end moves it for every flavour.
    const moved = offerWith({ prices: { "QP-SHOT-12": 5000 } });
    expect(
      quote(moved, { lines: [{ sku: "QP-SHOT-12-MCL", qty: 1 }] })
        .subtotalCents,
    ).toBe(5000);
  });
});

describe("the offer's word", () => {
  it("is handed to the page with the flavours, and moves when they do", () => {
    expect(forPage(FILE_OFFER).flavours).toEqual(FLAVOURS);
    const fewer = { ...FILE_OFFER, flavours: FLAVOURS.slice(0, 1) };
    expect(offerVersion(fewer)).not.toBe(FILE_OFFER.version);
  });
});
