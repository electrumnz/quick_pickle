/**
 * Tool grants and the autonomy dial.
 *
 * The dial has to gate real behaviour rather than be a stored preference, so
 * every position is exercised against the same four tools and the same model
 * script. What changes between these tests is one field on the definition.
 */

import { describe, expect, it } from "vitest";

import {
  ToolRegistry,
  approvalRequirement,
  checkToolAccess,
  defineAgent,
  defineTool,
  resolveRisk,
} from "@/lib/agents";
import { z } from "zod";

import { createHarness, toolTurn } from "./harness";

const DRAFT_CALL = toolTurn(
  "save_internal_draft",
  { slug: "note", body: "A plain internal note." },
  "Writing this down internally.",
);

describe("tool grants", () => {
  it("refuses a tool the agent was never granted", async () => {
    const harness = await createHarness({
      tools: ["read_catalogue"],
      script: [DRAFT_CALL, { kind: "text", text: "I could not do that." }],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Write a draft the agent may not write",
      trigger: "manual",
    });
    const turn = await harness.runtime.modelStep(started.runId);
    if (turn.type !== "tool_calls" || turn.toolCallIds[0] === undefined) {
      throw new Error("expected a proposed tool call");
    }
    const gate = await harness.runtime.gateToolCall(
      started.runId,
      turn.toolCallIds[0],
    );

    expect(gate.type).toBe("refused");
    if (gate.type !== "refused") {
      throw new Error("expected refusal");
    }
    expect(gate.reason).toContain("was not granted");
    expect(harness.effects.drafts).toHaveLength(0);
    const calls = await harness.store.listToolCalls(started.runId);
    expect(calls[0]?.status).toBe("skipped");
  });

  it("refuses a tool that is not registered at all", async () => {
    const harness = await createHarness({
      script: [
        {
          kind: "tool-calls",
          text: "Trying something.",
          calls: [{ toolName: "read_catalogue", input: { handle: 42 } }],
        },
        { kind: "text", text: "That did not work." },
      ],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Call a tool with the wrong argument type",
      trigger: "manual",
    });
    const turn = await harness.runtime.modelStep(started.runId);
    if (turn.type !== "tool_calls" || turn.toolCallIds[0] === undefined) {
      throw new Error("expected a proposed tool call");
    }
    const gate = await harness.runtime.gateToolCall(
      started.runId,
      turn.toolCallIds[0],
    );
    expect(gate.type).toBe("refused");
    expect(harness.effects.catalogueReads).toHaveLength(0);
  });

  it("rejects a tool with a side effect and no approval subject at declaration time", () => {
    expect(() =>
      defineTool({
        name: "rogue_tool",
        title: "Rogue",
        description: "Sends things with no way to describe itself.",
        effect: "external",
        inputSchema: z.object({ to: z.string() }),
        execute: async () => ({ ok: true }),
      }),
    ).toThrow(/declares no approval subject/);
  });

  it("rejects a duplicate registration", () => {
    const tool = defineTool({
      name: "peek",
      title: "Peek",
      description: "Reads a thing.",
      effect: "read",
      inputSchema: z.object({}),
      execute: async () => ({ ok: true }),
    });
    const registry = new ToolRegistry([tool]);
    expect(() => registry.register(tool)).toThrow(/already registered/);
  });
});

describe("the autonomy dial gates behaviour", () => {
  it("observe: read-only, every write refused outright", async () => {
    const harness = await createHarness({
      autonomy: "observe",
      script: [DRAFT_CALL, { kind: "text", text: "I may only look." }],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Try to write while on observe",
      trigger: "manual",
    });
    const turn = await harness.runtime.modelStep(started.runId);
    if (turn.type !== "tool_calls" || turn.toolCallIds[0] === undefined) {
      throw new Error("expected a proposed tool call");
    }
    const gate = await harness.runtime.gateToolCall(
      started.runId,
      turn.toolCallIds[0],
    );

    expect(gate.type).toBe("refused");
    if (gate.type !== "refused") {
      throw new Error("expected refusal");
    }
    expect(gate.reason).toContain('autonomy "observe"');
    expect(harness.effects.drafts).toHaveLength(0);
    // No approval is raised either: an observe agent has nothing to propose.
    expect(
      await harness.store.listApprovals({ runId: started.runId }),
    ).toHaveLength(0);
  });

  it("propose: an internal write becomes an approval instead of an action", async () => {
    const harness = await createHarness({
      autonomy: "propose",
      requiresApprovalFor: ["content_asset"],
      script: [DRAFT_CALL, { kind: "text", text: "Proposed." }],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Draft a note while on propose",
      trigger: "manual",
    });
    const turn = await harness.runtime.modelStep(started.runId);
    if (turn.type !== "tool_calls" || turn.toolCallIds[0] === undefined) {
      throw new Error("expected a proposed tool call");
    }
    const gate = await harness.runtime.gateToolCall(
      started.runId,
      turn.toolCallIds[0],
    );

    expect(gate.type).toBe("awaiting_approval");
    if (gate.type !== "awaiting_approval") {
      throw new Error("expected an approval");
    }
    expect(gate.reason).toContain('autonomy "propose"');
    expect(harness.effects.drafts).toHaveLength(0);
  });

  it("act_with_limits: an internal write runs unattended", async () => {
    const harness = await createHarness({
      autonomy: "act_with_limits",
      script: [DRAFT_CALL, { kind: "text", text: "Written." }],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Draft a note while on act_with_limits",
      trigger: "manual",
    });
    const summary = await harness.runtime.runToCompletion(started.runId);

    expect(summary.status).toBe("succeeded");
    expect(harness.effects.drafts).toEqual([
      { slug: "note", body: "A plain internal note." },
    ]);
    expect(
      await harness.store.listApprovals({ runId: started.runId }),
    ).toHaveLength(0);
  });

  it("act_with_limits still routes a declared subject through the queue", async () => {
    const harness = await createHarness({
      autonomy: "act_with_limits",
      requiresApprovalFor: ["content_asset"],
      script: [DRAFT_CALL, { kind: "text", text: "Proposed." }],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Draft a note the founder wants to see",
      trigger: "manual",
    });
    const turn = await harness.runtime.modelStep(started.runId);
    if (turn.type !== "tool_calls" || turn.toolCallIds[0] === undefined) {
      throw new Error("expected a proposed tool call");
    }
    const gate = await harness.runtime.gateToolCall(
      started.runId,
      turn.toolCallIds[0],
    );
    expect(gate.type).toBe("awaiting_approval");
    if (gate.type !== "awaiting_approval") {
      throw new Error("expected an approval");
    }
    expect(gate.reason).toContain("by configuration");
  });

  it("escalates an internal write whose value exceeds the single-action cap", () => {
    const definition = defineAgent({
      slug: "buyer",
      name: "Buyer",
      jobTitle: "Purchasing",
      purpose: "Keeps stock on the shelf.",
      model: "claude-opus-5",
      systemPrompt: "Buy what is needed.",
      tools: ["save_internal_draft"],
      autonomy: "autonomous",
      requiresApprovalFor: [],
      budget: {
        perRunCents: 100,
        dailyCents: 1_000,
        monthlyCents: 10_000,
        singleActionCents: 5_000,
      },
      maxSteps: 4,
      brandRuleScopes: [],
    });
    const tool = defineTool({
      name: "adjust_stock",
      title: "Adjust stock",
      description: "Changes an internal stock number.",
      effect: "business_write",
      inputSchema: z.object({ amountCents: z.number() }),
      approval: {
        subjectType: "inventory_adjustment",
        subjectTable: "inventory_levels",
        risk: "medium",
        present: (input) => ({
          title: "adjust",
          summary: "adjust",
          amountCents: input.amountCents,
        }),
      },
      execute: async () => ({ ok: true }),
    });

    const under = approvalRequirement({
      definition,
      tool,
      presentation: { title: "t", summary: "s", amountCents: 4_000 },
    });
    expect(under.required).toBe(false);

    const over = approvalRequirement({
      definition,
      tool,
      presentation: { title: "t", summary: "s", amountCents: 6_000 },
    });
    expect(over.required).toBe(true);
    if (!over.required) {
      throw new Error("expected escalation");
    }
    expect(over.trigger).toBe("over_single_action_cap");
  });

  it("no autonomy level removes approval from a storefront write or an external send", () => {
    const tools = {
      storefront: defineTool({
        name: "change_shop",
        title: "Change shop",
        description: "Changes the storefront.",
        effect: "storefront_write",
        inputSchema: z.object({}),
        approval: {
          subjectType: "product_publish",
          subjectTable: "products",
          risk: "high",
          present: () => ({ title: "t", summary: "s" }),
        },
        execute: async () => ({ ok: true }),
      }),
      external: defineTool({
        name: "shout",
        title: "Shout",
        description: "Sends something outside.",
        effect: "external",
        inputSchema: z.object({}),
        approval: {
          subjectType: "social_post",
          subjectTable: "outbound_messages",
          risk: "high",
          present: () => ({ title: "t", summary: "s" }),
        },
        execute: async () => ({ ok: true }),
      }),
    };

    for (const autonomy of [
      "propose",
      "act_with_limits",
      "autonomous",
    ] as const) {
      const definition = defineAgent({
        slug: "any-role",
        name: "Any",
        jobTitle: "Any",
        purpose: "Any",
        model: "claude-opus-5",
        systemPrompt: "Any",
        tools: ["change_shop", "shout"],
        autonomy,
        requiresApprovalFor: autonomy === "propose" ? ["social_post"] : [],
        budget: { perRunCents: 100, dailyCents: 1_000, monthlyCents: 10_000 },
        maxSteps: 4,
        brandRuleScopes: [],
      });
      expect(checkToolAccess(definition, tools.storefront).allowed).toBe(true);
      expect(
        approvalRequirement({
          definition,
          tool: tools.storefront,
          presentation: null,
        }).required,
      ).toBe(true);
      expect(
        approvalRequirement({
          definition,
          tool: tools.external,
          presentation: null,
        }).required,
      ).toBe(true);
    }
  });
});

describe("definition validation mirrors the database constraints", () => {
  const base = {
    slug: "role",
    name: "Role",
    jobTitle: "Role",
    purpose: "Role",
    model: "claude-opus-5",
    systemPrompt: "Do the job.",
    tools: [],
    budget: { perRunCents: 10, dailyCents: 100, monthlyCents: 1_000 },
    maxSteps: 4,
    brandRuleScopes: [],
  };

  it("refuses an observe agent that declares approval subjects", () => {
    expect(() =>
      defineAgent({
        ...base,
        autonomy: "observe",
        requiresApprovalFor: ["social_post"],
      }),
    ).toThrow(/observe agent may not declare/);
  });

  it("refuses a propose agent with no approval subjects", () => {
    expect(() =>
      defineAgent({ ...base, autonomy: "propose", requiresApprovalFor: [] }),
    ).toThrow(/must declare at least one approval subject/);
  });

  it("refuses a monthly cap below the daily cap", () => {
    expect(() =>
      defineAgent({
        ...base,
        autonomy: "autonomous",
        requiresApprovalFor: [],
        budget: { perRunCents: 10, dailyCents: 1_000, monthlyCents: 100 },
      }),
    ).toThrow(/monthlyCents must be >= dailyCents/);
  });

  it("floors the risk of a money-carrying approval, as approvals_money_risk does", () => {
    expect(resolveRisk("low", 100)).toBe("low");
    expect(resolveRisk("low", 5_000)).toBe("medium");
    expect(resolveRisk("high", 50_000)).toBe("high");
  });
});
