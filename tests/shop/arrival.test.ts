import { describe, expect, it } from "vitest";

import {
  ARRIVAL_DAYS,
  arrivalFrom,
  isFreshArrival,
  packArrival,
  sourceFromSearch,
  unpackArrival,
  type Arrival,
} from "@/lib/shop/arrival";
import { asPromoCode, codeFromSearch } from "@/lib/shop/code";

/**
 * What a visitor's browser remembers about how they arrived: the link they
 * followed and any promo code it carried. All of it is a claim from the
 * address bar, so all of it is read with suspicion.
 */

const NOW = Date.UTC(2026, 10, 12, 9);
const DAY = 24 * 60 * 60_000;

describe("a promo code in an address", () => {
  it("is read the way a person would type it", () => {
    expect(codeFromSearch("?code=rovers10")).toBe("ROVERS10");
    expect(codeFromSearch("?utm_source=x&code=%20crew%2010%20")).toBe("CREW10");
    expect(asPromoCode("two-for-1")).toBe("TWO-FOR-1");
  });

  it("is nothing when it could not be a code", () => {
    for (const search of [
      "",
      "?code=",
      "?code=ab",
      "?code=-nope",
      "?code=nope-",
      "?code=<script>alert(1)</script>",
      "?code=has_underscore",
      `?code=${"A".repeat(25)}`,
      "?kode=CREW10",
    ]) {
      expect(codeFromSearch(search), search).toBeNull();
    }
    expect(asPromoCode(undefined)).toBeNull();
    expect(asPromoCode(42)).toBeNull();
    expect(asPromoCode("A".repeat(61))).toBeNull();
  });
});

describe("where a visit came from", () => {
  it("keeps the link and the three labels, tidied, and nothing else", () => {
    expect(
      sourceFromSearch(
        "?utm_source=Instagram&utm_medium=social&utm_campaign=Bio&via=KAI&utm_term=x&next=//evil.example",
      ),
    ).toEqual({
      via: "kai",
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: "bio",
    });
  });

  it("drops anything that could not be one of ours", () => {
    expect(
      sourceFromSearch(
        `?via=../admin&utm_source=two%20words&utm_medium=${"m".repeat(61)}&utm_campaign=`,
      ),
    ).toEqual({});
    expect(sourceFromSearch("?via=a")).toEqual({});
    expect(sourceFromSearch("")).toEqual({});
  });
});

describe("remembering an arrival", () => {
  it("is nothing for an address with no link and no code on it", () => {
    expect(arrivalFrom("", null, NOW)).toBeNull();
    expect(arrivalFrom("?notice=hello", null, NOW)).toBeNull();
    const before: Arrival = { code: "CREW10", source: { via: "kai" }, at: 1 };
    // Wandering round the site does not wipe how somebody arrived.
    expect(arrivalFrom("?page=2", before, NOW)).toBeNull();
  });

  it("takes the link and the code together", () => {
    expect(
      arrivalFrom("?utm_source=rovers&via=rovers&code=ROVERS10", null, NOW),
    ).toEqual({
      code: "ROVERS10",
      source: { via: "rovers", utm_source: "rovers" },
      at: NOW,
    });
  });

  it("lets the last link win, and keeps a code the new link does not replace", () => {
    const before: Arrival = {
      code: "ROVERS10",
      source: { via: "rovers", utm_source: "rovers" },
      at: NOW - 3 * DAY,
    };
    // A second link with no code: the new link, the old code.
    expect(arrivalFrom("?via=kai", before, NOW)).toEqual({
      code: "ROVERS10",
      source: { via: "kai" },
      at: NOW,
    });
    // A code on its own: the new code, the old link.
    expect(arrivalFrom("?code=crew10", before, NOW)).toEqual({
      code: "CREW10",
      source: { via: "rovers", utm_source: "rovers" },
      at: NOW,
    });
  });

  it("survives being stored and read back", () => {
    const arrival: Arrival = {
      code: "ROVERS10",
      source: { via: "rovers", utm_medium: "print" },
      at: NOW,
    };
    expect(unpackArrival(packArrival(arrival))).toEqual(arrival);
    expect(
      unpackArrival(packArrival({ code: null, source: {}, at: NOW })),
    ).toEqual({ code: null, source: {}, at: NOW });
  });

  it("reads storage with suspicion: somebody else may have written it", () => {
    for (const raw of [
      "",
      "nonsense",
      "null",
      "[]",
      '"CREW10"',
      '{"code":"X"}',
    ]) {
      expect(unpackArrival(raw), raw).toBeNull();
    }
    expect(
      unpackArrival(
        JSON.stringify({
          code: "<img src=x onerror=alert(1)>",
          source: { via: "javascript:alert(1)", utm_source: "ok", extra: "x" },
          at: NOW,
        }),
      ),
    ).toEqual({ code: null, source: { utm_source: "ok" }, at: NOW });
    expect(
      unpackArrival(
        JSON.stringify({ code: "CREW10", source: "x", at: "soon" }),
      ),
    ).toBeNull();
  });

  it("goes stale after thirty days, and is not believed from the future", () => {
    const at = (when: number): Arrival => ({
      code: null,
      source: {},
      at: when,
    });
    expect(isFreshArrival(at(NOW), NOW)).toBe(true);
    expect(isFreshArrival(at(NOW - ARRIVAL_DAYS * DAY), NOW)).toBe(true);
    expect(isFreshArrival(at(NOW - ARRIVAL_DAYS * DAY - 1), NOW)).toBe(false);
    // A clock that is a little fast is fine. A date years off is not.
    expect(isFreshArrival(at(NOW + 60_000), NOW)).toBe(true);
    expect(isFreshArrival(at(NOW + 2 * DAY), NOW)).toBe(false);
  });
});
