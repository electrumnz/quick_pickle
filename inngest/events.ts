/**
 * The event vocabulary of the agent runtime.
 *
 * Schemas are zod, which Inngest reads as Standard Schema, so an event that
 * does not match its declared shape is rejected before a function ever sees it.
 */

import { eventType } from "inngest";
import { z } from "zod";

import { AGENT_RUN_TRIGGERS } from "@/lib/agents/types";

/** Ask the runtime to do a piece of work. */
export const agentRunRequestedSchema = z.object({
  agentSlug: z.string().min(1),
  goal: z.string().min(1),
  trigger: z.enum(AGENT_RUN_TRIGGERS).default("manual"),
  /** Whatever the caller wants the agent to see. Persisted on the run. */
  input: z.record(z.string(), z.unknown()).default({}),
  parentRunId: z.string().nullable().default(null),
});

/** A human decided an approval. Parked runs wait on this. */
export const approvalDecidedSchema = z.object({
  approvalId: z.string().min(1),
  status: z.enum(["approved", "rejected", "cancelled", "expired"]),
  decidedBy: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
});

/** The kill switch was thrown. Every in-flight run is cancelled on this. */
export const killSwitchEngagedSchema = z.object({
  reason: z.string().min(1),
  engagedBy: z.string().min(1),
});

/** One agent was paused. Its in-flight runs are cancelled on this. */
export const agentPausedSchema = z.object({
  agentSlug: z.string().min(1),
  reason: z.string().min(1),
  pausedBy: z.string().min(1),
});

export const agentRunRequested = eventType("agent/run.requested", {
  schema: agentRunRequestedSchema,
});
export const approvalDecided = eventType("agent/approval.decided", {
  schema: approvalDecidedSchema,
});
export const killSwitchEngaged = eventType("agent/kill-switch.engaged", {
  schema: killSwitchEngagedSchema,
});
export const agentPaused = eventType("agent/agent.paused", {
  schema: agentPausedSchema,
});

/** Event names as literals, for `waitForEvent` and `cancelOn` predicates. */
export const EVENT_NAMES = {
  runRequested: "agent/run.requested",
  approvalDecided: "agent/approval.decided",
  killSwitchEngaged: "agent/kill-switch.engaged",
  agentPaused: "agent/agent.paused",
} as const;

export type AgentRunRequestedData = z.infer<typeof agentRunRequestedSchema>;
export type ApprovalDecidedData = z.infer<typeof approvalDecidedSchema>;
