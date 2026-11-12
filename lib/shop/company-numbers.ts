/**
 * The two numbers a New Zealand business is known by, checked before they
 * are printed on a receipt or the terms of sale.
 *
 * Both end in a check digit, so a slipped or swapped digit is caught here
 * and not by a customer. This file imports nothing.
 */

/** Only the digits of what was typed: "94 290 404 02543" and its kin. */
export function digitsOf(typed: string): string {
  return typed.replace(/[\s-]/g, "");
}

/**
 * A New Zealand Business Number: 13 digits, the last a check digit.
 *
 * An NZBN is a GS1 Global Location Number, so its check digit is GS1's:
 * the first twelve digits weighted 1, 3, 1, 3 and so on, summed, and the
 * check digit brings the sum up to the next multiple of ten.
 */
export function isNzbn(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let at = 0; at < 12; at += 1) {
    sum += Number(digits[at]) * (at % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

const FIRST_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2] as const;
const SECOND_WEIGHTS = [7, 4, 3, 2, 5, 2, 7, 6] as const;

/**
 * A GST number, which is the business's IRD number: 8 or 9 digits, the
 * last a check digit.
 *
 * Inland Revenue's own check (from its specification for payroll and
 * withholding tax files): the number sits between 10,000,000 and
 * 150,000,000; the digits before the last, padded to eight, are weighted
 * and summed, and eleven less the remainder on dividing by eleven is the
 * check digit. Where that comes to ten, a second set of weights is tried,
 * and ten again means there is no such number.
 */
export function isGstNumber(digits: string): boolean {
  if (!/^\d{8,9}$/.test(digits)) return false;
  const whole = Number(digits);
  if (whole <= 10_000_000 || whole >= 150_000_000) return false;
  const base = digits.slice(0, -1).padStart(8, "0");
  const last = Number(digits.slice(-1));
  const checkWith = (weights: readonly number[]): number => {
    let sum = 0;
    for (let at = 0; at < 8; at += 1) {
      sum += Number(base[at]) * (weights[at] ?? 0);
    }
    const remainder = sum % 11;
    return remainder === 0 ? 0 : 11 - remainder;
  };
  const first = checkWith(FIRST_WEIGHTS);
  if (first !== 10) return first === last;
  const second = checkWith(SECOND_WEIGHTS);
  return second !== 10 && second === last;
}

/** A GST number as it is written: 49-091-850, 136-410-132. */
export function formatGstNumber(digits: string): string {
  const head = digits.slice(0, -6);
  return `${head}-${digits.slice(-6, -3)}-${digits.slice(-3)}`;
}
