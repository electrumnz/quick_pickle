/**
 * Inngest wiring for the agent runtime.
 *
 * `functions` is what the serve handler registers. The app route is three lines:
 *
 * ```ts
 * import { serve } from "inngest/next";
 * import { functions, inngest } from "@/inngest";
 * export const { GET, POST, PUT } = serve({ client: inngest, functions });
 * ```
 */

import { agentRunFunction } from "./functions/agent-run";
import {
  agentPausedSweepFunction,
  killSwitchSweepFunction,
} from "./functions/kill-switch";

export { inngest, INNGEST_APP_ID } from "./client";
export {
  EVENT_NAMES,
  agentPaused,
  agentRunRequested,
  approvalDecided,
  killSwitchEngaged,
  type AgentRunRequestedData,
  type ApprovalDecidedData,
} from "./events";
export {
  MemoryDurableStep,
  WorkflowParked,
  type DeliveredEvent,
  type DurableStep,
  type StepTrace,
  type WaitForEventOptions,
} from "./durable-step";
export {
  configureAgentPlatform,
  getAgentPlatform,
  resetAgentPlatform,
} from "./platform";
export {
  runAgentWorkflow,
  type AgentRunInput,
  type AgentRunResult,
} from "./workflow";
export { agentRunFunction } from "./functions/agent-run";
export {
  agentPausedSweepFunction,
  killSwitchSweepFunction,
} from "./functions/kill-switch";

/** Every function the app serves. */
export const functions = [
  agentRunFunction,
  killSwitchSweepFunction,
  agentPausedSweepFunction,
];
