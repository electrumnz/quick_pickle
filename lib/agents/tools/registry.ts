/**
 * The tool registry.
 *
 * A tool declares what it does to the world (`effect`) and, when that effect
 * leaves the building, which approval subject covers it. The registry holds the
 * declaration; the executor function itself lives in a module-private `WeakMap`
 * and is not reachable from the returned object.
 *
 * That means there is exactly one way to run a tool — {@link invokeTool} — and
 * it is where the grant is checked. Calling code cannot reach past it, because
 * there is no property to reach for.
 *
 * Declarations are type-erased on the way out: `defineTool` is generic in the
 * tool's input type and closes over it, so parsing, presentation and execution
 * are all type-checked at the point of declaration, while the registry and the
 * runtime handle a single uniform {@link ToolDefinition} with no casts.
 */

import type { FlexibleSchema } from "@ai-sdk/provider-utils";
import type { z } from "zod";

import type { UntrustedSource } from "../boundary/inbound";
import {
  AgentRuntimeError,
  ApprovalGateError,
  ToolAuthorisationError,
} from "../errors";
import { toJsonValue, type JsonObject, type JsonValue } from "../json";
import type { AgentLogger } from "../logger";
import {
  alwaysRequiresApproval,
  type ApprovalRisk,
  type ApprovalSubject,
  type ToolEffect,
} from "../types";
import { consumeEffectGrant, type EffectGrant } from "./effects";

/**
 * The intersection of two rules: the `agent_tool_calls_name_format` check
 * constraint (`^[a-z][a-z0-9_.]*$`) and Anthropic's tool-name rule, which allows
 * no dots. Taking the narrower of the two means a tool name is always valid in
 * both the database and a live model call.
 */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
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

/** Approval metadata a non-read tool must declare, in its typed form. */
export interface ToolApprovalSpec<TInput> {
  readonly subjectType: ApprovalSubject;
  /** The table the subject lives in, for `approvals.subject_table`. */
  readonly subjectTable: string;
  readonly risk: ApprovalRisk;
  /** Build the human-facing description of this specific call. */
  readonly present: (input: TInput) => ApprovalPresentation;
}

/** The same metadata after type erasure, as the runtime sees it. */
export interface ToolApprovalMeta {
  readonly subjectType: ApprovalSubject;
  readonly subjectTable: string;
  readonly risk: ApprovalRisk;
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

/**
 * A registered tool, with its input type erased.
 *
 * `parse` and `present` close over the declared schema, so the runtime never
 * needs to know a tool's input type and never needs a cast to call it.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly effect: ToolEffect;
  /** Handed to the model as the tool's parameter schema. */
  readonly inputSchema: FlexibleSchema<unknown>;
  readonly approval: ToolApprovalMeta | null;
  /**
   * Set when this tool's result carries text the company did not write — a
   * review body, the name a customer typed, a note on a trade account.
   *
   * The runtime frames such a result before it reaches a prompt
   * (`lib/agents/boundary/inbound.ts`). Declaring it here rather than at the
   * call site means the framing travels with the tool: a role granted this tool
   * cannot be given the raw text by accident, and a new read that surfaces
   * customer prose is one field away from being safe.
   */
  readonly untrustedSource: UntrustedSource | null;
  /** Validate raw model-supplied arguments. Throws `invalid_tool_input`. */
  readonly parse: (raw: unknown) => unknown;
  /** Describe a specific call for the approvals queue. Null for read-only tools. */
  readonly present: ((raw: unknown) => ApprovalPresentation) | null;
}

/** The full spec a caller passes to {@link defineTool}. */
export interface ToolSpec<TInput, TOutput> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly effect: ToolEffect;
  readonly inputSchema: z.ZodType<TInput>;
  readonly approval?: ToolApprovalSpec<TInput>;
  /** Declare when the result contains text written outside the company. */
  readonly untrustedSource?: UntrustedSource;
  readonly execute: (
    input: TInput,
    context: ToolExecutionContext,
  ) => Promise<TOutput>;
}

type ErasedExecutor = (
  input: unknown,
  context: ToolExecutionContext,
) => Promise<unknown>;

/**
 * Private executor table. The only reference to a tool's code lives here, keyed
 * by the definition object. Nothing outside this module can read it, and the
 * definition carries no property that exposes it.
 */
const EXECUTORS = new WeakMap<ToolDefinition, ErasedExecutor>();

/**
 * Declare a tool.
 *
 * Non-`read` tools must declare their approval subject. A tool that mutates the
 * storefront or reaches outside the company with no way to describe itself to a
 * human is refused at declaration time, not at call time.
 */
export function defineTool<TInput, TOutput>(
  spec: ToolSpec<TInput, TOutput>,
): ToolDefinition {
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
  if (
    spec.approval !== undefined &&
    !SUBJECT_TABLE_PATTERN.test(spec.approval.subjectTable)
  ) {
    throw new AgentRuntimeError(
      "invalid_agent_definition",
      `Tool "${spec.name}" declares subject_table "${spec.approval.subjectTable}", which the schema will reject.`,
      { tool: spec.name },
    );
  }

  const parse = (raw: unknown): TInput => {
    const parsed = spec.inputSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new ToolAuthorisationError(
        "invalid_tool_input",
        `Tool "${spec.name}" rejected its arguments: ${issues}`,
        { tool: spec.name },
      );
    }
    return parsed.data;
  };

  const approvalSpec = spec.approval;
  const definition: ToolDefinition = Object.freeze({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    effect: spec.effect,
    inputSchema: spec.inputSchema,
    untrustedSource: spec.untrustedSource ?? null,
    approval:
      approvalSpec === undefined
        ? null
        : Object.freeze({
            subjectType: approvalSpec.subjectType,
            subjectTable: approvalSpec.subjectTable,
            risk: approvalSpec.risk,
          }),
    parse,
    present:
      approvalSpec === undefined
        ? null
        : (raw: unknown) => approvalSpec.present(parse(raw)),
  });

  // Re-parsing inside the executor is deliberate: the value that reaches the
  // tool has been validated by the tool's own schema on this exact code path,
  // whatever the caller did or did not do beforehand.
  EXECUTORS.set(definition, async (input, context) =>
    spec.execute(parse(input), context),
  );

  return definition;
}

/**
 * Run a tool.
 *
 * The single entry point, and the only place a tool's code is reachable.
 *
 * For `storefront_write` and `external` — the two classes that change what
 * customers see or leave the company — a runtime-minted {@link EffectGrant} is
 * mandatory. A grant cannot exist without an approved `approvals` row covering
 * these exact arguments, so those effects cannot happen without one.
 *
 * An internal `business_write` is gated by the autonomy dial rather than by a
 * capability, but when the runtime did route it through the queue, the grant it
 * minted is still spent here.
 */
export async function invokeTool(
  definition: ToolDefinition,
  input: unknown,
  context: ToolExecutionContext,
  grant?: EffectGrant,
): Promise<unknown> {
  if (alwaysRequiresApproval(definition.effect) && grant === undefined) {
    throw new ApprovalGateError(
      "grant_missing",
      `Tool "${definition.name}" has effect "${definition.effect}" and cannot execute without an approval-backed grant.`,
      {
        tool: definition.name,
        effect: definition.effect,
        runId: context.runId,
      },
    );
  }
  if (grant !== undefined) {
    consumeEffectGrant(grant, {
      toolName: definition.name,
      runId: context.runId,
      input,
      now: context.now,
    });
  }

  const executor = EXECUTORS.get(definition);
  if (executor === undefined) {
    throw new AgentRuntimeError(
      "unknown_tool",
      `Tool "${definition.name}" has no registered executor.`,
      { tool: definition.name },
    );
  }

  return executor(input, context);
}

/** Normalise a tool result for `agent_tool_calls.result`. */
export function toolResultToJson(value: unknown): JsonValue {
  return toJsonValue(value);
}

/** An immutable, name-keyed set of tool declarations. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(definitions: readonly ToolDefinition[] = []) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register(definition: ToolDefinition): this {
    if (this.tools.has(definition.name)) {
      throw new AgentRuntimeError(
        "duplicate_tool",
        `Tool "${definition.name}" is already registered.`,
        { tool: definition.name },
      );
    }
    this.tools.set(definition.name, definition);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Look a tool up, or throw `unknown_tool`. */
  get(name: string): ToolDefinition {
    const definition = this.tools.get(name);
    if (definition === undefined) {
      throw new ToolAuthorisationError(
        "unknown_tool",
        `No tool named "${name}" is registered.`,
        {
          tool: name,
        },
      );
    }
    return definition;
  }

  /** Every registered tool, name-ordered. */
  list(): ToolDefinition[] {
    return [...this.tools.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  /** Only the tools this agent was granted, in the order the grant lists them. */
  forAgent(granted: readonly string[]): ToolDefinition[] {
    return granted.map((name) => this.get(name));
  }
}
