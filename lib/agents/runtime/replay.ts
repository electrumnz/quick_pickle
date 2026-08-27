/**
 * Replay — reconstruct a run entirely from what was written to the database.
 *
 * The design constraint the whole runtime is built around is that the founder
 * must always be able to answer "what did this agent do, and why?". `replay`
 * is the answer: it reads `agent_runs`, `agent_messages`, `agent_tool_calls`,
 * `agent_costs` and `approvals`, and returns the complete run — the inputs it
 * saw, the exact system prompt it was given, every message, every tool call with
 * its arguments and result, every approval, the bill, and the reason it stopped.
 *
 * Nothing is kept in memory to make this work. A run that crashed halfway
 * replays exactly as far as it got, which is the point.
 */

import type { ModelMessage } from "ai";

import { formatMicrosNzd } from "../cost/pricing";
import { AgentRuntimeError } from "../errors";
import type { JsonObject, JsonValue } from "../json";
import type { AgentStore } from "../store/types";
import type {
  ApprovalRecord,
  CostRecord,
  MessageRecord,
  RunRecord,
  ToolCallRecord,
} from "../types";
import { reconstructPrompt } from "./prompt";

/** One entry on the reconstructed timeline. */
export type TimelineEntry =
  | {
      readonly kind: "message";
      readonly seq: number;
      readonly at: string;
      readonly role: MessageRecord["role"];
      readonly text: string | null;
      readonly tokens: number | null;
      readonly model: string | null;
      readonly stopReason: string | null;
      readonly toolName: string | null;
    }
  | {
      readonly kind: "tool_call";
      readonly seq: number;
      readonly at: string | null;
      readonly toolName: string;
      readonly arguments: JsonObject;
      readonly result: JsonValue | null;
      readonly status: ToolCallRecord["status"];
      readonly error: string | null;
      readonly isMutation: boolean;
      readonly approvalId: string | null;
    };

/** Why a run stopped, when it stopped for a reason the runtime chose. */
export interface HaltDetail {
  readonly code: string;
  readonly reason: string;
  readonly at: string;
  readonly extra: JsonObject;
}

/** A complete run, reconstructed from storage. */
export interface RunReplay {
  readonly run: RunRecord;
  /** The exact system prompt the model was given, message 0. */
  readonly systemPrompt: string;
  /** The inputs the run was handed, from `agent_runs.context.input`. */
  readonly inputs: JsonValue;
  /** The brand rule slugs that were folded into the prompt. */
  readonly brandRules: readonly string[];
  readonly messages: readonly MessageRecord[];
  readonly toolCalls: readonly ToolCallRecord[];
  readonly approvals: readonly ApprovalRecord[];
  readonly costs: readonly CostRecord[];
  /** Messages and tool calls interleaved in the order they happened. */
  readonly timeline: readonly TimelineEntry[];
  /** Every sentence the model gave as its reason for acting. */
  readonly reasoning: readonly string[];
  /** The prompt as it would be sent again: proof the transcript is sufficient. */
  readonly prompt: {
    readonly system: string;
    readonly messages: readonly ModelMessage[];
  };
  readonly halt: HaltDetail | null;
  readonly totals: {
    readonly steps: number;
    readonly toolCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costMicros: number;
    readonly costNzd: string;
  };
}

function readHalt(context: JsonObject): HaltDetail | null {
  const halt = context["halt"];
  if (typeof halt !== "object" || halt === null || Array.isArray(halt)) {
    return null;
  }
  const record = halt as Record<string, JsonValue>;
  const code = record["code"];
  const reason = record["reason"];
  const at = record["at"];
  if (
    typeof code !== "string" ||
    typeof reason !== "string" ||
    typeof at !== "string"
  ) {
    return null;
  }
  const extra: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== "code" && key !== "reason" && key !== "at") {
      extra[key] = value;
    }
  }
  return { code, reason, at, extra };
}

function readStringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Rebuild a run from its stored transcript.
 *
 * @throws AgentRuntimeError when the run id is unknown.
 */
export async function replay(
  store: AgentStore,
  runId: string,
): Promise<RunReplay> {
  const run = await store.getRun(runId);
  if (run === null) {
    throw new AgentRuntimeError("run_not_found", `No run with id "${runId}".`, {
      runId,
    });
  }

  const [messages, toolCalls, approvals, costs] = await Promise.all([
    store.listMessages(runId),
    store.listToolCalls(runId),
    store.listApprovals({ runId }),
    store.listCosts({ runId }),
  ]);

  const prompt = reconstructPrompt(messages);
  const systemMessage = messages.find((message) => message.role === "system");

  const timeline: TimelineEntry[] = [
    ...messages.map((message): TimelineEntry => ({
      kind: "message",
      seq: message.seq,
      at: message.createdAt,
      role: message.role,
      text: message.content,
      tokens: message.tokens,
      model: message.model,
      stopReason: message.stopReason,
      toolName: message.toolName,
    })),
    ...toolCalls.map((call): TimelineEntry => ({
      kind: "tool_call",
      seq: call.seq,
      at: call.startedAt,
      toolName: call.toolName,
      arguments: call.arguments,
      result: call.result,
      status: call.status,
      error: call.error,
      isMutation: call.isMutation,
      approvalId: call.approvalId,
    })),
  ].sort((left, right) => {
    const leftAt = left.at ?? "";
    const rightAt = right.at ?? "";
    if (leftAt !== rightAt) {
      return leftAt < rightAt ? -1 : 1;
    }
    if (left.kind !== right.kind) {
      return left.kind === "message" ? -1 : 1;
    }
    return left.seq - right.seq;
  });

  const reasoning = messages
    .filter(
      (message) => message.role === "assistant" && message.content !== null,
    )
    .map((message) => message.content ?? "");

  return {
    run,
    systemPrompt: systemMessage?.content ?? "",
    inputs: run.context["input"] ?? null,
    brandRules: readStringArray(run.context["brandRules"]),
    messages,
    toolCalls,
    approvals,
    costs,
    timeline,
    reasoning,
    prompt: { system: prompt.system, messages: prompt.messages },
    halt: readHalt(run.context),
    totals: {
      steps: messages.filter((message) => message.role === "assistant").length,
      toolCalls: toolCalls.length,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costMicros: run.costMicros,
      costNzd: formatMicrosNzd(run.costMicros),
    },
  };
}

/** Render a replay as plain text — what the founder reads. */
export function renderReplay(view: RunReplay): string {
  const lines: string[] = [];
  const rule = "-".repeat(78);

  lines.push(rule);
  lines.push(`RUN ${view.run.id}`);
  lines.push(`agent      ${view.run.agentSlug}   trigger ${view.run.trigger}`);
  lines.push(`status     ${view.run.status}`);
  lines.push(`goal       ${view.run.goal}`);
  lines.push(`queued     ${view.run.queuedAt}`);
  lines.push(`started    ${view.run.startedAt ?? "-"}`);
  lines.push(`finished   ${view.run.finishedAt ?? "-"}`);
  lines.push(
    `spend      ${view.totals.costNzd} over ${view.totals.steps} model call(s), ` +
      `${view.totals.inputTokens} in / ${view.totals.outputTokens} out tokens`,
  );
  if (view.run.outcome !== null) {
    lines.push(`outcome    ${view.run.outcome}`);
  }
  if (view.run.error !== null) {
    lines.push(`error      ${view.run.error}`);
  }
  if (view.halt !== null) {
    lines.push(`halted     ${view.halt.code} at ${view.halt.at}`);
    lines.push(`           ${view.halt.reason}`);
    for (const [key, value] of Object.entries(view.halt.extra)) {
      lines.push(`           ${key}: ${JSON.stringify(value)}`);
    }
  }

  lines.push(rule);
  lines.push("INPUTS THE RUN SAW");
  lines.push(JSON.stringify(view.inputs, null, 2));
  lines.push(`brand rules loaded: ${view.brandRules.join(", ") || "(none)"}`);

  lines.push(rule);
  lines.push("SYSTEM PROMPT (message 0, exactly as sent)");
  lines.push(view.systemPrompt);

  lines.push(rule);
  lines.push("TIMELINE");
  for (const entry of view.timeline) {
    if (entry.kind === "message") {
      const head = `[${entry.at}] ${entry.role.toUpperCase()}`;
      const meta =
        entry.role === "assistant"
          ? ` (${entry.model ?? "?"}, ${entry.tokens ?? 0} tok, stop=${entry.stopReason ?? "?"})`
          : entry.toolName === null
            ? ""
            : ` (${entry.toolName})`;
      lines.push(`${head}${meta}`);
      if (entry.text !== null && entry.text.length > 0) {
        for (const line of entry.text.split("\n")) {
          lines.push(`    ${line}`);
        }
      }
    } else {
      lines.push(
        `[${entry.at ?? "-"}] TOOL CALL ${entry.toolName} -> ${entry.status}` +
          (entry.approvalId === null ? "" : ` (approval ${entry.approvalId})`),
      );
      lines.push(`    args   ${JSON.stringify(entry.arguments)}`);
      if (entry.result !== null) {
        lines.push(`    result ${JSON.stringify(entry.result)}`);
      }
      if (entry.error !== null) {
        lines.push(`    error  ${entry.error}`);
      }
    }
  }

  if (view.approvals.length > 0) {
    lines.push(rule);
    lines.push("APPROVALS");
    for (const approval of view.approvals) {
      lines.push(
        `${approval.id}  ${approval.subjectType}  risk=${approval.risk}  status=${approval.status}`,
      );
      lines.push(`    ${approval.title}`);
      lines.push(`    ${approval.summary}`);
      lines.push(`    payload ${JSON.stringify(approval.payload)}`);
      if (approval.decidedAt !== null) {
        lines.push(
          `    decided ${approval.decidedAt} by ${approval.decidedBy ?? "?"}` +
            (approval.decisionNote === null
              ? ""
              : ` — ${approval.decisionNote}`),
        );
      }
    }
  }

  lines.push(rule);
  lines.push("WHY (the model's own stated reasons, in order)");
  if (view.reasoning.length === 0) {
    lines.push("(the model produced no reasoning text)");
  }
  view.reasoning.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry}`);
  });

  lines.push(rule);
  lines.push(
    `PROMPT RECONSTRUCTED FROM STORAGE: ${view.prompt.messages.length} message(s) + system prompt`,
  );
  lines.push(rule);
  return lines.join("\n");
}
