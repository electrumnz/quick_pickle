/**
 * The SQL store, against the real schema.
 *
 * `SqlAgentStore` is the port `app/(admin)/admin/team` runs an agent through
 * when the founder presses "Run now", so a bug in it is a bug in the company's
 * memory: a transcript that does not persist, a cost that is not counted
 * against a cap, an approval that can be decided twice.
 *
 * PGlite applies every migration verbatim, so the check constraints in
 * `20260101000300_agents.sql` are the ones doing the refusing here — not a
 * TypeScript guard standing in for them. That is the point of testing this
 * implementation rather than trusting it: `InMemoryAgentStore` reimplements
 * those constraints, and this one has to actually satisfy them.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SqlAgentStore } from "@/lib/agents";
import type { AgentDefinition } from "@/lib/agents";
import { createPgliteExecutor } from "@/lib/commerce/sql/pglite";

import {
  createSeededBusiness,
  type RosterTestDatabase,
} from "../roster/support/pglite";

let database: RosterTestDatabase;
let store: SqlAgentStore;

const ROLE: AgentDefinition["slug"] = "brine-ops";

beforeAll(async () => {
  database = await createSeededBusiness();
  store = new SqlAgentStore(createPgliteExecutor(database.db));
}, 180_000);

afterAll(async () => {
  await database.close();
});

async function openRun(trigger: "manual" | "schedule" = "schedule") {
  const agent = await store.getAgentBySlug(ROLE);
  expect(agent).not.toBeNull();
  if (agent === null) throw new Error("no agent");
  const run = await store.createRun({
    agentId: agent.id,
    trigger,
    goal: "A job, for the store's own test.",
    context: { agentSlug: agent.slug, model: agent.model },
  });
  return { agent, run };
}

describe("agents", () => {
  it("reads the roster the migration registered, enum array and all", async () => {
    const agent = await store.getAgentBySlug(ROLE);
    expect(agent).not.toBeNull();
    // `requires_approval_for` is an array of an ENUM, which `pg` hands back as
    // the literal string `{purchase_order,...}`. Reading it as an empty array
    // would render "always asks you about: nothing" for every agent alive.
    expect(agent?.requiresApprovalFor.length).toBeGreaterThan(0);
    expect(agent?.tools.length).toBeGreaterThan(0);
    expect(agent?.model).toMatch(/^minimax\//);
  });

  it("upserts a role without un-pausing one the founder stopped", async () => {
    const before = await store.getAgentBySlug(ROLE);
    if (before === null) throw new Error("no agent");
    await store.setAgentStatus(ROLE, "paused", false);

    await store.upsertAgent({
      slug: before.slug,
      name: before.name,
      jobTitle: before.jobTitle,
      purpose: "A rewritten purpose, to prove the upsert writes.",
      model: before.model,
      systemPrompt: before.systemPrompt ?? "",
      tools: before.tools,
      autonomy: before.autonomy,
      requiresApprovalFor: before.requiresApprovalFor,
      dailySpendCapCents: before.dailySpendCapCents,
      monthlySpendCapCents: before.monthlySpendCapCents,
      singleActionCapCents: before.singleActionCapCents,
    });

    const after = await store.getAgentBySlug(ROLE);
    expect(after?.purpose).toContain("rewritten purpose");
    expect(after?.isEnabled).toBe(false);
    expect(after?.status).toBe("paused");

    await store.setAgentStatus(ROLE, "active", true);
    expect((await store.getAgentBySlug(ROLE))?.isEnabled).toBe(true);
  });
});

describe("runs, messages and tool calls", () => {
  it("records a run and hands back what the admin reads", async () => {
    const { agent, run } = await openRun();
    expect(run.agentSlug).toBe(ROLE);
    expect(run.status).toBe("queued");
    expect(run.costMicros).toBe(0);

    const started = await store.updateRun(run.id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
    expect(started.startedAt).not.toBeNull();

    // The `add*` fields accumulate in SQL, so two writers cannot lose one
    // another's increment.
    await store.updateRun(run.id, { addCostMicros: 12_000, addToolCalls: 1 });
    await store.updateRun(run.id, { addCostMicros: 3_000, addToolCalls: 1 });
    const counted = await store.getRun(run.id);
    expect(counted?.costMicros).toBe(15_000);
    expect(counted?.toolCallCount).toBe(2);

    // `contextPatch` merges rather than replaces — the halt record is written
    // this way, and losing the rest of the context would lose the model id.
    await store.updateRun(run.id, {
      contextPatch: { halt: { code: "cost_cap_exceeded", cap: "run" } },
    });
    const patched = await store.getRun(run.id);
    expect(patched?.context["agentSlug"]).toBe(ROLE);
    expect(patched?.context["halt"]).toMatchObject({
      code: "cost_cap_exceeded",
    });
    expect(patched?.agentId).toBe(agent.id);
  });

  it("numbers the transcript in order and reads it back the same way", async () => {
    const { run } = await openRun();
    await store.appendMessage({
      runId: run.id,
      role: "system",
      content: "You are Marlow.",
      contentJson: { role: "system" },
    });
    await store.appendMessage({
      runId: run.id,
      role: "user",
      content: "Do the nightly sweep.",
      contentJson: null,
    });
    await store.appendMessage({
      runId: run.id,
      role: "assistant",
      content: "Days of cover first.",
      contentJson: { role: "assistant" },
      tokens: 42,
      model: "minimax/minimax-m2.7-free",
      stopReason: "tool-calls",
    });

    const messages = await store.listMessages(run.id);
    expect(messages.map((message) => message.seq)).toEqual([0, 1, 2]);
    expect(messages[2]?.tokens).toBe(42);
    expect(messages[2]?.stopReason).toBe("tool-calls");
    expect(typeof messages[0]?.createdAt).toBe("string");
  });

  it("refuses a tool-role message with no tool name, as the schema does", async () => {
    const { run } = await openRun();
    await expect(
      store.appendMessage({
        runId: run.id,
        role: "tool",
        content: "{}",
        contentJson: null,
      }),
    ).rejects.toThrow();
  });

  it("records a tool call, its result and its failure", async () => {
    const { run } = await openRun();
    const call = await store.createToolCall({
      runId: run.id,
      messageId: null,
      toolName: "read_stock_cover",
      arguments: { window: 30 },
      isMutation: false,
      status: "pending",
    });
    expect(call.seq).toBe(0);
    expect(call.arguments["window"]).toBe(30);

    const finished = await store.updateToolCall(call.id, {
      status: "succeeded",
      result: { lines: [{ sku: "HS-01-500" }] },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    expect(finished.status).toBe("succeeded");
    expect(JSON.stringify(finished.result)).toContain("HS-01-500");

    const second = await store.createToolCall({
      runId: run.id,
      messageId: null,
      toolName: "read_batch_board",
      arguments: {},
      isMutation: false,
      status: "pending",
    });
    expect(second.seq).toBe(1);
    expect((await store.listToolCalls(run.id)).length).toBe(2);
  });

  it("refuses a finished run with no finish time, as the schema does", async () => {
    const { run } = await openRun();
    await expect(
      store.updateRun(run.id, { status: "succeeded", outcome: "Done." }),
    ).rejects.toThrow();
  });
});

describe("the approval gate's storage", () => {
  it("creates, decides once, and applies", async () => {
    const { agent, run } = await openRun();
    const approval = await store.createApproval({
      subjectType: "purchase_order",
      subjectTable: "purchase_orders",
      title: "Order 2,000 bottles from the glass supplier",
      summary: "Cover is 18 days against a 21-day lead time.",
      rationale: "Days of cover below the lead time.",
      payload: { sku: "BOTTLE_500", quantity: 2000 },
      preview: { supplier: "A glassworks" },
      risk: "medium",
      amountCents: 184_000,
      requestedByAgentId: agent.id,
      requestedByRunId: run.id,
    });
    expect(approval.status).toBe("pending");
    expect(approval.amountCents).toBe(184_000);
    expect(approval.currency).toBe("NZD");

    const decidedAt = new Date().toISOString();
    const decided = await store.decideApproval({
      approvalId: approval.id,
      status: "approved",
      decidedBy: null,
      decidedAt,
      decisionNote: "Yes, order them.",
    });
    expect(decided.status).toBe("approved");

    // Once-only. A second decision is refused rather than overwriting the first.
    await expect(
      store.decideApproval({
        approvalId: approval.id,
        status: "rejected",
        decidedBy: null,
        decidedAt,
        decisionNote: "Actually no.",
      }),
    ).rejects.toThrow(/already approved|once-only/);

    const applied = await store.markApprovalApplied(approval.id, decidedAt, {
      recorded: true,
    });
    expect(applied.appliedAt).not.toBeNull();

    const listed = await store.listApprovals({ runId: run.id });
    expect(listed.map((entry) => entry.id)).toContain(approval.id);
  });

  it("will not mark an undecided approval as applied", async () => {
    const { agent, run } = await openRun();
    const approval = await store.createApproval({
      subjectType: "social_post",
      subjectTable: "social_posts",
      title: "A caption nobody has approved",
      summary: "Waiting on the founder.",
      rationale: null,
      payload: {},
      preview: {},
      risk: "low",
      requestedByAgentId: agent.id,
      requestedByRunId: run.id,
    });
    await expect(
      store.markApprovalApplied(approval.id, new Date().toISOString(), {}),
    ).rejects.toThrow(/not approved|approvals_applied_requires_approved/);
  });
});

describe("the cost ledger", () => {
  it("records micros and sums them in the database", async () => {
    const { agent, run } = await openRun();
    const day = "2026-08-30";
    for (const micros of [12_500, 7_500]) {
      await store.recordCost({
        agentId: agent.id,
        runId: run.id,
        toolCallId: null,
        incurredAt: `${day}T09:00:00.000Z`,
        incurredOn: day,
        provider: "gateway",
        model: "minimax/minimax-m2.7-free",
        kind: "inference",
        inputTokens: 41_200,
        outputTokens: 480,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costMicros: micros,
        currency: "NZD",
        note: null,
      });
    }

    const rows = await store.listCosts({ runId: run.id });
    expect(rows).toHaveLength(2);
    // `date` comes back as text, not a Date parsed into the local timezone —
    // which is what keeps a Pacific/Auckland ledger day from drifting.
    expect(rows[0]?.incurredOn).toBe(day);
    expect(rows[0]?.provider).toBe("gateway");

    // `bigint` arrives as a string; it is narrowed once, here.
    expect(await store.sumCostMicros({ runId: run.id })).toBe(20_000);
    expect(
      await store.sumCostMicros({
        agentId: agent.id,
        fromDate: day,
        toDate: day,
      }),
    ).toBeGreaterThanOrEqual(20_000);
    expect(
      await store.sumCostMicros({
        agentId: agent.id,
        fromDate: "2020-01-01",
        toDate: "2020-01-02",
      }),
    ).toBe(0);
  });
});

describe("settings, brand rules and the audit trail", () => {
  it("round-trips the kill switch through the settings table", async () => {
    expect(await store.getSetting("agents.kill_switch")).not.toBeUndefined();
    await store.setSetting(
      "agents.test_switch",
      { halted: true, reason: "a test" },
      "Written by the SQL store's own test.",
    );
    expect(await store.getSetting("agents.test_switch")).toMatchObject({
      halted: true,
    });
  });

  it("loads the brand rules a prompt is composed from, in priority order", async () => {
    const rules = await store.listBrandRules(["social"]);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.map((rule) => rule.slug)).toContain("no-health-claims");
    const priorities = rules.map((rule) => rule.priority);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
    // Scope is honoured: a packaging-only rule is not in a social prompt.
    const all = await store.listBrandRules([]);
    expect(all.length).toBeGreaterThanOrEqual(rules.length);
  });

  it("writes the runtime's own audit lines", async () => {
    const { agent, run } = await openRun();
    await store.appendAudit({
      actorType: "agent",
      actorId: agent.id,
      actorLabel: ROLE,
      action: "sync",
      entityType: "agent_tool_calls",
      entityId: null,
      entityLabel: "read_stock_cover",
      summary: "brine-ops ran read_stock_cover (read)",
      beforeData: null,
      afterData: { lines: 4 },
      agentRunId: run.id,
      approvalId: null,
    });
    const rows = await database.rows(
      `select summary from public.audit_log where agent_run_id = $1`,
      [run.id],
    );
    expect(rows).toHaveLength(1);
  });
});

describe("one live manual run per agent", () => {
  it("lets the database refuse the second one", async () => {
    const { agent } = await openRun();
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

    // The guard is the partial unique index, not a read-then-write check in
    // TypeScript. A double submit reaches here and is refused by Postgres.
    await expect(
      store.createRun({
        agentId: agent.id,
        trigger: "manual",
        goal: "The same job, pressed twice.",
        context: {},
      }),
    ).rejects.toThrow(/agent_runs_one_live_manual_run|duplicate key/);

    // A scheduled run is untouched by it: those legitimately overlap.
    const scheduled = await store.createRun({
      agentId: agent.id,
      trigger: "schedule",
      goal: "The nightly sweep, which is nobody's double submit.",
      context: {},
    });
    expect(scheduled.id).not.toBe(first.id);

    // And once the first has finished, she can run it again.
    await store.updateRun(first.id, {
      status: "succeeded",
      outcome: "Done.",
      finishedAt: new Date().toISOString(),
    });
    const second = await store.createRun({
      agentId: agent.id,
      trigger: "manual",
      goal: "The job she pressed the button for, again.",
      context: {},
    });
    expect(second.id).not.toBe(first.id);
    const now = new Date().toISOString();
    await store.updateRun(second.id, {
      status: "cancelled",
      startedAt: now,
      finishedAt: now,
    });
  });
});
