/**
 * THE ACCEPTANCE TEST FOR THIS UNIT.
 *
 * > If changing a line in the BrandScript does not change what the next
 * > generated caption says, the unit has failed.
 *
 * So this file changes a line in the BrandScript — first in code, then in
 * Postgres — and runs the real `AgentRuntime` on either side of the edit. It
 * writes what actually happened to `components/strategy/evidence/`, so the
 * claim is checkable without running anything.
 *
 * What is real here: the strategy tables, `SqlStrategyStore`, the prompt
 * composition, `defineAgent`, the tool registry, the approval gate, the cost
 * meter, the control plane, the transcript, `runToCompletion`.
 * What is not: the model, which is `BriefingModel` — see the note at the top of
 * `support/briefing-model.ts` for why a scripted model could not prove this.
 *
 * Regenerate the evidence with:
 *   npx vitest run tests/strategy/agent-wiring.test.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STRATEGY } from "@/content/strategy";
import type { Strategy } from "@/content/strategy/types";
import {
  FixedClock,
  InMemoryAgentStore,
  MemoryLogger,
  ToolRegistry,
  createAgentRuntime,
  createReferenceTools,
  createScriptedResolver,
  type AgentPlatform,
} from "@/lib/agents";
import {
  SqlStrategyStore,
  StaticStrategyStore,
  composeStrategyBriefing,
  defineMarketingAgent,
  loadStrategyAgents,
} from "@/lib/strategy";

import { BriefingModel, MissingStrategyError } from "./support/briefing-model";
import {
  createStrategyDatabase,
  type StrategyTestDatabase,
} from "./support/pglite";
import { generatedBy, stabiliseIds } from "@/tests/support/evidence";

const EVIDENCE_DIR = resolve(process.cwd(), "components/strategy/evidence");

function write(name: string, body: string): void {
  const path = resolve(EVIDENCE_DIR, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${stabiliseIds(body).trimEnd()}\n`, "utf8");
}

/** Ports that record instead of acting. Nothing leaves the test. */
function recordingPorts() {
  const drafts: { slug: string; body: string }[] = [];
  return {
    drafts,
    ports: {
      readCatalogue: async (handle: string) => ({
        handle,
        title: "No 02 DIRTY",
        priceCents: 2_000,
        status: "active",
      }),
      saveDraft: async (slug: string, body: string) => {
        drafts.push({ slug, body });
        return { slug, savedAt: "2026-08-29T09:00:00.000Z" };
      },
      applyStorefrontChange: async (input: {
        handle: string;
        field: string;
        value: string;
      }) => ({
        handle: input.handle,
        field: input.field,
        appliedAt: "2026-08-29T09:00:00.000Z",
      }),
      sendExternalMessage: async (input: {
        channel: string;
        recipient: string;
        subject: string;
      }) => ({
        channel: input.channel,
        recipient: input.recipient,
        sentAt: "2026-08-29T09:00:00.000Z",
        messageId: "msg_1",
      }),
    },
  };
}

interface Rig {
  readonly platform: AgentPlatform;
  readonly model: BriefingModel;
}

function rig(): Rig {
  const clock = new FixedClock(new Date("2026-08-29T09:00:00.000Z"));
  const store = new InMemoryAgentStore(clock);
  store.seedBrandRules([
    {
      slug: "no-claims-about-the-body",
      kind: "compliance",
      severity: "never",
      title: "No claims about the body",
      rule: "Never suggest the product does anything to a person. Say what it tastes like and what it does in a glass or a pan.",
      appliesTo: ["social", "email", "storefront"],
      keywords: ["probiotic", "gut", "recovery"],
      priority: 1,
    },
  ]);
  const tools = createReferenceTools(recordingPorts().ports);
  const registry = new ToolRegistry([
    tools.readCatalogue,
    tools.saveDraft,
    tools.publishStorefrontChange,
    tools.sendExternalMessage,
  ]);
  const model = new BriefingModel();
  return {
    platform: createAgentRuntime({
      store,
      registry,
      models: createScriptedResolver(model),
      clock,
      logger: new MemoryLogger(),
    }),
    model,
  };
}

/** Run the marketing agent once against a given strategy, and return its text. */
async function captionFor(strategy: Strategy): Promise<{
  readonly caption: string;
  readonly systemPrompt: string;
}> {
  const { platform, model } = rig();
  const definition = defineMarketingAgent(strategy);
  await platform.runtime.register(definition);
  const started = await platform.runtime.startRun({
    agentSlug: definition.slug,
    goal: "Write one Instagram caption for No 02 DIRTY.",
    trigger: "manual",
  });
  const summary = await platform.runtime.runToCompletion(started.runId);
  expect(summary.status).toBe("succeeded");
  return {
    caption: summary.outcome ?? "",
    systemPrompt: model.systemPrompts[0] ?? "",
  };
}

/** The same strategy with one BrandScript line rewritten. */
function withEditedOneLiner(strategy: Strategy, oneLiner: string): Strategy {
  return {
    ...strategy,
    brandScript: {
      ...strategy.brandScript,
      derived: { ...strategy.brandScript.derived, oneLiner },
    },
  };
}

const EDITED_ONE_LINER =
  "A jar of olives is not an ingredient list. HALF SOUR is brine measured for the glass, so the round you pour tonight is the round you poured last month.";

describe("the BrandScript drives what an agent writes", () => {
  let database: StrategyTestDatabase;

  beforeAll(async () => {
    database = await createStrategyDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  it("puts the BrandScript into the agent's system prompt", () => {
    const definition = defineMarketingAgent(STRATEGY);
    expect(definition.systemPrompt).toContain(
      STRATEGY.brandScript.derived.oneLiner,
    );
    expect(definition.systemPrompt).toContain(
      STRATEGY.brandScript.derived.controllingIdea,
    );
    expect(definition.systemPrompt).toContain(
      STRATEGY.brandScript.audiences.b2c.problem.internal,
    );
    // The customer-is-the-hero rule is stated, not merely implied by the data.
    expect(definition.systemPrompt).toContain(
      "the customer is the hero and HALF SOUR is the",
    );
  });

  it("changes the generated caption when the one-liner changes", async () => {
    const before = await captionFor(STRATEGY);
    const after = await captionFor(
      withEditedOneLiner(STRATEGY, EDITED_ONE_LINER),
    );

    expect(before.caption).not.toBe(after.caption);
    expect(before.caption).toContain(STRATEGY.brandScript.derived.oneLiner);
    expect(after.caption).toContain(EDITED_ONE_LINER);
    expect(after.caption).not.toContain(STRATEGY.brandScript.derived.oneLiner);

    write(
      "01-brandscript-drives-output.txt",
      evidence({
        title: "CHANGING ONE BRANDSCRIPT LINE CHANGES THE GENERATED CAPTION",
        note:
          "The marketing agent is run twice through the real AgentRuntime. Between the\n" +
          "two runs exactly one field changes: brandScript.derived.oneLiner. Nothing\n" +
          "else — not the role prompt, not the tools, not the brand rules, not the goal.",
        blocks: [
          [
            "BEFORE — brandScript.derived.oneLiner",
            STRATEGY.brandScript.derived.oneLiner,
          ],
          ["BEFORE — the caption the run produced", before.caption],
          ["AFTER — brandScript.derived.oneLiner", EDITED_ONE_LINER],
          ["AFTER — the caption the run produced", after.caption],
        ],
      }),
    );
  });

  it("changes the caption when the row in Postgres changes", async () => {
    // The same proof, one layer lower: no code edit at all, just an UPDATE.
    const store = new SqlStrategyStore(database.sql);

    const first = await loadStrategyAgents(store);
    const before = await captionFor(first.strategy);

    const rows = await database.rows(
      `select body from public.strategy_documents where slug = 'brandscript'`,
    );
    const body = rows[0]?.["body"];
    const edited = JSON.parse(JSON.stringify(body)) as {
      derived: { oneLiner: string };
    };
    edited.derived.oneLiner = EDITED_ONE_LINER;
    await database.rows(
      `update public.strategy_documents set body = $1::jsonb where slug = 'brandscript'`,
      [JSON.stringify(edited)],
    );

    const second = await loadStrategyAgents(store);
    const after = await captionFor(second.strategy);

    expect(first.marketing.systemPrompt).not.toBe(
      second.marketing.systemPrompt,
    );
    expect(before.caption).not.toBe(after.caption);
    expect(after.caption).toContain(EDITED_ONE_LINER);

    write(
      "02-database-edit-changes-output.txt",
      evidence({
        title: "THE SAME PROOF WITH NO CODE CHANGE — ONE UPDATE STATEMENT",
        note:
          "No TypeScript is edited here. One SQL UPDATE rewrites the one-liner inside\n" +
          "strategy_documents.body, the agent definitions are rebuilt from the store,\n" +
          "and the run is repeated. This is the path production takes: the founder\n" +
          "edits the strategy and the next run says something different, with no deploy.",
        blocks: [
          [
            "THE EDIT",
            "update public.strategy_documents set body = ... where slug = 'brandscript'",
          ],
          ["BEFORE — the caption the run produced", before.caption],
          ["AFTER — the caption the run produced", after.caption],
          [
            "SYSTEM PROMPT DIFF (first differing line)",
            firstDifference(
              first.marketing.systemPrompt,
              second.marketing.systemPrompt,
            ),
          ],
        ],
      }),
    );

    // Put it back, so test order cannot matter.
    await database.rows(
      `update public.strategy_documents set body = $1::jsonb where slug = 'brandscript'`,
      [JSON.stringify(body)],
    );
  });

  it("refuses to write at all when the strategy is absent", async () => {
    // The dependency is not decorative: with no briefing there is no caption.
    const model = new BriefingModel();
    await expect(
      model.doGenerate({
        prompt: [
          {
            role: "system",
            content: "You are a marketing agent. Write a caption.",
          },
          { role: "user", content: [{ type: "text", text: "Go." }] },
        ],
      }),
    ).rejects.toThrow(MissingStrategyError);
  });

  it("gives the trade agent the market model and the marketing agent none", async () => {
    const store = new StaticStrategyStore();
    const agents = await loadStrategyAgents(store);

    expect(agents.trade.systemPrompt).toContain("MARKET SIZING");
    expect(agents.trade.systemPrompt).toContain(
      "Trade accounts live at month 24",
    );
    expect(agents.marketing.systemPrompt).not.toContain("MARKET SIZING");

    // And the trade agent leads with the venue buyer, not the home host.
    const tradeFirst = agents.trade.systemPrompt.indexOf("TRADE BUYER");
    const directFirst = agents.trade.systemPrompt.indexOf("DIRECT CUSTOMER");
    expect(tradeFirst).toBeLessThan(directFirst);

    write(
      "03-agent-briefings.txt",
      evidence({
        title: "WHAT EACH ROLE IS ACTUALLY HANDED",
        note:
          "Both briefings are composed from the same strategy_documents rows and scoped\n" +
          "by applies_to, exactly as brand_rules already are. Ari gets the story; Vic\n" +
          "gets the story and the numbers.",
        blocks: [
          [
            "ARI — marketing — full system prompt",
            agents.marketing.systemPrompt,
          ],
          ["VIC — trade — full system prompt", agents.trade.systemPrompt],
        ],
      }),
    );
  });

  it("keeps the briefing readable in a run transcript", () => {
    // It is persisted as message 0 and read back by the founder in the replay,
    // so it has to be text a person can follow rather than a JSON blob.
    const briefing = composeStrategyBriefing(STRATEGY, { scopes: ["social"] });
    expect(briefing).not.toContain("{");
    expect(briefing.split("\n").length).toBeGreaterThan(40);
  });
});

/* ------------------------------------------------------------- evidence */

function firstDifference(left: string, right: string): string {
  const a = left.split("\n");
  const b = right.split("\n");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) {
      return `line ${String(index + 1)}\n  before: ${a[index] ?? "(none)"}\n  after:  ${b[index] ?? "(none)"}`;
    }
  }
  return "(identical)";
}

function evidence(input: {
  title: string;
  note: string;
  blocks: readonly (readonly [string, string])[];
}): string {
  const bar = "=".repeat(78);
  const lines = [
    // These files reproduce agent prompts verbatim. The words in them are
    // scanned in full where they are authored, in content/strategy/, so
    // scanning the copy again here produces duplicate findings — and noise is
    // the failure mode legal/COPY-RULES.md §8 names, because it trains people
    // to stop reading the scanner's output.
    "copy-audit-ignore-file — generated transcript; the source copy is scanned in content/strategy/",
    "",
    bar,
    input.title,
    bar,
    input.note,
    "",
    generatedBy("npx vitest run tests/strategy/agent-wiring.test.ts"),
    "model: BriefingModel — deterministic, composes only from the system prompt.",
    "Everything below the model is the real runtime and the real strategy tables.",
    "",
  ];
  for (const [heading, body] of input.blocks) {
    lines.push("-".repeat(78), heading, "-".repeat(78), body, "");
  }
  return lines.join("\n");
}
