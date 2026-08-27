/**
 * Authorisation: what this agent, at this autonomy level, may do with this tool.
 *
 * Two independent questions, answered here and nowhere else:
 *
 *   1. May the agent call this tool at all? (grant list + autonomy floor)
 *   2. Does this specific call need a human first? (effect class + autonomy +
 *      the agent's declared approval subjects + the money on the line)
 *
 * Both are pure functions of the definition and the call. No tool implements
 * its own check, so a badly written tool cannot open a hole.
 */

import { LOW_RISK_AMOUNT_CEILING_CENTS } from "../constants";
import { ToolAuthorisationError } from "../errors";
import {
  alwaysRequiresApproval,
  type AgentDefinition,
  type ApprovalRisk,
  type ToolEffect,
} from "../types";
import type { ApprovalPresentation, ToolDefinition } from "./registry";

/** Why a tool call was allowed or refused, in a form the admin can render. */
export type AccessVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: "tool_not_granted" | "autonomy_forbids_effect";
      readonly reason: string;
    };

/** Can this agent call this tool at all? */
export function checkToolAccess(
  definition: AgentDefinition,
  tool: ToolDefinition,
): AccessVerdict {
  if (!definition.tools.includes(tool.name)) {
    return {
      allowed: false,
      code: "tool_not_granted",
      reason: `Agent "${definition.slug}" was not granted the tool "${tool.name}".`,
    };
  }
  if (definition.autonomy === "observe" && tool.effect !== "read") {
    return {
      allowed: false,
      code: "autonomy_forbids_effect",
      reason: `Agent "${definition.slug}" is on autonomy "observe" and may only call read-only tools; "${tool.name}" is "${tool.effect}".`,
    };
  }
  return { allowed: true };
}

/** Throwing form of {@link checkToolAccess}. */
export function assertToolAccess(
  definition: AgentDefinition,
  tool: ToolDefinition,
): void {
  const verdict = checkToolAccess(definition, tool);
  if (!verdict.allowed) {
    throw new ToolAuthorisationError(verdict.code, verdict.reason, {
      agent: definition.slug,
      tool: tool.name,
      effect: tool.effect,
      autonomy: definition.autonomy,
    });
  }
}

/** Why a call is being escalated to a human. */
export type ApprovalTrigger =
  | "external_effect"
  | "storefront_write"
  | "autonomy_propose"
  | "declared_subject"
  | "over_single_action_cap";

export type ApprovalRequirement =
  | { readonly required: false }
  | {
      readonly required: true;
      readonly trigger: ApprovalTrigger;
      readonly reason: string;
    };

/**
 * Does this specific call need a human decision first?
 *
 * `storefront_write` and `external` are unconditional — no autonomy level and no
 * configuration removes them. Everything else is policy.
 */
export function approvalRequirement(params: {
  readonly definition: AgentDefinition;
  readonly tool: ToolDefinition;
  readonly presentation: ApprovalPresentation | null;
}): ApprovalRequirement {
  const { definition, tool, presentation } = params;

  if (tool.effect === "external") {
    return {
      required: true,
      trigger: "external_effect",
      reason: `"${tool.name}" reaches outside the company; every external message needs an approved approvals row.`,
    };
  }
  if (tool.effect === "storefront_write") {
    return {
      required: true,
      trigger: "storefront_write",
      reason: `"${tool.name}" changes what customers see; every storefront write needs an approved approvals row.`,
    };
  }
  if (tool.effect === "read") {
    return { required: false };
  }

  // From here: business_write.
  const subject = tool.approval?.subjectType;
  if (definition.autonomy === "propose") {
    return {
      required: true,
      trigger: "autonomy_propose",
      reason: `Agent "${definition.slug}" is on autonomy "propose"; every write is a proposal.`,
    };
  }
  if (
    subject !== undefined &&
    definition.requiresApprovalFor.includes(subject)
  ) {
    return {
      required: true,
      trigger: "declared_subject",
      reason: `Agent "${definition.slug}" routes "${subject}" through the approvals queue by configuration.`,
    };
  }
  const cap = definition.budget.singleActionCents;
  const amount = presentation?.amountCents;
  if (cap !== undefined && amount !== undefined && amount > cap) {
    return {
      required: true,
      trigger: "over_single_action_cap",
      reason: `Action value ${amount}c exceeds the single-action cap of ${cap}c.`,
    };
  }
  return { required: false };
}

/**
 * The risk to file an approval under.
 *
 * The tool's declared risk is a floor, not the final word: money at or above
 * `LOW_RISK_AMOUNT_CEILING_CENTS` can never be `low`, which is exactly what the
 * `approvals_money_risk` check constraint enforces in the database.
 */
export function resolveRisk(
  declared: ApprovalRisk,
  amountCents: number | undefined,
): ApprovalRisk {
  if (amountCents === undefined) {
    return declared;
  }
  if (
    Math.abs(amountCents) >= LOW_RISK_AMOUNT_CEILING_CENTS &&
    declared === "low"
  ) {
    return "medium";
  }
  return declared;
}

/** True when the effect class writes something, anywhere. */
export function isMutation(effect: ToolEffect): boolean {
  return effect !== "read";
}

/** Re-exported so callers do not have to reach into `types` for the one predicate. */
export { alwaysRequiresApproval };
