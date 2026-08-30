/**
 * The market model's arithmetic.
 *
 * A TAM whose assumptions cannot be inspected is decoration, and a TAM whose
 * arithmetic nobody has checked is worse. These are the sums done a second way:
 * by hand here, by `computeMarket` there, and the two have to agree.
 */

import { describe, expect, it } from "vitest";

import {
  MARKET,
  MARKET_INPUTS,
  computeMarket,
  formatCents,
  inputValue,
} from "@/content/strategy/market";
import { FLIGHT_PLAN, wingEconomics } from "@/content/strategy/flight-plan";
import { SOURCES } from "@/content/strategy/sources";

const v = (id: string) => inputValue(MARKET_INPUTS, id);

function edited(id: string, value: number) {
  return MARKET_INPUTS.map((input) =>
    input.id === id ? { ...input, value } : input,
  );
}

describe("market model", () => {
  it("converts the shelf price out of GST exactly once", () => {
    const step = MARKET.tam.steps.find((entry) => entry.id === "net-shelf");
    expect(step?.value).toBe(Math.round(2_100 / 1.15));
    expect(step?.value).toBe(1_826);
  });

  it("computes the New Zealand TAM the way the expressions say it does", () => {
    const candidates = Math.round(2_057_500 * 0.35);
    expect(candidates).toBe(720_125);
    const households = candidates * 2 * 1_826;
    const venues = (9_036 + 2_400) * 24 * 1_096;
    expect(MARKET.tam.totalCents).toBe(households + venues);
    expect(formatCents(MARKET.tam.totalCents)).toBe("$29,307,090.44");
  });

  it("adds Australia as a separate layer and leaves it out of the SAM", () => {
    expect(MARKET.tamWithAustralia.totalCents).toBeGreaterThan(
      MARKET.tam.totalCents,
    );
    expect(MARKET.sam.totalCents).toBeLessThan(MARKET.tam.totalCents);
    expect(MARKET.sam.scope).toContain("New Zealand");
    expect(MARKET.sam.meaning).toContain("Australia is excluded");
  });

  it("bounds the SOM by capacity rather than by demand", () => {
    const capacity = 2 * 120 * 44;
    expect(capacity).toBe(10_560);

    // Doubling every demand assumption must not move the SOM by a cent.
    const doubled = MARKET_INPUTS.map((input) =>
      [
        "nzHouseholds",
        "nzCandidateHouseholdRate",
        "nzCafesRestaurants",
        "nzSpecialtyRetailDoors",
        "nzSpecialtyOnlineBuyerRate",
      ].includes(input.id)
        ? { ...input, value: Math.min(input.value * 2, input.max) }
        : input,
    );
    const model = computeMarket(doubled);
    expect(model.sam.totalCents).toBeGreaterThan(MARKET.sam.totalCents);
    expect(model.som.totalCents).toBe(MARKET.som.totalCents);

    // Halving the production day, however, halves it.
    const slower = computeMarket(edited("bottlesPerProductionDay", 60));
    expect(slower.som.totalCents).toBeLessThan(MARKET.som.totalCents);
  });

  it("keeps the year 2 SOM a defensible share of the SAM", () => {
    const share = (MARKET.som.totalCents / MARKET.sam.totalCents) * 100;
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(3);
  });

  it("states the SOM in things the founder can count", () => {
    const venues = MARKET.targets.find((target) => target.id === "venues");
    expect(venues?.value).toBe("83 venues");
    // The mission statement in the Flight Plan quotes the same number, so the
    // two frameworks cannot drift into promising different things.
    expect(FLIGHT_PLAN.cockpit.mission.goal).toContain("83");
  });

  it("moves every layer when one assumption moves", () => {
    const pessimistic = computeMarket(edited("nzCandidateHouseholdRate", 0.2));
    expect(pessimistic.tam.totalCents).toBeLessThan(MARKET.tam.totalCents);
    expect(pessimistic.sam.totalCents).toBeLessThan(MARKET.sam.totalCents);
    // The sensitivity quoted in the assumption's own rationale is the truth,
    // to the nearest $0.1m in both directions.
    expect(pessimistic.tam.totalCents / 100 / 1_000_000).toBeCloseTo(18.0, 1);
    const optimistic = computeMarket(edited("nzCandidateHouseholdRate", 0.5));
    expect(optimistic.tam.totalCents / 100 / 1_000_000).toBeCloseTo(40.6, 1);
  });

  it("names every input it uses, and uses every input it names", () => {
    const used = new Set<string>();
    for (const layer of [
      MARKET.tam,
      MARKET.tamWithAustralia,
      MARKET.sam,
      MARKET.som,
    ]) {
      for (const step of layer.steps) {
        for (const id of step.uses) used.add(id);
      }
    }
    for (const id of used) {
      expect(MARKET_INPUTS.map((input) => input.id)).toContain(id);
    }
    // Removing any input at all must break the model, which is what proves
    // nothing downstream is hard-coded.
    for (const input of MARKET_INPUTS) {
      expect(() =>
        computeMarket(MARKET_INPUTS.filter((other) => other.id !== input.id)),
      ).toThrow(`Market input "${input.id}" is not defined.`);
    }
  });

  it("cites a real source for everything not labelled an estimate", () => {
    const ids = new Set(SOURCES.map((entry) => entry.id));
    for (const input of MARKET_INPUTS) {
      if (input.confidence === "estimate") {
        expect(input.sourceId).toBeUndefined();
      } else {
        expect(input.sourceId).toBeDefined();
        expect(ids.has(input.sourceId ?? "")).toBe(true);
      }
    }
  });

  it("keeps every value inside the bounds the admin's editor offers", () => {
    for (const input of MARKET_INPUTS) {
      expect(input.min).toBeLessThanOrEqual(input.value);
      expect(input.value).toBeLessThanOrEqual(input.max);
      expect(input.step).toBeGreaterThan(0);
    }
  });

  it("splits the SOM channel mix into exactly one whole", () => {
    const total = v("somDtcShare") + v("somRetailShare") + v("somTradeShare");
    expect(total).toBeCloseTo(1, 10);
  });

  it("stores every assumption as an exact number of millionths", () => {
    for (const input of MARKET_INPUTS) {
      for (const value of [input.value, input.min, input.max, input.step]) {
        const micro = value * 1_000_000;
        expect(Number.isSafeInteger(Math.round(micro))).toBe(true);
        expect(Math.abs(micro - Math.round(micro))).toBeLessThan(1e-6);
      }
    }
  });
});

describe("unit economics", () => {
  const gst = v("gstRate");
  const discount = v("tradeDiscountRate");

  it("finds the trade discount does not pay on a single bottle", () => {
    const house = FLIGHT_PLAN.wings.wings.find(
      (wing) => wing.sku === "HS-01-500",
    );
    expect(house).toBeDefined();
    if (house === undefined) return;
    const economics = wingEconomics(house, gst, discount);
    expect(economics.netShelfCents).toBe(1_565);
    expect(economics.cogsCents).toBe(695);
    expect(economics.directMarginPercent).toBeGreaterThan(50);
    // This is the finding the wings section states in words.
    expect(economics.tradeMarginPercent).toBeLessThan(30);
  });

  it("finds The First Three has the weakest gross margin in the range", () => {
    const margins = FLIGHT_PLAN.wings.wings.map((wing) => ({
      sku: wing.sku,
      percent: wingEconomics(wing, gst, discount).directMarginPercent,
    }));
    const weakest = margins.reduce((low, entry) =>
      entry.percent < low.percent ? entry : low,
    );
    expect(weakest.sku).toBe("HS-SET-3");
  });

  it("finds a two-bottle direct order barely clears its own courier", () => {
    const house = FLIGHT_PLAN.wings.wings.find(
      (wing) => wing.sku === "HS-01-500",
    );
    if (house === undefined)
      throw new Error("No 01 is missing from the wings.");
    const perOrder = FLIGHT_PLAN.body.perOrderCosts.reduce(
      (total, line) => total + line.cents,
      0,
    );
    const twoBottles =
      wingEconomics(house, gst, discount).directMarginCents * 2;
    expect(twoBottles - perOrder).toBeLessThan(600);
    expect(twoBottles - perOrder).toBeGreaterThan(0);
  });
});
