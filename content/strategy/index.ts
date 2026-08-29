/**
 * The strategy layer, assembled.
 *
 * Three frameworks, one object. This is the shape that `lib/strategy` seeds
 * into Postgres, that the agent runtime loads back out as context, and that
 * `app/(admin)/admin/brand` renders. One shape, three consumers, so a change to
 * a BrandScript line reaches all three without anybody remembering to update
 * the other two.
 */

export * from "./types";
export { SOURCES, source } from "./sources";
export { BRAND_SCRIPT } from "./brandscript";
export {
  ESTIMATE,
  FLIGHT_PLAN,
  monthlyOverheadCents,
  weeklyHours,
  wingEconomics,
  type WingEconomics,
} from "./flight-plan";
export {
  MARKET,
  MARKET_HEADWINDS,
  MARKET_INPUTS,
  MARKET_NEXT_ACTIONS,
  computeMarket,
  formatCents,
  formatCentsShort,
  inputValue,
} from "./market";

import { BRAND_SCRIPT } from "./brandscript";
import { FLIGHT_PLAN } from "./flight-plan";
import { MARKET, MARKET_INPUTS } from "./market";
import { SOURCES } from "./sources";
import type { Strategy } from "./types";

/**
 * The canonical strategy as it stands in code.
 *
 * The database copy in `strategy_documents` is seeded from this and is allowed
 * to drift ahead of it — that is the point of storing it, since the founder can
 * edit a row and change what the agents say without a deploy.
 * `tests/strategy/seed-parity.test.ts` asserts the two match at the moment the
 * migration is written, so drift is a decision rather than an accident.
 */
export const STRATEGY: Strategy = {
  version: "1.0.0",
  updated: "2026-08-29",
  sources: SOURCES,
  inputs: MARKET_INPUTS,
  brandScript: BRAND_SCRIPT,
  flightPlan: FLIGHT_PLAN,
  market: MARKET,
};
