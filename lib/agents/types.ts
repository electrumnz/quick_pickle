/**
 * The typed domain model of the agent runtime.
 *
 * Every union here mirrors an enum in
 * `supabase/migrations/20260101000300_agents.sql`. The SQL is the source of
 * truth; these are the TypeScript projection of it. If they drift, the store
 * layer fails loudly at the zod boundary rather than writing an invalid row.
 */

import type { JsonObject, JsonValue } from "./json";

/** `public.agent_status` */
export const AGENT_STATUSES = ["active", "paused", "retired"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * `public.agent_autonomy` — the autonomy dial.
 *
 * - `observe`          read-only; any write or external effect is refused outright.
 * - `propose`          every write raises an approval; nothing mutating runs unattended.
 * - `act_with_limits`  internal writes run inside the caps; storefront writes and
 *                      external effects still require approval.
 * - `autonomous`       internal writes run and are reported after the fact;
 *                      storefront writes and external effects STILL require approval.
 *
 * No dial position removes the approval requirement for a storefront write or an
 * external effect — that is the property `M27` pins down.
 */
export const AGENT_AUTONOMIES = ["observe", "propose", "act_with_limits", "autonomous"] as const;
export type AgentAutonomy = (typeof AGENT_AUTONOMIES)[number];

/** `public.agent_run_trigger` */
export const AGENT_RUN_TRIGGERS = [
  "schedule",
  "manual",
  "webhook",
  "chained",
  "retry",
  "approval",
] as const;
export type AgentRunTrigger = (typeof AGENT_RUN_TRIGGERS)[number];

/** `public.agent_run_status` */
export const AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** `public.agent_message_role` */
export const AGENT_MESSAGE_ROLES = ["system", "user", "assistant", "tool"] as const;
export type AgentMessageRole = (typeof AGENT_MESSAGE_ROLES)[number];

/** `public.tool_call_status` */
export const TOOL_CALL_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "rejected",
  "skipped",
] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

/** `public.approval_subject` */
export const APPROVAL_SUBJECTS = [
  "social_post",
  "email_outreach",
  "email_campaign",
  "content_asset",
  "price_change",
  "discount",
  "product_publish",
  "purchase_order",
  "inventory_adjustment",
  "batch_release",
  "recipe_change",
  "refund",
  "order_cancel",
  "review_reply",
  "customer_message",
  "settings_change",
  "agent_config",
] as const;
export type ApprovalSubject = (typeof APPROVAL_SUBJECTS)[number];

/** `public.approval_status` */
export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "superseded",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** `public.approval_risk` */
export const APPROVAL_RISKS = ["low", "medium", "high", "critical"] as const;
export type ApprovalRisk = (typeof APPROVAL_RISKS)[number];

/**
 * What a tool does to the world. This is the axis authorisation turns on.
 *
 * - `read`             observes only; no state changes anywhere.
 * - `business_write`   mutates our own records (drafts, notes, internal state).
 * - `storefront_write` mutates what customers see (products, prices, publishing).
 * - `external`         reaches outside the company (email, social, supplier orders).
 *
 * `storefront_write` and `external` are the two classes that can never run
 * without an approved `approvals` row, at any autonomy level.
 */
export const TOOL_EFFECTS = ["read", "business_write", "storefront_write", "external"] as const;
export type ToolEffect = (typeof TOOL_EFFECTS)[number];

/** Effect classes that always require an approved approvals row. */
export const ALWAYS_APPROVED_EFFECTS: readonly ToolEffect[] = ["storefront_write", "external"];

/** True when the effect class can never execute without human approval. */
export function alwaysRequiresApproval(effect: ToolEffect): boolean {
  return ALWAYS_APPROVED_EFFECTS.includes(effect);
}

/** Spend caps for one agent, in whole cents (NZD). */
export interface AgentBudget {
  /** Ceiling on a single run. */
  readonly perRunCents: number;
  /** Ceiling on everything this agent spends in one Pacific/Auckland day. */
  readonly dailyCents: number;
  /** Ceiling on everything this agent spends in one calendar month. */
  readonly monthlyCents: number;
  /**
   * Ceiling on the money value of a single action (an order, a discount).
   * Anything above it is escalated to approval regardless of autonomy.
   */
  readonly singleActionCents?: number;
}

/**
 * A role in the company, declared as data.
 *
 * Adding a new agent is a new `AgentDefinition`, never a new code path: the
 * runtime reads identity, prompt, tool grants, autonomy and budget off this
 * object and behaves accordingly.
 */
export interface AgentDefinition {
  /** Stable identifier, matches `agents.slug`. */
  readonly slug: string;
  readonly name: string;
  readonly jobTitle: string;
  /** One sentence: what this role exists to do. Shown in the admin. */
  readonly purpose: string;
  /** Anthropic model id, e.g. `claude-sonnet-4-5`. */
  readonly model: string;
  /** Role-specific instructions. Brand voice is loaded from `brand_rules`, not hardcoded. */
  readonly systemPrompt: string;
  /** Tool names this role may call. A tool outside this list is refused by the runtime. */
  readonly tools: readonly string[];
  readonly autonomy: AgentAutonomy;
  /** Approval subjects this role must always route through the queue. */
  readonly requiresApprovalFor: readonly ApprovalSubject[];
  readonly budget: AgentBudget;
  /** Ceiling on model calls in one run. */
  readonly maxSteps: number;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /**
   * Which `brand_rules.applies_to` scopes to load into the system prompt.
   * Empty means "all active rules".
   */
  readonly brandRuleScopes: readonly string[];
  readonly schedule?: { readonly cron: string; readonly timezone: string };
}

/** A row of `public.agents`. */
export interface AgentRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly jobTitle: string;
  readonly purpose: string;
  readonly model: string;
  readonly systemPrompt: string | null;
  readonly tools: readonly string[];
  readonly status: AgentStatus;
  readonly autonomy: AgentAutonomy;
  readonly requiresApprovalFor: readonly ApprovalSubject[];
  readonly dailySpendCapCents: number;
  readonly monthlySpendCapCents: number;
  readonly singleActionCapCents: number | null;
  readonly isEnabled: boolean;
}

/** A row of `public.agent_runs`. */
export interface RunRecord {
  readonly id: string;
  readonly agentId: string;
  readonly agentSlug: string;
  readonly parentRunId: string | null;
  readonly trigger: AgentRunTrigger;
  readonly status: AgentRunStatus;
  readonly goal: string;
  readonly outcome: string | null;
  readonly error: string | null;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
  readonly toolCallCount: number;
  readonly blockingApprovalId: string | null;
  /** Everything the run saw that was not a message: trigger params, loaded brand rules, config. */
  readonly context: JsonObject;
}

/** A row of `public.agent_messages`. */
export interface MessageRecord {
  readonly id: string;
  readonly runId: string;
  readonly seq: number;
  readonly role: AgentMessageRole;
  readonly content: string | null;
  /** The exact `ModelMessage` as sent to or received from the provider. */
  readonly contentJson: JsonValue | null;
  readonly toolName: string | null;
  readonly tokens: number | null;
  readonly model: string | null;
  readonly stopReason: string | null;
  readonly createdAt: string;
}

/** A row of `public.agent_tool_calls`. */
export interface ToolCallRecord {
  readonly id: string;
  readonly runId: string;
  readonly messageId: string | null;
  readonly seq: number;
  readonly toolName: string;
  readonly arguments: JsonObject;
  readonly result: JsonValue | null;
  readonly status: ToolCallStatus;
  readonly error: string | null;
  readonly isMutation: boolean;
  readonly approvalId: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/** A row of `public.approvals`. */
export interface ApprovalRecord {
  readonly id: string;
  readonly subjectType: ApprovalSubject;
  readonly subjectTable: string;
  readonly subjectId: string | null;
  readonly title: string;
  readonly summary: string;
  readonly rationale: string | null;
  /** The exact mutation to perform on approval. The applier reads this, never re-derives it. */
  readonly payload: JsonObject;
  readonly preview: JsonObject;
  readonly risk: ApprovalRisk;
  readonly amountCents: number | null;
  readonly currency: string;
  readonly status: ApprovalStatus;
  readonly requestedByAgentId: string | null;
  readonly requestedByRunId: string | null;
  readonly requestedAt: string;
  readonly expiresAt: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly appliedAt: string | null;
  readonly appliedResult: JsonValue | null;
}

/** A row of `public.agent_costs`. */
export interface CostRecord {
  readonly id: string;
  readonly agentId: string;
  readonly runId: string | null;
  readonly toolCallId: string | null;
  readonly incurredOn: string;
  readonly incurredAt: string;
  readonly provider: string;
  readonly model: string;
  readonly kind: "inference" | "embedding" | "image" | "search" | "storage" | "third_party";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costMicros: number;
  readonly currency: string;
  readonly note: string | null;
}

/** A row of `public.brand_rules`, as the runtime consumes it. */
export interface BrandRuleRecord {
  readonly slug: string;
  readonly kind: string;
  readonly severity: string;
  readonly title: string;
  readonly rule: string;
  readonly appliesTo: readonly string[];
  readonly keywords: readonly string[];
  readonly priority: number;
}
