/**
 * Driving a run from a request, and stopping when it parks.
 *
 * `AgentRuntime.runToCompletion` and `inngest/workflow.ts` are the two existing
 * drivers, and they call exactly these methods in exactly this order: check the
 * controls, take a model step, gate each proposed tool call, execute the ones
 * the gate cleared. This is a third caller of the same methods and not a third
 * engine — nothing here decides anything the runtime decides.
 *
 * One difference, and it is the reason this file exists. `runToCompletion`
 * treats a parked run as something to answer: with no `onApproval` it passes
 * `null` to `applyApprovalDecision`, which records the tool call as rejected
 * and lets the run finish. That is right for an evidence script and wrong for a
 * chat window — she has not answered yet. So this driver stops the moment the
 * gate parks, leaves the run in `awaiting_approval` with its
 * `blocking_approval_id` set, and hands the approval id back so the surface can
 * put the ordinary approval card in front of her.
 *
 * Resuming afterwards is the durable workflow's job (`inngest/workflow.ts`
 * waits on `agent/approval.decided`). This driver never resumes a run and never
 * decides an approval.
 */

import type { AgentRuntime } from "../runtime/runtime";

/** Where a driven run stopped. */
export type DriveResult =
  | { readonly type: "finished"; readonly outcome: string }
  | { readonly type: "halted"; readonly code: string; readonly reason: string }
  | {
      readonly type: "awaiting_approval";
      readonly approvalId: string;
      readonly reason: string;
    }
  | { readonly type: "ran_out_of_steps"; readonly steps: number };

/**
 * Take a run as far as it goes without a human.
 *
 * The loop is bounded by the role's own `maxSteps`, which the runtime enforces
 * again on every model step; the bound here only stops the loop spinning after
 * the runtime has already halted the run.
 */
export async function driveRun(
  runtime: AgentRuntime,
  runId: string,
  agentSlug: string,
): Promise<DriveResult> {
  const maxSteps = runtime.definition(agentSlug).maxSteps;

  for (let step = 0; step < maxSteps; step += 1) {
    const halted = await runtime.checkControls(runId);
    if (halted !== null) {
      return { type: "halted", code: halted.code, reason: halted.reason };
    }

    const turn = await runtime.modelStep(runId);
    if (turn.type === "finished") {
      return { type: "finished", outcome: turn.outcome };
    }
    if (turn.type === "halted") {
      return { type: "halted", code: turn.code, reason: turn.reason };
    }

    for (const toolCallId of turn.toolCallIds) {
      const gate = await runtime.gateToolCall(runId, toolCallId);
      if (gate.type === "execute") {
        await runtime.executeToolCall(runId, toolCallId);
        continue;
      }
      if (gate.type === "refused") {
        // The refusal is already in the transcript as a tool result, so the
        // model gets to react to it on the next step rather than being cut off.
        continue;
      }
      // Parked. Nothing further happens until she decides, and nothing here
      // decides for her.
      return {
        type: "awaiting_approval",
        approvalId: gate.approvalId,
        reason: gate.reason,
      };
    }
  }

  return { type: "ran_out_of_steps", steps: maxSteps };
}

/**
 * The runner a handoff dispatches through, when the caller drives its own runs.
 *
 * `HandoffRunner` only asks for "something that can open a run". In a request
 * that is answering the founder, opening one and walking away would leave a run
 * sitting in `running` with nobody to move it — so the runner opens the run,
 * drives it here and now, and returns the id. The child's own step ceiling,
 * cost caps, control plane and approval gate all apply to it unchanged, and the
 * conversation turn cap was already spent before this was called.
 */
export function drivingRunner(runtime: AgentRuntime): {
  startRun(input: {
    readonly agentSlug: string;
    readonly goal: string;
    readonly trigger: "chained";
    readonly parentRunId?: string | null;
    readonly conversation?: { readonly id: string; readonly turnCap?: number };
  }): Promise<{ readonly runId: string }>;
} {
  return {
    async startRun(input) {
      const started = await runtime.startRun(input);
      await driveRun(runtime, started.runId, input.agentSlug);
      return { runId: started.runId };
    },
  };
}
