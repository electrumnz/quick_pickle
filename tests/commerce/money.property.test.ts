/**
 * Property tests for the money layer.
 *
 * Money is the one place in this codebase where being approximately right is
 * indistinguishable from being wrong, so these tests do not check a handful of
 * examples — they check laws, over thousands of pseudo-random inputs, against a
 * `BigInt` reference implementation that cannot round.
 *
 * The generator is a seeded mulberry32, so a failure is reproducible: the seed
 * is printed in the assertion message.
 */

import { describe, expect, it } from "vitest";

import {
  addMoney,
  allocateProportionally,
  applyBasisPoints,
  compareMoney,
  divideRoundHalfAwayFromZero,
  formatMoney,
  fromMoneyV2,
  minorUnitDigits,
  money,
  multiplyMoney,
  parseShopifyMoney,
  subtractMoney,
  sumMoney,
  taxIncludedInTotal,
  toDecimalString,
  toMoneyV2,
  toShopifyMoney,
  NZ_GST_BASIS_POINTS,
  MoneyError,
} from "@/lib/commerce/money";

const ITERATIONS = 4000;

/** Deterministic PRNG, so every failure below is reproducible from its seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** The reference: exact rational rounding done entirely in BigInt. */
function referenceHalfAwayFromZero(
  numerator: bigint,
  denominator: bigint,
): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const q = a / b;
  const r = a % b;
  const rounded = r * 2n >= b ? q + 1n : q;
  return negative ? -rounded : rounded;
}

const CURRENCIES = ["NZD", "AUD", "USD", "JPY", "KWD"] as const;

describe("minor units", () => {
  it("knows which currencies are not hundredths", () => {
    expect(minorUnitDigits("NZD")).toBe(2);
    expect(minorUnitDigits("AUD")).toBe(2);
    expect(minorUnitDigits("JPY")).toBe(0);
    expect(minorUnitDigits("KWD")).toBe(3);
  });

  it("refuses anything that is not an ISO 4217 code", () => {
    expect(() => minorUnitDigits("nzd")).toThrow(MoneyError);
    expect(() => minorUnitDigits("NZDD")).toThrow(MoneyError);
  });

  it("refuses a fractional amount of minor units", () => {
    expect(() => money(12.5, "NZD")).toThrow(MoneyError);
    expect(() => money(Number.NaN, "NZD")).toThrow(MoneyError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 2, "NZD")).toThrow(MoneyError);
  });
});

describe("Shopify decimal-string interop", () => {
  it("parses the shapes Shopify actually sends", () => {
    expect(parseShopifyMoney("18.00", "NZD").amountInMinorUnits).toBe(1800);
    expect(parseShopifyMoney("150.0", "NZD").amountInMinorUnits).toBe(15000);
    expect(parseShopifyMoney("7", "NZD").amountInMinorUnits).toBe(700);
    expect(parseShopifyMoney("0.05", "NZD").amountInMinorUnits).toBe(5);
    expect(parseShopifyMoney("-12.34", "NZD").amountInMinorUnits).toBe(-1234);
    expect(parseShopifyMoney("1500", "JPY").amountInMinorUnits).toBe(1500);
    expect(parseShopifyMoney("12.345", "KWD").amountInMinorUnits).toBe(12345);
  });

  it("never goes through a float", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754. Not here.
    const a = parseShopifyMoney("0.1", "NZD");
    const b = parseShopifyMoney("0.2", "NZD");
    expect(addMoney(a, b).amountInMinorUnits).toBe(30);
    // 1.005 is stored as 1.00499999999999989... so Math.round(1.005 * 100) is 100.
    expect(parseShopifyMoney("1.005", "NZD").amountInMinorUnits).toBe(101);
    expect(parseShopifyMoney("2.675", "NZD").amountInMinorUnits).toBe(268);
    expect(parseShopifyMoney("8.165", "NZD").amountInMinorUnits).toBe(817);
  });

  it("rejects anything that is not a decimal amount", () => {
    for (const bad of [
      "",
      "  ",
      "1.2.3",
      "12,50",
      "NZ$12.50",
      "1e3",
      "abc",
      "-",
    ]) {
      expect(() => parseShopifyMoney(bad, "NZD")).toThrow(MoneyError);
    }
  });

  it("round-trips every amount through the wire format", () => {
    const random = mulberry32(0xc0ffee);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const currency =
        CURRENCIES[randomInt(random, 0, CURRENCIES.length - 1)] ?? "NZD";
      const cents = randomInt(random, -9_999_999_999, 9_999_999_999);
      const value = money(cents, currency);
      const wire = toShopifyMoney(value);
      expect(
        parseShopifyMoney(wire, currency).amountInMinorUnits,
        `${wire} ${currency}`,
      ).toBe(cents);
      expect(fromMoneyV2(toMoneyV2(value))).toEqual(value);
      const digits = minorUnitDigits(currency);
      const fraction = wire.includes(".") ? (wire.split(".")[1] ?? "") : "";
      expect(
        fraction.length,
        `${wire} has the wrong precision for ${currency}`,
      ).toBe(digits);
    }
  });

  it("parses arbitrary decimal strings exactly", () => {
    const random = mulberry32(0x5eed);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const whole = String(randomInt(random, 0, 999_999));
      const places = randomInt(random, 0, 6);
      const fraction = Array.from({ length: places }, () =>
        String(randomInt(random, 0, 9)),
      ).join("");
      const text = places === 0 ? whole : `${whole}.${fraction}`;
      const parsed = parseShopifyMoney(text, "NZD").amountInMinorUnits;
      const expected = Number(
        referenceHalfAwayFromZero(
          BigInt(whole + fraction.padEnd(Math.max(places, 2), "0")),
          10n ** BigInt(Math.max(places, 2) - 2),
        ),
      );
      expect(parsed, `parse ${text}`).toBe(expected);
    }
  });
});

describe("rounding", () => {
  it("rounds halves away from zero, both signs", () => {
    expect(Number(divideRoundHalfAwayFromZero(5n, 2n))).toBe(3);
    expect(Number(divideRoundHalfAwayFromZero(-5n, 2n))).toBe(-3);
    expect(Number(divideRoundHalfAwayFromZero(4n, 2n))).toBe(2);
    expect(Number(divideRoundHalfAwayFromZero(1n, 3n))).toBe(0);
    expect(() => divideRoundHalfAwayFromZero(1n, 0n)).toThrow(MoneyError);
  });

  it("applyBasisPoints matches the exact rational, and stays inside its bounds", () => {
    const random = mulberry32(0xbeef);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const amount = randomInt(random, 0, 100_000_000);
      const basisPoints = randomInt(random, 0, 10_000);
      const actual = applyBasisPoints(amount, basisPoints);
      const expected = Number(
        referenceHalfAwayFromZero(
          BigInt(amount) * BigInt(basisPoints),
          10_000n,
        ),
      );
      expect(actual, `${amount} @ ${basisPoints}bp`).toBe(expected);
      expect(actual).toBeGreaterThanOrEqual(0);
      expect(actual).toBeLessThanOrEqual(amount);
      expect(Number.isSafeInteger(actual)).toBe(true);
    }
  });

  it("applyBasisPoints is monotonic in the amount", () => {
    const random = mulberry32(0x1234);
    for (let i = 0; i < 1000; i += 1) {
      const basisPoints = randomInt(random, 0, 10_000);
      const low = randomInt(random, 0, 1_000_000);
      const high = low + randomInt(random, 0, 1_000_000);
      expect(applyBasisPoints(low, basisPoints)).toBeLessThanOrEqual(
        applyBasisPoints(high, basisPoints),
      );
    }
  });

  it("rejects nonsense rates and amounts", () => {
    expect(() => applyBasisPoints(100, -1)).toThrow(MoneyError);
    expect(() => applyBasisPoints(1.5, 100)).toThrow(MoneyError);
    expect(() => taxIncludedInTotal(1.5)).toThrow(MoneyError);
  });
});

describe("GST", () => {
  it("extracts the component already inside a tax-inclusive price", () => {
    // NZ worked examples: $23.00 inclusive is $20.00 plus $3.00 GST.
    expect(taxIncludedInTotal(2300)).toBe(300);
    expect(taxIncludedInTotal(11500)).toBe(1500);
    expect(taxIncludedInTotal(1800)).toBe(235);
    expect(taxIncludedInTotal(0)).toBe(0);
  });

  it("never claims more tax than there is money", () => {
    const random = mulberry32(0x9a7e);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const total = randomInt(random, 0, 50_000_000);
      const tax = taxIncludedInTotal(total, NZ_GST_BASIS_POINTS);
      expect(tax).toBeGreaterThanOrEqual(0);
      expect(tax).toBeLessThanOrEqual(total);
      // Adding the rate back onto the net must land within a cent of the total.
      const net = total - tax;
      expect(
        Math.abs(net + applyBasisPoints(net, NZ_GST_BASIS_POINTS) - total),
      ).toBeLessThanOrEqual(1);
    }
  });
});

describe("proportional allocation", () => {
  it("always sums back to the total it was given", () => {
    const random = mulberry32(0xa11c);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const parts = randomInt(random, 1, 8);
      const weights = Array.from({ length: parts }, () =>
        randomInt(random, 0, 50_000),
      );
      const total = randomInt(random, 0, 500_000);
      const allocation = allocateProportionally(total, weights);
      expect(allocation.length).toBe(parts);
      expect(
        allocation.reduce((sum, value) => sum + value, 0),
        `total ${String(total)} over ${weights.join(",")}`,
      ).toBe(total);
      for (const value of allocation) {
        expect(Number.isSafeInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("never puts money on a part that is entitled to none", () => {
    const random = mulberry32(0xd00d);
    for (let i = 0; i < 1000; i += 1) {
      const weights = [
        randomInt(random, 1, 1000),
        0,
        randomInt(random, 1, 1000),
      ];
      const total = randomInt(random, 0, 100_000);
      const allocation = allocateProportionally(total, weights);
      expect(allocation[1]).toBe(0);
    }
  });

  it("stays within one minor unit of the exact share", () => {
    const random = mulberry32(0x2468);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const weights = Array.from({ length: randomInt(random, 1, 6) }, () =>
        randomInt(random, 1, 10_000),
      );
      const total = randomInt(random, 0, 1_000_000);
      const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
      const allocation = allocateProportionally(total, weights);
      for (const [index, weight] of weights.entries()) {
        const exact = (total * weight) / weightSum;
        expect(Math.abs((allocation[index] ?? 0) - exact)).toBeLessThan(1);
      }
    }
  });

  it("spreads evenly when nothing has any weight", () => {
    expect(allocateProportionally(10, [0, 0, 0])).toEqual([4, 3, 3]);
    expect(allocateProportionally(0, [0, 0])).toEqual([0, 0]);
    expect(allocateProportionally(0, [])).toEqual([]);
    expect(() => allocateProportionally(5, [])).toThrow(MoneyError);
    expect(() => allocateProportionally(5, [1, -1])).toThrow(MoneyError);
  });

  it("is deterministic: the same inputs always allocate the same way", () => {
    const weights = [333, 333, 334];
    const once = allocateProportionally(100, weights);
    for (let i = 0; i < 50; i += 1) {
      expect(allocateProportionally(100, weights)).toEqual(once);
    }
  });
});

describe("arithmetic", () => {
  it("adds, subtracts and multiplies exactly", () => {
    const random = mulberry32(0x7777);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const a = randomInt(random, -1_000_000, 1_000_000);
      const b = randomInt(random, -1_000_000, 1_000_000);
      const quantity = randomInt(random, 0, 500);
      expect(addMoney(money(a), money(b)).amountInMinorUnits).toBe(a + b);
      expect(subtractMoney(money(a), money(b)).amountInMinorUnits).toBe(a - b);
      // Compared against the BigInt reference rather than `a * quantity`,
      // because JS gives -0 for a negative times zero and money never should.
      expect(multiplyMoney(money(a), quantity).amountInMinorUnits).toBe(
        Number(BigInt(a) * BigInt(quantity)),
      );
      expect(
        Object.is(multiplyMoney(money(-5), 0).amountInMinorUnits, -0),
      ).toBe(false);
      expect(compareMoney(money(a), money(b))).toBe(a < b ? -1 : a > b ? 1 : 0);
    }
  });

  it("sums a list without drift", () => {
    const random = mulberry32(0x3141);
    for (let i = 0; i < 500; i += 1) {
      const amounts = Array.from({ length: randomInt(random, 1, 40) }, () =>
        randomInt(random, -100_000, 100_000),
      );
      expect(
        sumMoney(amounts.map((amount) => money(amount))).amountInMinorUnits,
      ).toBe(amounts.reduce((sum, amount) => sum + amount, 0));
    }
  });

  it("refuses to mix currencies or fractional quantities", () => {
    expect(() => addMoney(money(1, "NZD"), money(1, "AUD"))).toThrow(
      MoneyError,
    );
    expect(() => multiplyMoney(money(100), 1.5)).toThrow(MoneyError);
    expect(() => sumMoney([])).toThrow(/at least one item/);
  });
});

describe("display", () => {
  it("formats NZD with exactly two decimals, whatever the amount", () => {
    expect(formatMoney(money(1250))).toBe("$12.50");
    expect(formatMoney(money(0))).toBe("$0.00");
    expect(formatMoney(money(5))).toBe("$0.05");
    expect(formatMoney(money(-50))).toBe("-$0.50");
    expect(formatMoney(money(-1250))).toBe("-$12.50");
    expect(formatMoney(money(123456789))).toBe("$1,234,567.89");
  });

  it("honours currencies that are not hundredths", () => {
    expect(formatMoney(money(1500, "JPY"), "en-NZ")).toMatch(/1,500$/);
    expect(toDecimalString(money(1500, "JPY"))).toBe("1500");
    expect(toDecimalString(money(12345, "KWD"))).toBe("12.345");
  });

  it("renders every amount with the currency's exact precision", () => {
    const random = mulberry32(0xfeed);
    for (let i = 0; i < 2000; i += 1) {
      const cents = randomInt(random, -100_000_000, 100_000_000);
      const rendered = formatMoney(money(cents));
      expect(rendered, `${String(cents)} -> ${rendered}`).toMatch(
        /^-?\$[\d,]+\.\d{2}$/,
      );
      // And it must describe the same number it was given.
      const digitsOnly = rendered.replace(/[^0-9.]/g, "");
      expect(parseShopifyMoney(digitsOnly, "NZD").amountInMinorUnits).toBe(
        Math.abs(cents),
      );
    }
  });
});
