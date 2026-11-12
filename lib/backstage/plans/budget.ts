/**
 * The budget's sums: what a pack costs to make and send, what is left, and
 * how many packs a month cover the fixed costs.
 *
 * This is unit economics for deciding prices, not accounting. Xero keeps the
 * books.
 *
 * Every amount is a whole number of cents and every sum below is done in
 * whole numbers: there is no floating-point arithmetic anywhere in here.
 * Three things do not come out even, and each is rounded exactly once, in a
 * stated direction that never flatters the result:
 *
 *   a share of a sale (a card fee)   up, to the next whole cent
 *   a margin, as a percentage         down, to a tenth of a percent
 *   packs needed to break even        up, to a whole pack
 *
 * GST is the one exception to "against us": it is 3/23 of what the customer
 * pays, to the nearest cent, because that is the figure the shop itself uses
 * (`gstIncludedIn` in lib/shop/money.ts) and the two must never disagree.
 *
 * The model, so the page can say it plainly:
 *
 *   - One order holds one pack. An order with two packs does better than
 *     this, because the courier and the other per-order costs are shared.
 *   - Delivery is to a town address. The rural extra the customer pays is
 *     taken to be what the courier charges on top, so it washes out.
 *   - Costs are used as they were entered. A business that is registered for
 *     GST should enter them without GST (it gets that back); one that is not
 *     should enter what it actually pays.
 *   - Per-pack costs are the same for every pack size.
 */

export type CostBasis = "shot" | "pack" | "order" | "month" | "sale";

export type CostLine = {
  readonly basis: CostBasis;
  /** Cents, or hundredths of a percent when the basis is `sale`. */
  readonly amount: number;
  readonly confirmed?: boolean;
};

export type CostTotals = {
  readonly perShotCents: number;
  readonly perPackCents: number;
  readonly perOrderCents: number;
  readonly perMonthCents: number;
  /** Every share-of-sale line added up, in hundredths of a percent. */
  readonly saleShare: number;
  readonly lines: number;
  /** Lines that are still stand-ins, not from a real quote or invoice. */
  readonly unconfirmed: number;
};

/** What the customer is charged for delivery, and when it is free. */
export type DeliveryRule = {
  /** The flat rate. Nothing means delivery is free for everybody. */
  readonly standardCents: number;
  /** The order value that earns free delivery, or null when none does. */
  readonly freeOverCents: number | null;
};

export type PackInput = {
  readonly sku: string;
  readonly name: string;
  readonly shots: number;
  readonly priceCents: number;
};

export type PackEconomics = {
  readonly sku: string;
  readonly name: string;
  readonly shots: number;
  readonly gstRegistered: boolean;
  /** The pack's price on the site. */
  readonly priceCents: number;
  /** Delivery the customer pays on a one-pack order. Zero when it is free. */
  readonly deliveryChargedCents: number;
  /** Price plus delivery: everything the customer pays. */
  readonly paidCents: number;
  /** The GST inside what was paid. Zero when not registered. */
  readonly gstCents: number;
  /** What was paid, less GST: the money the business keeps. */
  readonly keptCents: number;
  readonly shotCostsCents: number;
  readonly packCostsCents: number;
  readonly orderCostsCents: number;
  /** Shares of the sale (card fees), on everything the customer paid. */
  readonly saleCostsCents: number;
  readonly costsCents: number;
  /** What is left of one sale after its costs. Can be below zero. */
  readonly leftCents: number;
  /**
   * What is left as a share of what is kept, in tenths of a percent, or null
   * when nothing is kept.
   */
  readonly marginTenths: number | null;
};

export type BreakEven = {
  readonly monthlyCents: number;
  /** How many packs are in one round of the chosen mix. */
  readonly mixPacks: number;
  /** What one round of the mix leaves after its own costs. */
  readonly mixLeftCents: number;
  /**
   * Packs to sell in a month, in the chosen mix, to cover the monthly costs.
   * Zero when there are none to cover; null when the mix leaves nothing, so
   * no number of packs ever gets there.
   */
  readonly packsPerMonth: number | null;
  /** The same thing by the week (52 weeks in 12 months). */
  readonly packsPerWeek: number | null;
};

function whole(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be a whole number`);
  }
  return value;
}

/** Whole-number division, rounded down (towards minus infinity). */
export function divideDown(amount: number, by: number): number {
  whole(amount, "amount");
  if (!Number.isSafeInteger(by) || by <= 0) {
    throw new RangeError("the divisor must be a whole number above zero");
  }
  const remainder = ((amount % by) + by) % by;
  return (amount - remainder) / by;
}

/** Whole-number division, rounded up. */
export function divideUp(amount: number, by: number): number {
  const down = divideDown(amount, by);
  return down * by === amount ? down : down + 1;
}

/** Whole-number division, to the nearest whole, halves up. */
export function divideNearest(amount: number, by: number): number {
  return divideDown(whole(2 * amount, "amount") + by, 2 * by);
}

export function totalCosts(costs: readonly CostLine[]): CostTotals {
  let perShotCents = 0;
  let perPackCents = 0;
  let perOrderCents = 0;
  let perMonthCents = 0;
  let saleShare = 0;
  let unconfirmed = 0;
  for (const line of costs) {
    const amount = whole(line.amount, "a cost");
    if (amount < 0) throw new RangeError("a cost cannot be below zero");
    if (line.confirmed !== true) unconfirmed += 1;
    switch (line.basis) {
      case "shot":
        perShotCents += amount;
        break;
      case "pack":
        perPackCents += amount;
        break;
      case "order":
        perOrderCents += amount;
        break;
      case "month":
        perMonthCents += amount;
        break;
      case "sale":
        saleShare += amount;
        break;
    }
  }
  return {
    perShotCents,
    perPackCents,
    perOrderCents,
    perMonthCents,
    saleShare,
    lines: costs.length,
    unconfirmed,
  };
}

/**
 * One pack, sold as a one-pack order: what comes in, what goes out and what
 * is left.
 */
export function packEconomics(
  pack: PackInput,
  totals: CostTotals,
  delivery: DeliveryRule,
  options: { readonly gstRegistered?: boolean } = {},
): PackEconomics {
  const gstRegistered = options.gstRegistered ?? false;
  const priceCents = whole(pack.priceCents, "a price");
  const shots = whole(pack.shots, "shots in a pack");
  if (priceCents < 0 || shots < 0) {
    throw new RangeError("a pack cannot have a price or a size below zero");
  }

  const deliveryChargedCents =
    delivery.freeOverCents !== null && priceCents >= delivery.freeOverCents
      ? 0
      : delivery.standardCents;
  const paidCents = priceCents + deliveryChargedCents;

  // 15% on top is 3/23 of the total. To the nearest cent, as the shop does.
  const gstCents = gstRegistered ? divideNearest(paidCents * 3, 23) : 0;
  const keptCents = paidCents - gstCents;

  const shotCostsCents = shots * totals.perShotCents;
  const packCostsCents = totals.perPackCents;
  const orderCostsCents = totals.perOrderCents;
  // A card fee is taken from everything charged, delivery and GST included.
  const saleCostsCents = divideUp(paidCents * totals.saleShare, 10_000);
  const costsCents =
    shotCostsCents + packCostsCents + orderCostsCents + saleCostsCents;

  const leftCents = keptCents - costsCents;
  const marginTenths =
    keptCents > 0 ? divideDown(leftCents * 1000, keptCents) : null;

  return {
    sku: pack.sku,
    name: pack.name,
    shots,
    gstRegistered,
    priceCents,
    deliveryChargedCents,
    paidCents,
    gstCents,
    keptCents,
    shotCostsCents,
    packCostsCents,
    orderCostsCents,
    saleCostsCents,
    costsCents,
    leftCents,
    marginTenths,
  };
}

/** How many of each pack sell together: `{ "QP-SHOT-06": 1, "QP-SHOT-12": 2 }`. */
export type Mix = Readonly<Record<string, number>>;

/** One of each: the mix to assume when nobody has said otherwise. */
export function evenMix(packs: readonly { readonly sku: string }[]): Mix {
  const mix: Record<string, number> = {};
  for (const pack of packs) mix[pack.sku] = 1;
  return mix;
}

/**
 * Packs a month needed to cover the monthly costs, when packs sell in the
 * given mix. A pack that is not in the mix, or has a weight of zero, is not
 * sold at all.
 */
export function breakEven(
  packs: readonly PackEconomics[],
  monthlyCents: number,
  mix: Mix,
): BreakEven {
  whole(monthlyCents, "the monthly costs");
  let mixPacks = 0;
  let mixLeftCents = 0;
  for (const pack of packs) {
    const weight = mix[pack.sku] ?? 0;
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new RangeError("a mix is whole numbers of packs, none below zero");
    }
    mixPacks += weight;
    mixLeftCents += weight * pack.leftCents;
  }

  if (monthlyCents <= 0) {
    return {
      monthlyCents,
      mixPacks,
      mixLeftCents,
      packsPerMonth: 0,
      packsPerWeek: 0,
    };
  }
  if (mixPacks === 0 || mixLeftCents <= 0) {
    return {
      monthlyCents,
      mixPacks,
      mixLeftCents,
      packsPerMonth: null,
      packsPerWeek: null,
    };
  }
  return {
    monthlyCents,
    mixPacks,
    mixLeftCents,
    packsPerMonth: divideUp(monthlyCents * mixPacks, mixLeftCents),
    packsPerWeek: divideUp(monthlyCents * mixPacks * 12, mixLeftCents * 52),
  };
}

/* ------------------------------------------------------- reading and saying */

/** "2.9" or "2.9%" as hundredths of a percent (290), or null if it is not one. */
export function parsePercent(text: string): number | null {
  const raw = text.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return null;
  const [wholePart = "0", fraction = ""] = raw.split(".");
  const value = Number(wholePart) * 100 + Number(fraction.padEnd(2, "0"));
  return value > 10_000 ? null : value;
}

/** Hundredths of a percent as a person writes it: 290 is "2.9%". */
export function formatShare(hundredths: number): string {
  whole(hundredths, "a share");
  const sign = hundredths < 0 ? "-" : "";
  const size = Math.abs(hundredths);
  const units = divideDown(size, 100);
  const rest = size - units * 100;
  if (rest === 0) return `${sign}${String(units)}%`;
  const decimals = String(rest).padStart(2, "0").replace(/0$/, "");
  return `${sign}${String(units)}.${decimals}%`;
}

/** Tenths of a percent as a person writes it: 425 is "42.5%". */
export function formatTenths(tenths: number): string {
  whole(tenths, "a percentage");
  const sign = tenths < 0 ? "-" : "";
  const size = Math.abs(tenths);
  const units = divideDown(size, 10);
  return `${sign}${String(units)}.${String(size - units * 10)}%`;
}

/** Cents as dollars, with a minus sign in front when below zero. */
export function formatSignedCents(cents: number): string {
  whole(cents, "an amount");
  const size = Math.abs(cents);
  const dollars = divideDown(size, 100);
  const rest = String(size - dollars * 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}$${dollars.toLocaleString("en-NZ")}.${rest}`;
}

/** Cents as the dollars-and-cents a form field shows: 1250 is "12.50". */
export function centsField(cents: number): string {
  whole(cents, "an amount");
  const dollars = divideDown(cents, 100);
  return `${String(dollars)}.${String(cents - dollars * 100).padStart(2, "0")}`;
}

/** Hundredths of a percent as a form field shows it: 290 is "2.9". */
export function shareField(hundredths: number): string {
  return formatShare(hundredths).replace(/%$/, "");
}
