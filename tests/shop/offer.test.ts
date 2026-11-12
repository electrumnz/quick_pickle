import { describe, expect, it } from "vitest";

import { PACKS, SHIPPING, STORE, UNCONFIRMED } from "@/content/offer";
import { FILE_OFFER, isPreview, offerVersion } from "@/lib/shop/offer";
import {
  asOfferChanges,
  LEAST_PRICE_CENTS,
  MOST_PRICE_CENTS,
  offerChangesSchema,
  offerWith,
} from "@/lib/shop/offer-changes";

/**
 * The offer as one value: the file's own, with the back end's changes laid
 * over it. What can be changed is a short, closed list, and these hold it
 * closed.
 */

describe("the file's own offer", () => {
  it("is exactly what the catalogue file says", () => {
    expect(FILE_OFFER).toMatchObject({
      open: true,
      launchMode: STORE.launchMode,
      batchName: STORE.batchName,
      preorderShipsFrom: STORE.preorderShipsFrom,
      contactEmail: STORE.contactEmail,
      gstRegistered: STORE.gstRegistered,
      packs: PACKS,
      shipping: { ...SHIPPING },
      unconfirmed: UNCONFIRMED,
    });
    expect(offerWith({})).toEqual(FILE_OFFER);
  });

  it("carries a word for its prices that is the same every time", () => {
    expect(FILE_OFFER.version).toMatch(/^[0-9a-z]{7}$/);
    expect(offerVersion(FILE_OFFER)).toBe(FILE_OFFER.version);
    expect(offerWith({}).version).toBe(FILE_OFFER.version);
  });
});

describe("the word for the prices", () => {
  const word = (changes: Parameters<typeof offerWith>[0]) =>
    offerWith(changes).version;

  it("changes when anything a buyer's total depends on does", () => {
    const words = new Set([
      FILE_OFFER.version,
      word({ prices: { "QP-SHOT-12": 4900 } }),
      word({ prices: { "QP-SHOT-06": 2800 } }),
      word({ shipping: { standardCents: 800 } }),
      word({ shipping: { ruralSurchargeCents: 500 } }),
      word({ shipping: { freeOverCents: 7000 } }),
      word({ open: false }),
      word({ launchMode: "live" }),
    ]);
    expect(words.size).toBe(8);
  });

  it("stays put when anything else changes", () => {
    for (const changes of [
      { preorderShipsFrom: "2026-12-01" },
      { contactEmail: "hello@example.co.nz" },
      { batchName: "Batch 002" },
      { gstRegistered: true },
      { confirmed: { packs: { by: "Ash", at: "2026-11-12T00:00:00Z" } } },
      // A price set to what it already was is no change at all.
      { prices: { "QP-SHOT-12": 4800 } },
    ]) {
      expect(word(changes), JSON.stringify(changes)).toBe(FILE_OFFER.version);
    }
  });
});

describe("the back end's changes, laid over the file", () => {
  it("moves a price on a pack that exists, and nothing else about it", () => {
    const offer = offerWith({ prices: { "QP-SHOT-12": 5200 } });
    expect(offer.packs.map((pack) => [pack.sku, pack.priceCents])).toEqual([
      ["QP-SHOT-06", 2700],
      ["QP-SHOT-12", 5200],
      ["QP-SHOT-24", 8400],
    ]);
    const [, starter] = offer.packs;
    expect(starter).toEqual({ ...PACKS[1], priceCents: 5200 });
    // The file's own packs are never written on.
    expect(PACKS[1]?.priceCents).toBe(4800);
  });

  it("never makes a pack: a price for one that is not on the shelf is dropped", () => {
    const offer = offerWith({
      prices: { "QP-SHOT-48": 100, "QP-SHOT-12": 5000, "": 100 },
    });
    expect(offer.packs.map((pack) => pack.sku)).toEqual([
      "QP-SHOT-06",
      "QP-SHOT-12",
      "QP-SHOT-24",
    ]);
    expect(offer.packs[1]?.priceCents).toBe(5000);
  });

  it("changes one delivery figure and leaves the others, and the country, alone", () => {
    const offer = offerWith({ shipping: { ruralSurchargeCents: 600 } });
    expect(offer.shipping).toEqual({
      standardCents: 700,
      ruralSurchargeCents: 600,
      freeOverCents: 6000,
      country: "NZ",
    });
    expect(
      offerWith({ shipping: { freeOverCents: 0 } }).shipping,
    ).toMatchObject({ freeOverCents: 0, standardCents: 700 });
  });

  it("can set a date and can take one away again", () => {
    expect(
      offerWith({ preorderShipsFrom: "2026-12-01" }).preorderShipsFrom,
    ).toBe("2026-12-01");
    // Taken away on purpose is not the same as never set.
    const dated = offerWith({ preorderShipsFrom: "2026-12-01" });
    expect(
      offerWith({ preorderShipsFrom: null }, dated).preorderShipsFrom,
    ).toBe(null);
    expect(offerWith({}, dated).preorderShipsFrom).toBe("2026-12-01");
    expect(offerWith({ contactEmail: null }).contactEmail).toBeNull();
  });

  it("shuts the shop, and opens it for real stock", () => {
    expect(offerWith({ open: false }).open).toBe(false);
    expect(offerWith({ launchMode: "live" }).launchMode).toBe("live");
  });

  it("keeps a fact open until somebody says it is right", () => {
    // Changing a figure is not confirming it.
    const changed = offerWith({ prices: { "QP-SHOT-12": 5000 } });
    expect(changed.unconfirmed.map((fact) => fact.key)).toContain("packs");
    expect(isPreview(changed)).toBe(true);

    const confirmed = offerWith({
      confirmed: {
        packs: { by: "Ash", at: "2026-11-12T00:00:00Z" },
        // A fact that is not on the list changes nothing.
        "the-moon": { by: "Ash", at: "2026-11-12T00:00:00Z" },
      },
    });
    expect(confirmed.unconfirmed.map((fact) => fact.key)).toEqual(
      UNCONFIRMED.map((fact) => fact.key).filter((key) => key !== "packs"),
    );
    expect(isPreview(confirmed)).toBe(true);

    const all = Object.fromEntries(
      UNCONFIRMED.map((fact) => [
        fact.key,
        { by: "Ash", at: "2026-11-12T00:00:00Z" },
      ]),
    );
    expect(isPreview(offerWith({ confirmed: all }))).toBe(false);
  });
});

describe("what was stored, before it is believed", () => {
  it("takes changes that fit", () => {
    const stored = {
      open: false,
      launchMode: "live",
      batchName: " Batch 002 ",
      preorderShipsFrom: "2026-12-01",
      contactEmail: " Hello@Example.co.nz ",
      gstRegistered: true,
      prices: { "QP-SHOT-12": 5000 },
      shipping: { standardCents: 800 },
      confirmed: { packs: { by: "Ash", at: "2026-11-12T00:00:00Z" } },
    };
    expect(asOfferChanges(stored)).toEqual({
      ...stored,
      batchName: "Batch 002",
      contactEmail: "hello@example.co.nz",
    });
    expect(asOfferChanges({})).toEqual({});
  });

  it("falls back to the file's own offer when anything does not fit", () => {
    for (const stored of [
      null,
      "prices",
      42,
      [],
      { prices: { "QP-SHOT-12": 48.5 } },
      { prices: { "QP-SHOT-12": "4800" } },
      { prices: { "QP-SHOT-12": LEAST_PRICE_CENTS - 1 } },
      { prices: { "QP-SHOT-12": MOST_PRICE_CENTS + 1 } },
      { prices: { "QP-SHOT-12": -4800 } },
      { shipping: { standardCents: -1 } },
      { shipping: { standardCents: 1_000_000 } },
      { launchMode: "closed" },
      { open: "no" },
      { batchName: "" },
      { batchName: "x".repeat(41) },
      { preorderShipsFrom: "1 December" },
      { preorderShipsFrom: "2026-02-30" },
      { preorderShipsFrom: "2026-13-01" },
      { contactEmail: "not an address" },
    ]) {
      expect(asOfferChanges(stored), JSON.stringify(stored)).toEqual({});
      expect(offerWith(asOfferChanges(stored))).toEqual(FILE_OFFER);
    }
  });

  it("knows a real day from one that only looks like a date", () => {
    const ok = (value: string) =>
      offerChangesSchema.safeParse({ preorderShipsFrom: value }).success;
    expect(ok("2028-02-29")).toBe(true);
    expect(ok("2027-02-29")).toBe(false);
    expect(ok("2026-11-31")).toBe(false);
    expect(ok("2026-11-30")).toBe(true);
  });
});
