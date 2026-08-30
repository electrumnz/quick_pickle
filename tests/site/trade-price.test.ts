import { describe, expect, it } from "vitest";

import {
  CASE_BOTTLES,
  TRADE_LIST,
  netShelfCents,
  tradeCents,
} from "@/components/site/trade";
import { BRINES } from "@/content/brines";

/**
 * The published trade price is the one the strategy layer costed.
 *
 * `/wholesale` publishes a number, because the BrandScript's B2B agreement
 * promises one published number and a price sent privately on request is not a
 * published price. That only helps if the number on the page is the number the
 * business was planned around — otherwise the storefront and the plan are two
 * companies.
 *
 * `content/strategy/avatars.ts` states, independently and in cents, what a
 * venue pays: 939 for a bottle of No. 01 and 5,634 for a case of six. Those two
 * figures were computed by the strategy unit from the market model's `gstRate`
 * and `tradeDiscountRate`. This test asserts the storefront's own derivation
 * lands on exactly the same integers. If the discount ever changes, this fails
 * and names both places that have to move together.
 *
 * The audit's `b2b-trade-price-published` check proves a price is on the page.
 * This proves it is the right one.
 */
describe("the trade price on /wholesale", () => {
  it("matches the cents the strategy layer costed for No. 01", () => {
    // avatars.b2b.price.comparedWith["No 01 HOUSE at trade, per bottle,
    // before GST"] = 939 cents.
    expect(tradeCents(BRINES["no-01-house"])).toBe(939);
  });

  it("matches the cents the strategy layer costed for a case of six", () => {
    // avatars.b2b.price.comparedWith["A case of six at the published 40%"]
    // = 5,634 cents.
    const row = TRADE_LIST.find((entry) => entry.brine.id === "no-01-house");
    expect(row?.caseTotal.amountInMinorUnits).toBe(5_634);
    expect(CASE_BOTTLES).toBe(6);
  });

  it("takes the GST out before the discount, not after", () => {
    // $18.00 GST-inclusive is $15.65 net, not $18.00 less 15%. Getting this
    // backwards is a 2% error on every invoice and it compounds by the case.
    expect(netShelfCents(BRINES["no-01-house"])).toBe(1_565);
  });

  it("is a whole number of cents for every bottle, and a case is six of them", () => {
    for (const row of TRADE_LIST) {
      expect(Number.isSafeInteger(row.bottle.amountInMinorUnits)).toBe(true);
      expect(row.caseTotal.amountInMinorUnits).toBe(
        row.bottle.amountInMinorUnits * CASE_BOTTLES,
      );
      // A trade price at or above the shelf price is not a trade price.
      expect(row.bottle.amountInMinorUnits).toBeLessThan(
        row.shelf.amountInMinorUnits,
      );
    }
  });

  it("costs a pour from the measure the recipe actually uses", () => {
    const dirty = TRADE_LIST.find((entry) => entry.brine.id === "no-02-dirty");
    // The Dirty Martini takes 20 ml, so a 500 ml bottle is 25 pours. Both
    // numbers are printed on the page so a bar manager can check the division.
    expect(dirty?.pours?.perServeMl).toBe(20);
    expect(dirty?.pours?.count).toBe(25);
    expect(dirty?.pours?.perPour.amountInMinorUnits).toBe(
      Math.round((dirty?.bottle.amountInMinorUnits ?? 0) / 25),
    );
  });
});
