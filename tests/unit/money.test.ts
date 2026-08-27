import { describe, expect, it } from "vitest";

import { formatMoney, sumMoney } from "@/lib/commerce/money";

describe("formatMoney", () => {
  it("formats minor units as a currency string", () => {
    expect(formatMoney({ amountInMinorUnits: 1250, currencyCode: "NZD" })).toBe(
      "$12.50",
    );
  });
});

describe("sumMoney", () => {
  it("adds amounts sharing a currency", () => {
    expect(
      sumMoney([
        { amountInMinorUnits: 1250, currencyCode: "NZD" },
        { amountInMinorUnits: 750, currencyCode: "NZD" },
      ]),
    ).toEqual({ amountInMinorUnits: 2000, currencyCode: "NZD" });
  });

  it("rejects mixed currencies", () => {
    expect(() =>
      sumMoney([
        { amountInMinorUnits: 100, currencyCode: "NZD" },
        { amountInMinorUnits: 100, currencyCode: "USD" },
      ]),
    ).toThrow(/mixed currencies/);
  });

  it("rejects an empty list", () => {
    expect(() => sumMoney([])).toThrow(/at least one item/);
  });
});
