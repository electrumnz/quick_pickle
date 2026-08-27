/**
 * M25 — "Any agent run reconstructs fully from its stored transcript."
 *
 * The runtime never holds conversation state in a variable: before every model
 * call it rebuilds the prompt from `agent_messages`. These tests prove the two
 * halves of that claim — that a finished run reconstructs completely, and that a
 * run which died mid-flight still reconstructs as far as it got.
 */

import { describe, expect, it } from "vitest";

import {
  InMemoryAgentStore,
  reconstructPrompt,
  renderReplay,
  replay,
} from "@/lib/agents";

import { createHarness, toolTurn } from "./harness";

describe("M25 a run reconstructs from its stored transcript", () => {
  it("reconstructs a completed multi-step run in full", async () => {
    const harness = await createHarness({
      autonomy: "act_with_limits",
      script: [
        toolTurn(
          "read_catalogue",
          { handle: "no-01-house" },
          "I need the current price before I write anything.",
        ),
        toolTurn(
          "save_internal_draft",
          { slug: "house-restock-note", body: "No 01 HOUSE is at $18.00." },
          "Recording what I found so the founder can read it later.",
        ),
        { kind: "text", text: "No 01 HOUSE sits at $18.00; I have noted it." },
      ],
    });

    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Check the price of No 01 HOUSE and note it.",
      trigger: "schedule",
      input: { handle: "no-01-house", requestedBy: "weekly-price-check" },
    });
    const summary = await harness.runtime.runToCompletion(started.runId);
    expect(summary.status).toBe("succeeded");

    const view = await replay(harness.store, started.runId);

    // Identity and provenance.
    expect(view.run.id).toBe(started.runId);
    expect(view.run.agentSlug).toBe("test-role");
    expect(view.run.goal).toBe("Check the price of No 01 HOUSE and note it.");

    // The inputs it saw.
    expect(view.inputs).toEqual({
      handle: "no-01-house",
      requestedBy: "weekly-price-check",
    });

    // The exact system prompt, including the brand rules that were live.
    expect(view.systemPrompt).toContain("You are Test Role");
    expect(view.systemPrompt).toContain("Never say a pickle is healthy");
    expect(view.brandRules).toEqual(["no-health-claims", "dry-not-cute"]);

    // Every message and every tool call, with arguments and results.
    expect(view.messages.length).toBeGreaterThanOrEqual(7);
    expect(view.toolCalls).toHaveLength(2);
    expect(view.toolCalls[0]?.toolName).toBe("read_catalogue");
    expect(view.toolCalls[0]?.arguments).toEqual({ handle: "no-01-house" });
    expect(view.toolCalls[0]?.result).toMatchObject({
      title: "No 01 HOUSE",
      priceCents: 1800,
    });
    expect(view.toolCalls[1]?.toolName).toBe("save_internal_draft");

    // The reasoning trail: why it did each thing.
    expect(view.reasoning).toEqual([
      "I need the current price before I write anything.",
      "Recording what I found so the founder can read it later.",
      "No 01 HOUSE sits at $18.00; I have noted it.",
    ]);

    // The bill.
    expect(view.totals.steps).toBe(3);
    expect(view.costs).toHaveLength(3);
    expect(view.totals.costMicros).toBeGreaterThan(0);

    // The timeline interleaves messages and tool calls in order.
    expect(view.timeline.length).toBe(
      view.messages.length + view.toolCalls.length,
    );
  });

  it("reconstructs the exact prompt the model was last sent", async () => {
    const harness = await createHarness({
      script: [
        toolTurn("read_catalogue", { handle: "no-01-house" }, "Looking it up."),
        { kind: "text", text: "Eighteen dollars." },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Price check",
      trigger: "manual",
      input: {},
    });
    await harness.runtime.runToCompletion(started.runId);

    const view = await replay(harness.store, started.runId);
    const stored = await harness.store.listMessages(started.runId);
    const rebuilt = reconstructPrompt(stored);

    // The replayed prompt equals the prompt built from storage, and the last
    // live call the model actually received had the same system prompt.
    expect(view.prompt.system).toBe(rebuilt.system);
    expect(view.prompt.messages).toEqual(rebuilt.messages);

    const lastCall = harness.model.calls.at(-1);
    const systemFromCall = lastCall?.prompt.find(
      (message) => message.role === "system",
    );
    expect(systemFromCall?.content).toContain("You are Test Role");

    // Message-for-message: what the provider saw last equals what storage says
    // it saw, minus the assistant turn that call produced.
    const nonSystemSent = (lastCall?.prompt ?? []).filter(
      (message) => message.role !== "system",
    );
    expect(nonSystemSent).toHaveLength(rebuilt.messages.length - 1);
  });

  it("reconstructs a run that crashed part-way through", async () => {
    const harness = await createHarness({
      script: [
        toolTurn(
          "read_catalogue",
          { handle: "no-01-house" },
          "Looking it up first.",
        ),
        { kind: "error", message: "provider exploded" },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Price check that dies half way",
      trigger: "manual",
    });
    const summary = await harness.runtime.runToCompletion(started.runId);
    expect(summary.status).toBe("failed");

    const view = await replay(harness.store, started.runId);
    expect(view.halt?.code).toBe("model_call_failed");
    expect(view.halt?.reason).toContain("provider exploded");
    // The work it did before dying is all still there.
    expect(view.toolCalls).toHaveLength(1);
    expect(view.toolCalls[0]?.status).toBe("succeeded");
    expect(view.reasoning[0]).toBe("Looking it up first.");
    expect(renderReplay(view)).toContain("TIMELINE");
  });

  it("refuses to replay a run that does not exist", async () => {
    const harness = await createHarness({
      script: [{ kind: "text", text: "hi" }],
    });
    const store: InMemoryAgentStore = harness.store;
    await expect(
      replay(store, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({
      code: "run_not_found",
    });
  });
});
