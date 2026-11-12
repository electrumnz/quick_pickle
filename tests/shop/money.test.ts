import { describe, expect, it } from "vitest";

import {
  assertCents,
  formatNzd,
  formatNzdExact,
  gstIncludedIn,
} from "@/lib/shop/money";

describe("money", () => {
  it("formats whole dollars without cents", () => {
    expect(formatNzd(4800)).toBe("$48");
    expect(formatNzd(0)).toBe("$0");
  });

  it("formats part dollars with two decimals", () => {
    expect(formatNzd(450)).toBe("$4.50");
    expect(formatNzd(405)).toBe("$4.05");
    expect(formatNzd(1)).toBe("$0.01");
  });

  it("groups thousands", () => {
    expect(formatNzd(123_456_00)).toBe("$123,456");
    expect(formatNzdExact(1_234_50)).toBe("$1,234.50");
  });

  it("always shows cents on an exact amount", () => {
    expect(formatNzdExact(4800)).toBe("$48.00");
  });

  it("refuses anything that is not a whole, non-negative number of cents", () => {
    for (const bad of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 60,
    ]) {
      expect(() => assertCents(bad)).toThrow(RangeError);
      expect(() => formatNzd(bad)).toThrow(RangeError);
    }
  });

  it("finds the GST inside a GST-inclusive price", () => {
    // $115 including 15% GST contains exactly $15.
    expect(gstIncludedIn(11500)).toBe(1500);
    expect(gstIncludedIn(4800)).toBe(626);
    expect(gstIncludedIn(0)).toBe(0);
  });
});
