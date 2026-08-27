/**
 * The seam that lets one suite test any provider.
 *
 * A harness supplies three things: a live {@link CommerceProvider}, the fixture
 * identifiers the cases need (which SKU is in stock, which code is expired),
 * and a handful of *out-of-band* hooks — set the stock to exactly n, make a
 * cart look expired, write a bogus price straight into storage. Those hooks
 * exist because some properties can only be checked by cheating: you cannot
 * prove the server ignores a tampered price using an API that has no price
 * field.
 *
 * Every hook may answer {@link Unsupported} when the provider genuinely cannot
 * do that thing — Shopify has no way to backdate a cart's expiry — and the
 * cases that depend on it record themselves as skipped rather than failing.
 * That is what keeps the suite honest across providers instead of degrading
 * into "the tests that happen to pass on both".
 *
 * Pointing the suite at a new provider is one line: a new harness object.
 */

import type { CommerceProvider, SimulatedCheckoutAddress } from "../provider";
import type { Order } from "../types";

export type HookResult = "applied" | "unsupported";

export type ConformanceFixtures = {
  /** A tracked, well-stocked variant. Cases add and remove this freely. */
  readonly stockedVariantId: string;
  /** A second tracked variant, so multi-line carts are real. */
  readonly secondVariantId: string;
  /** A variant whose stock cases are allowed to drive to zero. */
  readonly scarceVariantId: string;
  readonly stockedVariantSku: string;
  /** Handle of a published product that appears in `listProducts`. */
  readonly productHandle: string;
  /** A word that appears in that product's searchable text. */
  readonly searchTerm: string;
  /** A tag every catalogue product carries. */
  readonly commonTag: string;
  /** A tag only some products carry, so `excludeTags` has something to bite on. */
  readonly exclusiveTag: string;
  readonly collectionHandle: string;
  /** An order-scoped percentage code, active, with a subtotal minimum. */
  readonly percentageCode: string;
  readonly percentageBasisPoints: number;
  readonly percentageMinimumCents: number;
  /** A code whose window has closed. */
  readonly expiredCode: string;
  /** A code that does not exist. */
  readonly unknownCode: string;
  readonly checkoutAddress: SimulatedCheckoutAddress;
  /** Email used for simulated checkouts. */
  readonly checkoutEmail: string;
};

export type ConformanceContext = {
  readonly providerName: string;
  readonly provider: CommerceProvider;
  readonly fixtures: ConformanceFixtures;

  /** Complete checkout however this provider can. */
  completeCheckout(cartId: string): Promise<Order>;

  /** Force a variant's sellable stock to exactly `quantity`. */
  setStock(variantId: string, quantity: number): Promise<HookResult>;

  /** Make a cart look as though its TTL has elapsed. */
  expireCart(cartId: string): Promise<HookResult>;

  /**
   * Write `unitPriceCents` onto a stored cart line, behind the provider's back.
   * Answers `unsupported` where storage is not reachable (Shopify), which is
   * itself a pass: a price you cannot reach is a price you cannot tamper with.
   */
  tamperLinePrice(
    cartId: string,
    variantId: string,
    unitPriceCents: number,
  ): Promise<HookResult>;

  /** Write bogus cached totals onto a stored cart. */
  tamperCartTotals(cartId: string, totalCents: number): Promise<HookResult>;
};

export type ConformanceHarness = {
  readonly name: string;
  setUp(): Promise<ConformanceContext>;
  tearDown(context: ConformanceContext): Promise<void>;
};
