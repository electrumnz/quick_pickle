/**
 * `lib/strategy` — the strategy layer, as the rest of the app sees it.
 *
 * `content/strategy` holds the three frameworks as typed data.
 * `supabase/migrations/20260102000000_strategy.sql` holds them as rows.
 * This module is the seam: it reads the rows, checks them, recomputes the
 * market model from the stored assumptions, and hands the result to whoever
 * asked — the Brand & Plan screens in the admin.
 */

export {
  composeStrategyBriefing,
  strategyFingerprint,
  type StrategyBriefingOptions,
} from "./context";
export {
  AUDIT_CHECKS,
  HOME,
  LEAD_PRODUCT,
  PRODUCT_PATHS,
  PageIndex,
  RECIPES,
  SEVERITY_ORDER,
  SHOP,
  TRADE_PATHS,
  auditPaths,
  fixGroups,
  runAudit,
  type AuditCheck,
  type AuditFinding,
  type AuditRun,
  type AuditScore,
  type AuditSeverity,
  type CheckOutcome,
  type FixGroup,
} from "./audit";
export {
  fetchPage,
  fetchStorefront,
  pageLinks,
  pageTitle,
  visibleText,
  type PageFetcher,
  type PageLink,
  type RenderedPage,
  type StorefrontPages,
} from "./audit-pages";
export {
  StrategyDecodeError,
  decodeAvatar,
  decodeBrandScript,
  decodeFlightPlan,
  decodeMarketNarrative,
  type MarketNarrative,
} from "./schema";
export {
  AVATAR_SCOPES,
  DOCUMENT_SCOPES,
  SqlStrategyStore,
  StaticStrategyStore,
  StrategyStoreError,
  assembleAvatars,
  assembleStrategy,
  assumptionToInput,
  staticAvatars,
  staticDocuments,
  type StrategySqlClient,
  type StrategySqlRow,
  type StrategyStore,
} from "./store";
export {
  MICRO,
  STRATEGY_AUDIENCES,
  STRATEGY_FRAMEWORKS,
  fromMicro,
  toMicro,
  type StrategyAssumptionRecord,
  type StrategyAvatarRecord,
  type StrategyDocumentRecord,
  type StrategyFramework,
} from "./types";
