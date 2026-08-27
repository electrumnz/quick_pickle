/** Minimal money helpers shared by cart, checkout and product display. */

export type Money = {
  /** Integer amount in the currency's minor unit (e.g. cents). */
  readonly amountInMinorUnits: number;
  /** ISO 4217 currency code, e.g. "NZD". */
  readonly currencyCode: string;
};

/**
 * Format a {@link Money} value for display.
 *
 * @param money - amount in minor units plus its ISO 4217 currency code
 * @param locale - BCP 47 locale tag used for grouping and symbol placement
 */
export function formatMoney(money: Money, locale = "en-NZ"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currencyCode,
  }).format(money.amountInMinorUnits / 100);
}

/** Sum a list of {@link Money} values. Throws if currencies are mixed. */
export function sumMoney(items: readonly Money[]): Money {
  const first = items[0];
  if (first === undefined) {
    throw new Error("sumMoney requires at least one item");
  }
  let total = 0;
  for (const item of items) {
    if (item.currencyCode !== first.currencyCode) {
      throw new Error(
        `Cannot sum mixed currencies: ${first.currencyCode} and ${item.currencyCode}`,
      );
    }
    total += item.amountInMinorUnits;
  }
  return { amountInMinorUnits: total, currencyCode: first.currencyCode };
}
