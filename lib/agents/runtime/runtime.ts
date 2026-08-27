/**
 * The agent runtime.
 *
 * Every operation an agent performs is one of the methods below, and each one is
 * self-contained: it reads what it needs from the store, does one thing, writes
 * the result, and returns. That shape is deliberate — it is what lets the same
 * runtime be driven by a plain in-process loop (`runToCompletion`) or by Inngest
 * one durable step at a time, with identical behaviour and identical safety.
 *
 * The order of checks inside a turn never varies:
 *   1. control plane   — kill switch / agent pause
 *   2. cost caps       — projected, before the money is spent
 *   3. model call      — one call, persisted immediately
 *   4. cost recorded   — before the next step begins
 *   5. per tool call: authorisation -> approval gate -> execute
 */

import {
  generateText,
  stepCountIs,
  tool,
  type ModelMessage,
  type ToolSet,
} from "ai";

import type { ApprovalService } from "../approvals/service";
import type { Clock } from "../clock";
import { MODEL_CALL_TIMEOUT_MS } from "../constants";
import type { ControlPlane } from "../control/kill-switch";
import { ControlWatcher, assertNotHalted } from "../control/kill-switch";
import type { CostMeter } from "../cost/meter";
import { AgentRuntimeError, isAgentRuntimeError } from "../errors";
import {
  toJsonObject,
  toJsonValue,
  type JsonObject,
  type JsonValue,
} from "../json";
import type { AgentLogger } from "../logger";
import type { ModelResolver } from "../model/provider";
import type { AgentStore } from "../store/types";
import { approvalRequirement, checkToolAccess } from "../tools/authorization";
import {
  invokeTool,
  type ToolDefinition,
  type ToolRegistry,
} from "../tools/registry";
import {
  alwaysRequiresApproval,
  type AgentDefinition,
  type AgentRunTrigger,
  type ApprovalRecord,
  type RunRecord,
  type ToolCallRecord,
} from "../types";
import {
  composeGoalMessage,
  composeSystemPrompt,
  estimateTokens,
  reconstructPrompt,
} from "./prompt";

export interface AgentRuntimeDeps {
  readonly store: AgentStore;
  readonly registry: ToolRegistry;
  readonly control: ControlPlane;
  readonly approvals: ApprovalService;
  readonly meter: CostMeter;
  readonly models: ModelResolver;
  readonly clock: Clock;
  readonly logger: AgentLogger;
  /** Poll interval for the in-flight kill-switch watcher. Lowered in tests. */
  readonly controlPollIntervalMs?: number;
}

export interface StartRunInput {
  readonly agentSlug: string;
  readonly goal: string;
  readonly trigger: AgentRunTrigger;
  /** Everything the run was handed. Persisted so "what did it see?" is answerable. */
  readonly input?: JsonObject;
  readonly parentRunId?: string | null;
}

export interface StartedRun {
  readonly runId: string;
  readonly agentId: string;
  readonly definition: AgentDefinition;
}

/** What one turn of the loop produced. */
export type TurnOutcome =
  | { readonly type: "finished"; readonly outcome: string }
  | { readonly type: "halted"; readonly code: string; readonly reason: string }
  | { readonly type: "tool_calls"; readonly toolCallIds: readonly string[] };

/** The subset of {@link TurnOutcome} the control plane can produce. */
export type HaltOutcome = Extract<TurnOutcome, { type: "halted" }>;

/** What the gate decided about one proposed tool call. */
export type GateOutcome =
  | { readonly type: "execute"; readonly toolCallId: string }
  | {
      readonly type: "refused";
      readonly toolCallId: string;
      readonly reason: string;
    }
  | {
      readonly type: "awaiting_approval";
      readonly toolCallId: string;
      readonly approvalId: string;
      readonly reason: string;
    };

/** Terminal summary of a run. */
export interface RunSummary {
  readonly runId: string;
  readonly status: RunRecord["status"];
  readonly outcome: string | null;
  readonly error: string | null;
  readonly costMicros: number;
  readonly toolCallCount: number;
  readonly steps: number;
}

const HALT_CONTEXT_KEY = "halt";

export class AgentRuntime {
  private readonly definitions = new Map<string, AgentDefinition>();

  constructor(private readonly deps: AgentRuntimeDeps) {}

  /** Make a role known to the runtime and reconcile it into `public.agents`. */
  async register(definition: AgentDefinition): Promise<string> {
    this.definitions.set(definition.slug, definition);
    const record = await this.deps.store.upsertAgent({
      slug: definition.slug,
      name: definition.name,
      jobTitle: definition.jobTitle,
      purpose: definition.purpose,
      model: definition.model,
      systemPrompt: definition.systemPrompt,
      tools: definition.tools,
      autonomy: definition.autonomy,
      requiresApprovalFor: definition.requiresApprovalFor,
      dailySpendCapCents: definition.budget.dailyCents,
      monthlySpendCapCents: definition.budget.monthlyCents,
      singleActionCapCents: definition.budget.singleActionCents ?? null,
    });
    return record.id;
  }

  /** Look up a registered role. */
  definition(slug: string): AgentDefinition {
    const definition = this.definitions.get(slug);
    if (definition === undefined) {
      throw new AgentRuntimeError(
        "agent_not_found",
        `Agent "${slug}" is not registered.`,
        { slug },
      );
    }
    return definition;
  }

  /**
   * Open a run: create the row, persist the system prompt and the goal, and
   * mark it running. Nothing has been asked of a model yet.
   */
  async startRun(input: StartRunInput): Promise<StartedRun> {
    const definition = this.definition(input.agentSlug);
    const agent = await this.deps.store.getAgentBySlug(input.agentSlug);
    if (agent === null) {
      throw new AgentRuntimeError(
        "agent_not_found",
        `Agent "${input.agentSlug}" has no row in public.agents; call register() first.`,
        { slug: input.agentSlug },
      );
    }

    const brandRules = await this.deps.store.listBrandRules(
      definition.brandRuleScopes,
    );
    const systemPrompt = composeSystemPrompt(definition, brandRules);
    const runInput: JsonObject = input.input ?? {};

    const run = await this.deps.store.createRun({
      agentId: agent.id,
      trigger: input.trigger,
      goal: input.goal,
      parentRunId: input.parentRunId ?? null,
      context: {
        agentSlug: definition.slug,
        autonomy: definition.autonomy,
        model: definition.model,
        modelProvider: this.deps.models.kind,
        maxSteps: definition.maxSteps,
        grantedTools: [...definition.tools],
        budgetCents: {
          perRun: definition.budget.perRunCents,
          daily: definition.budget.dailyCents,
          monthly: definition.budget.monthlyCents,
        },
        brandRules: brandRules.map((rule) => rule.slug),
        input: runInput,
      },
    });

    await this.deps.store.appendMessage({
      runId: run.id,
      role: "system",
      content: systemPrompt,
      contentJson: { role: "system", content: systemPrompt },
    });
    const goalText = composeGoalMessage(input.goal, runInput);
    await this.deps.store.appendMessage({
      runId: run.id,
      role: "user",
      content: goalText,
      contentJson: { role: "user", content: goalText },
    });

    const startedAt = this.deps.clock.now().toISOString();
    await this.deps.store.updateRun(run.id, { status: "running", startedAt });

    this.deps.logger.log({
      level: "info",
      event: "agent.run.started",
      at: startedAt,
      runId: run.id,
      agentSlug: definition.slug,
      fields: {
        goal: input.goal,
        trigger: input.trigger,
        autonomy: definition.autonomy,
        model: definition.model,
        modelProvider: this.deps.models.kind,
      },
    });

    return { runId: run.id, agentId: agent.id, definition };
  }

  /** Consult the kill switch and the per-agent pause. */
  async checkControls(runId: string): Promise<HaltOutcome | null> {
    const run = await this.requireRun(runId);
    const verdict = await this.deps.control.evaluate(run.agentSlug);
    if (!verdict.halted) {
      return null;
    }
    await this.halt(runId, verdict.code, verdict.reason, "cancelled");
    return { type: "halted", code: verdict.code, reason: verdict.reason };
  }

  /**
   * One model call.
   *
   * Persists the assistant message and the cost before returning, so a crash
   * immediately after this method still leaves an inspectable run.
   */
  async modelStep(runId: string): Promise<TurnOutcome> {
    const run = await this.requireRun(runId);
    const definition = this.definition(run.agentSlug);

    const halted = await this.checkControls(runId);
    if (halted !== null) {
      return halted;
    }

    const stored = await this.deps.store.listMessages(runId);
    const { system, messages } = reconstructPrompt(stored);
    const assistantTurns = stored.filter(
      (message) => message.role === "assistant",
    ).length;
    if (assistantTurns >= definition.maxSteps) {
      const reason = `Step ceiling of ${definition.maxSteps} model calls reached.`;
      await this.halt(runId, "max_steps_exceeded", reason, "failed");
      return { type: "halted", code: "max_steps_exceeded", reason };
    }

    const promptTokens = estimateTokens(system + JSON.stringify(messages));
    const projected = this.deps.meter.project(
      definition.model,
      promptTokens,
      definition.maxOutputTokens ?? 0,
    );
    const verdict = await this.deps.meter.check({
      definition,
      agentId: run.agentId,
      runId,
      projectedMicros: projected,
    });
    if (!verdict.ok) {
      await this.halt(runId, "cost_cap_exceeded", verdict.reason, "failed", {
        cap: verdict.cap,
        limitMicros: verdict.limitMicros,
        spentMicros: verdict.spentMicros,
        projectedMicros: verdict.projectedMicros,
      });
      return {
        type: "halted",
        code: "cost_cap_exceeded",
        reason: verdict.reason,
      };
    }

    const watcher = new ControlWatcher(
      this.deps.control,
      run.agentSlug,
      this.deps.controlPollIntervalMs,
    );
    watcher.start();

    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await generateText({
        model: this.deps.models.resolve(definition.model),
        system,
        messages,
        tools: this.modelToolSet(definition),
        stopWhen: stepCountIs(1),
        abortSignal: watcher.signal,
        timeout: MODEL_CALL_TIMEOUT_MS,
        ...(definition.temperature === undefined
          ? {}
          : { temperature: definition.temperature }),
        ...(definition.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: definition.maxOutputTokens }),
      });
    } catch (error) {
      const halt = watcher.haltVerdict;
      if (halt.halted) {
        await this.halt(runId, halt.code, halt.reason, "cancelled");
        return { type: "halted", code: halt.code, reason: halt.reason };
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.halt(runId, "model_call_failed", message, "failed");
      return { type: "halted", code: "model_call_failed", reason: message };
    } finally {
      watcher.stop();
    }

    const usage = {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? 0,
      cacheWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens ?? 0,
    };

    let assistantMessageId: string | null = null;
    for (const message of result.response.messages) {
      if (message.role !== "assistant") {
        continue;
      }
      const record = await this.deps.store.appendMessage({
        runId,
        role: "assistant",
        content: result.text.length > 0 ? result.text : null,
        contentJson: toJsonValue(message),
        tokens: usage.outputTokens,
        model: definition.model,
        stopReason: result.finishReason,
      });
      assistantMessageId = record.id;
    }

    await this.deps.meter.record({
      agentId: run.agentId,
      runId,
      usage: {
        ...usage,
        model: definition.model,
        note: `step ${assistantTurns + 1}; provider ${this.deps.models.kind}`,
      },
    });

    this.deps.logger.log({
      level: "info",
      event: "agent.run.step",
      at: this.deps.clock.now().toISOString(),
      runId,
      agentSlug: definition.slug,
      fields: {
        step: assistantTurns + 1,
        finishReason: result.finishReason,
        reasoning: result.text,
        toolCalls: result.toolCalls.map((call) => call.toolName),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    });

    const postVerdict = await this.deps.meter.check({
      definition,
      agentId: run.agentId,
      runId,
      projectedMicros: 0,
    });
    if (!postVerdict.ok) {
      await this.halt(
        runId,
        "cost_cap_exceeded",
        postVerdict.reason,
        "failed",
        {
          cap: postVerdict.cap,
          limitMicros: postVerdict.limitMicros,
          spentMicros: postVerdict.spentMicros,
          projectedMicros: 0,
        },
      );
      return {
        type: "halted",
        code: "cost_cap_exceeded",
        reason: postVerdict.reason,
      };
    }

    if (result.toolCalls.length === 0) {
      const outcome = result.text;
      await this.finish(runId, outcome);
      return { type: "finished", outcome };
    }

    const toolCallIds: string[] = [];
    for (const call of result.toolCalls) {
      const record = await this.deps.store.createToolCall({
        runId,
        messageId: assistantMessageId,
        toolName: call.toolName,
        arguments: toJsonObject(call.input),
        isMutation: this.isMutationTool(call.toolName),
        status: "pending",
      });
      toolCallIds.push(record.id);
    }
    return { type: "tool_calls", toolCallIds };
  }

  /**
   * Decide what happens to one proposed tool call: run it, refuse it, or park
   * the run behind an approval.
   */
  async gateToolCall(runId: string, toolCallId: string): Promise<GateOutcome> {
    const run = await this.requireRun(runId);
    const definition = this.definition(run.agentSlug);
    const call = await this.requireToolCall(runId, toolCallId);

    let toolDefinition: ToolDefinition;
    try {
      toolDefinition = this.deps.registry.get(call.toolName);
    } catch (error) {
      const reason = isAgentRuntimeError(error) ? error.message : String(error);
      await this.refuseToolCall(runId, call, reason, "failed");
      return { type: "refused", toolCallId, reason };
    }

    const access = checkToolAccess(definition, toolDefinition);
    if (!access.allowed) {
      await this.refuseToolCall(runId, call, access.reason, "skipped");
      this.deps.logger.log({
        level: "warn",
        event: "agent.tool.refused",
        at: this.deps.clock.now().toISOString(),
        runId,
        agentSlug: definition.slug,
        fields: {
          tool: call.toolName,
          code: access.code,
          reason: access.reason,
        },
      });
      return { type: "refused", toolCallId, reason: access.reason };
    }

    let parsed: unknown;
    try {
      parsed = toolDefinition.parse(call.arguments);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.refuseToolCall(runId, call, reason, "failed");
      return { type: "refused", toolCallId, reason };
    }

    const presentation =
      toolDefinition.present === null
        ? null
        : toolDefinition.present(call.arguments);
    const requirement = approvalRequirement({
      definition,
      tool: toolDefinition,
      presentation,
    });
    if (!requirement.required) {
      return { type: "execute", toolCallId };
    }
    if (presentation === null) {
      const reason = `Tool "${call.toolName}" needs approval but cannot describe itself.`;
      await this.refuseToolCall(runId, call, reason, "failed");
      return { type: "refused", toolCallId, reason };
    }

    const approval = await this.deps.approvals.request({
      definition,
      agentId: run.agentId,
      runId,
      tool: toolDefinition,
      input: parsed,
      presentation,
      rationale: await this.lastAssistantText(runId),
    });
    await this.deps.store.updateToolCall(call.id, { approvalId: approval.id });
    await this.deps.store.updateRun(runId, {
      status: "awaiting_approval",
      blockingApprovalId: approval.id,
    });
    return {
      type: "awaiting_approval",
      toolCallId,
      approvalId: approval.id,
      reason: requirement.reason,
    };
  }

  /**
   * Run a tool that the gate cleared.
   *
   * For any effect other than `read` this mints a grant from the approvals row
   * first — and {@link invokeTool} will not execute without one.
   */
  async executeToolCall(
    runId: string,
    toolCallId: string,
  ): Promise<ToolCallRecord> {
    const run = await this.requireRun(runId);
    const definition = this.definition(run.agentSlug);
    const call = await this.requireToolCall(runId, toolCallId);
    const toolDefinition = this.deps.registry.get(call.toolName);
    const parsed = toolDefinition.parse(call.arguments);

    const startedAt = this.deps.clock.now().toISOString();
    await this.deps.store.updateToolCall(call.id, {
      status: "running",
      startedAt,
    });

    const watcher = new ControlWatcher(
      this.deps.control,
      run.agentSlug,
      this.deps.controlPollIntervalMs,
    );
    watcher.start();

    try {
      // Checked here as well as before the model call: a tool must not fire
      // because the switch was thrown a moment after the model proposed it.
      await assertNotHalted(this.deps.control, run.agentSlug, runId);

      // An effect that leaves the company or touches the storefront must carry
      // an approval; an internal write only carries one if the dial sent it to
      // the queue. Either way the grant is minted from the stored row, here,
      // inside the same step that executes the call.
      if (alwaysRequiresApproval(toolDefinition.effect)) {
        this.requireApprovalId(call);
      }
      const grant =
        call.approvalId === null
          ? undefined
          : await this.deps.approvals.grantFor({
              approvalId: call.approvalId,
              runId,
              toolName: call.toolName,
              input: parsed,
            });

      const output = await invokeTool(
        toolDefinition,
        parsed,
        {
          runId,
          agentSlug: definition.slug,
          toolCallId: call.id,
          now: this.deps.clock.now(),
          logger: this.deps.logger,
          abortSignal: watcher.signal,
        },
        grant,
      );

      const result = toJsonValue(output);
      const finishedAt = this.deps.clock.now().toISOString();
      const updated = await this.deps.store.updateToolCall(call.id, {
        status: "succeeded",
        result,
        finishedAt,
      });
      await this.appendToolMessage(runId, call, result);
      await this.deps.store.updateRun(runId, { addToolCalls: 1 });
      if (call.approvalId !== null) {
        await this.deps.approvals.markApplied(call.approvalId, result);
      }
      await this.deps.store.appendAudit({
        actorType: "agent",
        actorId: run.agentId,
        actorLabel: definition.slug,
        action: toolDefinition.effect === "read" ? "sync" : "update",
        entityType: "agent_tool_calls",
        entityId: call.id,
        entityLabel: call.toolName,
        summary: `${definition.slug} ran ${call.toolName} (${toolDefinition.effect})`,
        beforeData: null,
        afterData: result,
        agentRunId: runId,
        approvalId: call.approvalId,
      });
      this.deps.logger.log({
        level: "info",
        event: "agent.tool.succeeded",
        at: finishedAt,
        runId,
        agentSlug: definition.slug,
        fields: {
          tool: call.toolName,
          effect: toolDefinition.effect,
          approvalId: call.approvalId,
        },
      });
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = isAgentRuntimeError(error) ? error.code : "tool_failed";
      const finishedAt = this.deps.clock.now().toISOString();
      const updated = await this.deps.store.updateToolCall(call.id, {
        status: "failed",
        error: `${code}: ${message}`,
        finishedAt,
      });
      await this.appendToolMessage(runId, call, {
        error: `${code}: ${message}`,
      });
      await this.deps.store.updateRun(runId, { addToolCalls: 1 });
      this.deps.logger.log({
        level: "error",
        event: "agent.tool.failed",
        at: finishedAt,
        runId,
        agentSlug: definition.slug,
        fields: { tool: call.toolName, code, error: message },
      });
      return updated;
    } finally {
      watcher.stop();
    }
  }

  /**
   * Apply a human decision to a parked tool call and unpark the run.
   *
   * A rejection is fed back to the model as a tool result so it can react,
   * rather than being swallowed — the agent should learn that it was refused.
   */
  async applyApprovalDecision(
    runId: string,
    toolCallId: string,
    approval: ApprovalRecord | null,
  ): Promise<ToolCallRecord> {
    const call = await this.requireToolCall(runId, toolCallId);
    await this.deps.store.updateRun(runId, {
      status: "running",
      blockingApprovalId: null,
    });

    if (approval === null || approval.status !== "approved") {
      const status = approval?.status ?? "expired";
      const note =
        approval?.decisionNote ?? "no decision was recorded before the timeout";
      const finishedAt = this.deps.clock.now().toISOString();
      const updated = await this.deps.store.updateToolCall(call.id, {
        status: "rejected",
        error: `approval_${status}: ${note}`,
        approvalId: call.approvalId,
        finishedAt,
      });
      await this.appendToolMessage(runId, call, {
        refused: true,
        approvalStatus: status,
        note,
      });
      await this.deps.store.updateRun(runId, { addToolCalls: 1 });
      this.deps.logger.log({
        level: "warn",
        event: "agent.tool.rejected",
        at: finishedAt,
        runId,
        fields: {
          tool: call.toolName,
          approvalId: call.approvalId,
          status,
          note,
        },
      });
      return updated;
    }

    return this.executeToolCall(runId, toolCallId);
  }

  /**
   * Drive a run to completion in one process.
   *
   * Used for read-only and fully-autonomous work, and by the evidence scripts.
   * Anything that parks on an approval should be driven by the Inngest workflow
   * instead — see `inngest/workflow.ts` — which uses exactly these methods.
   */
  async runToCompletion(
    runId: string,
    options: {
      /** Called when the run parks; return the decided approval to continue, or null to give up. */
      readonly onApproval?: (
        approvalId: string,
      ) => Promise<ApprovalRecord | null>;
    } = {},
  ): Promise<RunSummary> {
    let steps = 0;
    const definition = this.definition(
      (await this.requireRun(runId)).agentSlug,
    );

    for (let index = 0; index < definition.maxSteps + 1; index += 1) {
      const outcome = await this.modelStep(runId);
      steps += 1;
      if (outcome.type === "finished" || outcome.type === "halted") {
        return this.summarise(runId, steps);
      }
      for (const toolCallId of outcome.toolCallIds) {
        const gate = await this.gateToolCall(runId, toolCallId);
        if (gate.type === "execute") {
          await this.executeToolCall(runId, toolCallId);
          continue;
        }
        if (gate.type === "refused") {
          continue;
        }
        const decided =
          options.onApproval === undefined
            ? null
            : await options.onApproval(gate.approvalId);
        await this.applyApprovalDecision(runId, toolCallId, decided);
      }
    }
    const reason = `Run exceeded ${definition.maxSteps} model calls without finishing.`;
    await this.halt(runId, "max_steps_exceeded", reason, "failed");
    return this.summarise(runId, steps);
  }

  /**
   * Stop a run from outside it.
   *
   * Inngest cancels a function the moment the kill switch fires, which means the
   * run's own loop never gets to write down why it stopped. The kill-switch
   * function calls this so the record is complete even when the process handling
   * the run was killed mid-step.
   */
  async cancelRun(runId: string, code: string, reason: string): Promise<void> {
    const run = await this.requireRun(runId);
    if (run.finishedAt !== null) {
      return;
    }
    await this.halt(runId, code, reason, "cancelled");
  }

  /** Terminal state of a run, for the caller and the admin. */
  async summarise(runId: string, steps: number): Promise<RunSummary> {
    const run = await this.requireRun(runId);
    return {
      runId,
      status: run.status,
      outcome: run.outcome,
      error: run.error,
      costMicros: run.costMicros,
      toolCallCount: run.toolCallCount,
      steps,
    };
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private modelToolSet(definition: AgentDefinition): ToolSet {
    const set: ToolSet = {};
    for (const name of definition.tools) {
      const toolDefinition = this.deps.registry.get(name);
      // No `execute`: the model may only PROPOSE a call. The runtime decides
      // whether it runs, which is what keeps authorisation out of the tool.
      set[name] = tool({
        description: `${toolDefinition.description} [effect: ${toolDefinition.effect}]`,
        inputSchema: toolDefinition.inputSchema,
      });
    }
    return set;
  }

  private isMutationTool(name: string): boolean {
    try {
      return this.deps.registry.get(name).effect !== "read";
    } catch {
      return false;
    }
  }

  private requireApprovalId(call: ToolCallRecord): string {
    if (call.approvalId === null) {
      throw new AgentRuntimeError(
        "approval_required",
        `Tool call ${call.id} (${call.toolName}) has no approval attached and its effect is not read-only.`,
        { toolCallId: call.id, tool: call.toolName },
      );
    }
    return call.approvalId;
  }

  private async requireRun(runId: string): Promise<RunRecord> {
    const run = await this.deps.store.getRun(runId);
    if (run === null) {
      throw new AgentRuntimeError(
        "run_not_found",
        `No run with id "${runId}".`,
        { runId },
      );
    }
    return run;
  }

  private async requireToolCall(
    runId: string,
    toolCallId: string,
  ): Promise<ToolCallRecord> {
    const calls = await this.deps.store.listToolCalls(runId);
    const call = calls.find((entry) => entry.id === toolCallId);
    if (call === undefined) {
      throw new AgentRuntimeError(
        "store_conflict",
        `Run ${runId} has no tool call ${toolCallId}.`,
        { runId, toolCallId },
      );
    }
    return call;
  }

  private async lastAssistantText(runId: string): Promise<string | null> {
    const messages = await this.deps.store.listMessages(runId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (
        message !== undefined &&
        message.role === "assistant" &&
        message.content !== null
      ) {
        return message.content;
      }
    }
    return null;
  }

  /**
   * The provider's own id for a proposed tool call.
   *
   * A tool result must carry the same `toolCallId` the assistant turn used, or
   * the next model call is rejected as an unanswered tool call. The id is not a
   * column on `agent_tool_calls`; it is already in the stored assistant message,
   * so it is read back from the transcript rather than held in memory — which is
   * also what lets a resumed or replayed run reproduce the prompt exactly.
   */
  private async providerToolCallId(
    runId: string,
    call: ToolCallRecord,
  ): Promise<string> {
    if (call.messageId === null) {
      return call.id;
    }
    const messages = await this.deps.store.listMessages(runId);
    const message = messages.find((entry) => entry.id === call.messageId);
    const stored = message?.contentJson;
    if (
      stored === undefined ||
      stored === null ||
      typeof stored !== "object" ||
      Array.isArray(stored)
    ) {
      return call.id;
    }
    const parts = stored["content"];
    if (!Array.isArray(parts)) {
      return call.id;
    }
    const ids: string[] = [];
    for (const part of parts) {
      if (typeof part !== "object" || part === null || Array.isArray(part)) {
        continue;
      }
      const record: Record<string, JsonValue> = part;
      if (
        record["type"] === "tool-call" &&
        typeof record["toolCallId"] === "string"
      ) {
        ids.push(record["toolCallId"]);
      }
    }
    const siblings = (await this.deps.store.listToolCalls(runId))
      .filter((entry) => entry.messageId === call.messageId)
      .sort((left, right) => left.seq - right.seq);
    const index = siblings.findIndex((entry) => entry.id === call.id);
    return ids[index] ?? call.id;
  }

  private async appendToolMessage(
    runId: string,
    call: ToolCallRecord,
    value: JsonValue,
  ): Promise<void> {
    const modelMessage: ModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: await this.providerToolCallId(runId, call),
          toolName: call.toolName,
          output: { type: "json", value },
        },
      ],
    };
    await this.deps.store.appendMessage({
      runId,
      role: "tool",
      content: JSON.stringify(value),
      contentJson: toJsonValue(modelMessage),
      toolName: call.toolName,
    });
  }

  private async refuseToolCall(
    runId: string,
    call: ToolCallRecord,
    reason: string,
    status: "skipped" | "failed",
  ): Promise<void> {
    const finishedAt = this.deps.clock.now().toISOString();
    await this.deps.store.updateToolCall(call.id, {
      status,
      error: reason,
      finishedAt,
    });
    await this.appendToolMessage(runId, call, { refused: true, reason });
    await this.deps.store.updateRun(runId, { addToolCalls: 1 });
  }

  private async finish(runId: string, outcome: string): Promise<void> {
    const finishedAt = this.deps.clock.now().toISOString();
    await this.deps.store.updateRun(runId, {
      status: "succeeded",
      outcome,
      finishedAt,
      blockingApprovalId: null,
    });
    this.deps.logger.log({
      level: "info",
      event: "agent.run.succeeded",
      at: finishedAt,
      runId,
      fields: { outcome },
    });
  }

  /**
   * Stop a run and record exactly why.
   *
   * The reason lands in three places on purpose: `agent_runs.error` (queryable),
   * `agent_runs.context.halt` (structured, for the admin), and a structured log
   * line (for the drain). The founder should never have to guess.
   */
  private async halt(
    runId: string,
    code: string,
    reason: string,
    status: "failed" | "cancelled",
    detail: JsonObject = {},
  ): Promise<void> {
    const finishedAt = this.deps.clock.now().toISOString();
    const run = await this.requireRun(runId);
    await this.deps.store.updateRun(runId, {
      status,
      error: `${code}: ${reason}`,
      outcome: `Halted: ${reason}`,
      finishedAt,
      blockingApprovalId: null,
      contextPatch: {
        [HALT_CONTEXT_KEY]: { code, reason, at: finishedAt, ...detail },
      },
    });
    await this.deps.store.appendAudit({
      actorType: "system",
      actorId: null,
      actorLabel: "agent-runtime",
      action: "cancel",
      entityType: "agent_runs",
      entityId: runId,
      entityLabel: run.agentSlug,
      summary: `Run halted (${code}): ${reason}`,
      beforeData: null,
      afterData: { code, reason, ...detail },
      agentRunId: runId,
      approvalId: null,
    });
    this.deps.logger.log({
      level: "error",
      event: "agent.run.halted",
      at: finishedAt,
      runId,
      agentSlug: run.agentSlug,
      fields: { code, reason, status, ...detail },
    });
  }
}
