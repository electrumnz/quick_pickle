/**
 * The HALF SOUR agent runtime.
 *
 * Every AI role in the company runs on this. A role is an
 * {@link AgentDefinition} — identity, prompt, tool grants, autonomy, budget —
 * and nothing else; the behaviour around it (authorisation, approvals, cost
 * caps, the kill switch, transcript persistence, replay) lives here and is
 * identical for every role.
 *
 * Deliberately NOT exported: `mintEffectGrant`. Minting a capability is the
 * runtime's job alone, and the only caller is `ApprovalService.grantFor`, which
 * requires an approved `approvals` row covering the exact arguments.
 */

export { canonicalJson, fingerprint } from "./canonical";
export { FixedClock, systemClock, type Clock } from "./clock";
export {
  APPROVAL_WAIT_TIMEOUT,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_STEPS,
  EFFECT_GRANT_TTL_MS,
  MICROS_PER_CENT,
} from "./constants";
export {
  AgentRuntimeError,
  ApprovalGateError,
  CostCapError,
  HaltedError,
  ToolAuthorisationError,
  isAgentRuntimeError,
  type RuntimeErrorCode,
} from "./errors";
export {
  defineAgent,
  definitionToAgentRow,
  mergeDefinitionWithRecord,
} from "./definition";
export type { AgentDefinitionInput } from "./definition";
export {
  createConsoleLogger,
  MemoryLogger,
  silentLogger,
  type AgentLogRecord,
  type AgentLogger,
} from "./logger";
export type { JsonObject, JsonValue } from "./json";

export { ApprovalService } from "./approvals/service";
export {
  ControlWatcher,
  KILL_SWITCH_SETTING_KEY,
  StoreControlPlane,
  assertNotHalted,
  type ControlPlane,
  type ControlVerdict,
  type KillSwitchState,
} from "./control/kill-switch";
export {
  CostMeter,
  DEFAULT_GLOBAL_MONTHLY_CAP_CENTS,
  GLOBAL_MONTHLY_CAP_SETTING_KEY,
  ledgerDate,
  ledgerMonthStart,
  type CapKind,
  type CapVerdict,
} from "./cost/meter";
export {
  MODEL_PRICES,
  centsToMicros,
  costMicrosFor,
  formatMicrosNzd,
  microsToCents,
  type ModelPrice,
} from "./cost/pricing";

export {
  ScriptedModel,
  type ScriptedFinishReason,
  type ScriptedTurn,
} from "./model/mock";
export {
  DEFAULT_AGENT_MODEL,
  createAnthropicResolver,
  createScriptedResolver,
  modelIdFromEnv,
  resolverFromEnv,
  type ModelResolver,
} from "./model/provider";

export { InMemoryAgentStore } from "./store/memory-store";
export {
  SupabaseAgentStore,
  createServiceClient,
} from "./store/supabase-store";
export type { AgentStore, AuditEntry, RunQuery } from "./store/types";

export {
  ToolRegistry,
  defineTool,
  invokeTool,
  type ApprovalPresentation,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolSpec,
} from "./tools/registry";
export {
  approvalRequirement,
  assertToolAccess,
  checkToolAccess,
  resolveRisk,
  type AccessVerdict,
  type ApprovalRequirement,
} from "./tools/authorization";
export {
  assertGrantUsable,
  consumeEffectGrant,
  describeGrant,
  type EffectGrant,
} from "./tools/effects";
export {
  createReferenceTools,
  type ReferencePorts,
  type ReferenceTools,
} from "./tools/builtin/reference";

export {
  AgentRuntime,
  type GateOutcome,
  type RunSummary,
  type TurnOutcome,
} from "./runtime/runtime";
export {
  RunHistory,
  type RunExplanation,
  type RunListItem,
} from "./runtime/history";
export {
  renderReplay,
  replay,
  type RunReplay,
  type TimelineEntry,
} from "./runtime/replay";
export {
  composeSystemPrompt,
  estimateTokens,
  reconstructPrompt,
  type ReconstructedPrompt,
} from "./runtime/prompt";

export {
  createAgentRuntime,
  createProductionRuntime,
  type AgentPlatform,
} from "./factory";

export * from "./types";
