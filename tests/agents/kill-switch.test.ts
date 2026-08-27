/**
 * The kill switch and the per-agent pause.
 *
 * The requirement is that they bite runs that are already moving, not just the
 * next one to start. The first test proves exactly that: the model call is in
 * flight, holding, when the switch is thrown, and the call is aborted rather
 * than allowed to finish.
 */

import { describe, expect, it } from "vitest";

import { replay } from "@/lib/agents";

import { createHarness, toolTurn } from "./harness";

describe("the kill switch", () => {
  it("stops a run whose model call is already in flight", async () => {
    const harness = await createHarness({
      // The first turn holds open until something aborts it.
      script: [
        {
          kind: "text",
          text: "this should never be returned",
          holdUntilAborted: true,
        },
        { kind: "text", text: "unreachable" },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Long job that gets killed",
      trigger: "manual",
    });

    const inFlight = harness.runtime.modelStep(started.runId);

    // The model call is genuinely running before the switch is thrown.
    await waitUntil(() => harness.model.consumed === 1);
    const runDuring = await harness.store.getRun(started.runId);
    expect(runDuring?.status).toBe("running");
    expect(runDuring?.finishedAt).toBeNull();

    await harness.platform.control.engageKillSwitch(
      "smoke in the kitchen",
      "founder",
    );

    const outcome = await inFlight;
    expect(outcome.type).toBe("halted");
    if (outcome.type !== "halted") {
      throw new Error("expected the run to halt");
    }
    expect(outcome.code).toBe("kill_switch_engaged");
    expect(outcome.reason).toContain("smoke in the kitchen");

    const run = await harness.store.getRun(started.runId);
    expect(run?.status).toBe("cancelled");
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.error).toContain("kill_switch_engaged");

    const view = await replay(harness.store, started.runId);
    expect(view.halt?.code).toBe("kill_switch_engaged");
    expect(
      harness.logger.where("agent.control.kill_switch_engaged"),
    ).toHaveLength(1);
    expect(harness.logger.where("agent.run.halted")).toHaveLength(1);
  });

  it("stops the next run before it calls a model at all", async () => {
    const harness = await createHarness({
      script: [
        toolTurn("read_catalogue", { handle: "no-01-house" }, "Looking it up."),
      ],
    });
    await harness.platform.control.engageKillSwitch(
      "everything off",
      "founder",
    );

    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Job that never gets going",
      trigger: "schedule",
    });
    const summary = await harness.runtime.runToCompletion(started.runId);

    expect(summary.status).toBe("cancelled");
    expect(harness.model.consumed).toBe(0);
    expect(harness.effects.catalogueReads).toHaveLength(0);
  });

  it("releases cleanly, so work can resume", async () => {
    const harness = await createHarness({
      script: [{ kind: "text", text: "done" }],
    });
    await harness.platform.control.engageKillSwitch(
      "pause everything",
      "founder",
    );
    expect((await harness.platform.control.readKillSwitch()).engaged).toBe(
      true,
    );

    await harness.platform.control.releaseKillSwitch("founder");
    expect((await harness.platform.control.readKillSwitch()).engaged).toBe(
      false,
    );

    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Job after the switch is released",
      trigger: "manual",
    });
    const summary = await harness.runtime.runToCompletion(started.runId);
    expect(summary.status).toBe("succeeded");
  });

  it("pauses one agent without touching the rest of the company", async () => {
    const harness = await createHarness({
      script: [{ kind: "text", text: "done" }],
    });
    await harness.platform.control.pauseAgent(
      "test-role",
      "it went odd",
      "founder",
    );

    const verdict = await harness.platform.control.evaluate("test-role");
    expect(verdict.halted).toBe(true);
    if (!verdict.halted) {
      throw new Error("expected the agent to be paused");
    }
    expect(verdict.code).toBe("agent_paused");
    // The global switch is untouched, so other agents are unaffected.
    expect((await harness.platform.control.readKillSwitch()).engaged).toBe(
      false,
    );

    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Job by a paused agent",
      trigger: "manual",
    });
    const summary = await harness.runtime.runToCompletion(started.runId);
    expect(summary.status).toBe("cancelled");
    expect(summary.error).toContain("agent_paused");

    await harness.platform.control.resumeAgent("test-role", "founder");
    expect((await harness.platform.control.evaluate("test-role")).halted).toBe(
      false,
    );
  });

  it("stops a run before it executes a tool, not only before a model call", async () => {
    const harness = await createHarness({
      autonomy: "act_with_limits",
      script: [
        toolTurn("read_catalogue", { handle: "no-01-house" }, "Looking it up."),
        { kind: "text", text: "done" },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Read the catalogue",
      trigger: "manual",
    });
    const turn = await harness.runtime.modelStep(started.runId);
    if (turn.type !== "tool_calls" || turn.toolCallIds[0] === undefined) {
      throw new Error("expected a proposed tool call");
    }

    await harness.platform.control.engageKillSwitch("stop now", "founder");
    const call = await harness.runtime.executeToolCall(
      started.runId,
      turn.toolCallIds[0],
    );

    expect(call.status).toBe("failed");
    expect(harness.effects.catalogueReads).toHaveLength(0);
  });
});

/** Poll until a condition holds, or fail the test after a short ceiling. */
async function waitUntil(predicate: () => boolean): Promise<void> {
  const POLL_MS = 2;
  const CEILING_MS = 2_000;
  const deadline = Date.now() + CEILING_MS;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("condition did not become true in time");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
