/**
 * Cost tracking and hard caps.
 *
 * Three ceilings, checked in this order because that is cheapest-to-most-severe:
 *   1. per run       — this run's own budget
 *   2. per agent/day — everything this role spends in one Pacific/Auckland day
 *   3. global month  — everything every agent spends in the calendar month
 *
 * Every ceiling is checked *before* the model call using a worst-case
 * projection, and again after the call using the real usage. Exceeding one
 * halts the run and records which cap, what the limit was, and what had already
 * been spent — the founder should never have to guess why an agent stopped.
 */

import type { Clock } from "../clock";
import { CostCapError } from "../errors";
import type { AgentLogger } from "../logger";
import type { AgentStore } from "../store/types";
import type { AgentDefinition } from "../types";
import {
  DEFAULT_FX_NZD_PER_USD,
  centsToMicros,
  costMicrosFor,
  formatMicrosNzd,
  projectedCostMicros,
  type TokenUsage,
} from "./pricing";

/** The books are kept on New Zealand days, matching `agent_costs.incurred_on`. */
export const LEDGER_TIME_ZONE = "Pacific/Auckland";

/** `YYYY-MM-DD` for an instant, in the ledger's timezone. */
export function ledgerDate(instant: Date, timeZone: string = LEDGER_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** First day of the ledger month containing `instant`, as `YYYY-MM-DD`. */
export function ledgerMonthStart(instant: Date, timeZone: string = LEDGER_TIME_ZONE): string {
  const day = ledgerDate(instant, timeZone);
  return `${day.slice(0, 7)}-01`;
}

/** Which ceiling was hit. */
export type CapKind = "run" | "agent_daily" | "agent_monthly" | "global_monthly";

/** The answer to "may this call proceed?". */
export type CapVerdict =
  | { readonly ok: true; readonly spentMicros: number }
  | {
      readonly ok: false;
      readonly cap: CapKind;
      readonly limitMicros: number;
      readonly spentMicros: number;
      readonly projectedMicros: number;
      readonly reason: string;
    };

/** Where the global ceiling is stored, so an operator can move it without a deploy. */
export const GLOBAL_MONTHLY_CAP_SETTING_KEY = "agents.global_monthly_cap_cents";

/** Used when the setting row is absent. */
export const DEFAULT_GLOBAL_MONTHLY_CAP_CENTS = 50_000;

export interface CostMeterDeps {
  readonly store: AgentStore;
  readonly clock: Clock;
  readonly logger: AgentLogger;
  readonly fxNzdPerUsd?: number;
  readonly timeZone?: string;
}

/** What a completed model call actually consumed. */
export interface RecordedUsage extends TokenUsage {
  readonly model: string;
  readonly note: string | null;
  readonly toolCallId?: string | null;
}

export class CostMeter {
  private readonly store: AgentStore;
  private readonly clock: Clock;
  private readonly logger: AgentLogger;
  private readonly fx: number;
  private readonly timeZone: string;

  constructor(deps: CostMeterDeps) {
    this.store = deps.store;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.fx = deps.fxNzdPerUsd ?? DEFAULT_FX_NZD_PER_USD;
    this.timeZone = deps.timeZone ?? LEDGER_TIME_ZONE;
  }

  /** The operator-configurable global ceiling, in micros. */
  async globalMonthlyCapMicros(): Promise<number> {
    const raw = await this.store.getSetting(GLOBAL_MONTHLY_CAP_SETTING_KEY);
    const cents = typeof raw === "number" ? raw : DEFAULT_GLOBAL_MONTHLY_CAP_CENTS;
    return centsToMicros(cents);
  }

  /** What a run has spent so far. */
  async spentOnRunMicros(runId: string): Promise<number> {
    return this.store.sumCostMicros({ runId });
  }

  /** What an agent has spent today, in the ledger timezone. */
  async spentTodayMicros(agentId: string): Promise<number> {
    const day = ledgerDate(this.clock.now(), this.timeZone);
    return this.store.sumCostMicros({ agentId, fromDate: day, toDate: day });
  }

  /** What an agent has spent this calendar month. */
  async spentThisMonthMicros(agentId: string): Promise<number> {
    const now = this.clock.now();
    return this.store.sumCostMicros({
      agentId,
      fromDate: ledgerMonthStart(now, this.timeZone),
      toDate: ledgerDate(now, this.timeZone),
    });
  }

  /** What every agent together has spent this calendar month. */
  async spentGloballyThisMonthMicros(): Promise<number> {
    const now = this.clock.now();
    return this.store.sumCostMicros({
      fromDate: ledgerMonthStart(now, this.timeZone),
      toDate: ledgerDate(now, this.timeZone),
    });
  }

  /**
   * May a call costing at most `projectedMicros` proceed?
   *
   * Returns a verdict rather than throwing so the caller can decide whether to
   * halt the run or degrade — the runtime halts.
   */
  async check(params: {
    readonly definition: AgentDefinition;
    readonly agentId: string;
    readonly runId: string;
    readonly projectedMicros: number;
  }): Promise<CapVerdict> {
    const { definition, agentId, runId, projectedMicros } = params;

    const runSpent = await this.spentOnRunMicros(runId);
    const runLimit = centsToMicros(definition.budget.perRunCents);
    if (runSpent + projectedMicros > runLimit) {
      return {
        ok: false,
        cap: "run",
        limitMicros: runLimit,
        spentMicros: runSpent,
        projectedMicros,
        reason: `Run cap of ${formatMicrosNzd(runLimit)} would be exceeded: ${formatMicrosNzd(runSpent)} already spent, next call projected at ${formatMicrosNzd(projectedMicros)}.`,
      };
    }

    const daySpent = await this.spentTodayMicros(agentId);
    const dayLimit = centsToMicros(definition.budget.dailyCents);
    if (daySpent + projectedMicros > dayLimit) {
      return {
        ok: false,
        cap: "agent_daily",
        limitMicros: dayLimit,
        spentMicros: daySpent,
        projectedMicros,
        reason: `Daily cap of ${formatMicrosNzd(dayLimit)} for "${definition.slug}" would be exceeded: ${formatMicrosNzd(daySpent)} spent today.`,
      };
    }

    const monthSpent = await this.spentThisMonthMicros(agentId);
    const monthLimit = centsToMicros(definition.budget.monthlyCents);
    if (monthSpent + projectedMicros > monthLimit) {
      return {
        ok: false,
        cap: "agent_monthly",
        limitMicros: monthLimit,
        spentMicros: monthSpent,
        projectedMicros,
        reason: `Monthly cap of ${formatMicrosNzd(monthLimit)} for "${definition.slug}" would be exceeded: ${formatMicrosNzd(monthSpent)} spent this month.`,
      };
    }

    const globalSpent = await this.spentGloballyThisMonthMicros();
    const globalLimit = await this.globalMonthlyCapMicros();
    if (globalSpent + projectedMicros > globalLimit) {
      return {
        ok: false,
        cap: "global_monthly",
        limitMicros: globalLimit,
        spentMicros: globalSpent,
        projectedMicros,
        reason: `Company-wide monthly cap of ${formatMicrosNzd(globalLimit)} would be exceeded: ${formatMicrosNzd(globalSpent)} spent across all agents this month.`,
      };
    }

    return { ok: true, spentMicros: runSpent };
  }

  /** Worst-case cost of a call that has not happened yet. */
  project(model: string, promptTokens: number, maxOutputTokens: number): number {
    return projectedCostMicros({
      model,
      promptTokens,
      maxOutputTokens,
      fxNzdPerUsd: this.fx,
    });
  }

  /**
   * Write a cost row and fold it into the run's totals.
   *
   * Called immediately after each model call, before the next step begins, so a
   * crashed run still has an accurate bill attached to it.
   */
  async record(params: {
    readonly agentId: string;
    readonly runId: string;
    readonly usage: RecordedUsage;
  }): Promise<number> {
    const now = this.clock.now();
    const micros = costMicrosFor(params.usage.model, params.usage, this.fx);
    await this.store.recordCost({
      agentId: params.agentId,
      runId: params.runId,
      toolCallId: params.usage.toolCallId ?? null,
      incurredAt: now.toISOString(),
      incurredOn: ledgerDate(now, this.timeZone),
      provider: "anthropic",
      model: params.usage.model,
      kind: "inference",
      inputTokens: params.usage.inputTokens,
      outputTokens: params.usage.outputTokens,
      cacheReadTokens: params.usage.cacheReadTokens,
      cacheWriteTokens: params.usage.cacheWriteTokens,
      costMicros: micros,
      currency: "NZD",
      note: params.usage.note ?? `fx nzd/usd ${this.fx}`,
    });
    await this.store.updateRun(params.runId, {
      addInputTokens: params.usage.inputTokens,
      addOutputTokens: params.usage.outputTokens,
      addCostMicros: micros,
    });
    this.logger.log({
      level: "info",
      event: "agent.cost.recorded",
      at: now.toISOString(),
      runId: params.runId,
      fields: {
        model: params.usage.model,
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
        costMicros: micros,
        costNzd: formatMicrosNzd(micros),
      },
    });
    return micros;
  }

  /** Throwing form of {@link check}, for call sites that cannot continue. */
  static assertVerdict(verdict: CapVerdict, runId: string): void {
    if (verdict.ok) {
      return;
    }
    throw new CostCapError(verdict.reason, {
      cap: verdict.cap,
      runId,
      limitMicros: verdict.limitMicros,
      spentMicros: verdict.spentMicros,
      projectedMicros: verdict.projectedMicros,
    });
  }
}
