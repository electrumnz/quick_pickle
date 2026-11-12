import { describe, expect, it } from "vitest";

import {
  digitsOf,
  formatGstNumber,
  isGstNumber,
  isNzbn,
} from "@/lib/shop/company-numbers";

/**
 * The two numbers a business is known by. Both end in a check digit, so a
 * slipped digit is caught before it is printed on a receipt.
 */

describe("a New Zealand Business Number", () => {
  it("is 13 digits whose last one checks the rest", () => {
    // A real one, as the register prints it.
    expect(isNzbn("9429040402543")).toBe(true);
    // The same with any one digit slipped.
    for (let at = 0; at < 13; at += 1) {
      const digits = "9429040402543".split("");
      digits[at] = String((Number(digits[at]) + 1) % 10);
      expect(isNzbn(digits.join(""))).toBe(false);
    }
  });

  it("is nothing else", () => {
    expect(isNzbn("")).toBe(false);
    expect(isNzbn("942904040254")).toBe(false);
    expect(isNzbn("94290404025430")).toBe(false);
    expect(isNzbn("94290404O2543")).toBe(false);
    expect(isNzbn("9429 0404 02543")).toBe(false);
  });

  it("is read from what was typed by taking the spaces and dashes out", () => {
    expect(digitsOf(" 94 2904 0402 543 ")).toBe("9429040402543");
    expect(digitsOf("49-091-850")).toBe("49091850");
  });
});

describe("a GST number", () => {
  // The worked examples in Inland Revenue's own specification.
  it.each(["49091850", "35901981", "49098576", "136410132"])(
    "takes %s, which Inland Revenue's own check passes",
    (number) => {
      expect(isGstNumber(number)).toBe(true);
    },
  );

  it.each([
    ["136410133", "the last digit is wrong"],
    ["9125568", "it is too short, and under the smallest there is"],
    ["49091851", "the last digit is wrong"],
    ["49O91850", "it has a letter in it"],
    ["150000001", "it is over the biggest there is"],
    ["", "it is empty"],
  ])("refuses %s, because %s", (number) => {
    expect(isGstNumber(number)).toBe(false);
  });

  it("catches any one slipped digit", () => {
    for (const real of ["49091850", "136410132"]) {
      for (let at = 0; at < real.length; at += 1) {
        const digits = real.split("");
        digits[at] = String((Number(digits[at]) + 1) % 10);
        expect(isGstNumber(digits.join(""))).toBe(false);
      }
    }
  });

  it("is written with dashes", () => {
    expect(formatGstNumber("49091850")).toBe("49-091-850");
    expect(formatGstNumber("136410132")).toBe("136-410-132");
  });
});
