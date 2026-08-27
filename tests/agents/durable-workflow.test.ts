/**
 * Durable execution: the run parks on `waitForEvent` and resumes on approval.
 *
 * The workflow body here is the same one `inngest/functions/agent-run.ts`
 * registers; only the step driver differs. `MemoryDurableStep` reproduces
 * Inngest's execution model — completed steps memoised by id, the whole function
 * re-invoked after a park — so a park/resume, and the fact that re-invocation
 * does not repeat completed work, are both observable without a running server.
 */

import { describe, expect, it } from "vitest";

import {
  MemoryDurableStep,
  WorkflowParked,
  runAgentWorkflow,
  type AgentRunResult,
} from "@/inngest";
import { EVENT_NAMES } from "@/inngest/events";

import { createHarness, toolTurn } from "./harness";

const ORDER = {
  channel: "supplier_order" as const,
  recipient: "cucumbers@example.co.nz",
  subject: "Restock No 01 HOUSE",
  body: "Twelve cases, please.",
  amountCents: 42_000,
};

/** Invoke the workflow once. Returns the result, or the park it hit. */
async function invoke(
  step: MemoryDurableStep,
  body: () => Promise<AgentRunResult>,
): Promise<{ result: AgentRunResult | null; parked: WorkflowParked | null }> {
  step.beginAttempt();
  try {
    return { result: await body(), parked: null };
  } catch (error) {
    if (error instanceof WorkflowParked) {
      return { result: null, parked: error };
    }
    throw error;
  }
}

describe("the durable agent workflow", () => {
  it("parks on waitForEvent and resumes when the approval arrives", async () => {
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
    const body = async (): Promise<AgentRunResult> =>
      runAgentWorkflow({
        step,
        platform: harness.platform,
        input: {
          agentSlug: "test-role",
          goal: "Reorder cucumbers",
          trigger: "schedule",
        },
      });

    // --- attempt 1: runs until it needs a human, then parks -----------------
    const first = await invoke(step, body);
    expect(first.result).toBeNull();
    expect(first.parked?.stepId).toBe("approval-0-0");
    expect(first.parked?.waiting.event).toBe(EVENT_NAMES.approvalDecided);
    expect(first.parked?.waiting.timeout).toBe("3d");
    expect(harness.model.consumed).toBe(1);
    expect(harness.effects.externalMessages).toHaveLength(0);

    const parkedRuns = await harness.store.listRuns({
      status: ["awaiting_approval"],
    });
    expect(parkedRuns).toHaveLength(1);
    const runId = parkedRuns[0]?.id ?? "";
    expect(parkedRuns[0]?.blockingApprovalId).not.toBeNull();

    const pending = await harness.platform.approvals.pending();
    expect(pending).toHaveLength(1);
    const approvalId = pending[0]?.id ?? "";
    expect(pending[0]?.subjectType).toBe("email_outreach");
    expect(pending[0]?.amountCents).toBe(42_000);
    expect(pending[0]?.risk).toBe("high");
    // The payload is the exact call to make, so applying it is a replay.
    expect(pending[0]?.payload["tool"]).toBe("send_external_message");

    // --- the founder decides ------------------------------------------------
    await harness.platform.approvals.decide({
      approvalId,
      status: "approved",
      decidedBy: "founder",
      note: "yes, we are low",
    });
    step.deliver({
      name: EVENT_NAMES.approvalDecided,
      data: { approvalId, status: "approved", decidedBy: "founder" },
    });

    // --- attempt 2: re-invoked, replays memoised steps, then continues -------
    const second = await invoke(step, body);
    expect(second.parked).toBeNull();
    expect(second.result?.status).toBe("succeeded");
    expect(second.result?.runId).toBe(runId);
    expect(harness.effects.externalMessages).toEqual([
      {
        channel: "supplier_order",
        recipient: ORDER.recipient,
        subject: ORDER.subject,
      },
    ]);

    // Re-invocation replayed the earlier steps rather than repeating them:
    // exactly one extra model call, and the completed steps came from memory.
    expect(harness.model.consumed).toBe(2);
    const replayed = step.trace.filter(
      (entry) => entry.attempt === 2 && entry.outcome === "memoised",
    );
    expect(replayed.map((entry) => entry.stepId)).toEqual([
      "start-run",
      "control-0",
      "model-0",
      "gate-0-0",
    ]);
    const resumed = step.trace.find(
      (entry) => entry.stepId === "approval-0-0" && entry.outcome === "resumed",
    );
    expect(resumed).toBeDefined();
  });

  it("resumes with a refusal when the founder rejects, and never sends", async () => {
    const harness = await createHarness({
      autonomy: "autonomous",
      script: [
        toolTurn("send_external_message", ORDER, "Reordering stock."),
        { kind: "text", text: "Understood, I will not order." },
      ],
    });
    const step = new MemoryDurableStep();
    const body = async (): Promise<AgentRunResult> =>
      runAgentWorkflow({
        step,
        platform: harness.platform,
        input: {
          agentSlug: "test-role",
          goal: "Reorder cucumbers",
          trigger: "schedule",
        },
      });

    await invoke(step, body);
    const approvalId =
      (await harness.platform.approvals.pending())[0]?.id ?? "";
    await harness.platform.approvals.decide({
      approvalId,
      status: "rejected",
      decidedBy: "founder",
      note: "we have enough",
    });
    step.deliver({
      name: EVENT_NAMES.approvalDecided,
      data: { approvalId, status: "rejected", decidedBy: "founder" },
    });

    const second = await invoke(step, body);
    expect(second.result?.status).toBe("succeeded");
    expect(harness.effects.externalMessages).toHaveLength(0);
    const calls = await harness.store.listToolCalls(second.result?.runId ?? "");
    expect(calls[0]?.status).toBe("rejected");
  });

  it("treats an expired wait as a refusal rather than an approval", async () => {
    const harness = await createHarness({
      autonomy: "autonomous",
      script: [
        toolTurn("send_external_message", ORDER, "Reordering stock."),
        { kind: "text", text: "Nobody answered, so I stopped." },
      ],
    });
    const step = new MemoryDurableStep();
    const body = async (): Promise<AgentRunResult> =>
      runAgentWorkflow({
        step,
        platform: harness.platform,
        input: {
          agentSlug: "test-role",
          goal: "Reorder cucumbers",
          trigger: "schedule",
        },
      });

    await invoke(step, body);
    // Nobody decided within the timeout; Inngest resolves the wait as null.
    step.expire("approval-0-0");

    const second = await invoke(step, body);
    expect(second.result?.status).toBe("succeeded");
    expect(harness.effects.externalMessages).toHaveLength(0);
    const calls = await harness.store.listToolCalls(second.result?.runId ?? "");
    expect(calls[0]?.status).toBe("rejected");
    expect(calls[0]?.error).toContain("approval_expired");
  });

  it("runs a read-only job straight through with no park at all", async () => {
    const harness = await createHarness({
      autonomy: "observe",
      tools: ["read_catalogue"],
      script: [
        toolTurn(
          "read_catalogue",
          { handle: "no-01-house" },
          "Checking the price.",
        ),
        { kind: "text", text: "No 01 HOUSE is $18.00." },
      ],
    });
    const step = new MemoryDurableStep();
    const outcome = await invoke(step, async () =>
      runAgentWorkflow({
        step,
        platform: harness.platform,
        input: {
          agentSlug: "test-role",
          goal: "Price check",
          trigger: "schedule",
        },
      }),
    );

    expect(outcome.parked).toBeNull();
    expect(outcome.result?.status).toBe("succeeded");
    expect(harness.effects.catalogueReads).toEqual(["no-01-house"]);
    expect(step.trace.some((entry) => entry.kind === "waitForEvent")).toBe(
      false,
    );
  });

  it("stores every step's output through JSON, so nothing depends on a live object", async () => {
    const harness = await createHarness({
      script: [{ kind: "text", text: "Nothing to do." }],
    });
    const step = new MemoryDurableStep();
    await invoke(step, async () =>
      runAgentWorkflow({
        step,
        platform: harness.platform,
        input: { agentSlug: "test-role", goal: "No-op", trigger: "manual" },
      }),
    );
    expect(step.completedSteps()).toEqual([
      "start-run",
      "control-0",
      "model-0",
      "summarise-1",
    ]);
  });
});
