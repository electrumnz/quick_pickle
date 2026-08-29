/**
 * Turning the strategy into agent context.
 *
 * This is the file the whole unit exists for. `composeStrategyBriefing` renders
 * the three frameworks into the block of text an agent is given before it
 * writes anything, and `lib/strategy/agents.ts` puts that block into the role's
 * system prompt. So the chain is:
 *
 *   strategy_documents row  →  StrategyStore.loadStrategy()
 *                           →  composeStrategyBriefing()
 *                           →  AgentDefinition.systemPrompt
 *                           →  the model call
 *                           →  the caption
 *
 * Nothing in that chain is decorative. Change the one-liner in the BrandScript
 * and the model is handed a different instruction on its next run;
 * `tests/strategy/agent-wiring.test.ts` runs the real `AgentRuntime` twice
 * across exactly that edit and diffs the output.
 *
 * Three choices in how it is written:
 *
 *  1. **Named lines are quoted, not summarised.** The one-liner and the
 *     controlling idea appear verbatim with an instruction not to paraphrase,
 *     because a model handed a "theme" will produce a variation and a founder
 *     with a variation has no message.
 *  2. **The customer is named as the hero in the briefing itself.** It is the
 *     single rule most often broken by generated copy, so it is stated as a
 *     rule rather than left implicit in the data.
 *  3. **It is scoped.** A support agent does not need the market model and a
 *     trade agent does not need the nurture sequence. Scopes come from
 *     `strategy_documents.applies_to`, exactly as they do for brand rules.
 */

import { formatCents, formatCentsShort } from "@/content/strategy/market";
import type {
  AudienceId,
  AudienceScript,
  MarketModel,
  Strategy,
} from "@/content/strategy/types";

export interface StrategyBriefingOptions {
  /**
   * The agent's scopes. A document whose `applies_to` is empty is always
   * included; otherwise the sets must overlap.
   */
  readonly scopes: readonly string[];
  /** Which script to lead with. Both are always included; this one goes first. */
  readonly audience?: AudienceId;
  /** Include the market model. Defaults to whether "market" is in scope. */
  readonly includeMarket?: boolean;
  /** Include the Flight Plan. Defaults to true — it is context for every role. */
  readonly includeFlightPlan?: boolean;
}

const RULE = "=".repeat(74);

function bullet(lines: readonly string[], indent = "  "): string[] {
  return lines.map((line) => `${indent}- ${line}`);
}

/** One audience's seven elements, in SB7 order. */
function renderScript(id: AudienceId, script: AudienceScript): string[] {
  const who = id === "b2c" ? "DIRECT CUSTOMER" : "TRADE BUYER";
  return [
    `${who} — ${script.character.label}`,
    `  1. THE CHARACTER: ${script.character.who}`,
    `     They want: ${script.character.wants}`,
    `  2. THE PROBLEM`,
    `     External (what is in their way): ${script.problem.external}`,
    `     Internal (how it makes them feel — LEAD WITH THIS): ${script.problem.internal}`,
    `     Philosophical (why it is wrong): ${script.problem.philosophical}`,
    `     The villain, named: ${script.problem.villain}`,
    `  3. WE ARE THE GUIDE, NOT THE HERO`,
    `     Empathy: ${script.guide.empathy}`,
    `     Authority we may claim:`,
    ...bullet(script.guide.authority, "       "),
    `  4. THE PLAN`,
    ...script.plan.process.map(
      (planStep) =>
        `     ${String(planStep.step)}. ${planStep.title} — ${planStep.detail}`,
    ),
    `     What we commit to in return:`,
    ...bullet(script.plan.agreement, "       "),
    `  5. THE CALL TO ACTION`,
    `     Direct: "${script.calls.direct.label}" → ${script.calls.direct.href}${
      script.calls.direct.live ? "" : "  (NOT DEPLOYED — do not link to it yet)"
    }`,
    `     Transitional: "${script.calls.transitional.label}" → ${script.calls.transitional.href}${
      script.calls.transitional.live
        ? ""
        : "  (NOT DEPLOYED — do not link to it yet)"
    }`,
    `  6. FAILURE THEY AVOID`,
    ...bullet(script.stakes.failure, "     "),
    `  7. SUCCESS THEY REACH`,
    ...bullet(script.stakes.success, "     "),
    `     Transformation: from "${script.stakes.transformation.from}" to "${script.stakes.transformation.to}"`,
  ];
}

/** The market model, compressed to the numbers a targeting decision needs. */
function renderMarket(market: MarketModel): string[] {
  const targets = market.targets.map(
    (target) => `${target.label}: ${target.value}`,
  );
  return [
    "MARKET SIZING — what is on the table, and what we are actually going for",
    `  Basis: ${market.basis}`,
    `  TAM (New Zealand): ${formatCentsShort(market.tam.totalCents)} a year`,
    `  TAM (with Australia): ${formatCentsShort(market.tamWithAustralia.totalCents)} a year — not reachable yet, and not part of the plan`,
    `  SAM (reachable today): ${formatCentsShort(market.sam.totalCents)} a year`,
    `  SOM (year 2, the promise): ${formatCents(market.som.totalCents)} a year`,
    `  Cumulative 24 months: ${formatCents(market.somCumulative24MonthCents)}`,
    "  What that means in things you can count:",
    ...bullet(targets, "    "),
    "  Headwinds you must not write against:",
    ...bullet(market.headwinds.slice(0, 3), "    "),
  ];
}

/**
 * Render the strategy as the block an agent is given.
 *
 * The return value is plain text rather than JSON because it goes into a system
 * prompt and is persisted as message 0 of the run, which the founder reads back
 * in the replay. A JSON blob in that position is unreadable to the only person
 * who matters.
 */
export function composeStrategyBriefing(
  strategy: Strategy,
  options: StrategyBriefingOptions,
): string {
  const includeMarket =
    options.includeMarket ??
    options.scopes.some((scope) =>
      ["wholesale", "pricing", "planning", "market"].includes(scope),
    );
  const includeFlightPlan = options.includeFlightPlan ?? true;
  const lead: AudienceId = options.audience ?? "b2c";
  const second: AudienceId = lead === "b2c" ? "b2b" : "b2c";

  const lines: string[] = [
    RULE,
    `STRATEGY — HALF SOUR's own position, loaded from strategy_documents (v${strategy.version}, ${strategy.updated}).`,
    RULE,
    "This is not background reading. Every line you write must be traceable to",
    "something below. Where the strategy already has a line written, use that",
    "line rather than a paraphrase of it.",
    "",
    "THE ONE RULE ABOVE THE OTHERS: the customer is the hero and HALF SOUR is the",
    "guide. Any sentence whose subject is us — what we make, how long it takes,",
    "how much we care — is a sentence to rewrite with them as the subject.",
    "",
    `CONTROLLING IDEA (governs every sentence): ${strategy.brandScript.derived.controllingIdea}`,
    "",
    "THE ONE-LINER — use it verbatim. Do not improve it, shorten it, or invent a",
    "second one:",
    `  "${strategy.brandScript.derived.oneLiner}"`,
    "",
    "THE TRADE ONE-LINER — the same rule, for anything aimed at a venue:",
    `  "${strategy.brandScript.derived.tradeOneLiner}"`,
    "",
    "THE ELEVATOR PITCH — the long form, when there is room for it:",
    `  "${strategy.brandScript.derived.elevatorPitch}"`,
    "",
    "BRANDSCRIPT (StoryBrand SB7) — two customers, two scripts:",
    "",
    ...renderScript(lead, strategy.brandScript.audiences[lead]),
    "",
    ...renderScript(second, strategy.brandScript.audiences[second]),
  ];

  if (includeFlightPlan) {
    const plan = strategy.flightPlan;
    lines.push(
      "",
      "FLIGHT PLAN — what this company is, in six parts:",
      `  Mission: ${plan.cockpit.mission.statement}`,
      "  Guiding principles, and the argument each one settles:",
      ...bullet(
        plan.cockpit.guidingPrinciples.map(
          (item) => `${item.principle} — settles: ${item.settles}`,
        ),
        "    ",
      ),
      "  The range, and what each bottle is for:",
      ...bullet(
        plan.wings.wings.map((wing) => `${wing.name} — ${wing.job}`),
        "    ",
      ),
      `  Direct sales: ${plan.leftEngine.processes[0]?.cadence ?? ""}`,
      `  Trade sales: ${plan.leftEngine.processes[1]?.cadence ?? ""}`,
      `  Hard constraint: ${plan.body.constraints[0] ?? ""}`,
    );
  }

  if (includeMarket) {
    lines.push("", ...renderMarket(strategy.market));
  }

  lines.push(
    "",
    "HOW TO USE THIS",
    "  - Name the customer's problem before naming the product.",
    "  - One idea per sentence, and one call to action per piece.",
    "  - Never make a claim about what brine does to a person. Positioning is",
    "    culinary: a mixer and a cooking acid. legal/COPY-RULES.md is binding on",
    "    every word, including yours, and is enforced by a scanner.",
    "  - Alcohol may be named as an ingredient and an occasion. Never as a",
    "    quantity, never as an effect, never aimed at anyone under 18.",
    "  - If a call to action is marked NOT DEPLOYED, do not link to it.",
    RULE,
  );

  return lines.join("\n");
}

/**
 * A short fingerprint of the strategy a run was composed against.
 *
 * Written into the run's context so a caption can be traced back to the exact
 * version of the position it was written from, the same way the run already
 * records which brand rules were live.
 */
export function strategyFingerprint(strategy: Strategy): {
  readonly version: string;
  readonly updated: string;
  readonly oneLiner: string;
  readonly controllingIdea: string;
} {
  return {
    version: strategy.version,
    updated: strategy.updated,
    oneLiner: strategy.brandScript.derived.oneLiner,
    controllingIdea: strategy.brandScript.derived.controllingIdea,
  };
}
