/**
 * {@link AgentStore} backed by the real `agent_*` tables.
 *
 * Writes land row by row, as they happen — there is no batching and no
 * end-of-run flush, because a crashed run must still be inspectable. The schema
 * this writes to is `supabase/migrations/20260101000300_agents.sql`; nothing
 * here creates or alters a table.
 *
 * It uses the service-role key and therefore bypasses RLS. That is correct for a
 * server-side worker and wrong everywhere else: this module must never be
 * imported into anything that runs in a browser.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { AgentRuntimeError } from "../errors";
import type { JsonObject, JsonValue } from "../json";
import {
  AGENT_AUTONOMIES,
  AGENT_MESSAGE_ROLES,
  AGENT_RUN_STATUSES,
  AGENT_RUN_TRIGGERS,
  AGENT_STATUSES,
  APPROVAL_RISKS,
  APPROVAL_STATUSES,
  APPROVAL_SUBJECTS,
  TOOL_CALL_STATUSES,
  type AgentRecord,
  type ApprovalRecord,
  type BrandRuleRecord,
  type CostRecord,
  type MessageRecord,
  type RunRecord,
  type ToolCallRecord,
} from "../types";
import {
  bool,
  expectRow,
  json,
  jsonObject,
  num,
  numOrNull,
  oneOf,
  str,
  strArray,
  strOrNull,
  type Row,
} from "./row";
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

/** How many times a sequence-number collision is retried before giving up. */
const SEQ_RETRY_LIMIT = 5;

function fail(context: string, error: { message: string } | null): never {
  throw new AgentRuntimeError(
    "store_conflict",
    `${context}: ${error?.message ?? "unknown error"}`,
    {
      context,
    },
  );
}

function mapAgent(value: unknown): AgentRecord {
  const row = expectRow(value, "agents");
  return {
    id: str(row, "id", "agents"),
    slug: str(row, "slug", "agents"),
    name: str(row, "name", "agents"),
    jobTitle: str(row, "job_title", "agents"),
    purpose: str(row, "purpose", "agents"),
    model: str(row, "model", "agents"),
    systemPrompt: strOrNull(row, "system_prompt"),
    tools: strArray(row, "tools"),
    status: oneOf(row, "status", AGENT_STATUSES, "agents"),
    autonomy: oneOf(row, "autonomy", AGENT_AUTONOMIES, "agents"),
    requiresApprovalFor: strArray(row, "requires_approval_for").filter(
      (entry): entry is (typeof APPROVAL_SUBJECTS)[number] =>
        (APPROVAL_SUBJECTS as readonly string[]).includes(entry),
    ),
    dailySpendCapCents: num(row, "daily_spend_cap_cents"),
    monthlySpendCapCents: num(row, "monthly_spend_cap_cents"),
    singleActionCapCents: numOrNull(row, "single_action_cap_cents"),
    isEnabled: bool(row, "is_enabled", true),
  };
}

function mapRun(value: unknown, agentSlug: string): RunRecord {
  const row = expectRow(value, "agent_runs");
  return {
    id: str(row, "id", "agent_runs"),
    agentId: str(row, "agent_id", "agent_runs"),
    agentSlug,
    parentRunId: strOrNull(row, "parent_run_id"),
    trigger: oneOf(row, "trigger", AGENT_RUN_TRIGGERS, "agent_runs"),
    status: oneOf(row, "status", AGENT_RUN_STATUSES, "agent_runs"),
    goal: str(row, "goal", "agent_runs"),
    outcome: strOrNull(row, "outcome"),
    error: strOrNull(row, "error"),
    queuedAt: str(row, "queued_at", "agent_runs"),
    startedAt: strOrNull(row, "started_at"),
    finishedAt: strOrNull(row, "finished_at"),
    inputTokens: num(row, "input_tokens"),
    outputTokens: num(row, "output_tokens"),
    costMicros: num(row, "cost_micros"),
    toolCallCount: num(row, "tool_call_count"),
    blockingApprovalId: strOrNull(row, "blocking_approval_id"),
    context: jsonObject(row, "context"),
  };
}

function mapMessage(value: unknown): MessageRecord {
  const row = expectRow(value, "agent_messages");
  return {
    id: str(row, "id", "agent_messages"),
    runId: str(row, "run_id", "agent_messages"),
    seq: num(row, "seq"),
    role: oneOf(row, "role", AGENT_MESSAGE_ROLES, "agent_messages"),
    content: strOrNull(row, "content"),
    contentJson: json(row, "content_json"),
    toolName: strOrNull(row, "tool_name"),
    tokens: numOrNull(row, "tokens"),
    model: strOrNull(row, "model"),
    stopReason: strOrNull(row, "stop_reason"),
    createdAt: str(row, "created_at", "agent_messages"),
  };
}

function mapToolCall(value: unknown): ToolCallRecord {
  const row = expectRow(value, "agent_tool_calls");
  return {
    id: str(row, "id", "agent_tool_calls"),
    runId: str(row, "run_id", "agent_tool_calls"),
    messageId: strOrNull(row, "message_id"),
    seq: num(row, "seq"),
    toolName: str(row, "tool_name", "agent_tool_calls"),
    arguments: jsonObject(row, "arguments"),
    result: json(row, "result"),
    status: oneOf(row, "status", TOOL_CALL_STATUSES, "agent_tool_calls"),
    error: strOrNull(row, "error"),
    isMutation: bool(row, "is_mutation"),
    approvalId: strOrNull(row, "approval_id"),
    startedAt: strOrNull(row, "started_at"),
    finishedAt: strOrNull(row, "finished_at"),
  };
}

function mapApproval(value: unknown): ApprovalRecord {
  const row = expectRow(value, "approvals");
  return {
    id: str(row, "id", "approvals"),
    subjectType: oneOf(row, "subject_type", APPROVAL_SUBJECTS, "approvals"),
    subjectTable: str(row, "subject_table", "approvals"),
    subjectId: strOrNull(row, "subject_id"),
    title: str(row, "title", "approvals"),
    summary: str(row, "summary", "approvals"),
    rationale: strOrNull(row, "rationale"),
    payload: jsonObject(row, "payload"),
    preview: jsonObject(row, "preview"),
    risk: oneOf(row, "risk", APPROVAL_RISKS, "approvals"),
    amountCents: numOrNull(row, "amount_cents"),
    currency: str(row, "currency", "approvals"),
    status: oneOf(row, "status", APPROVAL_STATUSES, "approvals"),
    requestedByAgentId: strOrNull(row, "requested_by_agent_id"),
    requestedByRunId: strOrNull(row, "requested_by_run_id"),
    requestedAt: str(row, "requested_at", "approvals"),
    expiresAt: strOrNull(row, "expires_at"),
    decidedBy: strOrNull(row, "decided_by"),
    decidedAt: strOrNull(row, "decided_at"),
    decisionNote: strOrNull(row, "decision_note"),
    appliedAt: strOrNull(row, "applied_at"),
    appliedResult: json(row, "applied_result"),
  };
}

function mapCost(value: unknown): CostRecord {
  const row = expectRow(value, "agent_costs");
  const kind = str(row, "kind", "agent_costs");
  const kinds: CostRecord["kind"][] = [
    "inference",
    "embedding",
    "image",
    "search",
    "storage",
    "third_party",
  ];
  return {
    id: str(row, "id", "agent_costs"),
    agentId: str(row, "agent_id", "agent_costs"),
    runId: strOrNull(row, "run_id"),
    toolCallId: strOrNull(row, "tool_call_id"),
    incurredOn: str(row, "incurred_on", "agent_costs"),
    incurredAt: str(row, "incurred_at", "agent_costs"),
    provider: str(row, "provider", "agent_costs"),
    model: str(row, "model", "agent_costs"),
    kind: (kinds.find((entry) => entry === kind) ??
      "inference") as CostRecord["kind"],
    inputTokens: num(row, "input_tokens"),
    outputTokens: num(row, "output_tokens"),
    cacheReadTokens: num(row, "cache_read_tokens"),
    cacheWriteTokens: num(row, "cache_write_tokens"),
    costMicros: num(row, "cost_micros"),
    currency: str(row, "currency", "agent_costs"),
    note: strOrNull(row, "note"),
  };
}

function mapBrandRule(value: unknown): BrandRuleRecord {
  const row = expectRow(value, "brand_rules");
  return {
    slug: str(row, "slug", "brand_rules"),
    kind: str(row, "kind", "brand_rules"),
    severity: str(row, "severity", "brand_rules"),
    title: str(row, "title", "brand_rules"),
    rule: str(row, "rule", "brand_rules"),
    appliesTo: strArray(row, "applies_to"),
    keywords: strArray(row, "keywords"),
    priority: num(row, "priority", 100),
  };
}

/** Build a service-role client from the environment. Server only. */
export function createServiceClient(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SupabaseClient {
  const url = env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = env["SUPABASE_SERVICE_ROLE_KEY"];
  if (
    url === undefined ||
    key === undefined ||
    url.length === 0 ||
    key.length === 0
  ) {
    throw new AgentRuntimeError(
      "store_conflict",
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set to reach the agent tables.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class SupabaseAgentStore implements AgentStore {
  /** Slug lookup cache so every run read does not need a join. */
  private readonly slugById = new Map<string, string>();

  constructor(private readonly client: SupabaseClient) {}

  async upsertAgent(input: UpsertAgentInput): Promise<AgentRecord> {
    const { data, error } = await this.client
      .from("agents")
      .upsert(
        {
          slug: input.slug,
          name: input.name,
          job_title: input.jobTitle,
          purpose: input.purpose,
          model: input.model,
          system_prompt: input.systemPrompt,
          tools: [...input.tools],
          autonomy: input.autonomy,
          requires_approval_for: [...input.requiresApprovalFor],
          daily_spend_cap_cents: input.dailySpendCapCents,
          monthly_spend_cap_cents: input.monthlySpendCapCents,
          single_action_cap_cents: input.singleActionCapCents,
        },
        { onConflict: "slug" },
      )
      .select()
      .single();
    if (error !== null) {
      fail("upsert agent", error);
    }
    const agent = mapAgent(data);
    this.slugById.set(agent.id, agent.slug);
    return agent;
  }

  async getAgentBySlug(slug: string): Promise<AgentRecord | null> {
    const { data, error } = await this.client
      .from("agents")
      .select()
      .eq("slug", slug)
      .maybeSingle();
    if (error !== null) {
      fail("get agent by slug", error);
    }
    if (data === null) {
      return null;
    }
    const agent = mapAgent(data);
    this.slugById.set(agent.id, agent.slug);
    return agent;
  }

  async getAgentById(id: string): Promise<AgentRecord | null> {
    const { data, error } = await this.client
      .from("agents")
      .select()
      .eq("id", id)
      .maybeSingle();
    if (error !== null) {
      fail("get agent by id", error);
    }
    if (data === null) {
      return null;
    }
    const agent = mapAgent(data);
    this.slugById.set(agent.id, agent.slug);
    return agent;
  }

  async setAgentStatus(
    slug: string,
    status: AgentRecord["status"],
    isEnabled: boolean,
  ): Promise<void> {
    const { error } = await this.client
      .from("agents")
      .update({ status, is_enabled: isEnabled })
      .eq("slug", slug);
    if (error !== null) {
      fail("set agent status", error);
    }
  }

  private async slugFor(agentId: string): Promise<string> {
    const cached = this.slugById.get(agentId);
    if (cached !== undefined) {
      return cached;
    }
    const agent = await this.getAgentById(agentId);
    if (agent === null) {
      throw new AgentRuntimeError(
        "agent_not_found",
        `No agent with id "${agentId}".`,
        { agentId },
      );
    }
    return agent.slug;
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const { data, error } = await this.client
      .from("agent_runs")
      .insert({
        agent_id: input.agentId,
        parent_run_id: input.parentRunId ?? null,
        trigger: input.trigger,
        goal: input.goal,
        context: input.context,
      })
      .select()
      .single();
    if (error !== null) {
      fail("create run", error);
    }
    return mapRun(data, await this.slugFor(input.agentId));
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const { data, error } = await this.client
      .from("agent_runs")
      .select()
      .eq("id", runId)
      .maybeSingle();
    if (error !== null) {
      fail("get run", error);
    }
    if (data === null) {
      return null;
    }
    const row = expectRow(data, "agent_runs");
    return mapRun(data, await this.slugFor(str(row, "agent_id", "agent_runs")));
  }

  async updateRun(runId: string, patch: UpdateRunPatch): Promise<RunRecord> {
    const current = await this.getRun(runId);
    if (current === null) {
      throw new AgentRuntimeError(
        "run_not_found",
        `No run with id "${runId}".`,
        { runId },
      );
    }
    const update: Row = {};
    if (patch.status !== undefined) {
      update["status"] = patch.status;
    }
    if (patch.outcome !== undefined) {
      update["outcome"] = patch.outcome;
    }
    if (patch.error !== undefined) {
      update["error"] = patch.error;
    }
    if (patch.startedAt !== undefined) {
      update["started_at"] = patch.startedAt;
    }
    if (patch.finishedAt !== undefined) {
      update["finished_at"] = patch.finishedAt;
    }
    if (patch.blockingApprovalId !== undefined) {
      update["blocking_approval_id"] = patch.blockingApprovalId;
    }
    if (patch.addInputTokens !== undefined) {
      update["input_tokens"] = current.inputTokens + patch.addInputTokens;
    }
    if (patch.addOutputTokens !== undefined) {
      update["output_tokens"] = current.outputTokens + patch.addOutputTokens;
    }
    if (patch.addCostMicros !== undefined) {
      update["cost_micros"] = current.costMicros + patch.addCostMicros;
    }
    if (patch.addToolCalls !== undefined) {
      update["tool_call_count"] = current.toolCallCount + patch.addToolCalls;
    }
    if (patch.contextPatch !== undefined) {
      update["context"] = { ...current.context, ...patch.contextPatch };
    }

    const { data, error } = await this.client
      .from("agent_runs")
      .update(update)
      .eq("id", runId)
      .select()
      .single();
    if (error !== null) {
      fail("update run", error);
    }
    return mapRun(data, current.agentSlug);
  }

  async listRuns(query: RunQuery): Promise<RunRecord[]> {
    let request = this.client
      .from("agent_runs")
      .select("*, agents!inner(slug)")
      .order("queued_at", { ascending: false });
    if (query.agentId !== undefined) {
      request = request.eq("agent_id", query.agentId);
    }
    if (query.agentSlug !== undefined) {
      request = request.eq("agents.slug", query.agentSlug);
    }
    if (query.status !== undefined) {
      request = request.in("status", [...query.status]);
    }
    if (query.since !== undefined) {
      request = request.gte("queued_at", query.since);
    }
    if (query.limit !== undefined) {
      request = request.limit(query.limit);
    }
    const { data, error } = await request;
    if (error !== null) {
      fail("list runs", error);
    }
    const rows = Array.isArray(data) ? data : [];
    return rows.map((entry) => {
      const row = expectRow(entry, "agent_runs");
      const joined = row["agents"];
      const slug =
        typeof joined === "object" && joined !== null && !Array.isArray(joined)
          ? str(joined as Row, "slug", "agents")
          : "";
      return mapRun(row, slug);
    });
  }

  /** Next free `seq` for a run's messages or tool calls. */
  private async nextSeq(
    table: "agent_messages" | "agent_tool_calls",
    runId: string,
  ): Promise<number> {
    const { data, error } = await this.client
      .from(table)
      .select("seq")
      .eq("run_id", runId)
      .order("seq", { ascending: false })
      .limit(1);
    if (error !== null) {
      fail(`next seq for ${table}`, error);
    }
    const rows = Array.isArray(data) ? data : [];
    const first = rows[0];
    if (first === undefined) {
      return 0;
    }
    return num(expectRow(first, table), "seq", -1) + 1;
  }

  async appendMessage(input: AppendMessageInput): Promise<MessageRecord> {
    for (let attempt = 0; attempt < SEQ_RETRY_LIMIT; attempt += 1) {
      const seq = await this.nextSeq("agent_messages", input.runId);
      const { data, error } = await this.client
        .from("agent_messages")
        .insert({
          run_id: input.runId,
          seq,
          role: input.role,
          content: input.content,
          content_json: input.contentJson,
          tool_name: input.toolName ?? null,
          tokens: input.tokens ?? null,
          model: input.model ?? null,
          stop_reason: input.stopReason ?? null,
        })
        .select()
        .single();
      if (error === null) {
        return mapMessage(data);
      }
      // 23505 = unique_violation: another writer took this seq. Re-read and retry.
      if (!error.message.includes("duplicate key")) {
        fail("append message", error);
      }
    }
    throw new AgentRuntimeError(
      "store_conflict",
      `Could not find a free message seq for run ${input.runId} after ${SEQ_RETRY_LIMIT} attempts.`,
      { runId: input.runId },
    );
  }

  async listMessages(runId: string): Promise<MessageRecord[]> {
    const { data, error } = await this.client
      .from("agent_messages")
      .select()
      .eq("run_id", runId)
      .order("seq", { ascending: true });
    if (error !== null) {
      fail("list messages", error);
    }
    return (Array.isArray(data) ? data : []).map(mapMessage);
  }

  async createToolCall(input: CreateToolCallInput): Promise<ToolCallRecord> {
    for (let attempt = 0; attempt < SEQ_RETRY_LIMIT; attempt += 1) {
      const seq = await this.nextSeq("agent_tool_calls", input.runId);
      const { data, error } = await this.client
        .from("agent_tool_calls")
        .insert({
          run_id: input.runId,
          message_id: input.messageId,
          seq,
          tool_name: input.toolName,
          arguments: input.arguments,
          status: input.status,
          is_mutation: input.isMutation,
          approval_id: input.approvalId ?? null,
          started_at: input.startedAt ?? null,
        })
        .select()
        .single();
      if (error === null) {
        return mapToolCall(data);
      }
      if (!error.message.includes("duplicate key")) {
        fail("create tool call", error);
      }
    }
    throw new AgentRuntimeError(
      "store_conflict",
      `Could not find a free tool-call seq for run ${input.runId}.`,
      { runId: input.runId },
    );
  }

  async updateToolCall(
    id: string,
    patch: UpdateToolCallPatch,
  ): Promise<ToolCallRecord> {
    const update: Row = {};
    if (patch.status !== undefined) {
      update["status"] = patch.status;
    }
    if (patch.result !== undefined) {
      update["result"] = patch.result;
    }
    if (patch.error !== undefined) {
      update["error"] = patch.error;
    }
    if (patch.approvalId !== undefined) {
      update["approval_id"] = patch.approvalId;
    }
    if (patch.startedAt !== undefined) {
      update["started_at"] = patch.startedAt;
    }
    if (patch.finishedAt !== undefined) {
      update["finished_at"] = patch.finishedAt;
    }
    const { data, error } = await this.client
      .from("agent_tool_calls")
      .update(update)
      .eq("id", id)
      .select()
      .single();
    if (error !== null) {
      fail("update tool call", error);
    }
    return mapToolCall(data);
  }

  async listToolCalls(runId: string): Promise<ToolCallRecord[]> {
    const { data, error } = await this.client
      .from("agent_tool_calls")
      .select()
      .eq("run_id", runId)
      .order("seq", { ascending: true });
    if (error !== null) {
      fail("list tool calls", error);
    }
    return (Array.isArray(data) ? data : []).map(mapToolCall);
  }

  async createApproval(input: CreateApprovalInput): Promise<ApprovalRecord> {
    const { data, error } = await this.client
      .from("approvals")
      .insert({
        subject_type: input.subjectType,
        subject_table: input.subjectTable,
        subject_id: input.subjectId ?? null,
        title: input.title,
        summary: input.summary,
        rationale: input.rationale,
        payload: input.payload,
        preview: input.preview,
        risk: input.risk,
        amount_cents: input.amountCents ?? null,
        currency: input.currency ?? "NZD",
        requested_by_agent_id: input.requestedByAgentId,
        requested_by_run_id: input.requestedByRunId,
        expires_at: input.expiresAt ?? null,
      })
      .select()
      .single();
    if (error !== null) {
      fail("create approval", error);
    }
    return mapApproval(data);
  }

  async getApproval(approvalId: string): Promise<ApprovalRecord | null> {
    const { data, error } = await this.client
      .from("approvals")
      .select()
      .eq("id", approvalId)
      .maybeSingle();
    if (error !== null) {
      fail("get approval", error);
    }
    return data === null ? null : mapApproval(data);
  }

  /**
   * Decide an approval.
   *
   * The `.eq("status", "pending")` predicate is the concurrency control: two
   * operators clicking at once produce one decision and one no-op, not two.
   */
  async decideApproval(input: DecideApprovalInput): Promise<ApprovalRecord> {
    const { data, error } = await this.client
      .from("approvals")
      .update({
        status: input.status,
        decided_by: input.decidedBy,
        decided_at: input.decidedAt,
        decision_note: input.decisionNote,
      })
      .eq("id", input.approvalId)
      .eq("status", "pending")
      .select()
      .maybeSingle();
    if (error !== null) {
      fail("decide approval", error);
    }
    if (data === null) {
      throw new AgentRuntimeError(
        "store_conflict",
        `Approval ${input.approvalId} was not pending; decisions are once-only.`,
        { approvalId: input.approvalId },
      );
    }
    return mapApproval(data);
  }

  async markApprovalApplied(
    approvalId: string,
    appliedAt: string,
    appliedResult: JsonValue,
  ): Promise<ApprovalRecord> {
    const { data, error } = await this.client
      .from("approvals")
      .update({ applied_at: appliedAt, applied_result: appliedResult })
      .eq("id", approvalId)
      .eq("status", "approved")
      .select()
      .maybeSingle();
    if (error !== null) {
      fail("mark approval applied", error);
    }
    if (data === null) {
      throw new AgentRuntimeError(
        "store_conflict",
        `Approval ${approvalId} is not approved; it cannot be marked applied.`,
        { approvalId },
      );
    }
    return mapApproval(data);
  }

  async listApprovals(query: ApprovalQuery): Promise<ApprovalRecord[]> {
    let request = this.client
      .from("approvals")
      .select()
      .order("requested_at", { ascending: false });
    if (query.status !== undefined) {
      request = request.in("status", [...query.status]);
    }
    if (query.runId !== undefined) {
      request = request.eq("requested_by_run_id", query.runId);
    }
    if (query.agentId !== undefined) {
      request = request.eq("requested_by_agent_id", query.agentId);
    }
    if (query.limit !== undefined) {
      request = request.limit(query.limit);
    }
    const { data, error } = await request;
    if (error !== null) {
      fail("list approvals", error);
    }
    return (Array.isArray(data) ? data : []).map(mapApproval);
  }

  async recordCost(input: RecordCostInput): Promise<CostRecord> {
    const { data, error } = await this.client
      .from("agent_costs")
      .insert({
        agent_id: input.agentId,
        run_id: input.runId,
        tool_call_id: input.toolCallId,
        incurred_on: input.incurredOn,
        incurred_at: input.incurredAt,
        provider: input.provider,
        model: input.model,
        kind: input.kind,
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
        cache_read_tokens: input.cacheReadTokens,
        cache_write_tokens: input.cacheWriteTokens,
        cost_micros: input.costMicros,
        currency: input.currency,
        note: input.note,
      })
      .select()
      .single();
    if (error !== null) {
      fail("record cost", error);
    }
    return mapCost(data);
  }

  async listCosts(window: CostWindow): Promise<CostRecord[]> {
    let request = this.client.from("agent_costs").select();
    if (window.agentId !== undefined) {
      request = request.eq("agent_id", window.agentId);
    }
    if (window.runId !== undefined) {
      request = request.eq("run_id", window.runId);
    }
    if (window.fromDate !== undefined) {
      request = request.gte("incurred_on", window.fromDate);
    }
    if (window.toDate !== undefined) {
      request = request.lte("incurred_on", window.toDate);
    }
    const { data, error } = await request;
    if (error !== null) {
      fail("list costs", error);
    }
    return (Array.isArray(data) ? data : []).map(mapCost);
  }

  async sumCostMicros(window: CostWindow): Promise<number> {
    const rows = await this.listCosts(window);
    return rows.reduce((total, row) => total + row.costMicros, 0);
  }

  async getSetting(key: string): Promise<JsonValue | null> {
    const { data, error } = await this.client
      .from("settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error !== null) {
      fail("get setting", error);
    }
    if (data === null) {
      return null;
    }
    return json(expectRow(data, "settings"), "value");
  }

  async setSetting(
    key: string,
    value: JsonValue,
    description: string,
  ): Promise<void> {
    const { error } = await this.client
      .from("settings")
      .upsert(
        { key, value, description, category: "agents" },
        { onConflict: "key" },
      );
    if (error !== null) {
      fail("set setting", error);
    }
  }

  async listBrandRules(scopes: readonly string[]): Promise<BrandRuleRecord[]> {
    let request = this.client
      .from("brand_rules")
      .select()
      .eq("is_active", true)
      .order("priority", { ascending: true });
    if (scopes.length > 0) {
      request = request.overlaps("applies_to", [...scopes]);
    }
    const { data, error } = await request;
    if (error !== null) {
      fail("list brand rules", error);
    }
    return (Array.isArray(data) ? data : []).map(mapBrandRule);
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    const { error } = await this.client.from("audit_log").insert({
      actor_type: entry.actorType,
      actor_id: entry.actorId,
      actor_label: entry.actorLabel,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      entity_label: entry.entityLabel,
      summary: entry.summary,
      before_data: entry.beforeData,
      after_data: entry.afterData,
      agent_run_id: entry.agentRunId,
      approval_id: entry.approvalId,
    });
    if (error !== null) {
      fail("append audit", error);
    }
  }
}

/** Type re-export so callers do not need to import from `supabase-js` directly. */
export type { JsonObject };
