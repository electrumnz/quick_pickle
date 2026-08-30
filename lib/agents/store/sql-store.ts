/**
 * {@link AgentStore} over a Postgres connection.
 *
 * `SupabaseAgentStore` writes the same tables through PostgREST, and it is the
 * right store for a worker that has a Supabase project in front of it. It is
 * the wrong one — in fact an impossible one — for the surface the founder
 * actually types into: the admin reads and writes the business through
 * `components/admin/data/db.ts`, which is a Postgres connection and nothing
 * else, and on a demonstration deployment there is no Supabase project at all.
 * Without this adapter, a run started from the admin cannot open its row.
 *
 * So this is the same port, the same tables and the same records, over the same
 * `SqlExecutor` the rest of the admin uses. It is an adapter, not an engine:
 * every guarantee the runtime has — the approval gate, the cost caps, the step
 * ceiling, the replayable transcript — is a property of `AgentRuntime` and is
 * untouched by which of these two stores is underneath it.
 *
 * Two differences from the PostgREST store, both forced by the driver:
 *
 *  - **`timestamptz` arrives as a `Date`.** PostgREST hands back ISO strings and
 *    the row readers in `./row.ts` expect text, so every timestamp is selected
 *    `::text` and normalised to ISO here, once, at the boundary.
 *  - **A sequence number is allocated in the statement that uses it.** The
 *    PostgREST store reads the maximum and retries on collision; one SQL
 *    statement with a sub-select and a unique index does the same job without
 *    the race, so `agent_messages.seq` is never guessed.
 */

import { AgentRuntimeError } from "../errors";
import type { JsonValue } from "../json";
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

/**
 * The narrowest client these statements need.
 *
 * Declared here rather than imported from `lib/commerce/sql/executor`, for the
 * same reason `RosterSqlClient` is declared in `lib/agents/roster/sql-reads.ts`:
 * the runtime depends on "something that can run a parameterised statement",
 * not on the commerce module. `pg`, PGlite and the admin's own executor all
 * satisfy it as they are.
 */
export type AgentSqlRow = Record<string, unknown>;

export interface AgentSqlClient {
  query<R extends AgentSqlRow = AgentSqlRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: R[] }>;
}

/* -------------------------------------------------------------- selections */

const AGENT_COLUMNS = `
  id::text, slug, name, job_title, purpose, model, system_prompt, tools,
  status::text, autonomy::text, requires_approval_for::text[] as requires_approval_for,
  daily_spend_cap_cents, monthly_spend_cap_cents, single_action_cap_cents, is_enabled`;

/** Unprefixed, for statements that touch `agent_runs` on its own. */
const RUN_COLUMNS = `
  id::text, agent_id::text, parent_run_id::text, trigger::text,
  status::text, goal, outcome, error,
  queued_at::text, started_at::text, finished_at::text,
  input_tokens, output_tokens, cost_micros::text as cost_micros,
  tool_call_count, blocking_approval_id::text, context`;

/**
 * The same list, qualified, for the join that carries the agent's slug.
 *
 * Written out rather than derived from the one above by string surgery: a
 * regular expression that rewrites a column list is a bug waiting for the day
 * somebody adds a column whose name contains one of its delimiters.
 */
const RUN_COLUMNS_JOINED = `
  r.id::text, r.agent_id::text, r.parent_run_id::text, r.trigger::text,
  r.status::text, r.goal, r.outcome, r.error,
  r.queued_at::text, r.started_at::text, r.finished_at::text,
  r.input_tokens, r.output_tokens, r.cost_micros::text as cost_micros,
  r.tool_call_count, r.blocking_approval_id::text, r.context`;

const MESSAGE_COLUMNS = `
  id::text, run_id::text, seq, role::text, content, content_json,
  tool_name, tokens, model, stop_reason, created_at::text`;

const TOOL_CALL_COLUMNS = `
  id::text, run_id::text, message_id::text, seq, tool_name, arguments, result,
  status::text, error, is_mutation, approval_id::text,
  started_at::text, finished_at::text`;

const APPROVAL_COLUMNS = `
  id::text, subject_type::text, subject_table, subject_id::text, title, summary,
  rationale, payload, preview, risk::text, amount_cents, currency::text,
  status::text, requested_by_agent_id::text, requested_by_run_id::text,
  requested_at::text, expires_at::text, decided_by::text, decided_at::text,
  decision_note, applied_at::text, applied_result`;

const COST_COLUMNS = `
  id::text, agent_id::text, run_id::text, tool_call_id::text,
  incurred_on::text, incurred_at::text, provider, model, kind,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
  cost_micros::text as cost_micros, currency::text, note`;

/* ------------------------------------------------------------- row mapping */

function only(rows: readonly AgentSqlRow[], context: string): Row {
  const row = rows[0];
  if (row === undefined) {
    throw new AgentRuntimeError(
      "store_conflict",
      `${context}: the database returned no row.`,
      { context },
    );
  }
  return expectRow(row, context);
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

const COST_KINDS: readonly CostRecord["kind"][] = [
  "inference",
  "embedding",
  "image",
  "search",
  "storage",
  "third_party",
];

function mapCost(value: unknown): CostRecord {
  const row = expectRow(value, "agent_costs");
  const kind = str(row, "kind", "agent_costs");
  return {
    id: str(row, "id", "agent_costs"),
    agentId: str(row, "agent_id", "agent_costs"),
    runId: strOrNull(row, "run_id"),
    toolCallId: strOrNull(row, "tool_call_id"),
    incurredOn: str(row, "incurred_on", "agent_costs"),
    incurredAt: str(row, "incurred_at", "agent_costs"),
    provider: str(row, "provider", "agent_costs"),
    model: str(row, "model", "agent_costs"),
    kind: COST_KINDS.find((entry) => entry === kind) ?? "inference",
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

/** `jsonb` parameters are bound as text and cast in the statement. */
function jsonParam(value: JsonValue | null | undefined): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/* ------------------------------------------------------------------ store */

export class SqlAgentStore implements AgentStore {
  /** Slug per agent id, so a run read does not need a join every time. */
  private readonly slugById = new Map<string, string>();

  constructor(private readonly sql: AgentSqlClient) {}

  async upsertAgent(input: UpsertAgentInput): Promise<AgentRecord> {
    const result = await this.sql.query(
      `insert into public.agents
         (slug, name, job_title, purpose, model, system_prompt, tools, autonomy,
          requires_approval_for, daily_spend_cap_cents, monthly_spend_cap_cents,
          single_action_cap_cents)
       values ($1, $2, $3, $4, $5, $6, $7::text[], $8::public.agent_autonomy,
               $9::text[]::public.approval_subject[], $10, $11, $12)
       on conflict (slug) do update set
         name = excluded.name,
         job_title = excluded.job_title,
         purpose = excluded.purpose,
         model = excluded.model,
         system_prompt = excluded.system_prompt,
         tools = excluded.tools,
         autonomy = excluded.autonomy,
         requires_approval_for = excluded.requires_approval_for,
         daily_spend_cap_cents = excluded.daily_spend_cap_cents,
         monthly_spend_cap_cents = excluded.monthly_spend_cap_cents,
         single_action_cap_cents = excluded.single_action_cap_cents,
         updated_at = now()
       returning ${AGENT_COLUMNS}`,
      [
        input.slug,
        input.name,
        input.jobTitle,
        input.purpose,
        input.model,
        input.systemPrompt,
        [...input.tools],
        input.autonomy,
        [...input.requiresApprovalFor],
        input.dailySpendCapCents,
        input.monthlySpendCapCents,
        input.singleActionCapCents,
      ],
    );
    const agent = mapAgent(only(result.rows, "upsert agent"));
    this.slugById.set(agent.id, agent.slug);
    return agent;
  }

  async getAgentBySlug(slug: string): Promise<AgentRecord | null> {
    const result = await this.sql.query(
      `select ${AGENT_COLUMNS} from public.agents where slug = $1`,
      [slug],
    );
    if (result.rows.length === 0) return null;
    const agent = mapAgent(result.rows[0]);
    this.slugById.set(agent.id, agent.slug);
    return agent;
  }

  async getAgentById(id: string): Promise<AgentRecord | null> {
    const result = await this.sql.query(
      `select ${AGENT_COLUMNS} from public.agents where id = $1`,
      [id],
    );
    if (result.rows.length === 0) return null;
    const agent = mapAgent(result.rows[0]);
    this.slugById.set(agent.id, agent.slug);
    return agent;
  }

  async setAgentStatus(
    slug: string,
    status: AgentRecord["status"],
    isEnabled: boolean,
  ): Promise<void> {
    await this.sql.query(
      `update public.agents
          set status = $2::public.agent_status, is_enabled = $3, updated_at = now()
        where slug = $1`,
      [slug, status, isEnabled],
    );
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const result = await this.sql.query(
      `insert into public.agent_runs (agent_id, parent_run_id, trigger, goal, context)
       values ($1, $2, $3::public.agent_run_trigger, $4, $5::jsonb)
       returning ${RUN_COLUMNS}`,
      [
        input.agentId,
        input.parentRunId ?? null,
        input.trigger,
        input.goal,
        JSON.stringify(input.context),
      ],
    );
    return mapRun(
      only(result.rows, "create run"),
      await this.slugFor(input.agentId),
    );
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const result = await this.sql.query(
      `select ${RUN_COLUMNS_JOINED}, a.slug as agent_slug
         from public.agent_runs r
         join public.agents a on a.id = r.agent_id
        where r.id = $1`,
      [runId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return mapRun(
      row,
      str(expectRow(row, "agent_runs"), "agent_slug", "agent_runs"),
    );
  }

  /**
   * Patch a run.
   *
   * The counter fields are `+=` rather than `=` and are applied in the same
   * statement that reads them, so two tool calls finishing at once cannot both
   * write "one more" over the same value. `contextPatch` merges at the top
   * level with `||`, which is what the halt record needs: it adds a `halt` key
   * without discarding the conversation or the granted tools beside it.
   */
  async updateRun(runId: string, patch: UpdateRunPatch): Promise<RunRecord> {
    const sets: string[] = ["updated_at = now()"];
    const params: unknown[] = [runId];
    const add = (fragment: string, value: unknown): void => {
      params.push(value);
      sets.push(fragment.replace("$n", `$${String(params.length)}`));
    };

    if (patch.status !== undefined) {
      add("status = $n::public.agent_run_status", patch.status);
    }
    if (patch.outcome !== undefined) add("outcome = $n", patch.outcome);
    if (patch.error !== undefined) add("error = $n", patch.error);
    if (patch.startedAt !== undefined) {
      add("started_at = $n::timestamptz", patch.startedAt);
    }
    if (patch.finishedAt !== undefined) {
      add("finished_at = $n::timestamptz", patch.finishedAt);
    }
    if (patch.blockingApprovalId !== undefined) {
      add("blocking_approval_id = $n::uuid", patch.blockingApprovalId);
    }
    if (patch.addInputTokens !== undefined) {
      add("input_tokens = input_tokens + $n", patch.addInputTokens);
    }
    if (patch.addOutputTokens !== undefined) {
      add("output_tokens = output_tokens + $n", patch.addOutputTokens);
    }
    if (patch.addCostMicros !== undefined) {
      add("cost_micros = cost_micros + $n", patch.addCostMicros);
    }
    if (patch.addToolCalls !== undefined) {
      add("tool_call_count = tool_call_count + $n", patch.addToolCalls);
    }
    if (patch.contextPatch !== undefined) {
      add("context = context || $n::jsonb", JSON.stringify(patch.contextPatch));
    }

    const result = await this.sql.query(
      `update public.agent_runs set ${sets.join(", ")}
        where id = $1
       returning ${RUN_COLUMNS}`,
      params,
    );
    const row = only(result.rows, "update run");
    return mapRun(row, await this.slugFor(str(row, "agent_id", "agent_runs")));
  }

  async listRuns(query: RunQuery): Promise<RunRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${String(params.length)}`;
    };
    if (query.agentId !== undefined) {
      where.push(`r.agent_id = ${bind(query.agentId)}`);
    }
    if (query.agentSlug !== undefined) {
      where.push(`a.slug = ${bind(query.agentSlug)}`);
    }
    if (query.status !== undefined && query.status.length > 0) {
      where.push(`r.status::text = any(${bind([...query.status])}::text[])`);
    }
    if (query.since !== undefined) {
      where.push(`r.queued_at >= ${bind(query.since)}::timestamptz`);
    }
    const limit = query.limit ?? 50;
    const result = await this.sql.query(
      `select ${RUN_COLUMNS_JOINED}, a.slug as agent_slug
         from public.agent_runs r
         join public.agents a on a.id = r.agent_id
        ${where.length === 0 ? "" : `where ${where.join(" and ")}`}
        order by r.queued_at desc
        limit ${bind(limit)}`,
      params,
    );
    return result.rows.map((row) =>
      mapRun(
        row,
        str(expectRow(row, "agent_runs"), "agent_slug", "agent_runs"),
      ),
    );
  }

  async appendMessage(input: AppendMessageInput): Promise<MessageRecord> {
    const result = await this.sql.query(
      `insert into public.agent_messages
         (run_id, seq, role, content, content_json, tool_name, tokens, model, stop_reason)
       values ($1,
               (select coalesce(max(seq) + 1, 0) from public.agent_messages where run_id = $1),
               $2::public.agent_message_role, $3, $4::jsonb, $5, $6, $7, $8)
       returning ${MESSAGE_COLUMNS}`,
      [
        input.runId,
        input.role,
        input.content,
        jsonParam(input.contentJson),
        input.toolName ?? null,
        input.tokens ?? null,
        input.model ?? null,
        input.stopReason ?? null,
      ],
    );
    return mapMessage(only(result.rows, "append message"));
  }

  async listMessages(runId: string): Promise<MessageRecord[]> {
    const result = await this.sql.query(
      `select ${MESSAGE_COLUMNS} from public.agent_messages
        where run_id = $1 order by seq`,
      [runId],
    );
    return result.rows.map(mapMessage);
  }

  async createToolCall(input: CreateToolCallInput): Promise<ToolCallRecord> {
    const result = await this.sql.query(
      `insert into public.agent_tool_calls
         (run_id, seq, message_id, tool_name, arguments, is_mutation, status,
          approval_id, started_at)
       values ($1,
               (select coalesce(max(seq) + 1, 0) from public.agent_tool_calls where run_id = $1),
               $2::uuid, $3, $4::jsonb, $5, $6::public.tool_call_status,
               $7::uuid, $8::timestamptz)
       returning ${TOOL_CALL_COLUMNS}`,
      [
        input.runId,
        input.messageId,
        input.toolName,
        JSON.stringify(input.arguments),
        input.isMutation,
        input.status,
        input.approvalId ?? null,
        input.startedAt ?? null,
      ],
    );
    return mapToolCall(only(result.rows, "create tool call"));
  }

  async updateToolCall(
    id: string,
    patch: UpdateToolCallPatch,
  ): Promise<ToolCallRecord> {
    const sets: string[] = ["updated_at = now()"];
    const params: unknown[] = [id];
    const add = (fragment: string, value: unknown): void => {
      params.push(value);
      sets.push(fragment.replace("$n", `$${String(params.length)}`));
    };
    if (patch.status !== undefined) {
      add("status = $n::public.tool_call_status", patch.status);
    }
    if (patch.result !== undefined) {
      add("result = $n::jsonb", jsonParam(patch.result));
    }
    if (patch.error !== undefined) add("error = $n", patch.error);
    if (patch.approvalId !== undefined) {
      add("approval_id = $n::uuid", patch.approvalId);
    }
    if (patch.startedAt !== undefined) {
      add("started_at = $n::timestamptz", patch.startedAt);
    }
    if (patch.finishedAt !== undefined) {
      add("finished_at = $n::timestamptz", patch.finishedAt);
    }
    const result = await this.sql.query(
      `update public.agent_tool_calls set ${sets.join(", ")}
        where id = $1 returning ${TOOL_CALL_COLUMNS}`,
      params,
    );
    return mapToolCall(only(result.rows, "update tool call"));
  }

  async listToolCalls(runId: string): Promise<ToolCallRecord[]> {
    const result = await this.sql.query(
      `select ${TOOL_CALL_COLUMNS} from public.agent_tool_calls
        where run_id = $1 order by seq`,
      [runId],
    );
    return result.rows.map(mapToolCall);
  }

  async createApproval(input: CreateApprovalInput): Promise<ApprovalRecord> {
    const result = await this.sql.query(
      `insert into public.approvals
         (subject_type, subject_table, subject_id, title, summary, rationale,
          payload, preview, risk, amount_cents, currency, requested_by_agent_id,
          requested_by_run_id, expires_at)
       values ($1::public.approval_subject, $2, $3::uuid, $4, $5, $6,
               $7::jsonb, $8::jsonb, $9::public.approval_risk, $10,
               $11::public.currency_code, $12::uuid, $13::uuid, $14::timestamptz)
       returning ${APPROVAL_COLUMNS}`,
      [
        input.subjectType,
        input.subjectTable,
        input.subjectId ?? null,
        input.title,
        input.summary,
        input.rationale,
        JSON.stringify(input.payload),
        JSON.stringify(input.preview),
        input.risk,
        input.amountCents ?? null,
        input.currency ?? "NZD",
        input.requestedByAgentId,
        input.requestedByRunId,
        input.expiresAt ?? null,
      ],
    );
    return mapApproval(only(result.rows, "create approval"));
  }

  async getApproval(approvalId: string): Promise<ApprovalRecord | null> {
    const result = await this.sql.query(
      `select ${APPROVAL_COLUMNS} from public.approvals where id = $1`,
      [approvalId],
    );
    return result.rows.length === 0 ? null : mapApproval(result.rows[0]);
  }

  /**
   * Record a decision.
   *
   * `and status = 'pending'` is the whole concurrency story, exactly as
   * `components/admin/approvals/actions.ts` writes it: two decisions on the
   * same row cannot both win, and the loser is told the row was already
   * decided rather than silently overwriting the answer that stuck.
   */
  async decideApproval(input: DecideApprovalInput): Promise<ApprovalRecord> {
    const result = await this.sql.query(
      `update public.approvals
          set status = $2::public.approval_status,
              decided_by = $3::uuid,
              decided_at = $4::timestamptz,
              decision_note = $5,
              updated_at = now()
        where id = $1 and status = 'pending'
       returning ${APPROVAL_COLUMNS}`,
      [
        input.approvalId,
        input.status,
        isUuid(input.decidedBy) ? input.decidedBy : null,
        input.decidedAt,
        input.decisionNote,
      ],
    );
    if (result.rows.length === 0) {
      const current = await this.getApproval(input.approvalId);
      throw new AgentRuntimeError(
        "store_conflict",
        current === null
          ? `Approval ${input.approvalId} does not exist.`
          : `Approval ${input.approvalId} was already ${current.status}.`,
        { approvalId: input.approvalId },
      );
    }
    return mapApproval(result.rows[0]);
  }

  async markApprovalApplied(
    approvalId: string,
    appliedAt: string,
    appliedResult: JsonValue,
  ): Promise<ApprovalRecord> {
    const result = await this.sql.query(
      `update public.approvals
          set applied_at = $2::timestamptz, applied_result = $3::jsonb, updated_at = now()
        where id = $1
       returning ${APPROVAL_COLUMNS}`,
      [approvalId, appliedAt, jsonParam(appliedResult)],
    );
    return mapApproval(only(result.rows, "mark approval applied"));
  }

  async listApprovals(query: ApprovalQuery): Promise<ApprovalRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${String(params.length)}`;
    };
    if (query.status !== undefined && query.status.length > 0) {
      where.push(`status::text = any(${bind([...query.status])}::text[])`);
    }
    if (query.runId !== undefined) {
      where.push(`requested_by_run_id = ${bind(query.runId)}`);
    }
    if (query.agentId !== undefined) {
      where.push(`requested_by_agent_id = ${bind(query.agentId)}`);
    }
    const result = await this.sql.query(
      `select ${APPROVAL_COLUMNS} from public.approvals
        ${where.length === 0 ? "" : `where ${where.join(" and ")}`}
        order by requested_at desc
        limit ${bind(query.limit ?? 100)}`,
      params,
    );
    return result.rows.map(mapApproval);
  }

  async recordCost(input: RecordCostInput): Promise<CostRecord> {
    const result = await this.sql.query(
      `insert into public.agent_costs
         (agent_id, run_id, tool_call_id, incurred_on, incurred_at, provider,
          model, kind, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, cost_micros, currency, note)
       values ($1, $2::uuid, $3::uuid, $4::date, $5::timestamptz, $6, $7, $8,
               $9, $10, $11, $12, $13, $14::public.currency_code, $15)
       returning ${COST_COLUMNS}`,
      [
        input.agentId,
        input.runId,
        input.toolCallId,
        input.incurredOn,
        input.incurredAt,
        input.provider,
        input.model,
        input.kind,
        input.inputTokens,
        input.outputTokens,
        input.cacheReadTokens,
        input.cacheWriteTokens,
        input.costMicros,
        input.currency,
        input.note,
      ],
    );
    return mapCost(only(result.rows, "record cost"));
  }

  async listCosts(window: CostWindow): Promise<CostRecord[]> {
    const { where, params } = costWindow(window);
    const result = await this.sql.query(
      `select ${COST_COLUMNS} from public.agent_costs
        ${where === "" ? "" : `where ${where}`}
        order by incurred_at desc limit 500`,
      params,
    );
    return result.rows.map(mapCost);
  }

  async sumCostMicros(window: CostWindow): Promise<number> {
    const { where, params } = costWindow(window);
    const result = await this.sql.query(
      `select coalesce(sum(cost_micros), 0)::text as total
         from public.agent_costs ${where === "" ? "" : `where ${where}`}`,
      params,
    );
    return num(only(result.rows, "sum costs"), "total");
  }

  async getSetting(key: string): Promise<JsonValue | null> {
    const result = await this.sql.query(
      `select value from public.settings where key = $1`,
      [key],
    );
    const row = result.rows[0];
    return row === undefined ? null : json(expectRow(row, "settings"), "value");
  }

  async setSetting(
    key: string,
    value: JsonValue,
    description: string,
  ): Promise<void> {
    await this.sql.query(
      `insert into public.settings (key, value, description, category)
       values ($1, $2::jsonb, $3, 'agents')
       on conflict (key) do update
         set value = excluded.value,
             description = excluded.description,
             updated_at = now()`,
      [key, jsonParam(value), description],
    );
  }

  async listBrandRules(scopes: readonly string[]): Promise<BrandRuleRecord[]> {
    const result = await this.sql.query(
      `select slug, kind::text, severity::text, title, rule, applies_to,
              keywords, priority
         from public.brand_rules
        where is_active
          and ($1::text[] is null or applies_to && $1::text[])
        order by priority`,
      [scopes.length === 0 ? null : [...scopes]],
    );
    return result.rows.map(mapBrandRule);
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.sql.query(
      `insert into public.audit_log
         (actor_type, actor_id, actor_label, action, entity_type, entity_id,
          entity_label, summary, before_data, after_data, agent_run_id, approval_id)
       values ($1::public.actor_type, $2::uuid, $3, $4::public.audit_action, $5,
               $6::uuid, $7, $8, $9::jsonb, $10::jsonb, $11::uuid, $12::uuid)`,
      [
        entry.actorType,
        isUuid(entry.actorId) ? entry.actorId : null,
        entry.actorLabel,
        entry.action,
        entry.entityType,
        isUuid(entry.entityId) ? entry.entityId : null,
        entry.entityLabel,
        entry.summary,
        jsonParam(entry.beforeData),
        jsonParam(entry.afterData),
        entry.agentRunId,
        entry.approvalId,
      ],
    );
  }

  /** The slug behind an agent id, cached because a run read asks for it often. */
  private async slugFor(agentId: string): Promise<string> {
    const cached = this.slugById.get(agentId);
    if (cached !== undefined) return cached;
    const result = await this.sql.query(
      `select slug from public.agents where id = $1`,
      [agentId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new AgentRuntimeError(
        "agent_not_found",
        `No agent with id "${agentId}".`,
        { agentId },
      );
    }
    const slug = str(expectRow(row, "agents"), "slug", "agents");
    this.slugById.set(agentId, slug);
    return slug;
  }
}

function costWindow(window: CostWindow): {
  readonly where: string;
  readonly params: readonly unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${String(params.length)}`;
  };
  if (window.agentId !== undefined) {
    clauses.push(`agent_id = ${bind(window.agentId)}`);
  }
  if (window.runId !== undefined)
    clauses.push(`run_id = ${bind(window.runId)}`);
  if (window.fromDate !== undefined) {
    clauses.push(`incurred_on >= ${bind(window.fromDate)}::date`);
  }
  if (window.toDate !== undefined) {
    clauses.push(`incurred_on <= ${bind(window.toDate)}::date`);
  }
  return { where: clauses.join(" and "), params };
}

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a value can be an id this database issued.
 *
 * `AuditEntry.actorId` and `DecideApprovalInput.decidedBy` are typed as
 * `string | null` because the in-memory store lets a test say `"founder"`.
 * Postgres will not cast that to a uuid, so a label that is not an id is
 * recorded as no id rather than failing the whole write — the actor's name is
 * on the row either way, in `actor_label`.
 */
function isUuid(value: string | null): value is string {
  return value !== null && UUID_SHAPE.test(value);
}
