/**
 * Kill switch and pause sweeps.
 *
 * `cancelOn` stops the in-flight function immediately, but a cancelled function
 * does not get to write its own epitaph. These two functions do it instead, so
 * every run stopped by a control ends up with a status, an error and a reason on
 * the row — the founder can always see why an agent went quiet.
 */

import { inngest } from "../client";
import { agentPaused, killSwitchEngaged } from "../events";
import { getAgentPlatform } from "../platform";

/** Statuses a run can be in when a control stops it. */
const LIVE_STATUSES = ["queued", "running", "awaiting_approval"] as const;

export const killSwitchSweepFunction = inngest.createFunction(
  {
    id: "agent-kill-switch-sweep",
    name: "Kill switch sweep",
    triggers: [killSwitchEngaged],
    retries: 3,
  },
  async ({ event, step }) => {
    const platform = await getAgentPlatform();
    return step.run("cancel-live-runs", async () => {
      const live = await platform.store.listRuns({ status: LIVE_STATUSES });
      for (const run of live) {
        await platform.runtime.cancelRun(
          run.id,
          "kill_switch_engaged",
          `Global kill switch engaged by ${event.data.engagedBy}: ${event.data.reason}`,
        );
      }
      return { cancelled: live.length };
    });
  },
);

export const agentPausedSweepFunction = inngest.createFunction(
  {
    id: "agent-paused-sweep",
    name: "Agent pause sweep",
    triggers: [agentPaused],
    retries: 3,
  },
  async ({ event, step }) => {
    const platform = await getAgentPlatform();
    return step.run("cancel-agent-runs", async () => {
      const live = await platform.store.listRuns({
        status: LIVE_STATUSES,
        agentSlug: event.data.agentSlug,
      });
      for (const run of live) {
        await platform.runtime.cancelRun(
          run.id,
          "agent_paused",
          `Agent paused by ${event.data.pausedBy}: ${event.data.reason}`,
        );
      }
      return { cancelled: live.length };
    });
  },
);
