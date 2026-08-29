/**
 * The persistence shapes for the strategy layer.
 *
 * These mirror `supabase/migrations/20260102000000_strategy.sql` one for one,
 * the same way `lib/agents/types.ts` mirrors the agent tables. The domain
 * types — `BrandScript`, `FlightPlan`, `MarketModel` — live in
 * `content/strategy/types.ts` and are not repeated here; a record is a row, and
 * a row carries a body which decodes into one of those.
 */

import type { Confidence, MarketUnit } from "@/content/strategy/types";

/** `public.strategy_framework` */
export const STRATEGY_FRAMEWORKS = [
  "flight_plan",
  "brandscript",
  "market_sizing",
] as const;
export type StrategyFramework = (typeof STRATEGY_FRAMEWORKS)[number];

/**
 * One row of `strategy_documents`.
 *
 * `body` is `unknown` on purpose: it arrives as `jsonb` and is only a
 * `BrandScript` or a `FlightPlan` once `lib/strategy/schema.ts` has said so.
 * Casting it here would move the lie one file earlier rather than removing it.
 */
export interface StrategyDocumentRecord {
  readonly slug: string;
  readonly framework: StrategyFramework;
  readonly title: string;
  /** The one plain sentence shown before the framework itself. */
  readonly purpose: string;
  readonly version: string;
  /** Agent scopes this document is loaded for. Empty means every agent. */
  readonly appliesTo: readonly string[];
  readonly priority: number;
  readonly body: unknown;
  readonly isActive: boolean;
  readonly updatedAt: string;
}

/**
 * One row of `strategy_assumptions` — a named, editable input to the market
 * model.
 *
 * `value` is exact: the column is a `bigint` of millionths, so 0.35 is stored
 * as 350000 and $21.00 as 2_100_000_000 (2,100 cents × 1e6). There is no float
 * anywhere between Postgres and the arithmetic, which is the same discipline
 * `agent_costs` uses for money.
 */
export interface StrategyAssumptionRecord {
  readonly slug: string;
  readonly label: string;
  readonly value: number;
  readonly unit: MarketUnit;
  readonly confidence: Confidence;
  readonly sourceId: string | null;
  readonly rationale: string;
  readonly minValue: number;
  readonly maxValue: number;
  readonly stepValue: number;
  readonly position: number;
  readonly isActive: boolean;
}

/** Millionths. The unit `strategy_assumptions.value_micro` is stored in. */
export const MICRO = 1_000_000;

export function toMicro(value: number): number {
  return Math.round(value * MICRO);
}

export function fromMicro(micro: number): number {
  return micro / MICRO;
}
