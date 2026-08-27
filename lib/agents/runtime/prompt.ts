/**
 * Prompt construction and reconstruction.
 *
 * The runtime's working memory *is* the persisted transcript: before every
 * model call it rebuilds the prompt from `agent_messages` rather than from a
 * variable it has been carrying. That single decision is what makes durability
 * and replay the same code path — {@link reconstructPrompt} is used by the
 * runner and by `replay()`, so a replayed run is byte-identical to the live one
 * by construction rather than by careful maintenance.
 */

import type { ModelMessage } from "ai";

import type { JsonValue } from "../json";
import type { AgentDefinition, BrandRuleRecord, MessageRecord } from "../types";

/** A prompt, split the way `generateText` wants it. */
export interface ReconstructedPrompt {
  readonly system: string;
  readonly messages: ModelMessage[];
}

/** Rough token estimate used only for pre-call cost projection. */
export function estimateTokens(text: string): number {
  const CHARS_PER_TOKEN = 4;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Compose the system prompt from the role definition plus the brand rules held
 * in `brand_rules`.
 *
 * Voice and style are data, not code: editing a row changes what every agent
 * says with no deploy, and the exact text used is persisted as message 0 so a
 * run can always be read back against the rules that were live at the time.
 */
export function composeSystemPrompt(
  definition: AgentDefinition,
  brandRules: readonly BrandRuleRecord[],
): string {
  const header = [
    `You are ${definition.name}, ${definition.jobTitle} at HALF SOUR.`,
    `Purpose: ${definition.purpose}`,
    "",
    definition.systemPrompt.trim(),
  ];

  const autonomyNote = {
    observe: "You may only read. You cannot change anything or contact anyone.",
    propose:
      "Every change you want to make is a proposal. Say what you would do and why; a human decides.",
    act_with_limits:
      "You may act on internal records inside your budget. Anything that changes the storefront or leaves the company still needs a human decision.",
    autonomous:
      "You may act on internal records and report afterwards. Anything that changes the storefront or leaves the company still needs a human decision.",
  }[definition.autonomy];

  const rules =
    brandRules.length === 0
      ? []
      : [
          "",
          "BRAND RULES (from brand_rules; these override your own judgement):",
          ...brandRules.map(
            (rule) => `- [${rule.severity}] ${rule.title}: ${rule.rule}`,
          ),
        ];

  const explainability = [
    "",
    "Before any tool call, state in one sentence what you are about to do and why.",
    "That sentence is stored as the run's reasoning trail and is what the founder reads later.",
  ];

  return [
    ...header,
    "",
    `AUTONOMY: ${definition.autonomy}. ${autonomyNote}`,
    ...rules,
    ...explainability,
  ].join("\n");
}

/** The opening user message: the goal plus every input the run was handed. */
export function composeGoalMessage(goal: string, input: JsonValue): string {
  const rendered = JSON.stringify(input, null, 2);
  return rendered === "{}" || rendered === "null"
    ? goal
    : `${goal}\n\nInputs:\n${rendered}`;
}

/**
 * Rebuild the exact `{ system, messages }` pair the model was, or will be, sent.
 *
 * Any stored message whose `contentJson` is a `ModelMessage` is used verbatim;
 * the system message is lifted out into `system`, because `generateText`
 * disallows system messages inside `messages` by default.
 */
export function reconstructPrompt(
  records: readonly MessageRecord[],
): ReconstructedPrompt {
  let system = "";
  const messages: ModelMessage[] = [];
  for (const record of [...records].sort(
    (left, right) => left.seq - right.seq,
  )) {
    if (record.role === "system") {
      system = record.content ?? "";
      continue;
    }
    const stored = record.contentJson;
    if (
      stored !== null &&
      typeof stored === "object" &&
      !Array.isArray(stored)
    ) {
      messages.push(stored as unknown as ModelMessage);
      continue;
    }
    if (record.role === "user" && record.content !== null) {
      messages.push({ role: "user", content: record.content });
    }
  }
  return { system, messages };
}
