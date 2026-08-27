/**
 * The durable agent-run workflow.
 *
 * One Inngest step per unit of work, so a failure retries just that unit and a
 * redeploy resumes from the last completed step rather than from the top. The
 * approval wait is a real `waitForEvent`: the run is suspended, no process is
 * held open, and it resumes when the founder decides.
 *
 * The body is written against {@link DurableStep} rather than Inngest's `step`
 * directly, so the same code can be driven by `MemoryDurableStep` in a test and
 * the park/resume behaviour proved without a running Inngest server.
 */

import { z } from "zod";

import type { AgentPlatform } from "@/lib/agents/factory";
import { APPROVAL_WAIT_TIMEOUT } from "@/lib/agents/constants";
import { toJsonObject } from "@/lib/agents/json";
import type { AgentRunTrigger } from "@/lib/agents/types";

import type { DurableStep } from "./durable-step";
import { EVENT_NAMES } from "./events";

/** What starts a run. */
export interface AgentRunInput {
  readonly agentSlug: string;
  readonly goal: string;
  readonly trigger: AgentRunTrigger;
  readonly input?: Record<string, unknown>;
  readonly parentRunId?: string | null;
}

// Step results cross a persistence boundary, so every one is parsed on the way
// back rather than trusted. This is also what keeps the workflow free of casts.
const startedSchema = z.object({
  runId: z.string(),
  maxSteps: z.number().int().positive(),
});

const controlSchema = z.object({
  halted: z.boolean(),
  code: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
});

const turnSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("finished"), outcome: z.string() }),
  z.object({ type: z.literal("halted"), code: z.string(), reason: z.string() }),
  z.object({ type: z.literal("tool_calls"), toolCallIds: z.array(z.string()) }),
]);

const gateSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("execute"), toolCallId: z.string() }),
  z.object({
    type: z.literal("refused"),
    toolCallId: z.string(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("awaiting_approval"),
    toolCallId: z.string(),
    approvalId: z.string(),
    reason: z.string(),
  }),
]);

const summarySchema = z.object({
  runId: z.string(),
  status: z.string(),
  outcome: z.string().nullable(),
  error: z.string().nullable(),
  costMicros: z.number(),
  toolCallCount: z.number(),
  steps: z.number(),
});

const waitResultSchema = z
  .object({ data: z.object({ approvalId: z.string() }).loose() })
  .nullable();

/** What the workflow reports back. */
export type AgentRunResult = z.infer<typeof summarySchema>;

/**
 * Drive one agent run to completion, durably.
 *
 * @param step - Inngest's `step`, or a compatible driver.
 * @param platform - a wired runtime (store, registry, control plane, meter).
 * @param input - the work to do.
 */
export async function runAgentWorkflow(params: {
  readonly step: DurableStep;
  readonly platform: AgentPlatform;
  readonly input: AgentRunInput;
  readonly approvalTimeout?: string;
}): Promise<AgentRunResult> {
  const { step, platform, input } = params;
  const runtime = platform.runtime;
  const approvalTimeout = params.approvalTimeout ?? APPROVAL_WAIT_TIMEOUT;

  const started = startedSchema.parse(
    await step.run("start-run", async () => {
      const definition = runtime.definition(input.agentSlug);
      const run = await runtime.startRun({
        agentSlug: input.agentSlug,
        goal: input.goal,
        trigger: input.trigger,
        ...(input.input === undefined
          ? {}
          : { input: toJsonObject(input.input) }),
        ...(input.parentRunId === undefined
          ? {}
          : { parentRunId: input.parentRunId }),
      });
      return { runId: run.runId, maxSteps: definition.maxSteps };
    }),
  );

  const runId = started.runId;
  let stepsTaken = 0;

  for (let turn = 0; turn < started.maxSteps; turn += 1) {
    const control = controlSchema.parse(
      await step.run(`control-${turn}`, async () => {
        const outcome = await runtime.checkControls(runId);
        return outcome === null
          ? { halted: false, code: null, reason: null }
          : { halted: true, code: outcome.code, reason: outcome.reason };
      }),
    );
    if (control.halted) {
      return finish(step, runtime, runId, stepsTaken);
    }

    const outcome = turnSchema.parse(
      await step.run(`model-${turn}`, async () => runtime.modelStep(runId)),
    );
    stepsTaken += 1;

    if (outcome.type === "finished" || outcome.type === "halted") {
      return finish(step, runtime, runId, stepsTaken);
    }

    for (let index = 0; index < outcome.toolCallIds.length; index += 1) {
      const toolCallId = outcome.toolCallIds[index];
      if (toolCallId === undefined) {
        continue;
      }
      const gate = gateSchema.parse(
        await step.run(`gate-${turn}-${index}`, async () =>
          runtime.gateToolCall(runId, toolCallId),
        ),
      );

      if (gate.type === "refused") {
        continue;
      }
      if (gate.type === "execute") {
        await step.run(`tool-${turn}-${index}`, async () => {
          const call = await runtime.executeToolCall(runId, toolCallId);
          return { toolCallId: call.id, status: call.status };
        });
        continue;
      }

      // Park. The run holds nothing open while the founder decides; Inngest
      // resumes this function when a matching decision event arrives.
      const decision = waitResultSchema.parse(
        await step.waitForEvent(`approval-${turn}-${index}`, {
          event: EVENT_NAMES.approvalDecided,
          timeout: approvalTimeout,
          if: `async.data.approvalId == "${gate.approvalId}"`,
        }),
      );

      await step.run(`resume-${turn}-${index}`, async () => {
        const approval =
          decision === null
            ? null
            : await platform.approvals.get(decision.data.approvalId);
        const call = await runtime.applyApprovalDecision(
          runId,
          toolCallId,
          approval,
        );
        return {
          toolCallId: call.id,
          status: call.status,
          approvalStatus: approval?.status ?? "expired",
        };
      });
    }
  }

  return finish(step, runtime, runId, stepsTaken);
}

async function finish(
  step: DurableStep,
  runtime: AgentPlatform["runtime"],
  runId: string,
  steps: number,
): Promise<AgentRunResult> {
  return summarySchema.parse(
    await step.run(`summarise-${steps}`, async () =>
      runtime.summarise(runId, steps),
    ),
  );
}
