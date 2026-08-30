/**
 * `agent/run.requested` -> a durable agent run.
 *
 * `retries` is per step, not per run: a flaky tool call retries on its own
 * without re-spending a model call. `cancelOn` is what makes the kill switch and
 * the per-agent pause bite runs that are already moving — Inngest stops the
 * function wherever it is, and the sweep function writes down why.
 */

import { inngest } from "../client";
import type { DurableStep, WaitForEventOptions } from "../durable-step";
import { EVENT_NAMES, agentRunRequested } from "../events";
import { getAgentPlatform } from "../platform";
import { runAgentWorkflow } from "../workflow";

export const agentRunFunction = inngest.createFunction(
  {
    id: "agent-run",
    name: "Agent run",
    triggers: [agentRunRequested],
    retries: 3,
    concurrency: { limit: 4, key: "event.data.agentSlug" },
    cancelOn: [
      // The global kill switch stops every agent, whatever it is doing.
      { event: EVENT_NAMES.killSwitchEngaged },
      // A pause stops only that role's runs.
      {
        event: EVENT_NAMES.agentPaused,
        if: "async.data.agentSlug == event.data.agentSlug",
      },
    ],
  },
  async ({ event, step }) => {
    const platform = await getAgentPlatform();
    const durable: DurableStep = {
      run: async (id: string, fn: () => Promise<unknown>) => step.run(id, fn),
      waitForEvent: async (id: string, options: WaitForEventOptions) =>
        step.waitForEvent(id, options),
    };
    return runAgentWorkflow({
      step: durable,
      platform,
      input: {
        agentSlug: event.data.agentSlug,
        goal: event.data.goal,
        trigger: event.data.trigger ?? "manual",
        ...(event.data.input === undefined ? {} : { input: event.data.input }),
        ...(event.data.parentRunId === undefined
          ? {}
          : { parentRunId: event.data.parentRunId }),
      },
    });
  },
);
