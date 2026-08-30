/**
 * `lib/agents/roster` — everyone in the company except the founder.
 *
 * The runtime in `lib/agents` is the machinery; this is the staff. Eight roles,
 * each an `AgentDefinition` plus the plain-English metadata the admin renders,
 * all reading the same business database the founder reads.
 *
 * ```ts
 * const roster = await loadRoster(new SqlStrategyStore(sql));
 * const tools  = createRosterTools({ reads: new SqlBusinessReads(sql), outbox });
 * const platform = createAgentRuntime({ store, registry: tools.registry, models });
 * await registerRoster(platform.runtime, roster);
 * ```
 *
 * Nothing in here can send anything. `storefront_write` and `external` tools are
 * unexecutable without an approved `approvals` row — that is the runtime's
 * doing — and behind that gate they end in `outbox.ts`, which records and does
 * not deliver.
 */

export {
  ANALYST_ROLE_PROMPT,
  CONCIERGE_ROLE_PROMPT,
  DEFAULT_WINDOW_DAYS,
  FINANCE_ROLE_PROMPT,
  MARKETING_TOOLS,
  OPS_ROLE_PROMPT,
  PRODUCT_ROLE_PROMPT,
  SOCIAL_ROLE_PROMPT,
  TRADE_TOOLS,
  analystRole,
  conciergeRole,
  defineAnalystAgent,
  defineConciergeAgent,
  defineFinanceAgent,
  defineOpsAgent,
  defineProductAgent,
  defineSocialAgent,
  financeRole,
  grantRosterTools,
  marketingRole,
  opsRole,
  productRole,
  socialRole,
  tradeRole,
} from "./definitions";

export {
  ROSTER_SLUGS,
  buildRoster,
  grantedToolNames,
  loadRoster,
  registerRoster,
  roleFor,
  type Roster,
  type RosterSlug,
} from "./roster";

export {
  createRosterTools,
  type RosterToolPorts,
  type RosterTools,
} from "./tools";

export {
  RecordingOutbox,
  type DraftSink,
  type OutboxEntry,
  type OutboxKind,
  type OutboxReceipt,
} from "./outbox";

export {
  COVER_WARNING_DAYS,
  FULFILMENT_GRACE_DAYS,
  MARGIN_FLOOR_PCT,
  SqlBusinessReads,
  nzd,
  pgTextArray,
  type RosterSqlClient,
  type RosterSqlRow,
} from "./sql-reads";

export type {
  AccountMemory,
  BatchLine,
  BatchPlanReport,
  BusinessReads,
  CatalogueLine,
  ContentReport,
  ConversationReport,
  CustomerHistory,
  CustomerReplyProposal,
  Findings,
  IngredientLine,
  MarginLine,
  MarginReport,
  OpenConversation,
  PostLine,
  PriceChangeProposal,
  ProductConceptProposal,
  RangeReport,
  ReviewThemeLine,
  SalesReport,
  SkuSalesLine,
  SocialPostProposal,
  StockCoverLine,
  StockCoverReport,
  SupplierOrderProposal,
  TakingsReport,
  TradeAccountLine,
  TradeOutreachProposal,
  TradeReport,
  WeeklyPulse,
} from "./reads";

export type { Audience, RosterRole, RoutineStep } from "./types";

export {
  AUDIENCE_WORDS,
  AUTONOMY_BADGE,
  AUTONOMY_WORDS,
  EFFECT_WORDS,
  RUN_STATUS_WORDS,
  SUBJECT_WORDS,
  TOOL_WORDS,
  TRIGGER_WORDS,
  audienceWords,
  autonomyBadge,
  autonomyWords,
  runStatusWords,
  scheduleWords,
  subjectWords,
  toolWords,
  triggerWords,
} from "./presentation";
