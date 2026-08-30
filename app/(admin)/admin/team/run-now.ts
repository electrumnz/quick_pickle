"use server";

import { revalidatePath } from "next/cache";

import { adminSql } from "@/components/admin/data/db";
import {
  audit,
  authorise,
  done,
  readReturnPath,
  readText,
  refuse,
  type FlashCode,
} from "@/components/admin/write/guard";
import { SqlAgentStore, formatMicrosNzd } from "@/lib/agents";
import { RecordingOutbox, createRosterPlatform } from "@/lib/agents/roster";
import {
  MemoryDurableStep,
  WorkflowParked,
  runAgentWorkflow,
  type AgentRunResult,
} from "@/inngest";

import {
  closeStrandedManualRuns,
  liveManualRun,
  stampRunOperator,
  teamMember,
  teamTotals,
} from "./data";
import { runNowBlockers } from "./run-readiness";

/**
 * Start one agent, now, because the founder asked it to.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is a **trigger**, not a runtime. Every safety property of a scheduled run
 * belongs to `lib/agents/runtime`, and none of it is re-implemented here: the
 * same `runAgentWorkflow` that `inngest/functions/agent-run.ts` calls drives the
 * same `AgentRuntime` through the same authorisation check, the same approval
 * gate, the same cost meter, the same kill switch, the same inbound boundary
 * framing and the same transcript writes. The only substitution is the durable
 * driver: Inngest's `step` is replaced by {@link MemoryDurableStep}, the
 * faithful in-process implementation of the same step model that
 * `inngest/durable-step.ts` already ships and that `tests/agents` already proves
 * the park-and-resume behaviour against.
 *
 * That substitution buys exactly one thing, and it is the thing this unit exists
 * for: **you can press a button and watch it work.** Production scheduling goes
 * through Inngest Cloud, which needs an account, an event key and a signing key
 * this deployment does not have — and a cron is the wrong shape for "make one
 * think, now, while I read what it said".
 *
 * It costs the same. A run started here is priced by the same meter, counted
 * against the same four ceilings and written to the same `agent_costs` rows as
 * one started by a schedule. `trigger = 'manual'` is the only difference on the
 * record, and `triggerWords()` has rendered that as "started by you" since the
 * Team page was built.
 *
 * ## Why parking is not an error
 *
 * A run that reaches something its rules say a human decides does not fail. The
 * gate writes the approvals row, sets the run to `awaiting_approval` with the
 * blocking approval on it, and `MemoryDurableStep` throws {@link WorkflowParked}
 * because there is no event to wait for inside one request. That is caught below
 * and reported as what it is — "it stopped and asked you" — with the decision
 * sitting in the queue the founder already knows. Saying yes there is what
 * carries it on, exactly as it would for a scheduled run.
 *
 * ## The three checks, in the order every admin write makes them
 *
 * `authorise()` is `requireAdminSession()` and then `assertAdminCsrf()`, and it
 * is NOT demo-aware. This is the point of the unit. Reads on this admin are open
 * because every row behind them is invented; writes that only touch that
 * invented database still redirect to `/login` because an `audit_log` row needs
 * an operator to stamp. This one is different in kind again: it spends real
 * money against a real API key, on a URL anyone can reach. There is no demo
 * exemption here and there must never be one.
 */

/** A run left marked live this long by a request that never reported back. */
const STRANDED_AFTER_MINUTES = 15;

/**
 * A step driver that remembers which run it opened.
 *
 * The workflow returns a summary when it finishes and throws when it parks, so
 * the run id is only reliably available from the inside. Reading it off the
 * `start-run` step is exact; asking the database afterwards for "the newest run
 * for this agent" would be a guess that is usually right, which is the worst
 * kind.
 */
class RunRecordingStep extends MemoryDurableStep {
  runId: string | null = null;

  override async run(id: string, fn: () => Promise<unknown>): Promise<unknown> {
    const value = await super.run(id, fn);
    if (id === "start-run" && typeof value === "object" && value !== null) {
      const candidate = (value as Record<string, unknown>)["runId"];
      if (typeof candidate === "string") this.runId = candidate;
    }
    return value;
  }
}

export async function runAgentNowAction(formData: FormData): Promise<void> {
  // 1. session, 2. CSRF. Both before anything is read out of the form, so an
  // anonymous caller learns nothing at all — including whether a slug exists.
  const operator = await authorise(formData);
  const slug = readText(formData, "slug");
  const back = readReturnPath(formData, `/admin/team/${slug}`);

  const member = await teamMember(slug);
  if (member === null) refuse(back, "run-agent-paused");

  // A run whose request died — a platform timeout, a redeploy mid-run — leaves
  // a row still marked live, and the database's one-live-manual-run index would
  // then refuse every future press for ever. So a stranded row is closed off
  // first, saying on its own record exactly what happened to it.
  await closeStrandedManualRuns(member.id, STRANDED_AFTER_MINUTES);

  const [totals, live] = await Promise.all([
    teamTotals(),
    liveManualRun(member.id),
  ]);
  const blockers = runNowBlockers({
    member,
    // We are past `authorise()`, so there is a session by construction.
    signedIn: true,
    killSwitchOn: totals.killSwitchOn,
    alreadyRunning: live !== null,
  });
  const first = blockers[0];
  if (first !== undefined) refuse(back, first.code);

  const sql = adminSql();
  const { platform, roster } = await createRosterPlatform({
    sql,
    // Nothing becomes live outbound. Every approved `external` and
    // `storefront_write` action is recorded with `delivered: false`, here as
    // everywhere else; this build has no outbound channel at all.
    outbox: new RecordingOutbox(),
    // The transcript lands in the same database the Team page reads, which is
    // the whole reason `SqlAgentStore` exists: `SupabaseAgentStore` speaks
    // PostgREST and needs service-role credentials this deployment has not got.
    store: new SqlAgentStore(sql),
  });
  const role = roster.roles.find((entry) => entry.definition.slug === slug);
  if (role === undefined) refuse(back, "run-agent-paused");

  const step = new RunRecordingStep();
  step.beginAttempt();

  let outcome: FlashCode;
  let summary: AgentRunResult | null = null;
  try {
    summary = await runAgentWorkflow({
      step,
      platform,
      input: {
        agentSlug: role.definition.slug,
        goal: role.goal,
        trigger: "manual",
      },
    });
    outcome =
      summary.status === "succeeded" ? "run-finished" : "run-stopped-early";
  } catch (cause) {
    if (cause instanceof WorkflowParked) {
      outcome = "run-asked-you";
    } else if (lostTheRace(cause)) {
      // Two presses close enough together that both got past the read above.
      // The database refused the second, which is the guard doing its job, and
      // it is a sentence rather than a crash.
      refuse(back, "run-already-going");
    } else {
      // Anything else is a real failure and belongs on the error boundary. A
      // halt — a cost cap, a lapsed model, the kill switch — is not one of
      // those: the runtime records it on the run and returns a summary.
      throw cause;
    }
  }

  const runId = step.runId;
  if (runId !== null) await stampRunOperator(runId, operator.id);

  await audit({
    operator,
    action: "create",
    entityType: "agent_runs",
    entityId: runId,
    entityLabel: member.name,
    summary:
      summary === null
        ? `Ran ${member.name} by hand. It stopped and asked for a decision before it could finish.`
        : `Ran ${member.name} by hand: ${summary.status}, ` +
          `${String(summary.steps)} model calls, ` +
          `${String(summary.toolCallCount)} actions, ` +
          // Straight from the meter. Nothing here recomputes a price.
          `${formatMicrosNzd(summary.costMicros)}.`,
    before: null,
    after:
      summary === null
        ? { trigger: "manual", status: "awaiting_approval" }
        : {
            trigger: "manual",
            status: summary.status,
            steps: summary.steps,
            tool_calls: summary.toolCallCount,
            // Integer minor units at the meter's own resolution, never a float.
            cost_micros: summary.costMicros,
          },
  });

  revalidatePath(`/admin/team/${slug}`);
  revalidatePath("/admin/team");
  revalidatePath("/admin");

  // A halt is bad news and a park is neutral, so they land in different halves
  // of the flash — but both are honest endings, and both leave the founder on
  // the finished transcript rather than on a spinner.
  if (outcome === "run-stopped-early") refuse(back, outcome);
  done(back, outcome);
}

/**
 * Whether Postgres refused this run because one was already live.
 *
 * `agent_runs_one_live_manual_run` is a partial unique index, so a second press
 * that slips past the read above arrives here as a unique violation. Matching on
 * the constraint's own name rather than on a SQLSTATE the driver may or may not
 * surface keeps this specific: any OTHER unique violation is still a bug and
 * still goes to the error boundary.
 */
function lostTheRace(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.includes("agent_runs_one_live_manual_run");
}
