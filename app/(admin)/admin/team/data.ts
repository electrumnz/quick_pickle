import "server-only";

import {
  adminSql,
  bool,
  int,
  iso,
  isoOrNull,
  text,
  textOrNull,
} from "@/components/admin/data/db";
import { pgTextArray } from "@/lib/agents/roster";

/**
 * What The Team page reads.
 *
 * It is its own module rather than another function in
 * `components/admin/data/queries.ts` for one reason worth writing down: an
 * `agents.requires_approval_for` value is an array of an ENUM, and `pg` does
 * not parse those. Enum OIDs are per-database, so the driver has no type parser
 * and hands the column back as the literal string
 * `{purchase_order,inventory_adjustment}`. Anything that treats it as an array
 * silently renders "always asks you about: (nothing)" for every agent in the
 * company, which is the most dangerous possible thing for this screen to get
 * wrong. `pgTextArray` copes with both shapes.
 *
 * Everything here answers one of the three questions the founder actually has:
 * what is this thing for, what may it do without me, and what did it do and why.
 */

/** One agent, as the Team page shows it. */
export type TeamMember = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly jobTitle: string;
  readonly purpose: string;
  readonly model: string;
  readonly status: string;
  readonly autonomy: string;
  readonly isEnabled: boolean;
  readonly tools: readonly string[];
  readonly needsApprovalFor: readonly string[];
  readonly dailyCapCents: number;
  readonly monthlyCapCents: number;
  readonly singleActionCapCents: number | null;
  readonly scheduleCron: string | null;
  readonly lastRunAt: string | null;
  readonly runsCount: number;
  readonly spentTodayCents: number;
  readonly spentMonthCents: number;
  readonly pendingApprovals: number;
  readonly failedRuns7d: number;
  readonly runs7d: number;
  /** What it said the last time it finished something. */
  readonly lastOutcome: string | null;
};

const MEMBER_SELECT = `
  select a.id, a.slug, a.name, a.job_title, a.purpose, a.model, a.status,
         a.autonomy, a.is_enabled, a.tools, a.requires_approval_for,
         a.daily_spend_cap_cents, a.monthly_spend_cap_cents,
         a.single_action_cap_cents, a.schedule_cron, a.last_run_at, a.runs_count,
         coalesce(today.micros, 0) as spent_today_micros,
         coalesce(month.micros, 0) as spent_month_micros,
         coalesce(pending.n, 0)    as pending_approvals,
         coalesce(failed.n, 0)     as failed_runs_7d,
         coalesce(week.n, 0)       as runs_7d,
         last_done.outcome         as last_outcome
    from public.agents a
    left join lateral (
      select sum(c.cost_micros) as micros from public.agent_costs c
       where c.agent_id = a.id
         and c.incurred_on = (now() at time zone 'Pacific/Auckland')::date
    ) today on true
    left join lateral (
      select sum(c.cost_micros) as micros from public.agent_costs c
       where c.agent_id = a.id
         and c.incurred_on >= date_trunc('month',
               (now() at time zone 'Pacific/Auckland'))::date
    ) month on true
    left join lateral (
      select count(*)::int as n from public.approvals ap
       where ap.requested_by_agent_id = a.id and ap.status = 'pending'
    ) pending on true
    left join lateral (
      select count(*)::int as n from public.agent_runs r
       where r.agent_id = a.id and r.status = 'failed'
         and r.queued_at > now() - interval '7 days'
    ) failed on true
    left join lateral (
      select count(*)::int as n from public.agent_runs r
       where r.agent_id = a.id and r.queued_at > now() - interval '7 days'
    ) week on true
    left join lateral (
      select r.outcome from public.agent_runs r
       where r.agent_id = a.id and r.outcome is not null
       order by r.queued_at desc limit 1
    ) last_done on true`;

function toMember(row: Record<string, unknown>): TeamMember {
  return {
    id: text(row, "id"),
    slug: text(row, "slug"),
    name: text(row, "name"),
    jobTitle: text(row, "job_title"),
    purpose: text(row, "purpose"),
    model: text(row, "model"),
    status: text(row, "status"),
    autonomy: text(row, "autonomy"),
    isEnabled: bool(row, "is_enabled"),
    tools: pgTextArray(row["tools"]),
    needsApprovalFor: pgTextArray(row["requires_approval_for"]),
    dailyCapCents: int(row, "daily_spend_cap_cents"),
    monthlyCapCents: int(row, "monthly_spend_cap_cents"),
    singleActionCapCents:
      row["single_action_cap_cents"] === null
        ? null
        : int(row, "single_action_cap_cents"),
    scheduleCron: textOrNull(row, "schedule_cron"),
    lastRunAt: isoOrNull(row, "last_run_at"),
    runsCount: int(row, "runs_count"),
    spentTodayCents: Math.round(int(row, "spent_today_micros") / 10_000),
    spentMonthCents: Math.round(int(row, "spent_month_micros") / 10_000),
    pendingApprovals: int(row, "pending_approvals"),
    failedRuns7d: int(row, "failed_runs_7d"),
    runs7d: int(row, "runs_7d"),
    lastOutcome: textOrNull(row, "last_outcome"),
  };
}

/** Everyone on the payroll, registered or not, name-ordered. */
export async function teamMembers(): Promise<readonly TeamMember[]> {
  const result = await adminSql().query(`${MEMBER_SELECT} order by a.name`);
  return result.rows.map(toMember);
}

/** One agent by slug, or null when the admin knows a name the database does not. */
export async function teamMember(slug: string): Promise<TeamMember | null> {
  const result = await adminSql().query(
    `${MEMBER_SELECT} where a.slug = $1 limit 1`,
    [slug],
  );
  const row = result.rows[0];
  return row === undefined ? null : toMember(row);
}

/* --------------------------------------------------------------------- runs */

/** One job the agent ran, with what it said and what it called. */
export type AgentRun = {
  readonly id: string;
  readonly status: string;
  readonly trigger: string;
  readonly goal: string;
  readonly outcome: string | null;
  readonly error: string | null;
  readonly queuedAt: string;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly costCents: number;
  readonly toolCallCount: number;
  readonly blockingApprovalId: string | null;
  /** Every sentence it gave as its reason for acting, in order. */
  readonly reasoning: readonly string[];
  readonly actions: readonly {
    readonly tool: string;
    readonly status: string;
    readonly isMutation: boolean;
    readonly needsApproval: boolean;
    readonly error: string | null;
  }[];
};

/**
 * The last few jobs one agent ran, each with its reasoning trail.
 *
 * The reasoning is `agent_messages`, filtered to what the agent itself said
 * before acting. It is the answer to "why did it do that", and it is read back
 * out of storage rather than reconstructed, so a run that crashed halfway is
 * just as legible as one that finished.
 */
export async function runsForAgent(
  agentId: string,
  limit = 6,
): Promise<readonly AgentRun[]> {
  const sql = adminSql();
  const runs = await sql.query(
    `select r.id, r.status, r.trigger, r.goal, r.outcome, r.error, r.queued_at,
            r.finished_at, r.duration_ms, r.cost_micros, r.tool_call_count,
            r.blocking_approval_id
       from public.agent_runs r
      where r.agent_id = $1
      order by r.queued_at desc
      limit $2`,
    [agentId, limit],
  );
  if (runs.rows.length === 0) return [];

  const ids = runs.rows.map((row) => text(row, "id"));
  const [messages, calls] = await Promise.all([
    sql.query(
      `select run_id, content, seq from public.agent_messages
        where run_id = any($1::uuid[]) and role = 'assistant'
          and content is not null
        order by seq`,
      [ids],
    ),
    sql.query(
      `select run_id, tool_name, status, is_mutation, approval_id, error, seq
         from public.agent_tool_calls
        where run_id = any($1::uuid[])
        order by seq`,
      [ids],
    ),
  ]);

  const reasoningByRun = new Map<string, string[]>();
  for (const row of messages.rows) {
    const runId = text(row, "run_id");
    const list = reasoningByRun.get(runId) ?? [];
    list.push(text(row, "content"));
    reasoningByRun.set(runId, list);
  }
  const actionsByRun = new Map<string, AgentRun["actions"][number][]>();
  for (const row of calls.rows) {
    const runId = text(row, "run_id");
    const list = actionsByRun.get(runId) ?? [];
    list.push({
      tool: text(row, "tool_name"),
      status: text(row, "status"),
      isMutation: bool(row, "is_mutation"),
      needsApproval: row["approval_id"] !== null,
      error: textOrNull(row, "error"),
    });
    actionsByRun.set(runId, list);
  }

  return runs.rows.map((row) => {
    const id = text(row, "id");
    return {
      id,
      status: text(row, "status"),
      trigger: text(row, "trigger"),
      goal: text(row, "goal"),
      outcome: textOrNull(row, "outcome"),
      error: textOrNull(row, "error"),
      queuedAt: iso(row, "queued_at"),
      finishedAt: isoOrNull(row, "finished_at"),
      durationMs: row["duration_ms"] === null ? null : int(row, "duration_ms"),
      costCents: Math.round(int(row, "cost_micros") / 10_000),
      toolCallCount: int(row, "tool_call_count"),
      blockingApprovalId: textOrNull(row, "blocking_approval_id"),
      reasoning: reasoningByRun.get(id) ?? [],
      actions: actionsByRun.get(id) ?? [],
    };
  });
}

/** The whole team's recent work, newest first. */
export type TeamRun = AgentRun & {
  readonly agentName: string;
  readonly agentSlug: string;
};

export async function recentTeamRuns(limit = 8): Promise<readonly TeamRun[]> {
  const sql = adminSql();
  const runs = await sql.query(
    `select r.id, r.status, r.trigger, r.goal, r.outcome, r.error, r.queued_at,
            r.finished_at, r.duration_ms, r.cost_micros, r.tool_call_count,
            r.blocking_approval_id, a.name as agent_name, a.slug as agent_slug,
            (select m.content from public.agent_messages m
              where m.run_id = r.id and m.role = 'assistant'
                and m.content is not null
              order by m.seq desc limit 1) as last_reason
       from public.agent_runs r
       join public.agents a on a.id = r.agent_id
      order by r.queued_at desc
      limit $1`,
    [limit],
  );
  return runs.rows.map((row) => ({
    id: text(row, "id"),
    agentName: text(row, "agent_name"),
    agentSlug: text(row, "agent_slug"),
    status: text(row, "status"),
    trigger: text(row, "trigger"),
    goal: text(row, "goal"),
    outcome: textOrNull(row, "outcome"),
    error: textOrNull(row, "error"),
    queuedAt: iso(row, "queued_at"),
    finishedAt: isoOrNull(row, "finished_at"),
    durationMs: row["duration_ms"] === null ? null : int(row, "duration_ms"),
    costCents: Math.round(int(row, "cost_micros") / 10_000),
    toolCallCount: int(row, "tool_call_count"),
    blockingApprovalId: textOrNull(row, "blocking_approval_id"),
    reasoning:
      textOrNull(row, "last_reason") === null ? [] : [text(row, "last_reason")],
    actions: [],
  }));
}

/* ----------------------------------------------------------------- the team */

export type TeamTotals = {
  readonly todayCents: number;
  readonly monthCents: number;
  readonly dailyCapCents: number;
  readonly monthlyCapCents: number;
  readonly killSwitchOn: boolean;
  readonly runsToday: number;
  readonly runningNow: number;
  readonly waitingOnYou: number;
  readonly onDuty: number;
  readonly paused: number;
};

/** What the whole team costs and what it is doing right now. */
export async function teamTotals(): Promise<TeamTotals> {
  const sql = adminSql();
  const [costs, caps, kill, runs] = await Promise.all([
    sql.query(
      `select coalesce(sum(cost_micros) filter (
                where incurred_on = (now() at time zone 'Pacific/Auckland')::date
              ), 0) as today_micros,
              coalesce(sum(cost_micros) filter (
                where incurred_on >= date_trunc('month',
                        (now() at time zone 'Pacific/Auckland'))::date
              ), 0) as month_micros
         from public.agent_costs`,
    ),
    sql.query(
      `select coalesce(sum(daily_spend_cap_cents), 0)   as daily,
              coalesce(sum(monthly_spend_cap_cents), 0) as monthly,
              count(*) filter (where is_enabled)::int   as on_duty,
              count(*) filter (where not is_enabled)::int as paused
         from public.agents where status <> 'retired'`,
    ),
    sql.query(
      `select value from public.settings where key = 'agents.kill_switch'`,
    ),
    sql.query(
      `select count(*) filter (
                where queued_at >= (date_trunc('day',
                  now() at time zone 'Pacific/Auckland')
                  at time zone 'Pacific/Auckland')
              )::int                                              as today,
              count(*) filter (where status = 'running')::int      as running,
              count(*) filter (where status = 'awaiting_approval')::int as waiting
         from public.agent_runs`,
    ),
  ]);
  const costRow = costs.rows[0] ?? {};
  const capRow = caps.rows[0] ?? {};
  const runRow = runs.rows[0] ?? {};
  const killValue = kill.rows[0]?.["value"];
  const halted =
    killValue !== null &&
    typeof killValue === "object" &&
    (killValue as Record<string, unknown>)["halted"] === true;
  return {
    todayCents: Math.round(int(costRow, "today_micros") / 10_000),
    monthCents: Math.round(int(costRow, "month_micros") / 10_000),
    dailyCapCents: int(capRow, "daily"),
    monthlyCapCents: int(capRow, "monthly"),
    killSwitchOn: halted,
    runsToday: int(runRow, "today"),
    runningNow: int(runRow, "running"),
    waitingOnYou: int(runRow, "waiting"),
    onDuty: int(capRow, "on_duty"),
    paused: int(capRow, "paused"),
  };
}

/** The decisions one agent is waiting on. */
export async function approvalsForAgent(
  agentId: string,
  limit = 8,
): Promise<
  readonly {
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly rationale: string | null;
    readonly subjectType: string;
    readonly status: string;
    readonly risk: string;
    readonly amountCents: number | null;
    readonly requestedAt: string;
    readonly decidedAt: string | null;
    readonly decisionNote: string | null;
  }[]
> {
  const result = await adminSql().query(
    `select id, title, summary, rationale, subject_type, status, risk,
            amount_cents, requested_at, decided_at, decision_note
       from public.approvals
      where requested_by_agent_id = $1
      order by case when status = 'pending' then 0 else 1 end,
               requested_at desc
      limit $2`,
    [agentId, limit],
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    title: text(row, "title"),
    summary: text(row, "summary"),
    rationale: textOrNull(row, "rationale"),
    subjectType: text(row, "subject_type"),
    status: text(row, "status"),
    risk: text(row, "risk"),
    amountCents: row["amount_cents"] === null ? null : int(row, "amount_cents"),
    requestedAt: iso(row, "requested_at"),
    decidedAt: isoOrNull(row, "decided_at"),
    decisionNote: textOrNull(row, "decision_note"),
  }));
}

/**
 * Pause or restart one agent.
 *
 * This writes exactly what `StoreControlPlane.pauseAgent()` writes —
 * `setAgentStatus(slug, "paused", false)` — because that is what the runtime
 * reads: `assertNotHalted` refuses a run when `!agent.isEnabled ||
 * agent.status !== "active"`, before every model call and again before every
 * tool call. So a paused agent stops mid-run rather than finishing what it
 * started.
 *
 * It is SQL rather than a call into the control plane because the control plane
 * takes an `AgentStore`, and the only SQL implementation of that port is
 * `SupabaseAgentStore`, which needs service-role credentials this deployment
 * does not have. The columns are the same two columns either way.
 */
export async function setAgentPaused(
  slug: string,
  paused: boolean,
): Promise<TeamMember | null> {
  const result = await adminSql().query(
    `update public.agents
        set is_enabled = $2,
            status = case
              when status = 'retired' then status
              when $2 then 'active'::public.agent_status
              else 'paused'::public.agent_status
            end,
            updated_at = now()
      where slug = $1
      returning slug`,
    [slug, !paused],
  );
  if (result.rows.length === 0) return null;
  return teamMember(slug);
}
