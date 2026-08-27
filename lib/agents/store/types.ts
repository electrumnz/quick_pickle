/**
 * The persistence port.
 *
 * The runtime writes the transcript as it happens, not at the end, so every
 * method here is a single append or a single patch — there is no "flush".
 * Two implementations exist: `InMemoryAgentStore` (tests, evidence) and
 * `SupabaseAgentStore` (production, writing the real `agent_*` tables).
 */

import type { JsonObject, JsonValue } from "../json";
import type {
  AgentAutonomy,
  AgentRecord,
  AgentRunStatus,
  AgentRunTrigger,
  ApprovalRecord,
  ApprovalRisk,
  ApprovalStatus,
  ApprovalSubject,
  AgentMessageRole,
  BrandRuleRecord,
  CostRecord,
  MessageRecord,
  RunRecord,
  ToolCallRecord,
  ToolCallStatus,
} from "../types";

export interface UpsertAgentInput {
  readonly slug: string;
  readonly name: string;
  readonly jobTitle: string;
  readonly purpose: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly tools: readonly string[];
  readonly autonomy: AgentAutonomy;
  readonly requiresApprovalFor: readonly ApprovalSubject[];
  readonly dailySpendCapCents: number;
  readonly monthlySpendCapCents: number;
  readonly singleActionCapCents: number | null;
}

export interface CreateRunInput {
  readonly agentId: string;
  readonly trigger: AgentRunTrigger;
  readonly goal: string;
  readonly parentRunId?: string | null;
  readonly context: JsonObject;
}

export interface UpdateRunPatch {
  readonly status?: AgentRunStatus;
  readonly outcome?: string | null;
  readonly error?: string | null;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
  readonly blockingApprovalId?: string | null;
  readonly addInputTokens?: number;
  readonly addOutputTokens?: number;
  readonly addCostMicros?: number;
  readonly addToolCalls?: number;
  readonly contextPatch?: JsonObject;
}

export interface AppendMessageInput {
  readonly runId: string;
  readonly role: AgentMessageRole;
  readonly content: string | null;
  readonly contentJson: JsonValue | null;
  readonly toolName?: string | null;
  readonly tokens?: number | null;
  readonly model?: string | null;
  readonly stopReason?: string | null;
}

export interface CreateToolCallInput {
  readonly runId: string;
  readonly messageId: string | null;
  readonly toolName: string;
  readonly arguments: JsonObject;
  readonly isMutation: boolean;
  readonly status: ToolCallStatus;
  readonly approvalId?: string | null;
  readonly startedAt?: string | null;
}

export interface UpdateToolCallPatch {
  readonly status?: ToolCallStatus;
  readonly result?: JsonValue | null;
  readonly error?: string | null;
  readonly approvalId?: string | null;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
}

export interface CreateApprovalInput {
  readonly subjectType: ApprovalSubject;
  readonly subjectTable: string;
  readonly subjectId?: string | null;
  readonly title: string;
  readonly summary: string;
  readonly rationale: string | null;
  readonly payload: JsonObject;
  readonly preview: JsonObject;
  readonly risk: ApprovalRisk;
  readonly amountCents?: number | null;
  readonly currency?: string;
  readonly requestedByAgentId: string | null;
  readonly requestedByRunId: string | null;
  readonly expiresAt?: string | null;
}

export interface DecideApprovalInput {
  readonly approvalId: string;
  readonly status: Extract<
    ApprovalStatus,
    "approved" | "rejected" | "cancelled" | "expired"
  >;
  readonly decidedBy: string | null;
  readonly decidedAt: string;
  readonly decisionNote: string | null;
}

export interface RecordCostInput {
  readonly agentId: string;
  readonly runId: string | null;
  readonly toolCallId: string | null;
  readonly incurredAt: string;
  readonly incurredOn: string;
  readonly provider: string;
  readonly model: string;
  readonly kind: CostRecord["kind"];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costMicros: number;
  readonly currency: string;
  readonly note: string | null;
}

export interface CostWindow {
  readonly agentId?: string;
  readonly runId?: string;
  /** Inclusive lower bound on `incurred_on` (YYYY-MM-DD). */
  readonly fromDate?: string;
  /** Inclusive upper bound on `incurred_on` (YYYY-MM-DD). */
  readonly toDate?: string;
}

export interface RunQuery {
  readonly agentId?: string;
  readonly agentSlug?: string;
  readonly status?: readonly AgentRunStatus[];
  readonly since?: string;
  readonly limit?: number;
}

export interface ApprovalQuery {
  readonly status?: readonly ApprovalStatus[];
  readonly runId?: string;
  readonly agentId?: string;
  readonly limit?: number;
}

/** An append-only line in `public.audit_log`. */
export interface AuditEntry {
  readonly actorType: "operator" | "agent" | "customer" | "system";
  readonly actorId: string | null;
  readonly actorLabel: string;
  readonly action:
    | "create"
    | "update"
    | "delete"
    | "approve"
    | "reject"
    | "publish"
    | "cancel"
    | "sync";
  readonly entityType: string;
  readonly entityId: string | null;
  readonly entityLabel: string | null;
  readonly summary: string;
  readonly beforeData: JsonValue | null;
  readonly afterData: JsonValue | null;
  readonly agentRunId: string | null;
  readonly approvalId: string | null;
}

/**
 * Everything the runtime needs from persistence. Nothing here is optional: a
 * store that cannot record a cost cannot enforce a cap.
 */
export interface AgentStore {
  upsertAgent(input: UpsertAgentInput): Promise<AgentRecord>;
  getAgentBySlug(slug: string): Promise<AgentRecord | null>;
  getAgentById(id: string): Promise<AgentRecord | null>;
  setAgentStatus(
    slug: string,
    status: AgentRecord["status"],
    isEnabled: boolean,
  ): Promise<void>;

  createRun(input: CreateRunInput): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | null>;
  updateRun(runId: string, patch: UpdateRunPatch): Promise<RunRecord>;
  listRuns(query: RunQuery): Promise<RunRecord[]>;

  appendMessage(input: AppendMessageInput): Promise<MessageRecord>;
  listMessages(runId: string): Promise<MessageRecord[]>;

  createToolCall(input: CreateToolCallInput): Promise<ToolCallRecord>;
  updateToolCall(
    id: string,
    patch: UpdateToolCallPatch,
  ): Promise<ToolCallRecord>;
  listToolCalls(runId: string): Promise<ToolCallRecord[]>;

  createApproval(input: CreateApprovalInput): Promise<ApprovalRecord>;
  getApproval(approvalId: string): Promise<ApprovalRecord | null>;
  decideApproval(input: DecideApprovalInput): Promise<ApprovalRecord>;
  listApprovals(query: ApprovalQuery): Promise<ApprovalRecord[]>;

  recordCost(input: RecordCostInput): Promise<CostRecord>;
  listCosts(window: CostWindow): Promise<CostRecord[]>;
  sumCostMicros(window: CostWindow): Promise<number>;

  getSetting(key: string): Promise<JsonValue | null>;
  setSetting(key: string, value: JsonValue, description: string): Promise<void>;

  listBrandRules(scopes: readonly string[]): Promise<BrandRuleRecord[]>;

  appendAudit(entry: AuditEntry): Promise<void>;
}
