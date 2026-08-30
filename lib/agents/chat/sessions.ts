/**
 * Reading and writing the thread.
 *
 * `chat_sessions` is the conversation she can leave and come back to;
 * `chat_turns` is one row per thing she said and a pointer to the run it
 * opened. Nothing here stores an agent's words: the reply is
 * `agent_runs.outcome`, joined in at read time, so there is exactly one copy of
 * what an agent said and the replay on The Team page and the line in the chat
 * log cannot disagree.
 */

import type { Capability } from "../boundary/handoff";
import type { AgentSqlClient } from "../store/sql-store";

/** Mirrors `public.chat_turn_outcome`. */
export type ChatTurnOutcome =
  "working" | "answered" | "waiting_on_you" | "nobody_does_that" | "stopped";

export interface ChatSessionRow {
  readonly id: string;
  readonly title: string;
  readonly status: "open" | "archived";
  readonly startedAt: string;
  readonly lastActivityAt: string;
  /** How many things she has said in it. */
  readonly turnCount: number;
  /** How many of those are parked on a decision she has not made. */
  readonly waitingCount: number;
}

export interface ChatTurnRow {
  readonly id: string;
  readonly seq: number;
  readonly asked: string;
  readonly askedAt: string;
  readonly capability: Capability | null;
  readonly agentName: string | null;
  readonly agentJobTitle: string | null;
  readonly runId: string | null;
  readonly outcome: ChatTurnOutcome;
  /** The routing layer's own words. Never an agent's. */
  readonly note: string | null;
  /** What the agent actually said: `agent_runs.outcome`, joined, never copied. */
  readonly said: string | null;
  readonly runStatus: string | null;
  readonly runCostMicros: number;
  readonly approvalId: string | null;
  /** Why it went where it went: the phrases the router matched. */
  readonly matched: readonly string[];
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function textOrNull(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function count(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function matchedFrom(row: Record<string, unknown>): readonly string[] {
  const detail = row["detail"];
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) {
    return [];
  }
  const matched = (detail as Record<string, unknown>)["matched"];
  if (!Array.isArray(matched)) return [];
  return matched.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Her conversations, most recently used first.
 *
 * The counts come from the same statement rather than a second round trip,
 * because the list is the first thing on the page and a list that needs one
 * query per row is a list that gets slower as she uses it more.
 */
export async function listSessions(
  sql: AgentSqlClient,
  operatorId: string,
  limit = 20,
): Promise<readonly ChatSessionRow[]> {
  const result = await sql.query(
    `select s.id::text, s.title, s.status::text as status,
            s.started_at::text as started_at,
            s.last_activity_at::text as last_activity_at,
            count(t.id)::int as turn_count,
            count(t.id) filter (where t.outcome = 'waiting_on_you')::int as waiting_count
       from public.chat_sessions s
       left join public.chat_turns t on t.session_id = s.id
      where s.operator_id = $1
      group by s.id
      order by s.last_activity_at desc
      limit $2`,
    [operatorId, limit],
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    title: text(row, "title"),
    status: text(row, "status") === "archived" ? "archived" : "open",
    startedAt: text(row, "started_at"),
    lastActivityAt: text(row, "last_activity_at"),
    turnCount: count(row, "turn_count"),
    waitingCount: count(row, "waiting_count"),
  }));
}

/** One session by id, scoped to its owner so an id from elsewhere opens nothing. */
export async function sessionById(
  sql: AgentSqlClient,
  operatorId: string,
  sessionId: string,
): Promise<ChatSessionRow | null> {
  const sessions = await listSessions(sql, operatorId, 100);
  return sessions.find((session) => session.id === sessionId) ?? null;
}

/**
 * A title from her first sentence.
 *
 * "Session 4" tells her nothing when she comes back on Thursday; the first
 * thing she asked tells her everything. Trimmed on a word boundary so a long
 * question does not become a long row.
 */
export function titleFrom(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat === "" ? "A new conversation" : flat;
  const cut = flat.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 30 ? lastSpace : 60).trimEnd()}…`;
}

/** Start a conversation. */
export async function openSession(
  sql: AgentSqlClient,
  operatorId: string,
  title: string,
): Promise<string> {
  const result = await sql.query(
    `insert into public.chat_sessions (operator_id, title)
     values ($1, $2) returning id::text`,
    [operatorId, title],
  );
  return text(result.rows[0] ?? {}, "id");
}

/** The conversation she was last in, if there is one still open. */
export async function latestOpenSession(
  sql: AgentSqlClient,
  operatorId: string,
): Promise<ChatSessionRow | null> {
  const sessions = await listSessions(sql, operatorId, 1);
  const first = sessions[0];
  return first !== undefined && first.status === "open" ? first : null;
}

/**
 * The thread, oldest first.
 *
 * `agent_runs` is joined rather than copied: `said` is the run's own outcome
 * text and `run_status` its own status, so a run that later halts or is
 * resumed shows the truth here without anything writing to `chat_turns` again.
 */
export async function turnsFor(
  sql: AgentSqlClient,
  sessionId: string,
): Promise<readonly ChatTurnRow[]> {
  const result = await sql.query(
    `select t.id::text, t.seq, t.asked, t.asked_at::text as asked_at,
            t.capability, t.outcome::text as outcome, t.note, t.detail,
            t.run_id::text as run_id,
            a.name as agent_name, a.job_title as agent_job_title,
            r.outcome as said, r.status::text as run_status,
            coalesce(r.cost_micros, 0)::text as run_cost_micros,
            r.blocking_approval_id::text as approval_id
       from public.chat_turns t
       left join public.agents a on a.id = t.agent_id
       left join public.agent_runs r on r.id = t.run_id
      where t.session_id = $1
      order by t.seq`,
    [sessionId],
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    seq: count(row, "seq"),
    asked: text(row, "asked"),
    askedAt: text(row, "asked_at"),
    capability: (textOrNull(row, "capability") as Capability | null) ?? null,
    agentName: textOrNull(row, "agent_name"),
    agentJobTitle: textOrNull(row, "agent_job_title"),
    runId: textOrNull(row, "run_id"),
    outcome: (text(row, "outcome") || "working") as ChatTurnOutcome,
    note: textOrNull(row, "note"),
    said: textOrNull(row, "said"),
    runStatus: textOrNull(row, "run_status"),
    runCostMicros: count(row, "run_cost_micros"),
    approvalId: textOrNull(row, "approval_id"),
    matched: matchedFrom(row),
  }));
}

/** How many turns across all her conversations are parked on a decision. */
export async function waitingOnHer(
  sql: AgentSqlClient,
  operatorId: string,
): Promise<number> {
  const result = await sql.query(
    `select count(*)::int as n
       from public.chat_turns t
       join public.chat_sessions s on s.id = t.session_id
      where s.operator_id = $1 and t.outcome = 'waiting_on_you'`,
    [operatorId],
  );
  return count(result.rows[0] ?? {}, "n");
}

export interface RecordTurnInput {
  readonly sessionId: string;
  readonly asked: string;
  readonly capability: Capability | null;
  readonly matched: readonly string[];
}

/**
 * Write down what she said, before anything is done about it.
 *
 * Written first and settled afterwards on purpose: if the run throws, crashes
 * or times out, the thing she typed is still in her conversation and the turn
 * says `working` rather than vanishing. The sequence number is allocated in the
 * same statement, against the unique index, so two tabs cannot both be turn 4.
 */
export async function recordTurn(
  sql: AgentSqlClient,
  input: RecordTurnInput,
): Promise<{ readonly id: string; readonly seq: number }> {
  const result = await sql.query(
    `insert into public.chat_turns (session_id, seq, asked, capability, detail)
     values ($1,
             (select coalesce(max(seq) + 1, 1) from public.chat_turns where session_id = $1),
             $2, $3, $4::jsonb)
     returning id::text, seq`,
    [
      input.sessionId,
      input.asked,
      input.capability,
      JSON.stringify({ matched: [...input.matched] }),
    ],
  );
  const row = result.rows[0] ?? {};
  return { id: text(row, "id"), seq: count(row, "seq") };
}

/**
 * Point the turn at its conversation.
 *
 * A separate statement because the conversation's name contains the turn's own
 * sequence number, which the insert above allocates — and because
 * `chat_turns.conversation_id` is a foreign key, so the ledger row has to exist
 * first. Attached before the run opens, so the record of which ceiling this ask
 * was counted against is written before anything is counted.
 */
export async function attachConversation(
  sql: AgentSqlClient,
  turnId: string,
  conversationId: string,
): Promise<void> {
  await sql.query(
    `update public.chat_turns set conversation_id = $2, updated_at = now()
      where id = $1`,
    [turnId, conversationId],
  );
}

export interface SettleTurnInput {
  readonly turnId: string;
  readonly outcome: ChatTurnOutcome;
  readonly agentId?: string | null;
  readonly runId?: string | null;
  readonly note?: string | null;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** Say how the turn ended. `detail` is merged, so the routing words survive. */
export async function settleTurn(
  sql: AgentSqlClient,
  input: SettleTurnInput,
): Promise<void> {
  await sql.query(
    `update public.chat_turns
        set outcome = $2::public.chat_turn_outcome,
            agent_id = coalesce($3::uuid, agent_id),
            run_id = coalesce($4::uuid, run_id),
            note = $5,
            detail = detail || $6::jsonb,
            settled_at = now(),
            updated_at = now()
      where id = $1`,
    [
      input.turnId,
      input.outcome,
      input.agentId ?? null,
      input.runId ?? null,
      input.note ?? null,
      JSON.stringify(input.detail ?? {}),
    ],
  );
}

/** Bump the session so the list orders by what she used last. */
export async function touchSession(
  sql: AgentSqlClient,
  sessionId: string,
): Promise<void> {
  await sql.query(
    `update public.chat_sessions
        set last_activity_at = now(), updated_at = now()
      where id = $1`,
    [sessionId],
  );
}

/**
 * The conversation id for one turn.
 *
 * One conversation per ask, not per session: the cap exists to stop agents
 * circling, and capping the session would cap HER at five messages. Shaped to
 * satisfy `agent_conversations_id_shape` and to be readable in a halt record.
 */
export function conversationIdFor(sessionId: string, seq: number): string {
  return `chat:${sessionId}:${String(seq)}`;
}
