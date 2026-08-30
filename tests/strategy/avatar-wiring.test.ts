/**
 * THE ACCEPTANCE TEST FOR THE AVATARS.
 *
 * > If changing a field on an avatar does not change what the next generated
 * > caption says, the avatars are a document and not a wiring.
 *
 * So this file changes one avatar field — first in code, then with a single
 * UPDATE against `strategy_avatars` — and runs the real `AgentRuntime` on
 * either side of the edit. It is the same proof
 * `tests/strategy/agent-wiring.test.ts` makes for the BrandScript, one layer
 * along, and it writes what actually happened into
 * `components/strategy/evidence/`.
 *
 * What is real here: the avatars table, `SqlStrategyStore`, the prompt
 * composition, `defineAgent`, the tool registry, the approval gate, the cost
 * meter, the transcript, `runToCompletion`. What is not: the model, which is
 * `AvatarModel` — see the note at the top of `support/avatar-model.ts`.
 *
 *   npx vitest run tests/strategy/avatar-wiring.test.ts
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
  defineMarketingAgent,
  defineTradeAgent,
  loadStrategyAgents,
} from "@/lib/strategy";

import { AvatarModel, MissingAvatarError } from "./support/avatar-model";
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
  return {
    readCatalogue: async (handle: string) => ({
      handle,
      title: "No 02 DIRTY",
      priceCents: 2_000,
      status: "active",
    }),
    saveDraft: async (slug: string) => ({
      slug,
      savedAt: "2026-08-30T09:00:00.000Z",
    }),
    applyStorefrontChange: async (input: {
      handle: string;
      field: string;
    }) => ({
      handle: input.handle,
      field: input.field,
      appliedAt: "2026-08-30T09:00:00.000Z",
    }),
    sendExternalMessage: async (input: {
      channel: string;
      recipient: string;
    }) => ({
      channel: input.channel,
      recipient: input.recipient,
      sentAt: "2026-08-30T09:00:00.000Z",
      messageId: "msg_1",
    }),
  };
}

interface Rig {
  readonly platform: AgentPlatform;
  readonly model: AvatarModel;
}

function rig(): Rig {
  const clock = new FixedClock(new Date("2026-08-30T09:00:00.000Z"));
  const store = new InMemoryAgentStore(clock);
  const tools = createReferenceTools(recordingPorts());
  const registry = new ToolRegistry([
    tools.readCatalogue,
    tools.saveDraft,
    tools.publishStorefrontChange,
    tools.sendExternalMessage,
  ]);
  const model = new AvatarModel();
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

/** Run one agent once against a given strategy, and return what it wrote. */
async function captionFor(
  strategy: Strategy,
  role: "marketing" | "trade" = "marketing",
): Promise<{ readonly caption: string; readonly systemPrompt: string }> {
  const { platform, model } = rig();
  const definition =
    role === "marketing"
      ? defineMarketingAgent(strategy)
      : defineTradeAgent(strategy);
  await platform.runtime.register(definition);
  const started = await platform.runtime.startRun({
    agentSlug: definition.slug,
    goal: "Write one caption for No 02 DIRTY, to the person you are given.",
    trigger: "manual",
  });
  const summary = await platform.runtime.runToCompletion(started.runId);
  expect(summary.status).toBe("succeeded");
  return {
    caption: summary.outcome ?? "",
    systemPrompt: model.systemPrompts[0] ?? "",
  };
}

/** The same strategy with one avatar field rewritten. */
function withEditedJob(strategy: Strategy, job: string): Strategy {
  return {
    ...strategy,
    avatars: {
      ...strategy.avatars,
      avatars: {
        ...strategy.avatars.avatars,
        b2c: { ...strategy.avatars.avatars.b2c, jobToBeDone: job },
      },
    },
  };
}

const EDITED_JOB =
  "Put something on a weeknight plate that tastes like it took longer than it did, using the acid she already has open.";

describe("the avatar drives what an agent writes", () => {
  let database: StrategyTestDatabase;

  beforeAll(async () => {
    database = await createStrategyDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  it("puts the whole avatar into the agent's system prompt", () => {
    const definition = defineMarketingAgent(STRATEGY);
    const avatar = STRATEGY.avatars.avatars.b2c;
    expect(definition.systemPrompt).toContain(
      `WHO YOU ARE WRITING TO — ${avatar.label}`,
    );
    expect(definition.systemPrompt).toContain(avatar.jobToBeDone);
    expect(definition.systemPrompt).toContain(avatar.price.anchor);
    expect(definition.systemPrompt).toContain(avatar.repeat.cadence);
    expect(definition.systemPrompt).toContain(avatar.notThisPerson[0] ?? "");
  });

  it("changes the generated caption when one avatar field changes", async () => {
    const before = await captionFor(STRATEGY);
    const after = await captionFor(withEditedJob(STRATEGY, EDITED_JOB));

    expect(before.caption).not.toBe(after.caption);
    expect(before.caption).toContain(STRATEGY.avatars.avatars.b2c.jobToBeDone);
    expect(after.caption).toContain(EDITED_JOB);
    expect(after.caption).not.toContain(
      STRATEGY.avatars.avatars.b2c.jobToBeDone,
    );

    write(
      "04-avatar-drives-output.txt",
      evidence({
        title: "CHANGING ONE AVATAR FIELD CHANGES THE GENERATED CAPTION",
        note:
          "The marketing agent is run twice through the real AgentRuntime. Between the\n" +
          "two runs exactly one field changes: avatars.b2c.jobToBeDone. Nothing else —\n" +
          "not the BrandScript, not the role prompt, not the tools, not the goal.",
        blocks: [
          [
            "BEFORE — avatars.b2c.jobToBeDone",
            STRATEGY.avatars.avatars.b2c.jobToBeDone,
          ],
          ["BEFORE — the caption the run produced", before.caption],
          ["AFTER — avatars.b2c.jobToBeDone", EDITED_JOB],
          ["AFTER — the caption the run produced", after.caption],
        ],
      }),
    );
  });

  it("changes the caption when the row in Postgres changes", async () => {
    const store = new SqlStrategyStore(database.sql);

    const first = await loadStrategyAgents(store);
    const before = await captionFor(first.strategy);

    // No TypeScript is edited here. One UPDATE rewrites one key inside the
    // avatar document, which is the path production takes.
    await database.rows(
      `update public.strategy_avatars
          set body = jsonb_set(body, '{jobToBeDone}', to_jsonb($1::text))
        where slug = 'friday-host'`,
      [EDITED_JOB],
    );

    const second = await loadStrategyAgents(store);
    const after = await captionFor(second.strategy);

    expect(first.marketing.systemPrompt).not.toBe(
      second.marketing.systemPrompt,
    );
    expect(before.caption).not.toBe(after.caption);
    expect(after.caption).toContain(EDITED_JOB);

    write(
      "05-avatar-database-edit.txt",
      evidence({
        title: "THE SAME PROOF WITH NO CODE CHANGE — ONE UPDATE STATEMENT",
        note:
          "One SQL UPDATE rewrites jobToBeDone inside strategy_avatars.body, the agent\n" +
          "definitions are rebuilt from the store, and the run is repeated. This is the\n" +
          "path production takes: the founder edits the avatar in the admin and the next\n" +
          "run is written to a different person, with no deploy.",
        blocks: [
          [
            "THE EDIT",
            "update public.strategy_avatars\n   set body = jsonb_set(body, '{jobToBeDone}', to_jsonb($1::text))\n where slug = 'friday-host'",
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
      `update public.strategy_avatars
          set body = jsonb_set(body, '{jobToBeDone}', to_jsonb($1::text))
        where slug = 'friday-host'`,
      [STRATEGY.avatars.avatars.b2c.jobToBeDone],
    );
  });

  it("gives each role its own customer and one line about the other", async () => {
    const agents = await loadStrategyAgents(new StaticStrategyStore());
    const host = STRATEGY.avatars.avatars.b2c;
    const venue = STRATEGY.avatars.avatars.b2b;

    expect(agents.marketing.systemPrompt).toContain(
      `WHO YOU ARE WRITING TO — ${host.label}`,
    );
    expect(agents.marketing.systemPrompt).not.toContain(venue.jobToBeDone);
    expect(agents.marketing.systemPrompt).toContain(venue.headline);

    expect(agents.trade.systemPrompt).toContain(
      `WHO YOU ARE WRITING TO — ${venue.label}`,
    );
    expect(agents.trade.systemPrompt).not.toContain(host.jobToBeDone);
    expect(agents.trade.systemPrompt).toContain(host.headline);

    const tradeCaption = await captionFor(STRATEGY, "trade");
    expect(tradeCaption.caption).toContain(venue.jobToBeDone);
  });

  it("refuses to write at all when there is no avatar in the prompt", async () => {
    // The dependency is not decorative: with nobody to write to, no caption.
    const model = new AvatarModel();
    await expect(
      model.doGenerate({
        prompt: [
          { role: "system", content: "You write captions. Go." },
          { role: "user", content: [{ type: "text", text: "Go." }] },
        ],
      }),
    ).rejects.toThrow(MissingAvatarError);
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
    "copy-audit-ignore-file — generated transcript; the source copy is scanned in content/strategy/",
    "",
    bar,
    input.title,
    bar,
    input.note,
    "",
    generatedBy("npx vitest run tests/strategy/avatar-wiring.test.ts"),
    "model: AvatarModel — deterministic, composes only from the avatar block in the system prompt.",
    "Everything below the model is the real runtime and the real strategy tables.",
    "",
  ];
  for (const [heading, body] of input.blocks) {
    lines.push("-".repeat(78), heading, "-".repeat(78), body, "");
  }
  return lines.join("\n");
}
