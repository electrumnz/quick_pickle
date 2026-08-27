/**
 * M26 — "A deliberately triggered cost cap halts the run and records why."
 *
 * Four ceilings, each tripped on purpose: per run, per agent per day, per agent
 * per month, and the company-wide monthly cap. In every case the run must stop,
 * the reason must be on the row, and the model must not be called again.
 */

import { describe, expect, it } from "vitest";

import {
  GLOBAL_MONTHLY_CAP_SETTING_KEY,
  centsToMicros,
  costMicrosFor,
  ledgerDate,
  replay,
} from "@/lib/agents";

import { createHarness, toolTurn } from "./harness";

const CHATTY_SCRIPT = [
  toolTurn("read_catalogue", { handle: "no-01-house" }, "Looking it up."),
  toolTurn("read_catalogue", { handle: "no-02-dirty" }, "And the next one."),
  toolTurn("read_catalogue", { handle: "no-03-smoke" }, "And the last one."),
  { kind: "text" as const, text: "All three checked." },
];

describe("M26 cost caps halt a run and record why", () => {
  it("prices a model call in NZD micros", () => {
    // claude-opus-5 at USD 5 / 25 per million tokens, converted at the book rate.
    const micros = costMicrosFor("claude-opus-5", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(micros).toBe(Math.ceil(5 * 1.65 * 1_000_000));
  });

  it("halts on the per-run cap and records which cap, the limit and the spend", async () => {
    // One scripted call costs 2,640 micros. A 1c (10,000 micro) run cap allows
    // three calls' worth of headroom on paper, but the projection is worst-case,
    // so the run stops before it can overspend.
    const harness = await createHarness({
      script: CHATTY_SCRIPT,
      perRunCents: 1,
      dailyCents: 100,
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Check every product price",
      trigger: "schedule",
    });
    const summary = await harness.runtime.runToCompletion(started.runId);

    expect(summary.status).toBe("failed");
    expect(summary.error).toContain("cost_cap_exceeded");

    const view = await replay(harness.store, started.runId);
    expect(view.halt?.code).toBe("cost_cap_exceeded");
    expect(view.halt?.extra["cap"]).toBe("run");
    expect(view.halt?.extra["limitMicros"]).toBe(centsToMicros(1));
    expect(typeof view.halt?.extra["spentMicros"]).toBe("number");
    expect(view.halt?.reason).toContain("Run cap of");

    const halted = harness.logger.where("agent.run.halted");
    expect(halted).toHaveLength(1);
    expect(halted[0]?.fields["cap"]).toBe("run");
  });

  it("halts on the per-agent daily cap, counting spend already on the books", async () => {
    const harness = await createHarness({
      script: CHATTY_SCRIPT,
      perRunCents: 50,
      dailyCents: 50,
      monthlyCents: 5_000,
    });
    // Yesterday's spend must not count; today's must.
    const today = ledgerDate(harness.clock.now());
    await harness.store.recordCost({
      agentId: harness.agentId,
      runId: null,
      toolCallId: null,
      incurredAt: harness.clock.now().toISOString(),
      incurredOn: today,
      provider: "anthropic",
      model: "claude-opus-5",
      kind: "inference",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicros: centsToMicros(50),
      currency: "NZD",
      note: "earlier run today",
    });

    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Check every product price",
      trigger: "schedule",
    });
    const summary = await harness.runtime.runToCompletion(started.runId);

    expect(summary.status).toBe("failed");
    const view = await replay(harness.store, started.runId);
    expect(view.halt?.extra["cap"]).toBe("agent_daily");
    // The model was never called: the cap is checked before the money is spent.
    expect(harness.model.consumed).toBe(0);
    expect(view.totals.steps).toBe(0);
  });

  it("halts on the per-agent monthly cap", async () => {
    const harness = await createHarness({
      script: CHATTY_SCRIPT,
      perRunCents: 40,
      dailyCents: 40,
      monthlyCents: 40,
    });
    await harness.store.recordCost({
      agentId: harness.agentId,
      runId: null,
      toolCallId: null,
      incurredAt: "2026-08-02T09:00:00.000Z",
      incurredOn: "2026-08-02",
      provider: "anthropic",
      model: "claude-opus-5",
      kind: "inference",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicros: centsToMicros(40),
      currency: "NZD",
      note: "spent earlier this month",
    });

    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Check every product price",
      trigger: "schedule",
    });
    const summary = await harness.runtime.runToCompletion(started.runId);
    const view = await replay(harness.store, started.runId);
    expect(summary.status).toBe("failed");
    expect(view.halt?.extra["cap"]).toBe("agent_monthly");
  });

  it("halts on the company-wide monthly cap, which no single agent's budget can beat", async () => {
    const harness = await createHarness({
      script: CHATTY_SCRIPT,
      perRunCents: 10_000,
      dailyCents: 10_000,
      monthlyCents: 100_000,
    });
    await harness.store.setSetting(
      GLOBAL_MONTHLY_CAP_SETTING_KEY,
      1,
      "test cap",
    );

    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Check every product price",
      trigger: "schedule",
    });
    const summary = await harness.runtime.runToCompletion(started.runId);
    const view = await replay(harness.store, started.runId);
    expect(summary.status).toBe("failed");
    expect(view.halt?.extra["cap"]).toBe("global_monthly");
    expect(view.halt?.reason).toContain("Company-wide monthly cap");
  });

  it("records a cost row per model call, as the call happens", async () => {
    const harness = await createHarness({
      script: CHATTY_SCRIPT,
      perRunCents: 100,
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Check every product price",
      trigger: "schedule",
    });
    await harness.runtime.runToCompletion(started.runId);
    const costs = await harness.store.listCosts({ runId: started.runId });
    expect(costs).toHaveLength(4);
    for (const cost of costs) {
      expect(cost.model).toBe("claude-opus-5");
      expect(cost.currency).toBe("NZD");
      expect(cost.costMicros).toBeGreaterThan(0);
    }
    const run = await harness.store.getRun(started.runId);
    expect(run?.costMicros).toBe(
      costs.reduce((total, cost) => total + cost.costMicros, 0),
    );
  });
});
