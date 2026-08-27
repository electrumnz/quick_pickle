/**
 * Money for HALF SOUR.
 *
 * One rule, enforced everywhere below: **money is an integer count of the
 * currency's minor unit**. No `number` in a price path is ever allowed to hold
 * a fractional value, because IEEE-754 cannot represent 0.1 and a storefront
 * that adds 0.1 + 0.2 owes its customer 0.30000000000000004.
 *
 * Shopify's APIs return money as decimal strings (`MoneyV2.amount = "18.00"`).
 * Converting those to minor units is this module's job and it is done with
 * `BigInt` string arithmetic, never `parseFloat`. See {@link parseShopifyMoney}.
 *
 * Rounding, where it is unavoidable (percentage discounts, GST components,
 * proportional allocation), is half-away-from-zero on exact integer ratios, and
 * allocation uses the largest-remainder method so the parts always sum back to
 * the whole.
 */

/** ISO 4217 alpha-3 currency code. Matches the `public.currency_code` domain. */
export type CurrencyCode = string;

export type Money = {
  /** Integer amount in the currency's minor unit (e.g. cents). */
  readonly amountInMinorUnits: number;
  /** ISO 4217 currency code, e.g. "NZD". */
  readonly currencyCode: string;
};

/** The store's home currency. The schema defaults every money column to it. */
export const DEFAULT_CURRENCY: CurrencyCode = "NZD";

/**
 * Currencies whose minor unit is not 1/100. Everything absent from this table
 * has two decimal places, which covers NZD, AUD and USD.
 *
 * Source: ISO 4217 minor unit column.
 */
const MINOR_UNIT_DIGITS: Readonly<Record<string, number>> = {
  BHD: 3,
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  UGX: 0,
  UYW: 4,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
};

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_AMOUNT_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/;

/** Thrown when a value that must be exact money is not. */
export class MoneyError extends Error {
  override readonly name = "MoneyError";
}

function fail(message: string): never {
  throw new MoneyError(message);
}

/** Number of decimal places the currency is quoted to. NZD -> 2, JPY -> 0. */
export function minorUnitDigits(currencyCode: CurrencyCode): number {
  assertCurrencyCode(currencyCode);
  return MINOR_UNIT_DIGITS[currencyCode] ?? 2;
}

export function assertCurrencyCode(
  currencyCode: string,
): asserts currencyCode is CurrencyCode {
  if (!CURRENCY_CODE_PATTERN.test(currencyCode)) {
    fail(
      `Not an ISO 4217 alpha-3 currency code: ${JSON.stringify(currencyCode)}`,
    );
  }
}

/**
 * Build a {@link Money} from an integer minor-unit amount, refusing anything
 * that is not exactly representable as an integer.
 */
export function money(
  amountInMinorUnits: number,
  currencyCode: CurrencyCode = DEFAULT_CURRENCY,
): Money {
  assertCurrencyCode(currencyCode);
  if (!Number.isSafeInteger(amountInMinorUnits)) {
    fail(
      `Money must be a safe integer number of minor units, got ${String(amountInMinorUnits)}`,
    );
  }
  return { amountInMinorUnits, currencyCode };
}

/** Zero in the given currency. */
export function zeroMoney(
  currencyCode: CurrencyCode = DEFAULT_CURRENCY,
): Money {
  return money(0, currencyCode);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currencyCode !== b.currencyCode) {
    fail(`Cannot combine ${a.currencyCode} with ${b.currencyCode}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountInMinorUnits + b.amountInMinorUnits, a.currencyCode);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountInMinorUnits - b.amountInMinorUnits, a.currencyCode);
}

/** Multiply by a whole quantity. Quantities are counts, never fractions. */
export function multiplyMoney(a: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity)) {
    fail(`Quantity must be an integer, got ${String(quantity)}`);
  }
  const product = BigInt(a.amountInMinorUnits) * BigInt(quantity);
  return money(bigIntToSafeInteger(product), a.currencyCode);
}

/** -1, 0 or 1. Throws on mixed currencies. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountInMinorUnits < b.amountInMinorUnits) return -1;
  if (a.amountInMinorUnits > b.amountInMinorUnits) return 1;
  return 0;
}

export function minMoney(a: Money, b: Money): Money {
  return compareMoney(a, b) <= 0 ? a : b;
}

export function maxMoney(a: Money, b: Money): Money {
  return compareMoney(a, b) >= 0 ? a : b;
}

/** Sum a list of {@link Money} values. Throws if currencies are mixed. */
export function sumMoney(items: readonly Money[]): Money {
  const first = items[0];
  if (first === undefined) {
    throw new Error("sumMoney requires at least one item");
  }
  let total = 0n;
  for (const item of items) {
    if (item.currencyCode !== first.currencyCode) {
      throw new Error(
        `Cannot sum mixed currencies: ${first.currencyCode} and ${item.currencyCode}`,
      );
    }
    total += BigInt(item.amountInMinorUnits);
  }
  return money(bigIntToSafeInteger(total), first.currencyCode);
}

function bigIntToSafeInteger(value: bigint): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    fail(`Money overflowed the safe integer range: ${value.toString()}`);
  }
  return Number(value);
}

// ---------------------------------------------------------------------------
// Exact rounding primitives
// ---------------------------------------------------------------------------

/**
 * Divide two integers, rounding halves away from zero. Pure `BigInt`, so the
 * result is exact for every input the rest of this module can produce.
 *
 * Half-away-from-zero (not banker's rounding) is what Shopify, Xero and the IRD
 * worked examples use for GST, so a 2.5c half-cent becomes 3c and -2.5c becomes
 * -3c.
 */
export function divideRoundHalfAwayFromZero(
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (denominator === 0n) fail("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Apply a rate expressed in basis points (1bp = 0.01%). 1500bp is 15%.
 *
 * The schema stores every percentage as `_bp` for exactly this reason: a
 * percentage held as a float cannot round-trip.
 */
export function applyBasisPoints(
  amountInMinorUnits: number,
  basisPoints: number,
): number {
  if (!Number.isSafeInteger(amountInMinorUnits)) {
    fail(`Amount must be an integer, got ${String(amountInMinorUnits)}`);
  }
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    fail(
      `Basis points must be a non-negative integer, got ${String(basisPoints)}`,
    );
  }
  return bigIntToSafeInteger(
    divideRoundHalfAwayFromZero(
      BigInt(amountInMinorUnits) * BigInt(basisPoints),
      10_000n,
    ),
  );
}

/** New Zealand GST, in basis points. 15%. */
export const NZ_GST_BASIS_POINTS = 1500;

/**
 * The tax already contained inside a tax-inclusive total.
 *
 * NZ retail prices are quoted GST-inclusive, so a $23.00 bottle is $20.00 plus
 * $3.00 GST, not $23.00 plus GST. The component is `total * rate / (1 + rate)`.
 */
export function taxIncludedInTotal(
  totalInMinorUnits: number,
  basisPoints: number = NZ_GST_BASIS_POINTS,
): number {
  if (!Number.isSafeInteger(totalInMinorUnits)) {
    fail(`Total must be an integer, got ${String(totalInMinorUnits)}`);
  }
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    fail(
      `Basis points must be a non-negative integer, got ${String(basisPoints)}`,
    );
  }
  return bigIntToSafeInteger(
    divideRoundHalfAwayFromZero(
      BigInt(totalInMinorUnits) * BigInt(basisPoints),
      10_000n + BigInt(basisPoints),
    ),
  );
}

/**
 * Split `total` across `weights` so that the parts sum **exactly** to `total`.
 *
 * Largest-remainder (Hamilton) apportionment: every part gets the floor of its
 * exact share, then the leftover minor units go one each to the parts with the
 * largest fractional remainders, ties broken by earlier index so the result is
 * deterministic. Used to spread an order-level discount over its lines, which
 * is where naive `Math.round(total * w / sum)` loses or invents a cent.
 *
 * If every weight is zero the total is spread as evenly as possible by index.
 */
export function allocateProportionally(
  total: number,
  weights: readonly number[],
): number[] {
  if (!Number.isSafeInteger(total)) {
    fail(`Total must be an integer, got ${String(total)}`);
  }
  if (total < 0) {
    fail(`Total must be non-negative, got ${String(total)}`);
  }
  if (weights.length === 0) {
    if (total !== 0) fail("Cannot allocate a non-zero total across zero parts");
    return [];
  }
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      fail(`Weights must be non-negative integers, got ${String(weight)}`);
    }
  }

  const totalBig = BigInt(total);
  const weightSum = weights.reduce((sum, w) => sum + BigInt(w), 0n);
  if (weightSum === 0n) return allocateEvenly(total, weights.length);

  const parts: number[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let assigned = 0n;

  for (const [index, weight] of weights.entries()) {
    const exact = totalBig * BigInt(weight);
    const floorPart = exact / weightSum; // both operands are >= 0, so this floors
    parts.push(bigIntToSafeInteger(floorPart));
    remainders.push({ index, remainder: exact - floorPart * weightSum });
    assigned += floorPart;
  }

  // Every part was rounded down, so the leftover is >= 0 and < weights.length.
  let leftover = totalBig - assigned;
  remainders.sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );

  for (const target of remainders) {
    if (leftover === 0n) break;
    parts[target.index] = (parts[target.index] ?? 0) + 1;
    leftover -= 1n;
  }

  return parts;
}

/** Spread `total` over `count` parts as evenly as an integer allows. */
function allocateEvenly(total: number, count: number): number[] {
  const totalBig = BigInt(total);
  const countBig = BigInt(count);
  const base = totalBig / countBig;
  const remainder = totalBig % countBig;
  return Array.from({ length: count }, (_unused, index) =>
    bigIntToSafeInteger(base + (BigInt(index) < remainder ? 1n : 0n)),
  );
}

// ---------------------------------------------------------------------------
// Shopify decimal-string interop
// ---------------------------------------------------------------------------

/**
 * Parse a Shopify `MoneyV2.amount` decimal string into integer minor units.
 *
 * Shopify is inconsistent about trailing zeroes — the same field comes back as
 * `"18.00"`, `"150.0"` and `"7"` — so this accepts any number of decimal
 * places. More places than the currency has are rounded half-away-from-zero
 * rather than silently truncated; fewer are padded.
 *
 * Deliberately never touches `Number` until the final exact integer, so
 * `"0.1"` + `"0.2"` really is `30` cents.
 */
export function parseShopifyMoney(
  amount: string,
  currencyCode: CurrencyCode,
): Money {
  assertCurrencyCode(currencyCode);
  const trimmed = amount.trim();
  const match = DECIMAL_AMOUNT_PATTERN.exec(trimmed);
  if (match === null) {
    fail(`Not a decimal money string: ${JSON.stringify(amount)}`);
  }
  const [, sign, whole = "0", fraction = ""] = match;
  const digits = minorUnitDigits(currencyCode);

  const scaledWhole = BigInt(whole) * 10n ** BigInt(digits);
  let scaledFraction: bigint;
  if (fraction.length <= digits) {
    scaledFraction = BigInt(fraction.padEnd(digits, "0") || "0");
  } else {
    const kept = fraction.slice(0, digits) || "0";
    const dropped = fraction.slice(digits);
    scaledFraction =
      BigInt(kept) +
      divideRoundHalfAwayFromZero(
        BigInt(dropped),
        10n ** BigInt(dropped.length),
      );
  }

  const magnitude = scaledWhole + scaledFraction;
  const signed = sign === "-" ? -magnitude : magnitude;
  return money(bigIntToSafeInteger(signed), currencyCode);
}

/**
 * Render {@link Money} the way Shopify wants it on the wire: a plain decimal
 * string with the currency's exact number of decimal places, no separators, no
 * symbol. The inverse of {@link parseShopifyMoney}.
 */
export function toShopifyMoney(value: Money): string {
  return toDecimalString(value);
}

/** `1250 NZD` -> `"12.50"`. Exact; built by string surgery, not division. */
export function toDecimalString(value: Money): string {
  const digits = minorUnitDigits(value.currencyCode);
  const negative = value.amountInMinorUnits < 0;
  const magnitude = BigInt(Math.abs(value.amountInMinorUnits)).toString();
  if (digits === 0) return `${negative ? "-" : ""}${magnitude}`;
  const padded = magnitude.padStart(digits + 1, "0");
  const whole = padded.slice(0, padded.length - digits);
  const fraction = padded.slice(padded.length - digits);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * The Shopify `MoneyV2` shape, so adapter code can hand one straight back.
 */
export type MoneyV2 = {
  readonly amount: string;
  readonly currencyCode: string;
};

export function toMoneyV2(value: Money): MoneyV2 {
  return { amount: toDecimalString(value), currencyCode: value.currencyCode };
}

export function fromMoneyV2(value: MoneyV2): Money {
  return parseShopifyMoney(value.amount, value.currencyCode);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Format a {@link Money} value for display.
 *
 * The amount is handed to `Intl.NumberFormat` as a decimal *string*, which the
 * ES2023 Intl.NumberFormat v3 API formats without ever going through a double.
 * `1250 NZD` in `en-NZ` is `"$12.50"`.
 *
 * @param value - amount in minor units plus its ISO 4217 currency code
 * @param locale - BCP 47 locale tag used for grouping and symbol placement
 */
export function formatMoney(value: Money, locale = "en-NZ"): string {
  const digits = minorUnitDigits(value.currencyCode);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currencyCode,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toDecimalString(value));
}

/** A price range, as the storefront shows it under a product title. */
export function formatMoneyRange(
  from: Money,
  to: Money,
  locale = "en-NZ",
): string {
  return compareMoney(from, to) === 0
    ? formatMoney(from, locale)
    : `${formatMoney(from, locale)} – ${formatMoney(to, locale)}`;
}
