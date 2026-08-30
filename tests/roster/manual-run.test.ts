/**
 * "Run now", end to end, with everything real except the socket.
 *
 * The admin's manual trigger is not a second runtime — it is the same
 * `runAgentWorkflow` the Inngest function calls, driven by `MemoryDurableStep`
 * instead of Inngest's `step`, over a `SqlAgentStore` on the same Postgres the
 * Team page reads. This file drives exactly that stack:
 *
 *  - the seeded HALF SOUR business, in a real Postgres, every migration applied;
 *  - the roster loaded from `strategy_documents` and reconciled into
 *    `public.agents` by the runtime's own `register`;
 *  - the real Vercel AI Gateway client, with only `fetch` substituted, so the
 *    model id, the credential and the twenty-three tool definitions are the ones
 *    that would go on the wire;
 *  - the real approval gate, cost meter, control plane and transcript;
 *  - `RecordingOutbox`, which delivers nothing.
 *
 * `tests/roster/gateway-wire.test.ts` proves the same substitution for the
 * scheduled path. This proves the trigger: that a run started by hand is written
 * to the database the admin reads, is marked `manual` so a reader can tell it
 * from a scheduled one, is priced by the meter, parks rather than fails when the
 * gate stops it, and cannot be started twice.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_GLOBAL_MONTHLY_CAP_CENTS,
  GLOBAL_MONTHLY_CAP_SETTING_KEY,
  MINIMAX_M2_7_FREE,
  RunHistory,
  SqlAgentStore,
  createGatewayResolver,
} from "@/lib/agents";
import type { AgentStore } from "@/lib/agents";
import { RecordingOutbox, createRosterPlatform } from "@/lib/agents/roster";
import { createPgliteExecutor } from "@/lib/commerce/sql/pglite";
import type { SqlExecutor } from "@/lib/commerce/sql/executor";
import { MemoryDurableStep, WorkflowParked, runAgentWorkflow } from "@/inngest";

import {
  createSeededBusiness,
  type RosterTestDatabase,
} from "./support/pglite";

/** Every request the gateway client made, as it would have sent it. */
interface CapturedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: {
    readonly prompt?: readonly unknown[];
    readonly tools?: readonly { readonly name?: string }[];
  };
}

const captured: CapturedRequest[] = [];

/** A `LanguageModelV4` generate result in the shape the gateway returns. */
function turn(
  content: readonly unknown[],
  finish: { readonly unified: string; readonly raw: string },
): Response {
  return new Response(
    JSON.stringify({
      content,
      finishReason: finish,
      usage: {
        inputTokens: {
          total: 18_400,
          noCache: 18_400,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: { total: 320, text: 320, reasoning: 0 },
      },
      warnings: [],
      response: { id: "gw-manual-1", modelId: MINIMAX_M2_7_FREE },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function record(input: RequestInfo | URL, init?: RequestInit): void {
  const headers: Record<string, string> = {};
  for (const [key, value] of new Headers(init?.headers).entries()) {
    headers[key.toLowerCase()] = value;
  }
  captured.push({
    url: String(input),
    headers,
    body: JSON.parse(String(init?.body ?? "{}")) as CapturedRequest["body"],
  });
}

/** Reads the stock cover, then reports. The shape an agentic model produces. */
function readsThenReports(): typeof globalThis.fetch {
  let call = 0;
  return async (input, init) => {
    call += 1;
    record(input, init);
    if (call === 1) {
      return turn(
        [
          {
            type: "text",
            text: "Days of cover first; nothing else in this job means anything without it.",
          },
          {
            type: "tool-call",
            toolCallId: "manual-call-1",
            toolName: "read_stock_cover",
            input: JSON.stringify({}),
          },
        ],
        { unified: "tool-calls", raw: "tool_use" },
      );
    }
    return turn(
      [
        {
          type: "text",
          text: "Cover read. Nothing is close enough to its lead time to order against today.",
        },
      ],
      { unified: "stop", raw: "end_turn" },
    );
  };
}

/** Reaches straight for something the founder has to decide. */
function proposesAnOrder(): typeof globalThis.fetch {
  return async (input, init) => {
    record(input, init);
    return turn(
      [
        {
          type: "text",
          text: "Bottles are under their reorder point against a three-week lead time. Drafting the order.",
        },
        {
          type: "tool-call",
          toolCallId: "manual-call-2",
          toolName: "queue_supplier_order",
          input: JSON.stringify({
            supplierCode: "GLASSWORKS",
            supplierName: "A glassworks",
            ingredientCode: "BOTTLE_500",
            quantity: 2000,
            unit: "each",
            amountCents: 184_000,
            reason: "Cover is under the lead time.",
          }),
        },
      ],
      { unified: "tool-calls", raw: "tool_use" },
    );
  };
}

let database: RosterTestDatabase;
let sql: SqlExecutor;
let store: AgentStore;

const ROLE = "brine-ops";

/**
 * Build the platform exactly as `app/(admin)/admin/team/run-now.ts` does.
 *
 * Same call, same outbox, same `SqlAgentStore` on the same Postgres. The one
 * argument this test adds is the model resolver, and it is the REAL gateway
 * client with only `fetch` substituted — because no credential is available
 * here, and a run that quietly fell back to a scripted planner would prove
 * nothing about the thing being shipped.
 */
async function manualPlatform(fetchImpl: typeof globalThis.fetch) {
  const { platform, roster } = await createRosterPlatform({
    sql,
    outbox: new RecordingOutbox(),
    store,
    models: createGatewayResolver({
      apiKey: "test-gateway-key",
      fetch: fetchImpl,
      // The free window closes on 6 September 2026 and this file has to keep
      // passing on the 7th, so the cutoff is asked about a fixed instant.
      now: () => new Date("2026-08-31T08:00:00.000Z"),
    }),
  });
  const role = roster.roles.find((entry) => entry.definition.slug === ROLE);
  if (role === undefined) throw new Error("no ops role");
  return { platform, role };
}

beforeAll(async () => {
  database = await createSeededBusiness();
  sql = createPgliteExecutor(database.db);
  store = new SqlAgentStore(sql);
}, 180_000);

afterAll(async () => {
  await database.close();
});

describe("a run the founder started by hand", () => {
  it("lands in the database the admin reads, marked manual", async () => {
    captured.length = 0;
    const { platform, role } = await manualPlatform(readsThenReports());

    // The driver is `MemoryDurableStep` and the workflow is the one Inngest
    // runs. This is the manual trigger, in full.
    const step = new MemoryDurableStep();
    step.beginAttempt();
    const summary = await runAgentWorkflow({
      step,
      platform,
      input: { agentSlug: ROLE, goal: role.goal, trigger: "manual" },
    });

    expect(summary.status).toBe("succeeded");

    // It went to the gateway, on this role's declared model, with this role's
    // tools and nobody else's.
    const first = captured[0];
    expect(first).toBeDefined();
    expect(first?.url).toContain("ai-gateway.vercel.sh");
    expect(first?.headers["ai-language-model-id"]).toBe(role.definition.model);
    expect(first?.headers["authorization"]).toBe("Bearer test-gateway-key");
    const toolNames = (first?.body.tools ?? []).map((tool) => tool.name ?? "");
    expect([...toolNames].sort()).toEqual([...role.definition.tools].sort());

    // And the transcript is in Postgres, not in memory.
    const rows = await database.rows(
      `select r.trigger::text as trigger, r.status::text as status,
              r.cost_micros::text as cost_micros, r.tool_call_count,
              r.context->>'modelProvider' as provider,
              r.context->>'model' as model
         from public.agent_runs r where r.id = $1`,
      [summary.runId],
    );
    expect(rows[0]).toMatchObject({
      trigger: "manual",
      status: "succeeded",
      provider: "gateway",
      model: MINIMAX_M2_7_FREE,
    });
    expect(Number(rows[0]?.["cost_micros"])).toBeGreaterThan(0);

    // The reasoning the admin renders is `agent_messages`, written as it went.
    const messages = await database.rows(
      `select role::text as role, content from public.agent_messages
        where run_id = $1 and role = 'assistant' order by seq`,
      [summary.runId],
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(String(messages[0]?.["content"])).toContain("Days of cover");

    // A real query against the seeded business answered the tool.
    const calls = await database.rows(
      `select tool_name, status::text as status, result
         from public.agent_tool_calls where run_id = $1 order by seq`,
      [summary.runId],
    );
    expect(calls.map((row) => row["tool_name"])).toEqual(["read_stock_cover"]);
    expect(calls[0]?.["status"]).toBe("succeeded");
    expect(JSON.stringify(calls[0]?.["result"])).toContain("sku");

    // Priced by the meter, against this run, on the gateway.
    const costs = await database.rows(
      `select provider, model, cost_micros::text as cost_micros
         from public.agent_costs where run_id = $1`,
      [summary.runId],
    );
    expect(costs.length).toBeGreaterThan(0);
    expect(costs[0]?.["provider"]).toBe("gateway");

    // And the admin's own reader gives back the same reasoning, out of the
    // same rows, which is what the page renders.
    const explained = await new RunHistory(store).explain(summary.runId);
    expect(explained.agentSlug).toBe(ROLE);
    expect(explained.reasoning.join(" ")).toContain("Days of cover");
    expect(explained.actions.map((action) => action.tool)).toEqual([
      "read_stock_cover",
    ]);
  }, 180_000);

  it("parks rather than failing when the gate stops it", async () => {
    captured.length = 0;
    const { platform, role } = await manualPlatform(proposesAnOrder());
    const step = new MemoryDurableStep();
    step.beginAttempt();

    // `MemoryDurableStep.waitForEvent` throws rather than returning null,
    // because there is nothing inside one request that can deliver a founder's
    // decision. That throw is the park, and the action reports it as one.
    await expect(
      runAgentWorkflow({
        step,
        platform,
        input: { agentSlug: ROLE, goal: role.goal, trigger: "manual" },
      }),
    ).rejects.toBeInstanceOf(WorkflowParked);

    // The run is parked on a real approvals row, not failed and not finished.
    const parked = await database.rows(
      `select r.id, r.status::text as status, r.blocking_approval_id,
              ap.status::text as approval_status, ap.subject_type::text as subject
         from public.agent_runs r
         join public.approvals ap on ap.id = r.blocking_approval_id
        where r.trigger = 'manual' and r.status = 'awaiting_approval'`,
    );
    expect(parked).toHaveLength(1);
    expect(parked[0]?.["approval_status"]).toBe("pending");
    expect(parked[0]?.["subject"]).toBe("purchase_order");

    // Nothing was carried out. The tool that proposed it never executed.
    const calls = await database.rows(
      `select status::text as status from public.agent_tool_calls
        where run_id = $1`,
      [parked[0]?.["id"]],
    );
    expect(calls.map((row) => row["status"])).toEqual(["pending"]);
  }, 180_000);

  it("stops at a spending limit and records which one, and what it had spent", async () => {
    // The failure mode the admin has to surface rather than swallow. The agent
    // is given a daily ceiling it has already passed, so the meter refuses the
    // NEXT model call — before the money is spent, which is the whole design —
    // and the halt is written where the page reads it.
    // The ceiling is moved through `settings`, not through `public.agents`:
    // `registerRoster` reconciles every agent row from the code moments before
    // the run opens, so a cap edited on the row would be written straight back.
    // The company-wide monthly ceiling is an operator setting for exactly this
    // reason — it can be moved without a deploy.
    const previous = await store.getSetting(GLOBAL_MONTHLY_CAP_SETTING_KEY);
    await store.setSetting(
      GLOBAL_MONTHLY_CAP_SETTING_KEY,
      0,
      "Lowered to nothing by the manual-run test.",
    );

    const { platform, roster } = await createRosterPlatform({
      sql,
      outbox: new RecordingOutbox(),
      store,
      models: createGatewayResolver({
        apiKey: "test-gateway-key",
        fetch: readsThenReports(),
        now: () => new Date("2026-08-31T08:00:00.000Z"),
      }),
    });
    const role = roster.roles.find(
      (entry) => entry.definition.slug === "analyst",
    );
    if (role === undefined) throw new Error("no analyst role");

    const step = new MemoryDurableStep();
    step.beginAttempt();
    const summary = await runAgentWorkflow({
      step,
      platform,
      input: { agentSlug: "analyst", goal: role.goal, trigger: "manual" },
    });

    expect(summary.status).toBe("failed");
    expect(summary.error ?? "").toContain("cost_cap_exceeded");

    // `context.halt` is what `app/(admin)/admin/team/data.ts` reads back and
    // the run card renders: which ceiling, what it was, and what had gone.
    const rows = await database.rows(
      `select context->'halt' as halt from public.agent_runs where id = $1`,
      [summary.runId],
    );
    const halt = rows[0]?.["halt"];
    expect(halt).toMatchObject({ code: "cost_cap_exceeded" });
    const record = halt as Record<string, unknown>;
    expect(["run", "agent_daily", "agent_monthly", "global_monthly"]).toContain(
      record["cap"],
    );
    expect(typeof record["limitMicros"]).toBe("number");
    expect(Number(record["spentMicros"])).toBeGreaterThan(0);
    // Nothing was spent past the ceiling: the meter refuses before the call.
    expect(summary.costMicros).toBe(0);

    await store.setSetting(
      GLOBAL_MONTHLY_CAP_SETTING_KEY,
      typeof previous === "number"
        ? previous
        : DEFAULT_GLOBAL_MONTHLY_CAP_CENTS,
      "Restored by the manual-run test.",
    );
  }, 120_000);

  it("cannot be started twice: the database refuses the second", async () => {
    const agent = await store.getAgentBySlug("concierge");
    expect(agent).not.toBeNull();
    if (agent === null) return;

    const first = await store.createRun({
      agentId: agent.id,
      trigger: "manual",
      goal: "The job she pressed the button for.",
      context: {},
    });
    await store.updateRun(first.id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });

    await expect(
      store.createRun({
        agentId: agent.id,
        trigger: "manual",
        goal: "The same job, pressed twice.",
        context: {},
      }),
    ).rejects.toThrow(/agent_runs_one_live_manual_run|duplicate key/);
  }, 60_000);
});
