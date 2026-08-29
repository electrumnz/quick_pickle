/**
 * A model that writes only from the strategy it was given.
 *
 * The acceptance test for this unit is "change a BrandScript line and the next
 * generated caption changes". Proving that needs a model, and there is no
 * `ANTHROPIC_API_KEY` in CI — so the same choice `lib/agents/model/mock.ts`
 * makes is made again here, for the same reason: the property under test is a
 * property of the wiring, not of the model, so the model is made deterministic
 * and everything below it stays real.
 *
 * `ScriptedModel` cannot be used for this: its output is fixed in advance, so
 * it would produce the same caption whatever the prompt said, which is exactly
 * the failure this test exists to catch. `BriefingModel` instead READS the
 * system prompt and composes its answer out of the named lines it finds there.
 * Three consequences, all deliberate:
 *
 *  - if the strategy briefing is missing, it refuses to write at all;
 *  - if the one-liner changes, the caption changes;
 *  - it cannot invent anything, so a difference in output is always a
 *    difference in input.
 *
 * Everything else in the run — the registry, the approval gate, the cost meter,
 * the control plane, the transcript — is the real runtime.
 */

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";

/** What the model managed to read out of the briefing. */
export interface ReadBriefing {
  readonly oneLiner: string;
  readonly controllingIdea: string;
  readonly internalProblem: string;
  readonly villain: string;
  readonly directCall: string;
  readonly transitionalCall: string;
}

export class MissingStrategyError extends Error {
  constructor() {
    super(
      "BriefingModel was given no STRATEGY block, so it has nothing to write from.",
    );
    this.name = "MissingStrategyError";
  }
}

function systemPromptOf(options: LanguageModelV4CallOptions): string {
  const system = options.prompt.find((message) => message.role === "system");
  return system === undefined ? "" : system.content;
}

function after(source: string, label: string): string {
  const at = source.indexOf(label);
  if (at === -1) return "";
  const rest = source.slice(at + label.length);
  const end = rest.indexOf("\n");
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

function quotedAfter(source: string, label: string): string {
  const at = source.indexOf(label);
  if (at === -1) return "";
  const rest = source.slice(at + label.length);
  const open = rest.indexOf('"');
  if (open === -1) return "";
  const close = rest.indexOf('"', open + 1);
  if (close === -1) return "";
  return rest.slice(open + 1, close);
}

/** Pull the named lines out of a composed briefing. */
export function readBriefing(system: string): ReadBriefing {
  if (!system.includes("STRATEGY — HALF SOUR's own position")) {
    throw new MissingStrategyError();
  }
  return {
    oneLiner: quotedAfter(system, "THE ONE-LINER"),
    controllingIdea: after(
      system,
      "CONTROLLING IDEA (governs every sentence):",
    ),
    internalProblem: after(
      system,
      "Internal (how it makes them feel — LEAD WITH THIS):",
    ),
    villain: after(system, "The villain, named:"),
    directCall: quotedAfter(system, "     Direct: "),
    transitionalCall: quotedAfter(system, "     Transitional: "),
  };
}

/**
 * Compose the caption.
 *
 * Deliberately mechanical: every clause is lifted from a named BrandScript
 * field, so the diff between two captions is exactly the diff between two
 * strategies and nothing else.
 */
export function composeCaption(brief: ReadBriefing): string {
  return [
    brief.internalProblem,
    "",
    brief.oneLiner,
    "",
    `Not ${brief.villain.replace(/\.$/, "").toLowerCase()}.`,
    "",
    `${brief.directCall} →`,
    "",
    `[written under: ${brief.controllingIdea}]`,
  ].join("\n");
}

export class BriefingModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "briefing";
  readonly modelId = "claude-opus-5";
  readonly supportedUrls: Record<string, RegExp[]> = {};

  /** Every system prompt this model was handed, in order. */
  readonly systemPrompts: string[] = [];

  async doGenerate(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    const system = systemPromptOf(options);
    this.systemPrompts.push(system);
    const caption = composeCaption(readBriefing(system));
    return {
      content: [{ type: "text", text: caption }],
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: {
        inputTokens: {
          total: Math.ceil(system.length / 4),
          noCache: Math.ceil(system.length / 4),
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: {
          total: Math.ceil(caption.length / 4),
          text: Math.ceil(caption.length / 4),
          reasoning: 0,
        },
      },
      warnings: [],
      response: { id: "briefing-1", modelId: this.modelId },
    };
  }

  async doStream(): Promise<LanguageModelV4StreamResult> {
    throw new Error(
      "BriefingModel does not stream; the runtime uses generateText.",
    );
  }
}
