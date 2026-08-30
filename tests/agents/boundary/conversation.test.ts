/**
 * The turn cap: the bound `maxSteps` cannot supply.
 *
 * The scenario is the one the research note names. Two agents hand work back and
 * forth. Each run is well inside its own step ceiling and its own per-run budget,
 * so nothing in the existing governance notices. Left alone the pair circles
 * until the daily cap runs out — which stops it, eventually, by spending the
 * budget of an agent that did nothing wrong.
 *
 * Below: it stops at turn five instead, and the stop is written down in the same
 * shape a cost cap is.
 */

import { describe, expect, it } from "vitest";

import {
  FixedClock,
  InMemoryAgentStore,
  MemoryLogger,
  ScriptedModel,
  ToolRegistry,
  createAgentRuntime,
  createScriptedResolver,
  defineAgent,
  type AgentDefinition,
  type AgentPlatform,
  type ScriptedTurn,
} from "@/lib/agents";
import {
  DEFAULT_CONVERSATION_TURN_CAP,
  InMemoryConversationLedger,
  InProcessHandoff,
  MAX_CONVERSATION_TURN_CAP,
  StaticCapabilityDirectory,
  checkConversationContext,
  readConversationContext,
  resolveTurnCap,
  type ConversationLedger,
} from "@/lib/agents/boundary";

function role(slug: string): AgentDefinition {
  return defineAgent({
    slug,
    name: slug,
    jobTitle: "Ping-pong fixture",
    purpose: "Exercise the conversation turn cap across a chain of runs.",
    model: "claude-opus-5",
    systemPrompt: "Answer briefly.",
    tools: [],
    autonomy: "act_with_limits",
    requiresApprovalFor: [],
    budget: { perRunCents: 200, dailyCents: 1_000, monthlyCents: 20_000 },
    maxSteps: 4,
    brandRuleScopes: [],
  });
}

interface PingPong {
  readonly platform: AgentPlatform;
  readonly store: InMemoryAgentStore;
  readonly ledger: ConversationLedger;
  readonly handoff: InProcessHandoff;
}

async function createPingPong(): Promise<PingPong> {
  const clock = new FixedClock(new Date("2026-08-30T09:00:00.000Z"));
  const store = new InMemoryAgentStore(clock);
  const script: readonly ScriptedTurn[] = Array.from({ length: 40 }, () => ({
    kind: "text" as const,
    text: "Handing this back.",
  }));

  const platform = createAgentRuntime({
    store,
    registry: new ToolRegistry([]),
    models: createScriptedResolver(new ScriptedModel(script)),
    clock,
    logger: new MemoryLogger(),
    controlPollIntervalMs: 5,
  });
  // One ledger, and the runtime owns it: the router is handed the same object
  // the runtime counts into. Two counters would be one counter that lies.
  const ledger = platform.runtime.conversations;

  await platform.runtime.register(role("alpha"));
  await platform.runtime.register(role("beta"));

  const handoff = new InProcessHandoff({
    directory: new StaticCapabilityDirectory([
      {
        agentSlug: "alpha",
        agentName: "Alpha",
        capabilities: ["business_reporting"],
      },
      {
        agentSlug: "beta",
        agentName: "Beta",
        capabilities: ["pricing_and_margin"],
      },
    ]),
    runner: platform.runtime,
    conversations: ledger,
  });

  return { platform, store, ledger, handoff };
}

describe("resolveTurnCap", () => {
  it("defaults to five and clamps to the hard maximum", () => {
    expect(resolveTurnCap()).toBe(DEFAULT_CONVERSATION_TURN_CAP);
    expect(resolveTurnCap(3)).toBe(3);
    expect(resolveTurnCap(0)).toBe(1);
    expect(resolveTurnCap(-4)).toBe(1);
    expect(resolveTurnCap(500)).toBe(MAX_CONVERSATION_TURN_CAP);
    expect(resolveTurnCap(Number.NaN)).toBe(DEFAULT_CONVERSATION_TURN_CAP);
  });
});

describe("the ledger", () => {
  it("answers in the same shape the cost caps answer in", async () => {
    const ledger = new InMemoryConversationLedger();
    const ref = { id: "conv-1", turnCap: 2 };

    expect(await ledger.check(ref)).toMatchObject({ ok: true, usedTurns: 0 });
    await ledger.take("conv-1");
    await ledger.take("conv-1");

    const verdict = await ledger.check(ref);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      // Which cap, what the limit was, what had already happened.
      expect(verdict.cap).toBe("conversation_turns");
      expect(verdict.limitTurns).toBe(2);
      expect(verdict.usedTurns).toBe(3);
      expect(verdict.conversationId).toBe("conv-1");
      expect(verdict.reason).toContain("Conversation cap of 2 turns");
    }
  });

  it("counts each conversation separately", async () => {
    const ledger = new InMemoryConversationLedger();
    await ledger.take("a");
    await ledger.take("a");
    await ledger.take("b");
    expect(await ledger.taken("a")).toBe(2);
    expect(await ledger.taken("b")).toBe(1);
    expect(await ledger.taken("never-seen")).toBe(0);
  });
});

describe("a run inside a conversation", () => {
  it("records its turn on the run, where a replay can read it", async () => {
    const { platform, store, ledger } = await createPingPong();

    const first = await platform.runtime.startRun({
      agentSlug: "alpha",
      goal: "Start something.",
      trigger: "manual",
      conversation: { id: "conv-x", turnCap: 3 },
    });
    const run = await store.getRun(first.runId);
    const context = readConversationContext(run?.context ?? {});

    expect(context).toEqual({ id: "conv-x", turn: 1, turnCap: 3 });
    expect(await ledger.taken("conv-x")).toBe(1);
    expect(context === null ? null : checkConversationContext(context).ok).toBe(
      true,
    );
  });

  it("records nothing when the run was not part of one", async () => {
    const { platform, store } = await createPingPong();
    const started = await platform.runtime.startRun({
      agentSlug: "alpha",
      goal: "A scheduled sweep.",
      trigger: "schedule",
    });
    const run = await store.getRun(started.runId);
    expect(readConversationContext(run?.context ?? {})).toBeNull();
  });
});

describe("agent A asking agent B asking agent A", () => {
  it("stops at the cap, and the router refuses before a run is even opened", async () => {
    const { handoff, ledger } = await createPingPong();
    const conversation = { id: "pingpong", turnCap: 4 };

    const opened: string[] = [];
    let capped: string | null = null;

    for (let bounce = 0; bounce < 12; bounce += 1) {
      const outcome = await handoff.dispatch({
        capability:
          bounce % 2 === 0 ? "pricing_and_margin" : "business_reporting",
        message: "Your turn.",
        conversation,
        from: { runId: `run-${String(bounce)}`, agentSlug: "alpha" },
      });
      if (outcome.type === "capped") {
        capped = outcome.reason;
        expect(outcome.cap).toBe("conversation_turns");
        expect(outcome.limitTurns).toBe(4);
        expect(outcome.usedTurns).toBe(5);
        break;
      }
      expect(outcome.type).toBe("dispatched");
      if (outcome.type === "dispatched") {
        opened.push(...outcome.deliveries.map((d) => d.agentSlug));
      }
    }

    // Four handoffs happened; the fifth was refused rather than opened.
    expect(opened).toEqual(["beta", "alpha", "beta", "alpha"]);
    expect(await ledger.taken("pingpong")).toBe(4);
    expect(capped).toContain("handing work back and forth");
  });

  it("halts a run that got past the router, before it spends a model call", async () => {
    const { platform, store, ledger } = await createPingPong();

    // Four turns already used on this conversation.
    for (let index = 0; index < 4; index += 1) {
      await ledger.take("forced");
    }

    const started = await platform.runtime.startRun({
      agentSlug: "beta",
      goal: "One bounce too many.",
      trigger: "chained",
      conversation: { id: "forced", turnCap: 4 },
    });
    const outcome = await platform.runtime.modelStep(started.runId);

    expect(outcome).toMatchObject({
      type: "halted",
      code: "conversation_turn_cap_exceeded",
    });

    const run = await store.getRun(started.runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("conversation_turn_cap_exceeded");
    // The same shape a cost cap halt writes: which cap, the limit, what happened.
    expect(run?.context["halt"]).toMatchObject({
      code: "conversation_turn_cap_exceeded",
      cap: "conversation_turns",
      conversationId: "forced",
      limitTurns: 4,
      usedTurns: 5,
    });
    // Nothing was spent proving it.
    expect(run?.costMicros).toBe(0);
  });

  it("does not bound a run that is not in a conversation", async () => {
    const { platform } = await createPingPong();
    const started = await platform.runtime.startRun({
      agentSlug: "alpha",
      goal: "A normal scheduled run.",
      trigger: "schedule",
    });
    const summary = await platform.runtime.runToCompletion(started.runId);
    expect(summary.status).toBe("succeeded");
  });
});
