/**
 * The cost meter still governs when the tokens are free.
 *
 * This is the check that is easy to skip and expensive to skip. Every one of the
 * four ceilings in `cost/meter.ts` is a comparison between a limit and
 * `tokens x price`. Set the price to zero and all four comparisons become
 * `0 > limit`, which is false forever: the caps do not fail loudly, they stop
 * existing, on the exact day the company first lets a real model call real
 * tools with real money behind them.
 *
 * So `lib/agents/cost/pricing.ts` charges the promotional MiniMax ids at the
 * list price of their paid twins — $0.30 in, $1.20 out per million, the rate the
 * gateway catalogue quotes for `minimax/minimax-m3` and `minimax/minimax-m2.7` —
 * and this file proves what that buys:
 *
 *   - a free model's tokens are counted, and cost more than nothing;
 *   - all four ceilings still halt a run and still say which one;
 *   - the single-action ceiling, which is a limit on the value of a business
 *     action rather than on tokens, is unaffected either way.
 *
 * Nothing here loosens a cap. The budgets are the same numbers they were.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  GLOBAL_MONTHLY_CAP_SETTING_KEY,
  MINIMAX_M2_7_FREE,
  MINIMAX_M3_FREE,
  approvalRequirement,
  centsToMicros,
  costMicrosFor,
  defineAgent,
  defineTool,
  isPromotionalModel,
  ledgerDate,
  replay,
  type ScriptedTurn,
} from "@/lib/agents";

import { createHarness, toolTurn } from "./harness";

/**
 * Token counts a roster run actually produces.
 *
 * A role's prompt is its own instructions plus the strategy briefing plus every
 * brand rule, and by the third step it is carrying three tool results as well.
 * Sixty thousand in and three thousand out is that shape, and it is what makes
 * the ceilings below bite at a believable number rather than at a toy one.
 *
 * At the MiniMax list rate this is 35,640 micros a call — NZ$0.0356.
 */
const REAL_USAGE = { inputTokens: 60_000, outputTokens: 3_000 } as const;

function heavy(turn: ScriptedTurn): ScriptedTurn {
  return turn.kind === "error" ? turn : { ...turn, usage: REAL_USAGE };
}

const CHATTY_SCRIPT = [
  toolTurn("read_catalogue", { handle: "no-01-house" }, "Looking it up."),
  toolTurn("read_catalogue", { handle: "no-02-dirty" }, "And the next one."),
  toolTurn("read_catalogue", { handle: "no-03-smoke" }, "And the last one."),
  { kind: "text" as const, text: "All three checked." },
].map(heavy);

const NO_CACHE = { cacheReadTokens: 0, cacheWriteTokens: 0 } as const;

describe("a free model's tokens are still counted, and still cost", () => {
  it("prices both promotional ids at their paid twins' list rate", () => {
    // The gateway catalogue quotes minimax/minimax-m3 and minimax/minimax-m2.7
    // at USD 0.30 in and 1.20 out per million. Converted at the book rate.
    for (const model of [MINIMAX_M3_FREE, MINIMAX_M2_7_FREE]) {
      expect(
        costMicrosFor(model, {
          inputTokens: 1_000_000,
          outputTokens: 0,
          ...NO_CACHE,
        }),
      ).toBe(Math.ceil(0.3 * 1.65 * 1_000_000));
      expect(
        costMicrosFor(model, {
          inputTokens: 0,
          outputTokens: 1_000_000,
          ...NO_CACHE,
        }),
      ).toBe(Math.ceil(1.2 * 1.65 * 1_000_000));
    }
  });

  it("charges the same as the paid model it is a promotion on", () => {
    const usage = { inputTokens: 12_000, outputTokens: 900, ...NO_CACHE };
    expect(costMicrosFor(MINIMAX_M3_FREE, usage)).toBe(
      costMicrosFor("minimax/minimax-m3", usage),
    );
    expect(costMicrosFor(MINIMAX_M3_FREE, usage)).toBeGreaterThan(0);
  });

  it("marks the promotional ids so a cost row can explain itself", () => {
    expect(isPromotionalModel(MINIMAX_M3_FREE)).toBe(true);
    expect(isPromotionalModel("minimax/minimax-m3")).toBe(false);
    expect(isPromotionalModel("claude-opus-5")).toBe(false);
  });

  it("writes a priced cost row per model call, naming the gateway", async () => {
    const harness = await createHarness({
      script: CHATTY_SCRIPT,
      model: MINIMAX_M3_FREE,
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
      expect(cost.model).toBe(MINIMAX_M3_FREE);
      expect(cost.inputTokens).toBeGreaterThan(0);
      expect(cost.outputTokens).toBeGreaterThan(0);
      expect(cost.costMicros).toBeGreaterThan(0);
      // The row says the promotion is why the number and the invoice differ.
      expect(cost.note ?? "").toContain("charged at list price");
      // And it names the backend that answered rather than assuming Anthropic.
      expect(cost.provider).toBe("scripted");
    }
    const run = await harness.store.getRun(started.runId);
    expect(run?.costMicros).toBe(
      costs.reduce((total, cost) => total + cost.costMicros, 0),
    );
    expect(run?.costMicros).toBeGreaterThan(0);
  });
});

describe("all four ceilings still halt a run on a free model", () => {
  it("halts on the per-run cap", async () => {
    const harness = await createHarness({
      script: CHATTY_SCRIPT,
      model: MINIMAX_M3_FREE,
      perRunCents: 5,
      dailyCents: 100,
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Check every product price",
      trigger: "schedule",
    });
    const summary = await harness.runtime.runToCompletion(started.runId);

    expect(summary.status).toBe("failed");
    const view = await replay(harness.store, started.runId);
    expect(view.halt?.code).toBe("cost_cap_exceeded");
    expect(view.halt?.extra["cap"]).toBe("run");
    expect(view.halt?.extra["limitMicros"]).toBe(centsToMicros(5));
    // One call's worth of real tokens was counted before it stopped.
    expect(view.halt?.extra["spentMicros"]).toBeGreaterThan(0);
  });

  it("halts on the per-agent daily cap, before the money is spent", async () => {
    const harness = await createHarness({
      script: CHATTY_SCRIPT,
      model: MINIMAX_M2_7_FREE,
      perRunCents: 50,
      dailyCents: 50,
      monthlyCents: 5_000,
    });
    await harness.store.recordCost({
      agentId: harness.agentId,
      runId: null,
      toolCallId: null,
      incurredAt: harness.clock.now().toISOString(),
      incurredOn: ledgerDate(harness.clock.now()),
      provider: "gateway",
      model: MINIMAX_M2_7_FREE,
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
    expect(harness.model.consumed).toBe(0);
  });

  it("halts on the per-agent monthly cap", async () => {
    const harness = await createHarness({
      script: CHATTY_SCRIPT,
      model: MINIMAX_M2_7_FREE,
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
      provider: "gateway",
      model: MINIMAX_M2_7_FREE,
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

  it("halts on the company-wide monthly cap", async () => {
    const harness = await createHarness({
      script: CHATTY_SCRIPT,
      model: MINIMAX_M3_FREE,
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
  });
});

describe("the single-action ceiling is not a token ceiling", () => {
  it("still sends an over-cap action to the founder on a free model", () => {
    // This ceiling limits the VALUE of a business action — a supplier order, a
    // refund — not the cost of the tokens that proposed it. A free model does
    // not move it by a cent, which is worth asserting rather than assuming.
    const definition = defineAgent({
      slug: "capped-role",
      name: "Capped",
      jobTitle: "Fixture",
      purpose: "Prove the single-action cap is about money, not tokens.",
      model: MINIMAX_M3_FREE,
      systemPrompt: "Do the job.",
      tools: ["save_internal_draft"],
      autonomy: "act_with_limits",
      requiresApprovalFor: [],
      budget: {
        perRunCents: 100,
        dailyCents: 1_000,
        monthlyCents: 10_000,
        singleActionCents: 25_000,
      },
    });
    const tool = defineTool({
      name: "queue_supplier_order",
      title: "Order stock",
      description: "Draft an order to a supplier.",
      effect: "business_write",
      inputSchema: z.object({ amountCents: z.number().int() }),
      approval: {
        subjectType: "purchase_order",
        subjectTable: "purchase_orders",
        risk: "medium",
        present: (input) => ({
          title: "Order",
          summary: "supplier order",
          amountCents: input.amountCents,
        }),
      },
      execute: async () => ({ recorded: true }),
    });

    const under = approvalRequirement({
      definition,
      tool,
      presentation: { title: "Order", summary: "small", amountCents: 24_999 },
    });
    const over = approvalRequirement({
      definition,
      tool,
      presentation: { title: "Order", summary: "large", amountCents: 25_001 },
    });

    expect(under.required).toBe(false);
    expect(over.required).toBe(true);
    expect(over.required ? over.trigger : null).toBe("over_single_action_cap");
  });
});
