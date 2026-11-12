/**
 * Money is integer cents. There is no float anywhere in a price path.
 */

/** Throws on anything that is not a whole, non-negative number of cents. */
export function assertCents(value: number, what = "amount"): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative integer of cents`);
  }
  return value;
}

/**
 * "$48" for a whole-dollar amount, "$4.50" otherwise.
 *
 * Trailing zero cents are noise on a shelf price, and the dollar sign alone is
 * right for a New Zealand shop selling to New Zealand: "NZ$" only earns its
 * place once somebody overseas can order.
 */
export function formatNzd(cents: number): string {
  assertCents(cents);
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  const whole = dollars.toLocaleString("en-NZ");
  if (remainder === 0) return `$${whole}`;
  return `$${whole}.${String(remainder).padStart(2, "0")}`;
}

/** Always two decimals: "$48.00". For receipts and totals. */
export function formatNzdExact(cents: number): string {
  assertCents(cents);
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `$${dollars.toLocaleString("en-NZ")}.${String(remainder).padStart(2, "0")}`;
}

/**
 * The GST contained in a GST-inclusive amount: 3/23 of it, rounded to the
 * cent. New Zealand's 15% on top is 3/23 of the total.
 */
export function gstIncludedIn(totalCents: number): number {
  assertCents(totalCents);
  return Math.round((totalCents * 3) / 23);
}
