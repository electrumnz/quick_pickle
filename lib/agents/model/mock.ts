/**
 * A scripted language model.
 *
 * The runtime has to be provable without an `ANTHROPIC_API_KEY`: the safety
 * properties (approval gate, cost caps, kill switch, replay) are properties of
 * the runtime, not of the model, so every one of them is exercised against a
 * model whose output is fixed in advance. Nothing about the code path differs —
 * the same `generateText` call, the same tool plumbing, the same persistence.
 */

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";

/**
 * The unified finish reasons a provider may actually return. Taken from the
 * installed `@ai-sdk/provider` union rather than typed as a string, so a script
 * cannot express an outcome a real model never produces.
 */
export type ScriptedFinishReason = LanguageModelV4FinishReason["unified"];

/** Token counts a scripted turn should report. */
export interface ScriptedUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

/** One scripted model turn. */
export type ScriptedTurn =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly usage?: ScriptedUsage;
      /** Defaults to `stop`. `length`, `content-filter` and `other` are all reachable here. */
      readonly finishReason?: Exclude<ScriptedFinishReason, "tool-calls">;
      /** Hold the call open until the abort signal fires. Used to prove the kill switch bites mid-call. */
      readonly holdUntilAborted?: boolean;
    }
  | {
      readonly kind: "tool-calls";
      /** Reasoning the model states before calling tools. Persisted as the run's "why". */
      readonly text?: string;
      readonly calls: readonly {
        readonly toolName: string;
        readonly input: unknown;
      }[];
      readonly usage?: ScriptedUsage;
      readonly holdUntilAborted?: boolean;
    }
  | {
      readonly kind: "error";
      readonly message: string;
    };

const DEFAULT_USAGE: ScriptedUsage = { inputTokens: 120, outputTokens: 40 };

/**
 * The finish reason a turn reports.
 *
 * A tool-calling turn is always `tool-calls`, matching the provider contract; a
 * text turn defaults to `stop` but may declare `length`, `content-filter` or
 * `other`, so the runtime's handling of those is exercised rather than assumed.
 */
function finishReasonFor(
  turn: Extract<ScriptedTurn, { kind: "text" | "tool-calls" }>,
): LanguageModelV4FinishReason {
  if (turn.kind === "tool-calls") {
    return { unified: "tool-calls", raw: "tool_use" };
  }
  const unified: ScriptedFinishReason = turn.finishReason ?? "stop";
  const raw: Record<ScriptedFinishReason, string> = {
    stop: "end_turn",
    length: "max_tokens",
    "content-filter": "refusal",
    "tool-calls": "tool_use",
    error: "error",
    other: "other",
  };
  return { unified, raw: raw[unified] };
}

function toUsage(usage: ScriptedUsage | undefined): LanguageModelV4Usage {
  const value = usage ?? DEFAULT_USAGE;
  const cacheRead = value.cacheReadTokens ?? 0;
  const cacheWrite = value.cacheWriteTokens ?? 0;
  return {
    inputTokens: {
      total: value.inputTokens,
      noCache: value.inputTokens - cacheRead,
      cacheRead,
      cacheWrite,
    },
    outputTokens: {
      total: value.outputTokens,
      text: value.outputTokens,
      reasoning: 0,
    },
  };
}

/** Rejects as soon as the signal aborts; never resolves otherwise. */
function untilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal === undefined) {
      return;
    }
    if (signal.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

/** A `LanguageModelV4` that replays a fixed script, one turn per call. */
export class ScriptedModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  /** Every call the runtime made, in order. Useful for asserting prompt contents. */
  readonly calls: LanguageModelV4CallOptions[] = [];

  private index = 0;

  constructor(
    private readonly script: readonly ScriptedTurn[],
    options: { readonly provider?: string; readonly modelId?: string } = {},
  ) {
    this.provider = options.provider ?? "mock";
    this.modelId = options.modelId ?? "claude-opus-5";
  }

  /** How many turns have been consumed. */
  get consumed(): number {
    return this.index;
  }

  async doGenerate(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    this.calls.push(options);
    const turn = this.script[this.index];
    this.index += 1;
    if (turn === undefined) {
      throw new Error(
        `ScriptedModel ran out of script at turn ${this.index}; the runtime made more model calls than the test expected.`,
      );
    }
    if (turn.kind === "error") {
      throw new Error(turn.message);
    }
    if (turn.holdUntilAborted === true) {
      await untilAborted(options.abortSignal);
    }

    const content: LanguageModelV4Content[] = [];
    if (turn.kind === "text") {
      content.push({ type: "text", text: turn.text });
    } else {
      if (turn.text !== undefined && turn.text.length > 0) {
        content.push({ type: "text", text: turn.text });
      }
      turn.calls.forEach((call, position) => {
        content.push({
          type: "tool-call",
          toolCallId: `mock-call-${this.index}-${position}`,
          toolName: call.toolName,
          input: JSON.stringify(call.input),
        });
      });
    }

    return {
      content,
      finishReason: finishReasonFor(turn),
      usage: toUsage(turn.usage),
      warnings: [],
      response: { id: `mock-response-${this.index}`, modelId: this.modelId },
    };
  }

  async doStream(): Promise<LanguageModelV4StreamResult> {
    throw new Error(
      "ScriptedModel does not implement streaming; the runtime uses generateText.",
    );
  }
}
