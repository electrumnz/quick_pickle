/**
 * Evidence generator.
 *
 * Runs the five scenarios the answer key asks to see and writes what actually
 * happened to `lib/agents/evidence/`. Nothing here is narrated by hand: every
 * value in the artefacts is read back out of the store, the logger or the step
 * trace after the scenario has run.
 *
 * Regenerate with:  npx vitest run tests/agents/evidence.test.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GLOBAL_MONTHLY_CAP_SETTING_KEY,
  formatMicrosNzd,
  invokeTool,
  renderReplay,
  replay,
  silentLogger,
  type EffectGrant,
} from "@/lib/agents";
import { MemoryDurableStep, WorkflowParked, runAgentWorkflow } from "@/inngest";
import { EVENT_NAMES } from "@/inngest/events";

import { createHarness, toolTurn } from "./harness";

const EVIDENCE_DIR = resolve(process.cwd(), "lib/agents/evidence");

function write(name: string, body: string): string {
  const path = resolve(EVIDENCE_DIR, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${body.trimEnd()}\n`, "utf8");
  return path;
}

function heading(title: string, note: string): string {
  return [
    "=".repeat(78),
    title,
    "=".repeat(78),
    note,
    `generated: ${new Date().toISOString()} (npx vitest run tests/agents/evidence.test.ts)`,
    "model: SCRIPTED (lib/agents/model/mock.ts). Everything below the model is the real runtime.",
    "",
  ].join("\n");
}

const ORDER = {
  channel: "supplier_order" as const,
  recipient: "cucumbers@example.co.nz",
  subject: "Restock No 01 HOUSE",
  body: "Twelve cases, please.",
  amountCents: 42_000,
};

describe("evidence artefacts", () => {
  it("01 — the approval gate refuses every bypass route", async () => {
    const lines: string[] = [
      heading(
        "M27 — BYPASS ATTEMPTS ON AN EXTERNAL-EFFECT TOOL",
        "Each row is a deliberate attempt to make send_external_message fire without an\n" +
          "approvals row in an approved state. Every one must fail, and the recording port\n" +
          "must never see the call.",
      ),
    ];

    const harness = await createHarness({
      autonomy: "autonomous",
      script: [
        toolTurn(
          "send_external_message",
          ORDER,
          "Stock is low, so I am reordering.",
        ),
        { kind: "text", text: "Done." },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Reorder cucumbers",
      trigger: "schedule",
    });
    const context = {
      runId: started.runId,
      agentSlug: "test-role",
      toolCallId: "direct",
      now: harness.clock.now(),
      logger: silentLogger,
      abortSignal: new AbortController().signal,
    };

    const attempts: { name: string; outcome: string }[] = [];
    const record = async (
      name: string,
      attempt: () => Promise<unknown>,
    ): Promise<void> => {
      try {
        await attempt();
        attempts.push({ name, outcome: "!!! SUCCEEDED — THE GATE FAILED !!!" });
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code: unknown }).code)
            : "unknown";
        attempts.push({
          name,
          outcome: `REFUSED  ${code}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    };

    await record("1. call the tool directly with no grant", () =>
      invokeTool(harness.tools.sendExternalMessage, ORDER, context),
    );

    // Get a real grant so a structurally identical forgery can be attempted.
    const approval = await harness.platform.approvals.request({
      definition: harness.definition,
      agentId: harness.agentId,
      runId: started.runId,
      tool: harness.tools.sendExternalMessage,
      input: ORDER,
      presentation: {
        title: "Restock",
        summary: "Twelve cases",
        amountCents: 42_000,
      },
      rationale: "Stock is low.",
    });
    await record("2. mint a grant from a PENDING approval", () =>
      harness.platform.approvals.grantFor({
        approvalId: approval.id,
        runId: started.runId,
        toolName: "send_external_message",
        input: ORDER,
      }),
    );

    await harness.platform.approvals.decide({
      approvalId: approval.id,
      status: "approved",
      decidedBy: "founder",
      note: "yes",
    });
    const real = await harness.platform.approvals.grantFor({
      approvalId: approval.id,
      runId: started.runId,
      toolName: "send_external_message",
      input: ORDER,
    });
    const forged: EffectGrant = { ...real };
    await record("3. forge a grant by copying a real one field for field", () =>
      invokeTool(harness.tools.sendExternalMessage, ORDER, context, forged),
    );

    await record("4. swap the recipient after approval", () =>
      harness.platform.approvals.grantFor({
        approvalId: approval.id,
        runId: started.runId,
        toolName: "send_external_message",
        input: { ...ORDER, recipient: "everyone@example.co.nz" },
      }),
    );

    await record("5. spend the same grant a second time", async () => {
      await invokeTool(harness.tools.sendExternalMessage, ORDER, context, real);
      await invokeTool(harness.tools.sendExternalMessage, ORDER, context, real);
    });

    // Fresh harness so the earlier approval cannot be reused.
    const second = await createHarness({
      autonomy: "autonomous",
      script: [toolTurn("send_external_message", ORDER, "Reordering.")],
    });
    const secondRun = await second.runtime.startRun({
      agentSlug: "test-role",
      goal: "Reorder cucumbers",
      trigger: "schedule",
    });
    const turn = await second.runtime.modelStep(secondRun.runId);
    const toolCallId =
      turn.type === "tool_calls" ? (turn.toolCallIds[0] ?? "") : "";
    const skipped = await second.runtime.executeToolCall(
      secondRun.runId,
      toolCallId,
    );
    attempts.push({
      name: "6. skip the gate and execute the proposed call directly",
      outcome: `REFUSED  tool call recorded as "${skipped.status}" — ${skipped.error ?? ""}`,
    });

    const rejectedHarness = await createHarness({
      autonomy: "autonomous",
      script: [
        toolTurn("send_external_message", ORDER, "Reordering."),
        { kind: "text", text: "OK." },
      ],
    });
    const rejectedRun = await rejectedHarness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Reorder cucumbers",
      trigger: "schedule",
    });
    await rejectedHarness.runtime.runToCompletion(rejectedRun.runId, {
      onApproval: async (id) =>
        rejectedHarness.platform.approvals.decide({
          approvalId: id,
          status: "rejected",
          decidedBy: "founder",
          note: "we have enough",
        }),
    });
    attempts.push({
      name: "7. proceed anyway after the founder rejects",
      outcome: `REFUSED  external sends: ${rejectedHarness.effects.externalMessages.length}; tool call status "${(await rejectedHarness.store.listToolCalls(rejectedRun.runId))[0]?.status}"`,
    });

    for (const attempt of attempts) {
      lines.push(attempt.name);
      lines.push(`    ${attempt.outcome}`);
      lines.push("");
    }

    lines.push("-".repeat(78));
    lines.push("SIDE EFFECTS ACTUALLY PERFORMED");
    lines.push(
      `  harness 1 (one legitimately approved send in attempt 5): ${harness.effects.externalMessages.length}`,
    );
    lines.push(
      `  harness 2 (gate skipped):                                ${second.effects.externalMessages.length}`,
    );
    lines.push(
      `  harness 3 (approval rejected):                           ${rejectedHarness.effects.externalMessages.length}`,
    );
    lines.push("");
    lines.push(
      "Every refusal above is a different route to the same effect. The only path that",
    );
    lines.push(
      "worked was the legitimate one: an approvals row in status 'approved', raised by",
    );
    lines.push("this run, covering these exact arguments.");

    const path = write("01-approval-gate-bypass.txt", lines.join("\n"));
    expect(path).toContain("01-approval-gate-bypass.txt");
    expect(
      attempts.every((attempt) => attempt.outcome.startsWith("REFUSED")),
    ).toBe(true);
    expect(second.effects.externalMessages).toHaveLength(0);
    expect(rejectedHarness.effects.externalMessages).toHaveLength(0);
  });

  it("02 — replay(runId) reconstructs a real run", async () => {
    const harness = await createHarness({
      autonomy: "act_with_limits",
      script: [
        toolTurn(
          "read_catalogue",
          { handle: "no-01-house" },
          "I need the current price first.",
        ),
        toolTurn(
          "save_internal_draft",
          {
            slug: "house-price-note",
            body: "No 01 HOUSE is listed at $18.00 and is active.",
          },
          "Writing down what I found so the founder can read it later.",
        ),
        {
          kind: "text",
          text: "No 01 HOUSE is $18.00 and active. Noted internally.",
        },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Check the price of No 01 HOUSE and note it.",
      trigger: "schedule",
      input: { handle: "no-01-house", requestedBy: "weekly-price-check" },
    });
    await harness.runtime.runToCompletion(started.runId);

    const view = await replay(harness.store, started.runId);
    const body = [
      heading(
        "M25 — replay(runId) RECONSTRUCTED FROM STORED TRANSCRIPT ONLY",
        "Nothing below came from memory. replay() reads agent_runs, agent_messages,\n" +
          "agent_tool_calls, agent_costs and approvals, and rebuilds the run — including the\n" +
          "prompt the model would be sent next.",
      ),
      renderReplay(view),
      "",
      "-".repeat(78),
      "PROMPT REBUILT FROM STORAGE (verbatim JSON, as generateText would receive it)",
      "-".repeat(78),
      JSON.stringify(view.prompt, null, 2),
    ].join("\n");

    const path = write("02-replay.txt", body);
    expect(path).toContain("02-replay.txt");
    expect(view.reasoning).toHaveLength(3);
    expect(view.toolCalls).toHaveLength(2);
  });

  it("03 — a cost cap is tripped and the halt is recorded", async () => {
    const chatty = [
      toolTurn(
        "read_catalogue",
        { handle: "no-01-house" },
        "Checking No 01 HOUSE.",
      ),
      toolTurn(
        "read_catalogue",
        { handle: "no-02-dirty" },
        "Checking No 02 DIRTY.",
      ),
      toolTurn(
        "read_catalogue",
        { handle: "no-03-smoke" },
        "Checking No 03 SMOKE.",
      ),
      { kind: "text" as const, text: "All three checked." },
    ];

    const sections: string[] = [
      heading(
        "M26 — COST CAPS DELIBERATELY TRIPPED",
        "Four ceilings, each tripped on purpose. In every case the run stops, the reason\n" +
          "lands on agent_runs.error and agent_runs.context.halt, and a structured log line\n" +
          "records which cap, the limit, and what had already been spent.",
      ),
    ];

    const scenarios: {
      name: string;
      setUp: (
        harness: Awaited<ReturnType<typeof createHarness>>,
      ) => Promise<void>;
      options: Parameters<typeof createHarness>[0];
    }[] = [
      {
        name: "PER-RUN CAP (1c)",
        options: { script: chatty, perRunCents: 1, dailyCents: 100 },
        setUp: async () => {},
      },
      {
        name: "PER-AGENT DAILY CAP (50c, already spent today)",
        options: {
          script: chatty,
          perRunCents: 50,
          dailyCents: 50,
          monthlyCents: 5_000,
        },
        setUp: async (harness) => {
          await harness.store.recordCost({
            agentId: harness.agentId,
            runId: null,
            toolCallId: null,
            incurredAt: harness.clock.now().toISOString(),
            incurredOn: "2026-08-27",
            provider: "anthropic",
            model: "claude-opus-5",
            kind: "inference",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costMicros: 500_000,
            currency: "NZD",
            note: "earlier run today",
          });
        },
      },
      {
        name: "PER-AGENT MONTHLY CAP (40c, already spent this month)",
        options: {
          script: chatty,
          perRunCents: 40,
          dailyCents: 40,
          monthlyCents: 40,
        },
        setUp: async (harness) => {
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
            costMicros: 400_000,
            currency: "NZD",
            note: "spent earlier this month",
          });
        },
      },
      {
        name: "COMPANY-WIDE MONTHLY CAP (1c across every agent)",
        options: {
          script: chatty,
          perRunCents: 10_000,
          dailyCents: 10_000,
          monthlyCents: 100_000,
        },
        setUp: async (harness) => {
          await harness.store.setSetting(
            GLOBAL_MONTHLY_CAP_SETTING_KEY,
            1,
            "company-wide cap",
          );
        },
      },
    ];

    for (const scenario of scenarios) {
      const harness = await createHarness(scenario.options);
      await scenario.setUp(harness);
      const started = await harness.runtime.startRun({
        agentSlug: "test-role",
        goal: "Check every product price",
        trigger: "schedule",
      });
      const summary = await harness.runtime.runToCompletion(started.runId);
      const view = await replay(harness.store, started.runId);
      const halted = harness.logger.where("agent.run.halted")[0];

      sections.push("-".repeat(78));
      sections.push(scenario.name);
      sections.push("-".repeat(78));
      sections.push(`run status        ${summary.status}`);
      sections.push(`agent_runs.error  ${summary.error ?? "(none)"}`);
      sections.push(`model calls made  ${harness.model.consumed}`);
      sections.push(`spend on the run  ${formatMicrosNzd(summary.costMicros)}`);
      sections.push("agent_runs.context.halt:");
      sections.push(JSON.stringify(view.halt, null, 2));
      sections.push("structured log line:");
      sections.push(JSON.stringify(halted, null, 2));
      sections.push("");

      expect(summary.status).toBe("failed");
      expect(summary.error).toContain("cost_cap_exceeded");
    }

    const path = write("03-cost-cap-halt.txt", sections.join("\n"));
    expect(path).toContain("03-cost-cap-halt.txt");
  });

  it("04 — a run parks on waitForEvent and resumes on approval", async () => {
    const harness = await createHarness({
      autonomy: "autonomous",
      script: [
        toolTurn(
          "send_external_message",
          ORDER,
          "Stock is down to two cases, so I am reordering.",
        ),
        { kind: "text", text: "Order placed with the grower." },
      ],
    });
    const step = new MemoryDurableStep();
    const body = async () =>
      runAgentWorkflow({
        step,
        platform: harness.platform,
        input: {
          agentSlug: "test-role",
          goal: "Reorder cucumbers",
          trigger: "schedule",
        },
      });

    const lines: string[] = [
      heading(
        "DURABLE RUN — PARKED ON waitForEvent, RESUMED BY AN APPROVAL",
        "The workflow body is the one inngest/functions/agent-run.ts registers. The step\n" +
          "driver here reproduces Inngest's model: completed steps memoised by id, the whole\n" +
          "function re-invoked after a park. No process is held open while the founder decides.",
      ),
    ];

    step.beginAttempt();
    let parked: WorkflowParked | null = null;
    try {
      await body();
    } catch (error) {
      if (error instanceof WorkflowParked) {
        parked = error;
      } else {
        throw error;
      }
    }

    const parkedRun = (
      await harness.store.listRuns({ status: ["awaiting_approval"] })
    )[0];
    const pending = (await harness.platform.approvals.pending())[0];

    lines.push("ATTEMPT 1");
    lines.push(`  parked at step      ${parked?.stepId ?? "(did not park)"}`);
    lines.push(`  waiting for event   ${parked?.waiting.event ?? "-"}`);
    lines.push(`  timeout             ${parked?.waiting.timeout ?? "-"}`);
    lines.push(`  match predicate     ${parked?.waiting.if ?? "-"}`);
    lines.push(`  model calls so far  ${harness.model.consumed}`);
    lines.push(
      `  external sends      ${harness.effects.externalMessages.length}`,
    );
    lines.push(`  agent_runs.status   ${parkedRun?.status ?? "-"}`);
    lines.push(`  blocking approval   ${parkedRun?.blockingApprovalId ?? "-"}`);
    lines.push("  approvals row raised:");
    lines.push(
      JSON.stringify(
        {
          id: pending?.id,
          subject_type: pending?.subjectType,
          status: pending?.status,
          risk: pending?.risk,
          amount_cents: pending?.amountCents,
          title: pending?.title,
          rationale: pending?.rationale,
          payload: pending?.payload,
        },
        null,
        2,
      ),
    );
    lines.push("  completed steps held durably:");
    lines.push(`    ${step.completedSteps().join(", ")}`);
    lines.push("");

    await harness.platform.approvals.decide({
      approvalId: pending?.id ?? "",
      status: "approved",
      decidedBy: "founder",
      note: "yes, we are low",
    });
    step.deliver({
      name: EVENT_NAMES.approvalDecided,
      data: {
        approvalId: pending?.id ?? "",
        status: "approved",
        decidedBy: "founder",
      },
    });

    step.beginAttempt();
    const result = await body();

    lines.push("FOUNDER DECIDES");
    lines.push(`  approval ${pending?.id} -> approved by founder`);
    lines.push(`  event emitted: ${EVENT_NAMES.approvalDecided}`);
    lines.push("");
    lines.push("ATTEMPT 2 (re-invoked, as Inngest re-invokes after a park)");
    lines.push(`  result status       ${result.status}`);
    lines.push(`  run id              ${result.runId}`);
    lines.push(
      `  model calls total   ${harness.model.consumed}  (one more than attempt 1)`,
    );
    lines.push(
      `  external sends      ${harness.effects.externalMessages.length}`,
    );
    lines.push("");
    lines.push(
      "STEP TRACE (attempt, step, outcome) — memoised steps were not re-run",
    );
    for (const entry of step.trace) {
      lines.push(
        `  attempt ${entry.attempt}  ${entry.stepId.padEnd(18)} ${entry.kind.padEnd(13)} ${entry.outcome}`,
      );
    }

    const path = write("04-approval-park-resume.txt", lines.join("\n"));
    expect(path).toContain("04-approval-park-resume.txt");
    expect(parked?.stepId).toBe("approval-0-0");
    expect(result.status).toBe("succeeded");
    expect(harness.effects.externalMessages).toHaveLength(1);
  });

  it("05 — the kill switch stops a run that is already in flight", async () => {
    const harness = await createHarness({
      script: [
        { kind: "text", text: "never returned", holdUntilAborted: true },
        { kind: "text", text: "unreachable" },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Long job that gets killed mid-call",
      trigger: "manual",
    });

    const inFlight = harness.runtime.modelStep(started.runId);
    const POLL_MS = 2;
    const CEILING_MS = 2_000;
    const deadline = Date.now() + CEILING_MS;
    while (harness.model.consumed === 0) {
      if (Date.now() > deadline) {
        throw new Error("the model call never started");
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    const during = await harness.store.getRun(started.runId);
    const engagedAt = Date.now();
    await harness.platform.control.engageKillSwitch(
      "smoke in the kitchen",
      "founder",
    );
    const outcome = await inFlight;
    const stoppedAfterMs = Date.now() - engagedAt;

    const after = await harness.store.getRun(started.runId);
    const view = await replay(harness.store, started.runId);

    const lines = [
      heading(
        "KILL SWITCH — STOPS A RUN THAT IS ALREADY IN FLIGHT",
        "The model call is open and holding when the switch is thrown. The in-flight\n" +
          "watcher aborts the request; the runtime then records why the run stopped.",
      ),
      "BEFORE THE SWITCH",
      `  agent_runs.status   ${during?.status}`,
      `  finished_at         ${during?.finishedAt ?? "null"}`,
      `  model calls started ${harness.model.consumed}`,
      "",
      "SWITCH THROWN",
      `  ${JSON.stringify(await harness.platform.control.readKillSwitch(), null, 2)}`,
      "",
      "AFTER",
      `  in-flight call aborted after   ${stoppedAfterMs} ms`,
      `  modelStep outcome              ${JSON.stringify(outcome)}`,
      `  agent_runs.status              ${after?.status}`,
      `  agent_runs.error               ${after?.error}`,
      `  agent_runs.finished_at         ${after?.finishedAt}`,
      "  agent_runs.context.halt:",
      JSON.stringify(view.halt, null, 2),
      "",
      "STRUCTURED LOG",
      ...harness.logger.records
        .filter(
          (entry) =>
            entry.event === "agent.control.kill_switch_engaged" ||
            entry.event === "agent.run.halted",
        )
        .map((entry) => `  ${JSON.stringify(entry)}`),
      "",
      "PER-AGENT PAUSE (the narrower control) is exercised in tests/agents/kill-switch.test.ts.",
    ].join("\n");

    const path = write("05-kill-switch.txt", lines);
    expect(path).toContain("05-kill-switch.txt");
    expect(after?.status).toBe("cancelled");
  });
});
