/**
 * M27 — the approval gate.
 *
 * "No agent can write to the storefront or send an external message without a
 * row in `approvals` with an explicit approved state."
 *
 * Each test below is a deliberate attempt to get an external effect to happen
 * without one, coming at the gate from a different direction. All of them must
 * fail, and the recording port must never see the call.
 */

import { describe, expect, it } from "vitest";

import {
  ApprovalGateError,
  invokeTool,
  silentLogger,
  type EffectGrant,
} from "@/lib/agents";

import { createHarness, toolTurn } from "./harness";

const EXTERNAL_ARGS = {
  channel: "email" as const,
  recipient: "wholesale@example.co.nz",
  subject: "Restock",
  body: "Twelve cases of No 01 HOUSE, please.",
};

function executionContext(runId: string, now: Date) {
  return {
    runId,
    agentSlug: "test-role",
    toolCallId: "direct-call",
    now,
    logger: silentLogger,
    abortSignal: new AbortController().signal,
  };
}

describe("M27 the approval gate cannot be bypassed", () => {
  it("refuses to execute an external tool with no grant at all", async () => {
    const harness = await createHarness({ script: [{ kind: "text", text: "done" }] });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "bypass attempt",
      trigger: "manual",
    });

    await expect(
      invokeTool(
        harness.tools.sendExternalMessage,
        EXTERNAL_ARGS,
        executionContext(started.runId, harness.clock.now()),
      ),
    ).rejects.toThrow(ApprovalGateError);
    expect(harness.effects.externalMessages).toHaveLength(0);
  });

  it("refuses a grant that the runtime did not mint, even one shaped identically", async () => {
    const harness = await createHarness({ script: [{ kind: "text", text: "done" }] });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "forge a grant",
      trigger: "manual",
    });

    // Obtain a genuine grant, then hand over a spread copy. The copy carries
    // every property including the private brand symbol, so it satisfies the
    // type — but it was never minted, so it is not in the runtime's registry.
    const approval = await harness.platform.approvals.request({
      definition: harness.definition,
      agentId: harness.agentId,
      runId: started.runId,
      tool: harness.tools.sendExternalMessage,
      input: EXTERNAL_ARGS,
      presentation: { title: "t", summary: "s" },
      rationale: null,
    });
    await harness.platform.approvals.decide({
      approvalId: approval.id,
      status: "approved",
      decidedBy: "founder",
      note: null,
    });
    const real = await harness.platform.approvals.grantFor({
      approvalId: approval.id,
      runId: started.runId,
      toolName: "send_external_message",
      input: EXTERNAL_ARGS,
    });
    const forged: EffectGrant = { ...real };

    await expect(
      invokeTool(
        harness.tools.sendExternalMessage,
        EXTERNAL_ARGS,
        executionContext(started.runId, harness.clock.now()),
        forged,
      ),
    ).rejects.toMatchObject({ code: "grant_forged" });
    expect(harness.effects.externalMessages).toHaveLength(0);
  });

  it("refuses to mint a grant from an approval that is still pending", async () => {
    const harness = await createHarness({ script: [{ kind: "text", text: "done" }] });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "mint from pending",
      trigger: "manual",
    });
    const approval = await harness.platform.approvals.request({
      definition: harness.definition,
      agentId: harness.agentId,
      runId: started.runId,
      tool: harness.tools.sendExternalMessage,
      input: EXTERNAL_ARGS,
      presentation: { title: "t", summary: "s" },
      rationale: null,
    });

    await expect(
      harness.platform.approvals.grantFor({
        approvalId: approval.id,
        runId: started.runId,
        toolName: "send_external_message",
        input: EXTERNAL_ARGS,
      }),
    ).rejects.toMatchObject({ code: "approval_not_approved" });
  });

  it("refuses to mint a grant from a rejected approval", async () => {
    const harness = await createHarness({ script: [{ kind: "text", text: "done" }] });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "mint from rejected",
      trigger: "manual",
    });
    const approval = await harness.platform.approvals.request({
      definition: harness.definition,
      agentId: harness.agentId,
      runId: started.runId,
      tool: harness.tools.sendExternalMessage,
      input: EXTERNAL_ARGS,
      presentation: { title: "t", summary: "s" },
      rationale: null,
    });
    await harness.platform.approvals.decide({
      approvalId: approval.id,
      status: "rejected",
      decidedBy: "founder",
      note: "we are not ordering more stock this month",
    });

    await expect(
      harness.platform.approvals.grantFor({
        approvalId: approval.id,
        runId: started.runId,
        toolName: "send_external_message",
        input: EXTERNAL_ARGS,
      }),
    ).rejects.toMatchObject({ code: "approval_rejected" });
  });

  it("refuses a grant when the arguments differ from the ones approved", async () => {
    const harness = await createHarness({ script: [{ kind: "text", text: "done" }] });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "swap the payload after approval",
      trigger: "manual",
    });
    const approval = await harness.platform.approvals.request({
      definition: harness.definition,
      agentId: harness.agentId,
      runId: started.runId,
      tool: harness.tools.sendExternalMessage,
      input: EXTERNAL_ARGS,
      presentation: { title: "t", summary: "s" },
      rationale: null,
    });
    await harness.platform.approvals.decide({
      approvalId: approval.id,
      status: "approved",
      decidedBy: "founder",
      note: null,
    });

    await expect(
      harness.platform.approvals.grantFor({
        approvalId: approval.id,
        runId: started.runId,
        toolName: "send_external_message",
        input: { ...EXTERNAL_ARGS, recipient: "everyone@example.co.nz" },
      }),
    ).rejects.toMatchObject({ code: "grant_arguments_mismatch" });
  });

  it("refuses an approval raised by a different run", async () => {
    const harness = await createHarness({ script: [{ kind: "text", text: "done" }] });
    const first = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "run one",
      trigger: "manual",
    });
    const second = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "run two",
      trigger: "manual",
    });
    const approval = await harness.platform.approvals.request({
      definition: harness.definition,
      agentId: harness.agentId,
      runId: first.runId,
      tool: harness.tools.sendExternalMessage,
      input: EXTERNAL_ARGS,
      presentation: { title: "t", summary: "s" },
      rationale: null,
    });
    await harness.platform.approvals.decide({
      approvalId: approval.id,
      status: "approved",
      decidedBy: "founder",
      note: null,
    });

    await expect(
      harness.platform.approvals.grantFor({
        approvalId: approval.id,
        runId: second.runId,
        toolName: "send_external_message",
        input: EXTERNAL_ARGS,
      }),
    ).rejects.toMatchObject({ code: "approval_mismatch" });
  });

  it("spends a grant exactly once", async () => {
    const harness = await createHarness({ script: [{ kind: "text", text: "done" }] });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "replay a grant",
      trigger: "manual",
    });
    const approval = await harness.platform.approvals.request({
      definition: harness.definition,
      agentId: harness.agentId,
      runId: started.runId,
      tool: harness.tools.sendExternalMessage,
      input: EXTERNAL_ARGS,
      presentation: { title: "t", summary: "s" },
      rationale: null,
    });
    await harness.platform.approvals.decide({
      approvalId: approval.id,
      status: "approved",
      decidedBy: "founder",
      note: null,
    });
    const grant = await harness.platform.approvals.grantFor({
      approvalId: approval.id,
      runId: started.runId,
      toolName: "send_external_message",
      input: EXTERNAL_ARGS,
    });

    await invokeTool(
      harness.tools.sendExternalMessage,
      EXTERNAL_ARGS,
      executionContext(started.runId, harness.clock.now()),
      grant,
    );
    expect(harness.effects.externalMessages).toHaveLength(1);

    await expect(
      invokeTool(
        harness.tools.sendExternalMessage,
        EXTERNAL_ARGS,
        executionContext(started.runId, harness.clock.now()),
        grant,
      ),
    ).rejects.toMatchObject({ code: "grant_consumed" });
    expect(harness.effects.externalMessages).toHaveLength(1);
  });

  it("parks a fully autonomous agent's external message instead of sending it", async () => {
    const harness = await createHarness({
      autonomy: "autonomous",
      script: [
        toolTurn("send_external_message", EXTERNAL_ARGS, "Stock is low, so I am reordering."),
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "reorder stock",
      trigger: "manual",
    });

    const turn = await harness.runtime.modelStep(started.runId);
    expect(turn.type).toBe("tool_calls");
    if (turn.type !== "tool_calls") {
      throw new Error("expected the model to propose a tool call");
    }
    const toolCallId = turn.toolCallIds[0];
    if (toolCallId === undefined) {
      throw new Error("expected a tool call id");
    }
    const gate = await harness.runtime.gateToolCall(started.runId, toolCallId);

    expect(gate.type).toBe("awaiting_approval");
    expect(harness.effects.externalMessages).toHaveLength(0);

    const run = await harness.store.getRun(started.runId);
    expect(run?.status).toBe("awaiting_approval");
    const approvals = await harness.store.listApprovals({ runId: started.runId });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.status).toBe("pending");
  });

  it("parks a fully autonomous agent's storefront write too", async () => {
    const harness = await createHarness({
      autonomy: "autonomous",
      script: [
        toolTurn(
          "publish_storefront_change",
          { handle: "no-01-house", field: "price_cents", value: "2200", priceCents: 2200 },
          "Costs are up, so the price should follow.",
        ),
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "reprice",
      trigger: "manual",
    });
    const turn = await harness.runtime.modelStep(started.runId);
    if (turn.type !== "tool_calls" || turn.toolCallIds[0] === undefined) {
      throw new Error("expected a proposed tool call");
    }
    const gate = await harness.runtime.gateToolCall(started.runId, turn.toolCallIds[0]);
    expect(gate.type).toBe("awaiting_approval");
    expect(harness.effects.storefrontChanges).toHaveLength(0);
  });

  it("does not execute a rejected tool call, and tells the model it was refused", async () => {
    const harness = await createHarness({
      autonomy: "autonomous",
      script: [
        toolTurn("send_external_message", EXTERNAL_ARGS, "Reordering stock."),
        { kind: "text", text: "Understood — I will not send it." },
      ],
    });
    const summary = await harness.runtime.runToCompletion(
      (
        await harness.runtime.startRun({
          agentSlug: "test-role",
          goal: "reorder stock",
          trigger: "manual",
        })
      ).runId,
      {
        onApproval: async (approvalId) =>
          harness.platform.approvals.decide({
            approvalId,
            status: "rejected",
            decidedBy: "founder",
            note: "no",
          }),
      },
    );

    expect(summary.status).toBe("succeeded");
    expect(harness.effects.externalMessages).toHaveLength(0);
    const calls = await harness.store.listToolCalls(summary.runId);
    expect(calls[0]?.status).toBe("rejected");
    expect(calls[0]?.approvalId).not.toBeNull();
  });

  it("refuses to execute an effectful tool call that carries no approval id", async () => {
    const harness = await createHarness({
      autonomy: "autonomous",
      script: [toolTurn("send_external_message", EXTERNAL_ARGS, "Reordering stock.")],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "reorder stock",
      trigger: "manual",
    });
    const turn = await harness.runtime.modelStep(started.runId);
    if (turn.type !== "tool_calls" || turn.toolCallIds[0] === undefined) {
      throw new Error("expected a proposed tool call");
    }

    // Skip the gate entirely and go straight for execution.
    const call = await harness.runtime.executeToolCall(started.runId, turn.toolCallIds[0]);
    expect(call.status).toBe("failed");
    expect(call.error).toContain("approval_required");
    expect(harness.effects.externalMessages).toHaveLength(0);
  });

  it("only ever executes an external effect against an approved row", async () => {
    const harness = await createHarness({
      autonomy: "autonomous",
      script: [
        toolTurn("send_external_message", EXTERNAL_ARGS, "Reordering stock."),
        { kind: "text", text: "Order placed." },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "reorder stock",
      trigger: "manual",
    });
    await harness.runtime.runToCompletion(started.runId, {
      onApproval: async (approvalId) =>
        harness.platform.approvals.decide({
          approvalId,
          status: "approved",
          decidedBy: "founder",
          note: "go ahead",
        }),
    });

    expect(harness.effects.externalMessages).toHaveLength(1);
    const calls = await harness.store.listToolCalls(started.runId);
    for (const call of calls) {
      if (call.isMutation && call.status === "succeeded") {
        expect(call.approvalId).not.toBeNull();
        const approval = await harness.store.getApproval(call.approvalId ?? "");
        expect(approval?.status).toBe("approved");
        expect(approval?.appliedAt).not.toBeNull();
      }
    }
  });
});
