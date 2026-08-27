/**
 * The tool registry.
 *
 * A tool declares what it does to the world (`effect`) and, when that effect
 * leaves the building, which approval subject covers it. The registry holds the
 * declaration; the executor function itself is stored in a module-private
 * `WeakMap` and is not reachable from the returned object.
 *
 * That means there is exactly one way to run a tool — {@link invokeTool} — and
 * it is the place the grant is checked. Calling code cannot reach past it,
 * because there is no property to reach for.
 */

import { z } from "zod";

import { AgentRuntimeError, ToolAuthorisationError } from "../errors";
import { toJsonValue, type JsonObject, type JsonValue } from "../json";
import type { AgentLogger } from "../logger";
import {
  alwaysRequiresApproval,
  type ApprovalRisk,
  type ApprovalSubject,
  type ToolEffect,
} from "../types";
import { consumeEffectGrant, type EffectGrant } from "./effects";

/** Matches `agent_tool_calls_name_format`: `^[a-z][a-z0-9_.]*$`. */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_.]*$/;
/** Matches `approvals_subject_table_format`: `^[a-z][a-z0-9_]*$`. */
const SUBJECT_TABLE_PATTERN = /^[a-z][a-z0-9_]*$/;

/** How a tool call is summarised for the human looking at the approvals queue. */
export interface ApprovalPresentation {
  readonly title: string;
  readonly summary: string;
  /** Money at stake, if any. Drives the risk floor and the single-action cap. */
  readonly amountCents?: number;
  /** Structured preview the admin renders (a caption, a diff, an order table). */
  readonly preview?: JsonObject;
}

/** Approval metadata a non-read tool must declare. */
export interface ToolApprovalSpec<TInput> {
  readonly subjectType: ApprovalSubject;
  /** The table the subject lives in, for `approvals.subject_table`. */
  readonly subjectTable: string;
  readonly risk: ApprovalRisk;
  /** Build the human-facing description of this specific call. */
  readonly present: (input: TInput) => ApprovalPresentation;
}

/** Everything a tool executor is handed. Deliberately narrow. */
export interface ToolExecutionContext {
  readonly runId: string;
  readonly agentSlug: string;
  readonly toolCallId: string;
  readonly now: Date;
  readonly logger: AgentLogger;
  readonly abortSignal: AbortSignal;
}

/** The declaration half of a tool: everything except the code. */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly effect: ToolEffect;
  readonly inputSchema: z.ZodType<TInput>;
  readonly approval?: ToolApprovalSpec<TInput>;
  /** Present only so the type parameter is used; never populated at runtime. */
  readonly __output?: TOutput;
}

/** The full spec a caller passes to {@link defineTool}. */
export interface ToolSpec<TInput, TOutput> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly effect: ToolEffect;
  readonly inputSchema: z.ZodType<TInput>;
  readonly approval?: ToolApprovalSpec<TInput>;
  readonly execute: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>;
}

type ErasedExecutor = (input: unknown, context: ToolExecutionContext) => Promise<unknown>;

/**
 * Private executor table. The only reference to a tool's code lives here, keyed
 * by the definition object. Nothing outside this module can read it.
 */
const EXECUTORS = new WeakMap<ToolDefinition<never, never>, ErasedExecutor>();

function executorKey<TInput, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
): ToolDefinition<never, never> {
  return definition as unknown as ToolDefinition<never, never>;
}

/**
 * Declare a tool.
 *
 * Non-`read` tools must declare their approval subject. A tool that mutates the
 * storefront or reaches outside the company with no way to describe itself to a
 * human is refused at declaration time, not at call time.
 */
export function defineTool<TInput, TOutput>(spec: ToolSpec<TInput, TOutput>): ToolDefinition<TInput, TOutput> {
  if (!TOOL_NAME_PATTERN.test(spec.name)) {
    throw new AgentRuntimeError(
      "invalid_agent_definition",
      `Tool name "${spec.name}" must match ${String(TOOL_NAME_PATTERN)}`,
      { tool: spec.name },
    );
  }
  if (spec.effect !== "read" && spec.approval === undefined) {
    throw new AgentRuntimeError(
      "invalid_agent_definition",
      `Tool "${spec.name}" has effect "${spec.effect}" but declares no approval subject.`,
      { tool: spec.name, effect: spec.effect },
    );
  }
  if (spec.approval !== undefined && !SUBJECT_TABLE_PATTERN.test(spec.approval.subjectTable)) {
    throw new AgentRuntimeError(
      "invalid_agent_definition",
      `Tool "${spec.name}" declares subject_table "${spec.approval.subjectTable}", which the schema will reject.`,
      { tool: spec.name },
    );
  }

  const definition: ToolDefinition<TInput, TOutput> = Object.freeze({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    effect: spec.effect,
    inputSchema: spec.inputSchema,
    ...(spec.approval === undefined ? {} : { approval: spec.approval }),
  });

  EXECUTORS.set(executorKey(definition), async (input, context) =>
    spec.execute(input as TInput, context),
  );

  return definition;
}

/** Parse and validate raw model-supplied arguments against the tool's schema. */
export function parseToolInput<TInput, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
  raw: unknown,
): TInput {
  const parsed = definition.inputSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ToolAuthorisationError(
      "invalid_tool_input",
      `Tool "${definition.name}" rejected its arguments: ${issues}`,
      { tool: definition.name },
    );
  }
  return parsed.data;
}

/**
 * Run a tool.
 *
 * The single entry point. For any effect class other than `read`, a
 * runtime-minted {@link EffectGrant} is mandatory and is spent here. There is no
 * path that reaches the executor without passing this check.
 */
export async function invokeTool<TInput, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
  input: TInput,
  context: ToolExecutionContext,
  grant?: EffectGrant,
): Promise<TOutput> {
  if (definition.effect !== "read") {
    if (grant === undefined) {
      throw new (await import("../errors")).ApprovalGateError(
        "grant_missing",
        `Tool "${definition.name}" has effect "${definition.effect}" and cannot execute without an approval-backed grant.`,
        { tool: definition.name, effect: definition.effect, runId: context.runId },
      );
    }
    consumeEffectGrant(grant, {
      toolName: definition.name,
      runId: context.runId,
      input,
      now: context.now,
    });
  }

  const executor = EXECUTORS.get(executorKey(definition));
  if (executor === undefined) {
    throw new AgentRuntimeError(
      "unknown_tool",
      `Tool "${definition.name}" has no registered executor.`,
      { tool: definition.name },
    );
  }

  const output = await executor(input, context);
  return output as TOutput;
}

/** Normalise a tool result for `agent_tool_calls.result`. */
export function toolResultToJson(value: unknown): JsonValue {
  return toJsonValue(value);
}

/** An immutable, name-keyed set of tool declarations. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<never, never>>();

  constructor(definitions: readonly ToolDefinition<never, never>[] = []) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register<TInput, TOutput>(definition: ToolDefinition<TInput, TOutput>): this {
    if (this.tools.has(definition.name)) {
      throw new AgentRuntimeError(
        "duplicate_tool",
        `Tool "${definition.name}" is already registered.`,
        { tool: definition.name },
      );
    }
    this.tools.set(definition.name, executorKey(definition));
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Look a tool up, or throw `unknown_tool`. */
  get(name: string): ToolDefinition<never, never> {
    const definition = this.tools.get(name);
    if (definition === undefined) {
      throw new ToolAuthorisationError("unknown_tool", `No tool named "${name}" is registered.`, {
        tool: name,
      });
    }
    return definition;
  }

  /** Every registered tool, name-ordered. */
  list(): ToolDefinition<never, never>[] {
    return [...this.tools.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Only the tools this agent was granted, in the order the grant lists them. */
  forAgent(granted: readonly string[]): ToolDefinition<never, never>[] {
    return granted.map((name) => this.get(name));
  }
}
