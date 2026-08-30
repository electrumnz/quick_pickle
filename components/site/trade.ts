/**
 * The trade price list, computed rather than typed in.
 *
 * The BrandScript's B2B agreement promises "one published number, the same for
 * every venue of your size". A published number is only worth having if it is
 * derived from the shelf price on the same page a customer reads, so nothing
 * here is a literal: every figure comes out of `content/brines.ts` through two
 * rates, and the page prints the working so a bar manager can check it in the
 * margin of a stocktake sheet.
 *
 *   net shelf   = GST-inclusive shelf price ÷ 1.15
 *   trade price = net shelf × (1 − 0.40)
 *   a case      = trade price × 6
 *   a pour      = trade price ÷ pours in the bottle
 *
 * **Every step is integer minor units.** `divideRoundHalfAwayFromZero` is
 * BigInt arithmetic, so no cent is ever lost to a double, and the rounding rule
 * is the one Shopify, Xero and the IRD worked examples use. A trade price list
 * that disagrees with the invoice by a cent is worse than no trade price list.
 *
 * The two rates are the market model's own assumptions —
 * `content/strategy/market.ts`, inputs `gstRate` and `tradeDiscountRate`. They
 * are restated here as basis points rather than imported because a public page
 * must not read the internal strategy layer, and because a percentage held as a
 * float cannot round-trip. Change one there and one here, or the published
 * price and the plan that pays for it stop being the same company.
 *
 * Checkable: at the published 40%, No. 01 lands on 939 cents a bottle and 5,634
 * cents a case, which is exactly what `avatars.b2b.price.comparedWith` says a
 * venue pays. If those stop matching, one of the two is wrong.
 */

import { ALL_BRINES } from "@/content/brines";
import type { Brine } from "@/content/types";
import { divideRoundHalfAwayFromZero, money, type Money } from "@/lib/commerce";

import { drinksPerBottle } from "@/components/product/serves";

/** New Zealand GST, in basis points. Shelf prices are GST-inclusive. */
export const GST_BASIS_POINTS = 1_500;

/** The published trade discount off the GST-exclusive shelf price. */
export const TRADE_DISCOUNT_BASIS_POINTS = 4_000;

/** Bottles in a case. Cases are not split; that is what makes the price work. */
export const CASE_BOTTLES = 6;

/** The smallest trade order, in cases. */
export const MINIMUM_CASES = 1;

/** Sample bottles sent before a first order. */
export const SAMPLE_BOTTLES = 2;

function toBigInt(value: number): bigint {
  return BigInt(value);
}

/** Whole dollars on the shelf, as integer cents. `priceNzd` is a whole number. */
function shelfCents(brine: Brine): number {
  return brine.priceNzd * 100;
}

/** Shelf price with the GST taken out of it. */
export function netShelfCents(brine: Brine): number {
  return Number(
    divideRoundHalfAwayFromZero(
      toBigInt(shelfCents(brine)) * 10_000n,
      toBigInt(10_000 + GST_BASIS_POINTS),
    ),
  );
}

/** What a venue pays for one bottle, before GST. */
export function tradeCents(brine: Brine): number {
  return Number(
    divideRoundHalfAwayFromZero(
      toBigInt(netShelfCents(brine)) *
        toBigInt(10_000 - TRADE_DISCOUNT_BASIS_POINTS),
      10_000n,
    ),
  );
}

/** One row of the published list. Every field is derived. */
export interface TradeRow {
  readonly brine: Brine;
  readonly shelf: Money;
  readonly netShelf: Money;
  readonly bottle: Money;
  readonly caseTotal: Money;
  /**
   * Pours in a bottle and the measure they are counted at, taken from the
   * recipe this bottle was built for. Null when that recipe measures the brine
   * by something other than volume — in which case no pour cost is printed
   * rather than an invented one.
   */
  readonly pours: {
    readonly count: number;
    readonly perServeMl: number;
    readonly title: string;
    readonly perPour: Money;
  } | null;
  /** True where supply, not demand, sets the ceiling. */
  readonly supplyLimited: boolean;
}

function rowFor(brine: Brine): TradeRow {
  const bottleCents = tradeCents(brine);
  const yieldInfo = drinksPerBottle(brine.id, brine.volumeMl);
  return {
    brine,
    shelf: money(shelfCents(brine)),
    netShelf: money(netShelfCents(brine)),
    bottle: money(bottleCents),
    caseTotal: money(bottleCents * CASE_BOTTLES),
    pours:
      yieldInfo === null
        ? null
        : {
            count: yieldInfo.count,
            perServeMl: yieldInfo.perServeMl,
            title: yieldInfo.title,
            perPour: money(
              Number(
                divideRoundHalfAwayFromZero(
                  toBigInt(bottleCents),
                  toBigInt(yieldInfo.count),
                ),
              ),
            ),
          },
    supplyLimited: brine.supplyLimited,
  };
}

/** The whole published list, in range order. */
export const TRADE_LIST: readonly TradeRow[] = ALL_BRINES.map(rowFor);

/** "40%" — the discount, written the way it is written on the sheet. */
export function tradeDiscountPercent(): string {
  return `${String(TRADE_DISCOUNT_BASIS_POINTS / 100)}%`;
}

/** "15%" — the GST rate the shelf prices already include. */
export function gstPercent(): string {
  return `${String(GST_BASIS_POINTS / 100)}%`;
}
