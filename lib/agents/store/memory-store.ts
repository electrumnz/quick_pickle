/**
 * In-memory implementation of {@link AgentStore}.
 *
 * It is not a stub: it enforces the same invariants the SQL check constraints
 * do (terminal runs carry a finish time, a failed run carries an error, a
 * rejected approval carries a note, message `seq` is unique per run,
 * `agent_tool_calls.rejected` carries an approval id). A test that passes here
 * would pass against Postgres, which is what makes it usable as evidence.
 */

import { randomUUID } from "node:crypto";

import type { Clock } from "../clock";
import { AgentRuntimeError } from "../errors";
import type { JsonObject, JsonValue } from "../json";
import type {
  AgentRecord,
  ApprovalRecord,
  BrandRuleRecord,
  CostRecord,
  MessageRecord,
  RunRecord,
  ToolCallRecord,
} from "../types";
import type {
  AgentStore,
  AppendMessageInput,
  ApprovalQuery,
  AuditEntry,
  CostWindow,
  CreateApprovalInput,
  CreateRunInput,
  CreateToolCallInput,
  DecideApprovalInput,
  RecordCostInput,
  RunQuery,
  UpdateRunPatch,
  UpdateToolCallPatch,
  UpsertAgentInput,
} from "./types";

const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const TERMINAL_TOOL_STATUSES = new Set([
  "succeeded",
  "failed",
  "rejected",
  "skipped",
]);

/** A recorded audit line, kept so tests can assert on the trail. */
export interface StoredAudit extends AuditEntry {
  readonly id: number;
  readonly occurredAt: string;
}

export class InMemoryAgentStore implements AgentStore {
  private readonly agents = new Map<string, AgentRecord>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly messages = new Map<string, MessageRecord[]>();
  private readonly toolCalls = new Map<string, ToolCallRecord[]>();
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly costs: CostRecord[] = [];
  private readonly settings = new Map<string, JsonValue>();
  private readonly brandRules: BrandRuleRecord[] = [];
  readonly audit: StoredAudit[] = [];

  constructor(private readonly clock: Clock) {}

  /** Seed brand rules the same way `brand_rules` would supply them. */
  seedBrandRules(rules: readonly BrandRuleRecord[]): void {
    this.brandRules.push(...rules);
  }

  async upsertAgent(input: UpsertAgentInput): Promise<AgentRecord> {
    const existing = [...this.agents.values()].find(
      (agent) => agent.slug === input.slug,
    );
    const record: AgentRecord = {
      id: existing?.id ?? randomUUID(),
      slug: input.slug,
      name: input.name,
      jobTitle: input.jobTitle,
      purpose: input.purpose,
      model: input.model,
      systemPrompt: input.systemPrompt,
      tools: [...input.tools],
      status: existing?.status ?? "active",
      autonomy: input.autonomy,
      requiresApprovalFor: [...input.requiresApprovalFor],
      dailySpendCapCents: input.dailySpendCapCents,
      monthlySpendCapCents: input.monthlySpendCapCents,
      singleActionCapCents: input.singleActionCapCents,
      isEnabled: existing?.isEnabled ?? true,
    };
    this.agents.set(record.id, record);
    return record;
  }

  async getAgentBySlug(slug: string): Promise<AgentRecord | null> {
    return (
      [...this.agents.values()].find((agent) => agent.slug === slug) ?? null
    );
  }

  async getAgentById(id: string): Promise<AgentRecord | null> {
    return this.agents.get(id) ?? null;
  }

  async setAgentStatus(
    slug: string,
    status: AgentRecord["status"],
    isEnabled: boolean,
  ): Promise<void> {
    const agent = await this.getAgentBySlug(slug);
    if (agent === null) {
      throw new AgentRuntimeError(
        "agent_not_found",
        `No agent with slug "${slug}".`,
        { slug },
      );
    }
    this.agents.set(agent.id, { ...agent, status, isEnabled });
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const agent = await this.getAgentById(input.agentId);
    if (agent === null) {
      throw new AgentRuntimeError(
        "agent_not_found",
        `No agent with id "${input.agentId}".`,
        {
          agentId: input.agentId,
        },
      );
    }
    const record: RunRecord = {
      id: randomUUID(),
      agentId: input.agentId,
      agentSlug: agent.slug,
      parentRunId: input.parentRunId ?? null,
      trigger: input.trigger,
      status: "queued",
      goal: input.goal,
      outcome: null,
      error: null,
      queuedAt: this.clock.now().toISOString(),
      startedAt: null,
      finishedAt: null,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      toolCallCount: 0,
      blockingApprovalId: null,
      context: input.context,
    };
    this.runs.set(record.id, record);
    this.messages.set(record.id, []);
    this.toolCalls.set(record.id, []);
    return record;
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  async updateRun(runId: string, patch: UpdateRunPatch): Promise<RunRecord> {
    const current = this.runs.get(runId);
    if (current === undefined) {
      throw new AgentRuntimeError(
        "run_not_found",
        `No run with id "${runId}".`,
        { runId },
      );
    }
    const next: RunRecord = {
      ...current,
      status: patch.status ?? current.status,
      outcome: patch.outcome === undefined ? current.outcome : patch.outcome,
      error: patch.error === undefined ? current.error : patch.error,
      startedAt:
        patch.startedAt === undefined ? current.startedAt : patch.startedAt,
      finishedAt:
        patch.finishedAt === undefined ? current.finishedAt : patch.finishedAt,
      blockingApprovalId:
        patch.blockingApprovalId === undefined
          ? current.blockingApprovalId
          : patch.blockingApprovalId,
      inputTokens: current.inputTokens + (patch.addInputTokens ?? 0),
      outputTokens: current.outputTokens + (patch.addOutputTokens ?? 0),
      costMicros: current.costMicros + (patch.addCostMicros ?? 0),
      toolCallCount: current.toolCallCount + (patch.addToolCalls ?? 0),
      context:
        patch.contextPatch === undefined
          ? current.context
          : { ...current.context, ...patch.contextPatch },
    };
    assertRunInvariants(next);
    this.runs.set(runId, next);
    return next;
  }

  async listRuns(query: RunQuery): Promise<RunRecord[]> {
    let rows = [...this.runs.values()];
    if (query.agentId !== undefined) {
      rows = rows.filter((run) => run.agentId === query.agentId);
    }
    if (query.agentSlug !== undefined) {
      rows = rows.filter((run) => run.agentSlug === query.agentSlug);
    }
    if (query.status !== undefined) {
      const wanted = new Set(query.status);
      rows = rows.filter((run) => wanted.has(run.status));
    }
    if (query.since !== undefined) {
      const since = Date.parse(query.since);
      rows = rows.filter((run) => Date.parse(run.queuedAt) >= since);
    }
    rows.sort(
      (left, right) => Date.parse(right.queuedAt) - Date.parse(left.queuedAt),
    );
    return query.limit === undefined ? rows : rows.slice(0, query.limit);
  }

  async appendMessage(input: AppendMessageInput): Promise<MessageRecord> {
    const list = this.messages.get(input.runId);
    if (list === undefined) {
      throw new AgentRuntimeError(
        "run_not_found",
        `No run with id "${input.runId}".`,
        {
          runId: input.runId,
        },
      );
    }
    if (input.content === null && input.contentJson === null) {
      throw new AgentRuntimeError(
        "store_conflict",
        "agent_messages requires content or content_json (agent_messages_has_body).",
        { runId: input.runId },
      );
    }
    const isToolRole = input.role === "tool";
    const hasToolName = (input.toolName ?? null) !== null;
    if (isToolRole !== hasToolName) {
      throw new AgentRuntimeError(
        "store_conflict",
        "agent_messages_tool_role: tool_name is set exactly when role = 'tool'.",
        { runId: input.runId, role: input.role },
      );
    }
    const record: MessageRecord = {
      id: randomUUID(),
      runId: input.runId,
      seq: list.length,
      role: input.role,
      content: input.content,
      contentJson: input.contentJson,
      toolName: input.toolName ?? null,
      tokens: input.tokens ?? null,
      model: input.model ?? null,
      stopReason: input.stopReason ?? null,
      createdAt: this.clock.now().toISOString(),
    };
    list.push(record);
    return record;
  }

  async listMessages(runId: string): Promise<MessageRecord[]> {
    return [...(this.messages.get(runId) ?? [])].sort(
      (left, right) => left.seq - right.seq,
    );
  }

  async createToolCall(input: CreateToolCallInput): Promise<ToolCallRecord> {
    const list = this.toolCalls.get(input.runId);
    if (list === undefined) {
      throw new AgentRuntimeError(
        "run_not_found",
        `No run with id "${input.runId}".`,
        {
          runId: input.runId,
        },
      );
    }
    const record: ToolCallRecord = {
      id: randomUUID(),
      runId: input.runId,
      messageId: input.messageId,
      seq: list.length,
      toolName: input.toolName,
      arguments: input.arguments,
      result: null,
      status: input.status,
      error: null,
      isMutation: input.isMutation,
      approvalId: input.approvalId ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: null,
    };
    assertToolCallInvariants(record);
    list.push(record);
    return record;
  }

  async updateToolCall(
    id: string,
    patch: UpdateToolCallPatch,
  ): Promise<ToolCallRecord> {
    for (const [runId, list] of this.toolCalls) {
      const index = list.findIndex((call) => call.id === id);
      if (index === -1) {
        continue;
      }
      const current = list[index];
      if (current === undefined) {
        continue;
      }
      const next: ToolCallRecord = {
        ...current,
        status: patch.status ?? current.status,
        result: patch.result === undefined ? current.result : patch.result,
        error: patch.error === undefined ? current.error : patch.error,
        approvalId:
          patch.approvalId === undefined
            ? current.approvalId
            : patch.approvalId,
        startedAt:
          patch.startedAt === undefined ? current.startedAt : patch.startedAt,
        finishedAt:
          patch.finishedAt === undefined
            ? current.finishedAt
            : patch.finishedAt,
      };
      assertToolCallInvariants(next);
      list[index] = next;
      this.toolCalls.set(runId, list);
      return next;
    }
    throw new AgentRuntimeError(
      "store_conflict",
      `No tool call with id "${id}".`,
      { id },
    );
  }

  async listToolCalls(runId: string): Promise<ToolCallRecord[]> {
    return [...(this.toolCalls.get(runId) ?? [])].sort(
      (left, right) => left.seq - right.seq,
    );
  }

  async createApproval(input: CreateApprovalInput): Promise<ApprovalRecord> {
    const record: ApprovalRecord = {
      id: randomUUID(),
      subjectType: input.subjectType,
      subjectTable: input.subjectTable,
      subjectId: input.subjectId ?? null,
      title: input.title,
      summary: input.summary,
      rationale: input.rationale,
      payload: input.payload,
      preview: input.preview,
      risk: input.risk,
      amountCents: input.amountCents ?? null,
      currency: input.currency ?? "NZD",
      status: "pending",
      requestedByAgentId: input.requestedByAgentId,
      requestedByRunId: input.requestedByRunId,
      requestedAt: this.clock.now().toISOString(),
      expiresAt: input.expiresAt ?? null,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      appliedAt: null,
      appliedResult: null,
    };
    assertApprovalInvariants(record);
    this.approvals.set(record.id, record);
    return record;
  }

  async getApproval(approvalId: string): Promise<ApprovalRecord | null> {
    return this.approvals.get(approvalId) ?? null;
  }

  async decideApproval(input: DecideApprovalInput): Promise<ApprovalRecord> {
    const current = this.approvals.get(input.approvalId);
    if (current === undefined) {
      throw new AgentRuntimeError(
        "store_conflict",
        `No approval with id "${input.approvalId}".`,
        { approvalId: input.approvalId },
      );
    }
    if (current.status !== "pending") {
      throw new AgentRuntimeError(
        "store_conflict",
        `Approval ${input.approvalId} is already "${current.status}"; decisions are once-only.`,
        { approvalId: input.approvalId, status: current.status },
      );
    }
    const next: ApprovalRecord = {
      ...current,
      status: input.status,
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      decisionNote: input.decisionNote,
    };
    assertApprovalInvariants(next);
    this.approvals.set(next.id, next);
    return next;
  }

  async markApprovalApplied(
    approvalId: string,
    appliedAt: string,
    appliedResult: JsonValue,
  ): Promise<ApprovalRecord> {
    const current = this.approvals.get(approvalId);
    if (current === undefined) {
      throw new AgentRuntimeError(
        "store_conflict",
        `No approval with id "${approvalId}".`,
        {
          approvalId,
        },
      );
    }
    if (current.status !== "approved") {
      throw new AgentRuntimeError(
        "store_conflict",
        `approvals_applied_requires_approved violated for approval ${approvalId}.`,
        { approvalId, status: current.status },
      );
    }
    const next: ApprovalRecord = { ...current, appliedAt, appliedResult };
    this.approvals.set(approvalId, next);
    return next;
  }

  async listApprovals(query: ApprovalQuery): Promise<ApprovalRecord[]> {
    let rows = [...this.approvals.values()];
    if (query.status !== undefined) {
      const wanted = new Set(query.status);
      rows = rows.filter((approval) => wanted.has(approval.status));
    }
    if (query.runId !== undefined) {
      rows = rows.filter(
        (approval) => approval.requestedByRunId === query.runId,
      );
    }
    if (query.agentId !== undefined) {
      rows = rows.filter(
        (approval) => approval.requestedByAgentId === query.agentId,
      );
    }
    rows.sort(
      (left, right) =>
        Date.parse(right.requestedAt) - Date.parse(left.requestedAt),
    );
    return query.limit === undefined ? rows : rows.slice(0, query.limit);
  }

  async recordCost(input: RecordCostInput): Promise<CostRecord> {
    const record: CostRecord = { id: randomUUID(), ...input };
    this.costs.push(record);
    return record;
  }

  async listCosts(window: CostWindow): Promise<CostRecord[]> {
    return this.costs.filter((cost) => matchesWindow(cost, window));
  }

  async sumCostMicros(window: CostWindow): Promise<number> {
    return this.costs
      .filter((cost) => matchesWindow(cost, window))
      .reduce((total, cost) => total + cost.costMicros, 0);
  }

  async getSetting(key: string): Promise<JsonValue | null> {
    return this.settings.get(key) ?? null;
  }

  async setSetting(
    key: string,
    value: JsonValue,
    _description: string,
  ): Promise<void> {
    this.settings.set(key, value);
  }

  async listBrandRules(scopes: readonly string[]): Promise<BrandRuleRecord[]> {
    const matching =
      scopes.length === 0
        ? [...this.brandRules]
        : this.brandRules.filter(
            (rule) =>
              rule.appliesTo.length === 0 ||
              rule.appliesTo.some((scope) => scopes.includes(scope)),
          );
    return matching.sort((left, right) => left.priority - right.priority);
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    this.audit.push({
      ...entry,
      id: this.audit.length + 1,
      occurredAt: this.clock.now().toISOString(),
    });
  }
}

function matchesWindow(cost: CostRecord, window: CostWindow): boolean {
  if (window.agentId !== undefined && cost.agentId !== window.agentId) {
    return false;
  }
  if (window.runId !== undefined && cost.runId !== window.runId) {
    return false;
  }
  if (window.fromDate !== undefined && cost.incurredOn < window.fromDate) {
    return false;
  }
  if (window.toDate !== undefined && cost.incurredOn > window.toDate) {
    return false;
  }
  return true;
}

/** Mirrors the check constraints on `public.agent_runs`. */
function assertRunInvariants(run: RunRecord): void {
  const terminal = TERMINAL_RUN_STATUSES.has(run.status);
  if (terminal !== (run.finishedAt !== null)) {
    throw new AgentRuntimeError(
      "store_conflict",
      `agent_runs_terminal_has_finish violated for run ${run.id} (status ${run.status}).`,
      { runId: run.id, status: run.status },
    );
  }
  if (run.status === "running" && run.startedAt === null) {
    throw new AgentRuntimeError(
      "store_conflict",
      `agent_runs_running_has_start violated for run ${run.id}.`,
      { runId: run.id },
    );
  }
  if (run.status === "failed" && run.error === null) {
    throw new AgentRuntimeError(
      "store_conflict",
      `agent_runs_failed_has_error violated for run ${run.id}.`,
      { runId: run.id },
    );
  }
  if (run.status === "awaiting_approval" && run.blockingApprovalId === null) {
    throw new AgentRuntimeError(
      "store_conflict",
      `agent_runs_blocked_has_approval violated for run ${run.id}.`,
      { runId: run.id },
    );
  }
}

/** Mirrors the check constraints on `public.agent_tool_calls`. */
function assertToolCallInvariants(call: ToolCallRecord): void {
  const terminal = TERMINAL_TOOL_STATUSES.has(call.status);
  if (terminal !== (call.finishedAt !== null)) {
    throw new AgentRuntimeError(
      "store_conflict",
      `agent_tool_calls_terminal_has_finish violated for tool call ${call.id} (status ${call.status}).`,
      { toolCallId: call.id, status: call.status },
    );
  }
  if (call.status === "failed" && call.error === null) {
    throw new AgentRuntimeError(
      "store_conflict",
      `agent_tool_calls_failed_has_error violated for tool call ${call.id}.`,
      { toolCallId: call.id },
    );
  }
  if (call.status === "rejected" && call.approvalId === null) {
    throw new AgentRuntimeError(
      "store_conflict",
      `agent_tool_calls_rejected_has_approval violated for tool call ${call.id}.`,
      { toolCallId: call.id },
    );
  }
}

/** Mirrors the check constraints on `public.approvals`. */
function assertApprovalInvariants(approval: ApprovalRecord): void {
  if (
    approval.status === "pending" &&
    (approval.decidedAt !== null || approval.decidedBy !== null)
  ) {
    throw new AgentRuntimeError(
      "store_conflict",
      `approvals_pending_undecided violated for approval ${approval.id}.`,
      { approvalId: approval.id },
    );
  }
  if (
    (approval.status === "approved" || approval.status === "rejected") &&
    approval.decidedAt === null
  ) {
    throw new AgentRuntimeError(
      "store_conflict",
      `approvals_decided_stamped violated for approval ${approval.id}.`,
      { approvalId: approval.id },
    );
  }
  if (approval.status === "rejected" && approval.decisionNote === null) {
    throw new AgentRuntimeError(
      "store_conflict",
      `approvals_rejected_has_note violated for approval ${approval.id}.`,
      { approvalId: approval.id },
    );
  }
  if (
    approval.amountCents !== null &&
    Math.abs(approval.amountCents) >= 5_000 &&
    approval.risk === "low"
  ) {
    throw new AgentRuntimeError(
      "store_conflict",
      `approvals_money_risk violated for approval ${approval.id}.`,
      { approvalId: approval.id },
    );
  }
}

/** Convenience for tests: an empty context object. */
export const EMPTY_CONTEXT: JsonObject = {};
