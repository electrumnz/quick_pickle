/**
 * Server-side pricing. The single authority on what a cart costs.
 *
 * Nothing in this file reads a price from a caller. Every figure is derived
 * from `product_variants.price_cents` and `discounts` as they exist in the
 * database at the moment of the call. That is the whole defence against a
 * tampered client: there is no price input to tamper with, and the stored
 * `carts.subtotal_cents` / `total_cents` columns are a *cache* that is
 * overwritten on every read and every mutation, never trusted.
 *
 * All arithmetic is integer minor units via `../money`. No `Math.round`, no
 * floating point, anywhere below.
 */

import {
  allocateProportionally,
  applyBasisPoints,
  NZ_GST_BASIS_POINTS,
  taxIncludedInTotal,
} from "../money";
import type { CommerceErrorCode } from "../errors";
import type { CustomerType, DiscountScope, DiscountValueType } from "../types";

/** A cart line as pricing sees it: quantities and catalogue prices, nothing else. */
export type PricedLineInput = {
  readonly lineId: string;
  readonly variantId: string;
  readonly productId: string;
  readonly quantity: number;
  /** Read from `product_variants.price_cents` in this same statement. */
  readonly catalogueUnitPriceCents: number;
  /** Collections the line's product belongs to, for collection-scoped codes. */
  readonly collectionIds: readonly string[];
};

export type DiscountRule = {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly valueType: DiscountValueType;
  readonly valueBasisPoints: number | null;
  readonly valueCents: number | null;
  readonly appliesTo: DiscountScope;
  readonly targetProductId: string | null;
  readonly targetCollectionId: string | null;
  readonly minimumSubtotalCents: number | null;
  readonly minimumQuantity: number | null;
  readonly customerTypeRestriction: CustomerType | null;
  readonly oncePerCustomer: boolean;
  readonly usageLimit: number | null;
  readonly usageLimitPerCustomer: number | null;
  readonly usedCount: number;
  readonly status: "draft" | "scheduled" | "active" | "expired" | "disabled";
  readonly startsAt: string;
  readonly endsAt: string | null;
};

export type DiscountContext = {
  readonly now: Date;
  readonly customerType: CustomerType | null;
  /** How many times this customer has already redeemed this code. */
  readonly customerRedemptions: number;
};

export type DiscountOutcome = {
  readonly applicable: boolean;
  readonly rejectionCode: CommerceErrorCode | null;
  readonly rejectionMessage: string | null;
  /** Amount taken off the merchandise subtotal. Never exceeds it. */
  readonly amountCents: number;
  /** True for a `free_shipping` code: shipping is zeroed at checkout instead. */
  readonly freeShipping: boolean;
  /** Per-line share of `amountCents`, index-aligned with the input lines. */
  readonly lineAllocations: readonly number[];
};

function reject(
  code: CommerceErrorCode,
  message: string,
  lineCount: number,
): DiscountOutcome {
  return {
    applicable: false,
    rejectionCode: code,
    rejectionMessage: message,
    amountCents: 0,
    freeShipping: false,
    lineAllocations: new Array<number>(lineCount).fill(0),
  };
}

function lineSubtotal(line: PricedLineInput): number {
  return line.catalogueUnitPriceCents * line.quantity;
}

function isEligible(rule: DiscountRule, line: PricedLineInput): boolean {
  switch (rule.appliesTo) {
    case "product":
      return line.productId === rule.targetProductId;
    case "collection":
      return (
        rule.targetCollectionId !== null &&
        line.collectionIds.includes(rule.targetCollectionId)
      );
    case "order":
    case "shipping":
      return true;
  }
}

/**
 * Decide whether a discount applies to these lines and, if so, how much it
 * takes off each of them.
 *
 * The rejection codes line up with Shopify's `CartWarningCode` DISCOUNT_* set
 * (see `SHOPIFY_CART_WARNING_CODE_MAP`), so the storefront's copy for "that
 * code has expired" is written once and works on either provider.
 */
export function evaluateDiscount(
  rule: DiscountRule,
  lines: readonly PricedLineInput[],
  context: DiscountContext,
): DiscountOutcome {
  const count = lines.length;

  if (rule.status === "draft" || rule.status === "disabled") {
    return reject(
      "DISCOUNT_INACTIVE",
      `${rule.code} is not currently active`,
      count,
    );
  }

  const startsAt = new Date(rule.startsAt);
  if (context.now < startsAt) {
    return reject(
      "DISCOUNT_INACTIVE",
      `${rule.code} does not start until ${startsAt.toISOString()}`,
      count,
    );
  }
  if (rule.endsAt !== null && context.now >= new Date(rule.endsAt)) {
    return reject("DISCOUNT_EXPIRED", `${rule.code} has expired`, count);
  }
  if (rule.status === "expired") {
    return reject("DISCOUNT_EXPIRED", `${rule.code} has expired`, count);
  }

  if (rule.usageLimit !== null && rule.usedCount >= rule.usageLimit) {
    return reject(
      "DISCOUNT_USAGE_LIMIT_REACHED",
      `${rule.code} has been fully redeemed`,
      count,
    );
  }

  const perCustomerLimit = rule.oncePerCustomer
    ? 1
    : rule.usageLimitPerCustomer;
  if (
    perCustomerLimit !== null &&
    context.customerRedemptions >= perCustomerLimit
  ) {
    return reject(
      "DISCOUNT_CUSTOMER_USAGE_LIMIT_REACHED",
      `${rule.code} has already been used on this account`,
      count,
    );
  }

  if (
    rule.customerTypeRestriction !== null &&
    context.customerType !== rule.customerTypeRestriction
  ) {
    return reject(
      "DISCOUNT_CUSTOMER_NOT_ELIGIBLE",
      `${rule.code} is only for ${rule.customerTypeRestriction} accounts`,
      count,
    );
  }

  const eligible = lines.map((line) => isEligible(rule, line));
  const eligibleSubtotal = lines.reduce(
    (sum, line, index) =>
      eligible[index] === true ? sum + lineSubtotal(line) : sum,
    0,
  );
  const eligibleQuantity = lines.reduce(
    (sum, line, index) =>
      eligible[index] === true ? sum + line.quantity : sum,
    0,
  );

  if (eligibleQuantity === 0) {
    return reject(
      "DISCOUNT_NOT_APPLICABLE",
      `${rule.code} does not apply to anything in this cart`,
      count,
    );
  }
  if (
    rule.minimumSubtotalCents !== null &&
    eligibleSubtotal < rule.minimumSubtotalCents
  ) {
    return reject(
      "DISCOUNT_MINIMUM_NOT_MET",
      `${rule.code} needs a subtotal of at least ${String(rule.minimumSubtotalCents)} cents`,
      count,
    );
  }
  if (
    rule.minimumQuantity !== null &&
    eligibleQuantity < rule.minimumQuantity
  ) {
    return reject(
      "DISCOUNT_MINIMUM_NOT_MET",
      `${rule.code} needs at least ${String(rule.minimumQuantity)} items`,
      count,
    );
  }

  if (rule.valueType === "free_shipping") {
    return {
      applicable: true,
      rejectionCode: null,
      rejectionMessage: null,
      amountCents: 0,
      freeShipping: true,
      lineAllocations: new Array<number>(count).fill(0),
    };
  }

  let amountCents: number;
  if (rule.valueType === "percentage") {
    const basisPoints = rule.valueBasisPoints ?? 0;
    amountCents = applyBasisPoints(eligibleSubtotal, basisPoints);
  } else {
    amountCents = Math.min(rule.valueCents ?? 0, eligibleSubtotal);
  }
  amountCents = Math.min(amountCents, eligibleSubtotal);

  // Largest-remainder allocation: the per-line parts sum back to exactly
  // `amountCents`, so `sum(order_items.discount_cents) = orders.discount_cents`
  // holds by construction rather than by luck.
  const weights = lines.map((line, index) =>
    eligible[index] === true ? lineSubtotal(line) : 0,
  );
  const lineAllocations = allocateProportionally(amountCents, weights);

  return {
    applicable: true,
    rejectionCode: null,
    rejectionMessage: null,
    amountCents,
    freeShipping: false,
    lineAllocations,
  };
}

export type CartTotals = {
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly lineSubtotals: readonly number[];
  readonly lineDiscounts: readonly number[];
};

/**
 * Cart totals.
 *
 * Shipping and tax are zero here, deliberately: neither is knowable until the
 * hosted checkout has an address and a shipping method. Shopify deprecated
 * `CartCost.totalTaxAmount` for the same reason. `Cart.cost.*Estimated` is how
 * that uncertainty reaches the UI.
 */
export function computeCartTotals(
  lines: readonly PricedLineInput[],
  discount: DiscountOutcome | null,
): CartTotals {
  const lineSubtotals = lines.map(lineSubtotal);
  const subtotalCents = lineSubtotals.reduce((sum, value) => sum + value, 0);
  const lineDiscounts =
    discount === null || !discount.applicable
      ? new Array<number>(lines.length).fill(0)
      : [...discount.lineAllocations];
  const discountCents = Math.min(
    lineDiscounts.reduce((sum, value) => sum + value, 0),
    subtotalCents,
  );
  return {
    subtotalCents,
    discountCents,
    shippingCents: 0,
    taxCents: 0,
    totalCents: subtotalCents - discountCents,
    lineSubtotals,
    lineDiscounts,
  };
}

/**
 * The mock's stand-in for Shopify's shipping rates.
 *
 * A real rate card lives in the Shopify admin and is applied by the hosted
 * checkout; this exists only so the simulated checkout produces a plausible
 * order rather than always shipping free. Free over $90, $8.50 otherwise.
 */
export const NZ_FREE_SHIPPING_THRESHOLD_CENTS = 9000;
export const NZ_STANDARD_SHIPPING_CENTS = 850;

export function defaultShippingCents(merchandiseTotalCents: number): number {
  return merchandiseTotalCents >= NZ_FREE_SHIPPING_THRESHOLD_CENTS
    ? 0
    : NZ_STANDARD_SHIPPING_CENTS;
}

export type OrderTotals = {
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly lineDiscounts: readonly number[];
  readonly lineTotals: readonly number[];
  readonly lineTaxes: readonly number[];
};

/**
 * Order totals, satisfying the schema's `orders_total_balances` and
 * `order_items_line_balances` constraints by construction.
 *
 * NZ prices are GST-inclusive, so `taxCents` is the GST *contained in*
 * `totalCents`, not something added to it — which is exactly what
 * `tax_inclusive = true` means in the orders table.
 */
export function computeOrderTotals(
  lines: readonly PricedLineInput[],
  discount: DiscountOutcome | null,
  shippingCentsInput: number | null,
  taxRateBasisPoints: number = NZ_GST_BASIS_POINTS,
): OrderTotals {
  const cart = computeCartTotals(lines, discount);
  const merchandiseTotal = cart.totalCents;
  const baseShipping =
    shippingCentsInput ?? defaultShippingCents(merchandiseTotal);
  const shippingCents =
    discount !== null && discount.applicable && discount.freeShipping
      ? 0
      : baseShipping;
  const totalCents = merchandiseTotal + shippingCents;
  const lineTotals = cart.lineSubtotals.map(
    (subtotal, index) => subtotal - (cart.lineDiscounts[index] ?? 0),
  );
  return {
    subtotalCents: cart.subtotalCents,
    discountCents: cart.discountCents,
    shippingCents,
    taxCents: taxIncludedInTotal(totalCents, taxRateBasisPoints),
    totalCents,
    lineDiscounts: cart.lineDiscounts,
    lineTotals,
    lineTaxes: lineTotals.map((value) =>
      taxIncludedInTotal(value, taxRateBasisPoints),
    ),
  };
}
