/**
 * The sums behind "was this partnership worth it?". No database in here.
 *
 * There are two ways a partner gets paid, and often both at once:
 *
 *   a cut       a percentage of each sale they bring in, worked out per order
 *   a flat cost a fee for a post or a stall, or product given away
 *
 * What a partnership has COST is the flat costs plus the cut. The cut is
 * counted once: as what has been earned so far or what has been paid out,
 * whichever is more. (Paying somebody their cut does not make it cost twice.)
 *
 * What it BROUGHT IN is what customers paid on the orders credited to the
 * partner, delivery included, less anything refunded.
 *
 * The headline is sales back for each dollar spent. It is sales, not profit:
 * it does not take off what the product and the postage cost. The budget
 * (Plans) is where margin lives.
 */

export type CostKind = "fee" | "product" | "commission" | "other";

export const COST_KINDS = [
  "fee",
  "product",
  "commission",
  "other",
] as const satisfies readonly CostKind[];

export const COST_KIND_LABEL: Readonly<Record<CostKind, string>> = {
  fee: "A flat payment",
  product: "Product given away",
  commission: "Their cut, paid out",
  other: "Something else",
};

/** What the sales credited to a partner, a code or a link add up to. */
export type Takings = {
  /** Paid orders, not counting test orders or ones called off. */
  readonly orders: number;
  /** What customers paid on them, delivery included, less refunds. */
  readonly salesCents: number;
  /** What promo codes took off those orders: goods and delivery. */
  readonly discountCents: number;
  /** The partner's cut, earned on those orders. */
  readonly commissionCents: number;
  /** Orders from someone who had not bought before. */
  readonly newCustomers: number;
};

export const NO_TAKINGS: Takings = {
  orders: 0,
  salesCents: 0,
  discountCents: 0,
  commissionCents: 0,
  newCustomers: 0,
};

/** What has been written down as spent, by kind. */
export type Spend = Readonly<Record<CostKind, number>>;

export const NO_SPEND: Spend = { fee: 0, product: 0, commission: 0, other: 0 };

export type CollabReturn = {
  /** Flat payments, product and anything else. Not the cut. */
  readonly flatCents: number;
  /** The cut, counted once: earned or paid out, whichever is more. */
  readonly cutCents: number;
  /** Everything the partnership has cost. */
  readonly spendCents: number;
  /** Cut earned and not yet paid out. Never below nothing. */
  readonly cutOwingCents: number;
  /** Sales less what the partnership cost. Can be below nothing. */
  readonly afterCostsCents: number;
  /**
   * Sales that came back for each dollar spent, in cents: 379 is "$3.79 back
   * for every $1". Null when nothing has been spent, so there is nothing to
   * divide by.
   */
  readonly backPerDollarCents: number | null;
};

/**
 * One order's cut: a whole percentage of what the buyer paid for the goods
 * (after a code's saving and anything refunded, not counting delivery),
 * rounded to the nearest cent. The database does the same sum when it adds
 * orders up; this is here so the rule can be read and tested in one place.
 */
export function cutOn(
  order: {
    readonly subtotalCents: number;
    readonly discountCents: number;
    readonly refundedCents: number;
  },
  percent: number,
): number {
  const goods = Math.max(
    0,
    order.subtotalCents - order.discountCents - order.refundedCents,
  );
  return Math.floor((goods * percent + 50) / 100);
}

export function collabReturn(takings: Takings, spend: Spend): CollabReturn {
  const flatCents = spend.fee + spend.product + spend.other;
  const cutCents = Math.max(takings.commissionCents, spend.commission);
  const spendCents = flatCents + cutCents;
  return {
    flatCents,
    cutCents,
    spendCents,
    cutOwingCents: Math.max(0, takings.commissionCents - spend.commission),
    afterCostsCents: takings.salesCents - spendCents,
    backPerDollarCents:
      spendCents === 0
        ? null
        : Math.round((takings.salesCents * 100) / spendCents),
  };
}
