/**
 * The price book.
 *
 * List prices are quoted by Anthropic in USD per million tokens. The company's
 * books are in NZD, and `agent_costs.cost_micros` is an integer count of
 * millionths of one NZD — so everything is converted once, here, and never
 * touched as a float again after that.
 */

import {
  MICROS_PER_CENT,
  MICROS_PER_UNIT,
  TOKENS_PER_PRICING_UNIT,
} from "../constants";

/** USD list price for one model, per million tokens. */
export interface ModelPrice {
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
}

/**
 * Cached list prices. Source: the Anthropic pricing table current at the time
 * of writing (2026-06-24 snapshot), and for the gateway models the Vercel AI
 * Gateway catalogue (`GET https://ai-gateway.vercel.sh/v1/models`, read
 * 2026-08-30). Unknown models fall back to {@link FALLBACK_PRICE}, which is
 * deliberately the most expensive tier so an unpriced model over-reports rather
 * than silently costing nothing.
 *
 * ## The free models are priced anyway, and that is deliberate
 *
 * `minimax/minimax-m3-free` and `minimax/minimax-m2.7-free` bill at zero while
 * the GMI Cloud promotion runs. They are entered here at the list price of their
 * paid twins — `minimax/minimax-m3` and `minimax/minimax-m2.7`, both
 * $0.30/$1.20 per million in the same catalogue — because a cap measured against
 * zero is not a cap. Every ceiling in `cost/meter.ts` multiplies tokens by a
 * price; price the tokens at nothing and all four ceilings quietly stop existing
 * on the exact day the company first lets a real model call real tools.
 *
 * So the meter charges what the tokens *would* cost. Two consequences worth
 * being plain about: the ledger over-states actual spend for as long as the
 * promotion lasts, and every cost row for a promotional model says so in its
 * note (see {@link isPromotionalModel}). What it buys is that nothing about the
 * budgets changes on the day the promotion ends — the caps were already sized
 * for the real price.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze(
  {
    // MiniMax, via the Vercel AI Gateway. The `-free` ids are shadow-priced at
    // their paid twins' rate; see the note above.
    "minimax/minimax-m3": { inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2 },
    "minimax/minimax-m3-free": {
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 1.2,
    },
    "minimax/minimax-m2.7": {
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 1.2,
    },
    "minimax/minimax-m2.7-free": {
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 1.2,
    },
    "claude-fable-5": { inputUsdPerMillion: 10, outputUsdPerMillion: 50 },
    "claude-mythos-5": { inputUsdPerMillion: 10, outputUsdPerMillion: 50 },
    "claude-opus-5": { inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
    "claude-opus-4-8": { inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
    "claude-opus-4-7": { inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
    "claude-opus-4-6": { inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
    "claude-sonnet-5": { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
    "claude-sonnet-4-6": { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    "claude-haiku-4-5": { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
  },
);

/** Used when a model id is not in the book. Priced at the top tier on purpose. */
export const FALLBACK_PRICE: ModelPrice = Object.freeze({
  inputUsdPerMillion: 10,
  outputUsdPerMillion: 50,
});

/** Cache reads bill at roughly a tenth of the uncached input rate. */
export const CACHE_READ_MULTIPLIER = 0.1;
/** Cache writes bill at roughly 1.25x the uncached input rate (5-minute TTL). */
export const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * NZD per USD used to convert list prices into the ledger currency.
 * Override with `AGENT_FX_NZD_PER_USD` when the rate moves materially; the rate
 * in force is recorded on every cost row's note so old rows stay explicable.
 */
export const DEFAULT_FX_NZD_PER_USD = 1.65;

/** Token counts for one model call. */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/** Look a model up, falling back to the top tier when it is unknown. */
export function priceFor(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? FALLBACK_PRICE;
}

/** True when the model is priced explicitly rather than by fallback. */
export function isPricedModel(model: string): boolean {
  return Object.hasOwn(MODEL_PRICES, model);
}

/**
 * True when the model bills at zero today but is charged here at list price.
 *
 * Used to mark the cost row, so a ledger that says NZ$0.004 against a call that
 * cost nothing explains itself on the row rather than in a comment nobody
 * reading the books will see.
 */
export function isPromotionalModel(model: string): boolean {
  return model.endsWith("-free");
}

/**
 * Cost of one model call, in NZD micros (millionths of one dollar), rounded up.
 *
 * Rounding up matters: a cap must never be beaten by accumulated rounding-down
 * across thousands of small calls.
 */
export function costMicrosFor(
  model: string,
  usage: TokenUsage,
  fxNzdPerUsd: number = DEFAULT_FX_NZD_PER_USD,
): number {
  const price = priceFor(model);
  const usdPerToken = (perMillion: number): number =>
    perMillion / TOKENS_PER_PRICING_UNIT;
  const usd =
    usage.inputTokens * usdPerToken(price.inputUsdPerMillion) +
    usage.outputTokens * usdPerToken(price.outputUsdPerMillion) +
    usage.cacheReadTokens *
      usdPerToken(price.inputUsdPerMillion) *
      CACHE_READ_MULTIPLIER +
    usage.cacheWriteTokens *
      usdPerToken(price.inputUsdPerMillion) *
      CACHE_WRITE_MULTIPLIER;
  return Math.ceil(usd * fxNzdPerUsd * MICROS_PER_UNIT);
}

/** Convert whole cents to micros. */
export function centsToMicros(cents: number): number {
  return cents * MICROS_PER_CENT;
}

/** Convert micros to whole cents, rounding up so a cap is never under-reported. */
export function microsToCents(micros: number): number {
  return Math.ceil(micros / MICROS_PER_CENT);
}

/** Human-readable NZD, for logs and the admin. */
export function formatMicrosNzd(micros: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
  }).format(micros / MICROS_PER_UNIT);
}

/**
 * Worst-case cost of a call that has not happened yet.
 *
 * The meter checks this *before* the call, so a run that would blow its cap is
 * stopped before the money is spent rather than after.
 */
export function projectedCostMicros(params: {
  readonly model: string;
  readonly promptTokens: number;
  readonly maxOutputTokens: number;
  readonly fxNzdPerUsd?: number;
}): number {
  return costMicrosFor(
    params.model,
    {
      inputTokens: params.promptTokens,
      outputTokens: params.maxOutputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    params.fxNzdPerUsd ?? DEFAULT_FX_NZD_PER_USD,
  );
}
