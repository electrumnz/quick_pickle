/**
 * Observability: a queryable run history that returns clean typed data.
 *
 * The admin UI is built by a later unit; this is the layer it will read. Nothing
 * here renders anything — every method returns structures, so the UI can sort,
 * filter and paginate without re-deriving state from raw rows.
 */

import { formatMicrosNzd, microsToCents } from "../cost/pricing";
import type { AgentStore, RunQuery } from "../store/types";
import type { AgentRunStatus, ApprovalRecord, RunRecord } from "../types";
import { replay, type RunReplay } from "./replay";

/** One row in the run list. */
export interface RunListItem {
  readonly runId: string;
  readonly agentSlug: string;
  readonly status: AgentRunStatus;
  readonly trigger: RunRecord["trigger"];
  readonly goal: string;
  readonly outcome: string | null;
  readonly error: string | null;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly toolCallCount: number;
  readonly costMicros: number;
  readonly costNzd: string;
  readonly blockingApprovalId: string | null;
}

/** Spend rolled up for one agent. */
export interface AgentSpendSummary {
  readonly agentSlug: string;
  readonly agentId: string;
  readonly todayMicros: number;
  readonly monthMicros: number;
  readonly todayCents: number;
  readonly monthCents: number;
  readonly dailyCapCents: number;
  readonly monthlyCapCents: number;
  readonly dailyHeadroomCents: number;
}

/** The short answer to "what did this agent do and why?". */
export interface RunExplanation {
  readonly runId: string;
  readonly agentSlug: string;
  readonly goal: string;
  readonly inputsSeen: RunReplay["inputs"];
  readonly reasoning: readonly string[];
  readonly actions: readonly {
    readonly tool: string;
    readonly effect: "read" | "mutation";
    readonly status: string;
    readonly approvalId: string | null;
    readonly arguments: RunReplay["toolCalls"][number]["arguments"];
  }[];
  readonly approvals: readonly {
    readonly id: string;
    readonly subjectType: ApprovalRecord["subjectType"];
    readonly status: ApprovalRecord["status"];
    readonly decidedBy: string | null;
    readonly note: string | null;
  }[];
  readonly conclusion: string;
}

function durationMs(run: RunRecord): number | null {
  if (run.startedAt === null || run.finishedAt === null) {
    return null;
  }
  return Date.parse(run.finishedAt) - Date.parse(run.startedAt);
}

export class RunHistory {
  constructor(private readonly store: AgentStore) {}

  /** Runs matching a filter, newest first. */
  async list(query: RunQuery = {}): Promise<RunListItem[]> {
    const runs = await this.store.listRuns(query);
    return runs.map((run) => ({
      runId: run.id,
      agentSlug: run.agentSlug,
      status: run.status,
      trigger: run.trigger,
      goal: run.goal,
      outcome: run.outcome,
      error: run.error,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: durationMs(run),
      toolCallCount: run.toolCallCount,
      costMicros: run.costMicros,
      costNzd: formatMicrosNzd(run.costMicros),
      blockingApprovalId: run.blockingApprovalId,
    }));
  }

  /** Runs waiting on a human, so the admin can link an approval to its run. */
  async awaitingApproval(): Promise<RunListItem[]> {
    return this.list({ status: ["awaiting_approval"] });
  }

  /** Everything about one run, reconstructed from storage. */
  async detail(runId: string): Promise<RunReplay> {
    return replay(this.store, runId);
  }

  /** Spend against caps for one agent. */
  async spend(
    agentSlug: string,
    today: string,
    monthStart: string,
  ): Promise<AgentSpendSummary | null> {
    const agent = await this.store.getAgentBySlug(agentSlug);
    if (agent === null) {
      return null;
    }
    const [todayMicros, monthMicros] = await Promise.all([
      this.store.sumCostMicros({
        agentId: agent.id,
        fromDate: today,
        toDate: today,
      }),
      this.store.sumCostMicros({
        agentId: agent.id,
        fromDate: monthStart,
        toDate: today,
      }),
    ]);
    return {
      agentSlug,
      agentId: agent.id,
      todayMicros,
      monthMicros,
      todayCents: microsToCents(todayMicros),
      monthCents: microsToCents(monthMicros),
      dailyCapCents: agent.dailySpendCapCents,
      monthlyCapCents: agent.monthlySpendCapCents,
      dailyHeadroomCents: agent.dailySpendCapCents - microsToCents(todayMicros),
    };
  }

  /**
   * "What did this agent do and why?" — the whole design constraint, as one
   * typed object built entirely from stored data.
   */
  async explain(runId: string): Promise<RunExplanation> {
    const view = await replay(this.store, runId);
    const conclusion =
      view.halt !== null
        ? `Stopped by the runtime (${view.halt.code}): ${view.halt.reason}`
        : view.run.status === "succeeded"
          ? (view.run.outcome ?? "Finished with no closing statement.")
          : view.run.status === "awaiting_approval"
            ? `Parked waiting on approval ${view.run.blockingApprovalId ?? "?"}.`
            : (view.run.error ?? `Run is ${view.run.status}.`);

    return {
      runId,
      agentSlug: view.run.agentSlug,
      goal: view.run.goal,
      inputsSeen: view.inputs,
      reasoning: view.reasoning,
      actions: view.toolCalls.map((call) => ({
        tool: call.toolName,
        effect: call.isMutation ? "mutation" : "read",
        status: call.status,
        approvalId: call.approvalId,
        arguments: call.arguments,
      })),
      approvals: view.approvals.map((approval) => ({
        id: approval.id,
        subjectType: approval.subjectType,
        status: approval.status,
        decidedBy: approval.decidedBy,
        note: approval.decisionNote,
      })),
      conclusion,
    };
  }
}
