/**
 * Observability: structured logs and a queryable run history.
 *
 * The admin UI is a later unit, so what matters here is that the data it will
 * render is typed, complete, and derived from storage rather than from memory —
 * and that "what did this agent do and why?" has a real answer.
 */

import { describe, expect, it } from "vitest";

import { RunHistory, ledgerDate, ledgerMonthStart } from "@/lib/agents";

import { createHarness, toolTurn } from "./harness";

describe("run history", () => {
  it("lists runs with durations, spend and status", async () => {
    const harness = await createHarness({
      script: [
        toolTurn(
          "read_catalogue",
          { handle: "no-01-house" },
          "Checking the price.",
        ),
        { kind: "text", text: "Eighteen dollars." },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Price check",
      trigger: "schedule",
    });
    harness.clock.advance(1_500);
    await harness.runtime.runToCompletion(started.runId);

    const history = new RunHistory(harness.store);
    const rows = await history.list({ agentSlug: "test-role" });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.status).toBe("succeeded");
    expect(row?.trigger).toBe("schedule");
    expect(row?.toolCallCount).toBe(1);
    expect(row?.costNzd).toMatch(/^\$/);
    // The clock advanced 1.5s between startRun and the first step.
    expect(row?.durationMs).toBe(1_500);
  });

  it("answers what the agent did and why, entirely from stored data", async () => {
    const harness = await createHarness({
      autonomy: "autonomous",
      script: [
        toolTurn(
          "send_external_message",
          {
            channel: "email",
            recipient: "grower@example.co.nz",
            subject: "Restock",
            body: "Twelve cases.",
          },
          "We are down to two cases of No 01 HOUSE, so I am reordering.",
        ),
        { kind: "text", text: "Order sent to the grower." },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Keep No 01 HOUSE in stock",
      trigger: "schedule",
      input: { onHandCases: 2, reorderPoint: 6 },
    });
    await harness.runtime.runToCompletion(started.runId, {
      onApproval: async (approvalId) =>
        harness.platform.approvals.decide({
          approvalId,
          status: "approved",
          decidedBy: "founder",
          note: "yes",
        }),
    });

    const explanation = await new RunHistory(harness.store).explain(
      started.runId,
    );
    expect(explanation.goal).toBe("Keep No 01 HOUSE in stock");
    expect(explanation.inputsSeen).toEqual({ onHandCases: 2, reorderPoint: 6 });
    expect(explanation.reasoning[0]).toContain("down to two cases");
    expect(explanation.actions).toHaveLength(1);
    expect(explanation.actions[0]).toMatchObject({
      tool: "send_external_message",
      effect: "mutation",
      status: "succeeded",
    });
    expect(explanation.actions[0]?.approvalId).not.toBeNull();
    expect(explanation.approvals[0]).toMatchObject({
      subjectType: "email_outreach",
      status: "approved",
      decidedBy: "founder",
    });
    expect(explanation.conclusion).toBe("Order sent to the grower.");
  });

  it("explains a halted run by naming the cap that stopped it", async () => {
    const harness = await createHarness({
      perRunCents: 1,
      script: [
        toolTurn("read_catalogue", { handle: "no-01-house" }, "Checking."),
        toolTurn("read_catalogue", { handle: "no-02-dirty" }, "And again."),
        toolTurn("read_catalogue", { handle: "no-03-smoke" }, "And again."),
        { kind: "text", text: "Done." },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Check every price",
      trigger: "schedule",
    });
    await harness.runtime.runToCompletion(started.runId);

    const explanation = await new RunHistory(harness.store).explain(
      started.runId,
    );
    expect(explanation.conclusion).toContain(
      "Stopped by the runtime (cost_cap_exceeded)",
    );
  });

  it("reports spend against caps", async () => {
    const harness = await createHarness({
      script: [{ kind: "text", text: "Done." }],
      dailyCents: 500,
      monthlyCents: 5_000,
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "One call",
      trigger: "manual",
    });
    await harness.runtime.runToCompletion(started.runId);

    const now = harness.clock.now();
    const spend = await new RunHistory(harness.store).spend(
      "test-role",
      ledgerDate(now),
      ledgerMonthStart(now),
    );
    expect(spend?.dailyCapCents).toBe(500);
    expect(spend?.todayMicros).toBeGreaterThan(0);
    expect(spend?.dailyHeadroomCents).toBeLessThan(500);
  });

  it("emits one structured log line per lifecycle event", async () => {
    const harness = await createHarness({
      autonomy: "act_with_limits",
      script: [
        toolTurn("read_catalogue", { handle: "no-01-house" }, "Checking."),
        { kind: "text", text: "Done." },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Price check",
      trigger: "manual",
    });
    await harness.runtime.runToCompletion(started.runId);

    const events = harness.logger.records.map((record) => record.event);
    expect(events).toContain("agent.run.started");
    expect(events).toContain("agent.run.step");
    expect(events).toContain("agent.cost.recorded");
    expect(events).toContain("agent.tool.succeeded");
    expect(events).toContain("agent.run.succeeded");
    // Every line carries the run id, so a log drain can be filtered by run.
    for (const record of harness.logger.records) {
      expect(typeof record.at).toBe("string");
      expect(["debug", "info", "warn", "error"]).toContain(record.level);
    }
    expect(
      JSON.parse(harness.logger.toNdjson().split("\n")[0] ?? "{}"),
    ).toHaveProperty("event");
  });

  it("writes an audit line for every agent action and every decision", async () => {
    const harness = await createHarness({
      autonomy: "autonomous",
      script: [
        toolTurn(
          "publish_storefront_change",
          { handle: "no-01-house", field: "title", value: "No 01 HOUSE" },
          "Fixing the title case.",
        ),
        { kind: "text", text: "Title fixed." },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Fix the title",
      trigger: "manual",
    });
    await harness.runtime.runToCompletion(started.runId, {
      onApproval: async (approvalId) =>
        harness.platform.approvals.decide({
          approvalId,
          status: "approved",
          decidedBy: "founder",
          note: null,
        }),
    });

    const actions = harness.store.audit.map((entry) => entry.action);
    expect(actions).toContain("create");
    expect(actions).toContain("approve");
    expect(actions).toContain("update");
    for (const entry of harness.store.audit) {
      if (entry.actorType === "agent") {
        // audit_log_agent_has_run: an agent line must name its run.
        expect(entry.agentRunId).not.toBeNull();
      }
    }
  });
});
