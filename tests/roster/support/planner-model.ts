/**
 * A model that can only say what the business told it.
 *
 * There is no `ANTHROPIC_API_KEY` in this environment, and the properties under
 * test — that a role reads real data, that the gate holds, that the reasoning is
 * legible — are properties of the wiring rather than of the model. So the same
 * choice `lib/agents/model/mock.ts` and `tests/strategy/support/briefing-model.ts`
 * make is made again here.
 *
 * `ScriptedModel` cannot be used: its output is fixed in advance, so an agent's
 * "findings" would be whatever the test typed, which is the exact failure this
 * work has to avoid. `PlannerModel` instead:
 *
 *  1. **refuses to work without the strategy.** If the system prompt carries no
 *     STRATEGY block it throws, so a broken prompt chain fails loudly;
 *  2. **follows the role's own routine**, which is data on the role in
 *     `lib/agents/roster/definitions.ts`, not a script in this file;
 *  3. **writes only from tool results.** Every number and every name in its
 *     output was returned by a tool that ran a query against the seeded
 *     business. It cannot add one.
 *
 * The one exception is copy: for the two tools whose job is to write a sentence
 * to a person — `queue_social_post` and `queue_campaign_email` — the caption is
 * composed out of named BrandScript fields lifted from the system prompt, in the
 * same mechanical way `BriefingModel` does it. That is deliberate and it is
 * stated in the evidence: it makes a strategy edit visibly change the copy,
 * which is the property that matters, and it means the caption cannot contain a
 * claim nobody wrote down.
 *
 * Everything below the model is the real runtime.
 */

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";

import type { JsonObject, JsonValue } from "@/lib/agents";
import type { RosterRole, RoutineStep } from "@/lib/agents/roster";

export class MissingStrategyError extends Error {
  constructor(agent: string) {
    super(
      `${agent} was given no STRATEGY block, so it has nothing to reason from.`,
    );
    this.name = "MissingStrategyError";
  }
}

/* -------------------------------------------------------- reading a prompt */

function systemPromptOf(options: LanguageModelV4CallOptions): string {
  const system = options.prompt.find((message) => message.role === "system");
  return system === undefined ? "" : system.content;
}

function lineAfter(source: string, label: string): string {
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

/** The named lines a role is given, as this model reads them back. */
export interface ReadStrategy {
  readonly oneLiner: string;
  readonly tradeOneLiner: string;
  readonly controllingIdea: string;
  readonly internalProblem: string;
  readonly villain: string;
  readonly directCall: string;
}

export function readStrategy(system: string): ReadStrategy {
  return {
    oneLiner: quotedAfter(system, "THE ONE-LINER"),
    tradeOneLiner: quotedAfter(system, "THE TRADE ONE-LINER"),
    controllingIdea: lineAfter(
      system,
      "CONTROLLING IDEA (governs every sentence):",
    ),
    internalProblem: lineAfter(
      system,
      "Internal (how it makes them feel — LEAD WITH THIS):",
    ),
    villain: lineAfter(system, "The villain, named:"),
    directCall: quotedAfter(system, "     Direct: "),
  };
}

/* ------------------------------------------------------- reading the state */

interface ToolResult {
  readonly toolName: string;
  readonly value: JsonValue;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every tool result already in the transcript, oldest first. */
function resultsIn(options: LanguageModelV4CallOptions): ToolResult[] {
  const results: ToolResult[] = [];
  for (const message of options.prompt) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const output = part.output;
      const value: JsonValue =
        output.type === "json" || output.type === "error-json"
          ? (output.value as JsonValue)
          : output.type === "text" || output.type === "error-text"
            ? output.value
            : null;
      results.push({ toolName: part.toolName, value });
    }
  }
  return results;
}

/**
 * Resolve a dotted path against the most recent result that has it.
 * A numeric segment indexes an array, so "lines.0.sku" works.
 */
function resolvePath(results: readonly ToolResult[], path: string): JsonValue {
  const parts = path.split(".");
  for (let index = results.length - 1; index >= 0; index -= 1) {
    let cursor: JsonValue | undefined = results[index]?.value;
    for (const part of parts) {
      if (Array.isArray(cursor)) {
        cursor = cursor[Number.parseInt(part, 10)];
        continue;
      }
      if (!isObject(cursor)) {
        cursor = undefined;
        break;
      }
      cursor = cursor[part];
    }
    if (cursor !== undefined && cursor !== null) return cursor;
  }
  return null;
}

/** The proposal built by one named read, if it built one. */
function proposalFrom(
  results: readonly ToolResult[],
  toolName: string,
): JsonObject | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    if (result === undefined || result.toolName !== toolName) continue;
    if (!isObject(result.value)) continue;
    const proposal = result.value["proposal"];
    if (isObject(proposal)) return proposal;
  }
  return null;
}

function stringsFrom(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/* ------------------------------------------------------------ composition */

/**
 * A caption built out of the BrandScript, and nothing else.
 *
 * Mechanical on purpose: every clause is a named field from the strategy, so the
 * difference between two captions is exactly the difference between two
 * strategies.
 */
export function composeCaption(strategy: ReadStrategy): string {
  return [
    strategy.internalProblem,
    "",
    strategy.oneLiner,
    "",
    `Not ${strategy.villain.replace(/\.$/, "").toLowerCase()}.`,
    "",
    `${strategy.directCall} →`,
  ].join("\n");
}

/* ----------------------------------------------------------------- model */

export interface PlannerOptions {
  /** Words the model must never write, whatever it was asked for. */
  readonly bannedWords?: readonly string[];
}

export class PlannerModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "planner";
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  /** Every system prompt this model was handed, in order. */
  readonly systemPrompts: string[] = [];

  constructor(
    private readonly role: RosterRole,
    private readonly options: PlannerOptions = {},
  ) {
    this.modelId = role.definition.model;
  }

  async doGenerate(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    const system = systemPromptOf(options);
    this.systemPrompts.push(system);
    if (!system.includes("STRATEGY — HALF SOUR's own position")) {
      throw new MissingStrategyError(this.role.definition.name);
    }
    const strategy = readStrategy(system);
    const results = resultsIn(options);
    const done = new Set(results.map((result) => result.toolName));

    const next = this.nextStep(results, done, strategy);
    const content: LanguageModelV4Content[] =
      next === null
        ? [{ type: "text", text: this.report(results, strategy) }]
        : [
            { type: "text", text: next.step.why },
            {
              type: "tool-call",
              toolCallId: `${this.role.definition.slug}-${String(results.length + 1)}`,
              toolName: next.step.tool,
              input: JSON.stringify(next.input),
            },
          ];

    const text = next === null ? this.report(results, strategy) : next.step.why;
    return {
      content,
      finishReason:
        next === null
          ? { unified: "stop", raw: "end_turn" }
          : { unified: "tool-calls", raw: "tool_use" },
      usage: {
        inputTokens: {
          total: Math.ceil(system.length / 4),
          noCache: Math.ceil(system.length / 4),
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: {
          total: Math.ceil(text.length / 4),
          text: Math.ceil(text.length / 4),
          reasoning: 0,
        },
      },
      warnings: [],
      response: {
        id: `planner-${String(results.length + 1)}`,
        modelId: this.modelId,
      },
    };
  }

  async doStream(): Promise<LanguageModelV4StreamResult> {
    throw new Error("PlannerModel does not stream; the runtime uses generateText.");
  }

  /* --------------------------------------------------------------- steps */

  private nextStep(
    results: readonly ToolResult[],
    done: ReadonlySet<string>,
    strategy: ReadStrategy,
  ): { readonly step: RoutineStep; readonly input: JsonObject } | null {
    for (const step of this.role.routine) {
      if (done.has(step.tool)) continue;
      const input = this.inputFor(step, results, strategy);
      if (input === null) continue; // nothing to work with; skip and say so later
      return { step, input };
    }
    return null;
  }

  private inputFor(
    step: RoutineStep,
    results: readonly ToolResult[],
    strategy: ReadStrategy,
  ): JsonObject | null {
    if (step.kind === "read") {
      const input: JsonObject = { ...step.input };
      for (const binding of step.from ?? []) {
        const value = resolvePath(results, binding.path);
        if (value === null) return null;
        input[binding.as] = value;
      }
      return input;
    }
    if (step.kind === "note") {
      return {
        slug: step.slug,
        title: this.noteTitle(results),
        body: this.noteBody(results),
      };
    }
    const proposal = proposalFrom(results, step.from);
    if (proposal === null) return null;
    // The two tools whose job is to write a sentence to a person get their copy
    // composed from the BrandScript rather than from the query that found the
    // opportunity. Everything else in the arguments is still the query's.
    if (step.tool === "queue_social_post") {
      // Which bottle to feature comes from the sales read; the words come from
      // the BrandScript. Neither is invented here.
      const leader = resolvePath(results, "lines.0.sku");
      return {
        ...proposal,
        caption: composeCaption(strategy),
        sku: typeof leader === "string" ? leader : null,
      };
    }
    if (step.tool === "queue_campaign_email") {
      // Subject and body both come from the BrandScript; which product the
      // campaign is about came from the sales read.
      return {
        ...proposal,
        subject: `${String(proposal["subject"] ?? "")}: ${strategy.directCall}`,
        body: composeCaption(strategy),
      };
    }
    return proposal;
  }

  /* -------------------------------------------------------------- writing */

  private headlines(results: readonly ToolResult[]): string[] {
    const lines: string[] = [];
    for (const result of results) {
      if (!isObject(result.value)) continue;
      const headline = result.value["headline"];
      if (typeof headline === "string" && headline !== "") lines.push(headline);
    }
    return lines;
  }

  private findings(results: readonly ToolResult[]): string[] {
    const lines: string[] = [];
    for (const result of results) {
      if (!isObject(result.value)) continue;
      lines.push(...stringsFrom(result.value["findings"]));
    }
    return lines;
  }

  /** A note's title has to fit the column, so it is the first sentence of it. */
  private noteTitle(results: readonly ToolResult[]): string {
    const headline =
      this.headlines(results)[0] ??
      `${this.role.definition.name}: nothing to report`;
    const sentence = headline.split(". ")[0] ?? headline;
    const trimmed = sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
    return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  }

  private noteBody(results: readonly ToolResult[]): string {
    return [
      ...this.headlines(results),
      "",
      ...this.findings(results).map((line) => `- ${line}`),
    ].join("\n");
  }

  /** The run's closing statement: what was found, what was done, what was not. */
  private report(
    results: readonly ToolResult[],
    strategy: ReadStrategy,
  ): string {
    const done = new Set(results.map((result) => result.toolName));
    const actions: string[] = [];
    const blocked: string[] = [];

    for (const result of results) {
      if (!isObject(result.value)) continue;
      if (result.value["recorded"] === true) {
        const reference = result.value["reference"];
        actions.push(
          `${result.toolName}: recorded${typeof reference === "string" ? ` (${reference})` : ""}, not delivered — this deployment has no live outbound channel.`,
        );
      }
      if (result.value["refused"] === true) {
        const reason = result.value["reason"] ?? result.value["note"];
        blocked.push(
          `${result.toolName}: ${typeof reason === "string" ? reason : "refused"}`,
        );
      }
    }

    for (const step of this.role.routine) {
      if (done.has(step.tool)) continue;
      blocked.push(
        step.kind === "propose"
          ? `${step.tool}: nothing to propose — the reads found no action worth putting to you.`
          : `${step.tool}: skipped, because what it needed was not in the data.`,
      );
    }

    const banned = this.options.bannedWords ?? [];
    const findings = this.findings(results).filter(
      (line) =>
        !banned.some((word) => line.toLowerCase().includes(word.toLowerCase())),
    );

    return [
      this.headlines(results).join(" "),
      "",
      "What I found",
      ...findings.map((line) => `- ${line}`),
      "",
      "What I did",
      ...(actions.length === 0
        ? ["- Nothing left this company. Every action is above."]
        : actions.map((line) => `- ${line}`)),
      ...(blocked.length === 0
        ? []
        : ["", "What I could not do", ...blocked.map((line) => `- ${line}`)]),
      "",
      `[written under: ${strategy.controllingIdea}]`,
    ]
      .join("\n")
      .trim();
  }
}
