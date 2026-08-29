/**
 * `lib/strategy` — the strategy layer, as the rest of the app sees it.
 *
 * `content/strategy` holds the three frameworks as typed data.
 * `supabase/migrations/20260102000000_strategy.sql` holds them as rows.
 * This module is the seam: it reads the rows, checks them, recomputes the
 * market model from the stored assumptions, and hands the result to whoever
 * asked — the agent runtime, or the Brand & Plan screens in the admin.
 */

export {
  composeStrategyBriefing,
  strategyFingerprint,
  type StrategyBriefingOptions,
} from "./context";
export {
  MARKETING_SCOPES,
  TRADE_SCOPES,
  defineMarketingAgent,
  defineTradeAgent,
  loadStrategyAgents,
  type StrategyAgents,
} from "./agents";
export {
  StrategyDecodeError,
  decodeBrandScript,
  decodeFlightPlan,
  decodeMarketNarrative,
  type MarketNarrative,
} from "./schema";
export {
  DOCUMENT_SCOPES,
  SqlStrategyStore,
  StaticStrategyStore,
  StrategyStoreError,
  assembleStrategy,
  assumptionToInput,
  staticDocuments,
  type StrategySqlClient,
  type StrategySqlRow,
  type StrategyStore,
} from "./store";
export {
  MICRO,
  STRATEGY_FRAMEWORKS,
  fromMicro,
  toMicro,
  type StrategyAssumptionRecord,
  type StrategyDocumentRecord,
  type StrategyFramework,
} from "./types";
