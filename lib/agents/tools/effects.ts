/**
 * Effect grants — the capability token that lets an effectful tool run.
 *
 * The safety property this file exists to make structural:
 *
 *   A tool whose effect class is `storefront_write` or `external` cannot
 *   execute unless an `approvals` row exists, is in status `approved`, was
 *   raised by this run, and covers these exact arguments.
 *
 * Three things make bypass impossible rather than merely discouraged:
 *
 * 1. `EffectGrant` carries a brand keyed by a module-private `unique symbol`.
 *    The symbol is never exported, so no other module can write a value of
 *    that type — a hand-rolled object is a compile error.
 * 2. Every minted grant is recorded in a module-private `WeakSet`. Even a
 *    runtime forgery (structuredClone, Object.create, symbol reflection) fails
 *    membership, so the check is not defeatable by shape.
 * 3. `mintEffectGrant` derives every field from an `ApprovalRecord` that was
 *    *read back from the store*. It refuses anything that is not `approved`,
 *    refuses an approval belonging to another run, and refuses one whose
 *    payload fingerprint differs from the arguments about to be executed.
 *    So the only way to obtain a grant is to have a genuinely approved row.
 *
 * Grants are single-use and short-lived; a consumed grant cannot be replayed.
 */

import { EFFECT_GRANT_TTL_MS } from "../constants";
import { ApprovalGateError } from "../errors";
import { fingerprint } from "../canonical";
import type { ApprovalRecord } from "../types";

/**
 * Module-private brand. Not exported, so `EffectGrant` is unconstructable
 * outside this file even though the type itself is public.
 */
const GRANT_BRAND: unique symbol = Symbol("half-sour.agents.effect-grant");

/** Every grant this process has minted. Membership is the forgery check. */
const MINTED = new WeakSet<object>();
/** Grants already spent. A grant authorises exactly one execution. */
const CONSUMED = new WeakSet<object>();

/**
 * Proof that a specific tool call, with specific arguments, in a specific run,
 * was approved by a human. Opaque by construction.
 */
export interface EffectGrant {
  readonly [GRANT_BRAND]: true;
  /** The `approvals` row this grant is derived from. */
  readonly approvalId: string;
  /** The run permitted to spend it. */
  readonly runId: string;
  /** The tool permitted to spend it. */
  readonly toolName: string;
  /** SHA-256 of the canonical arguments the human actually approved. */
  readonly argumentsFingerprint: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/** What the payload of an approval must contain for a grant to be derivable. */
export interface ApprovalPayloadShape {
  readonly tool: string;
  readonly arguments: unknown;
}

function readPayloadShape(approval: ApprovalRecord): ApprovalPayloadShape | null {
  const tool = approval.payload["tool"];
  if (typeof tool !== "string") {
    return null;
  }
  return { tool, arguments: approval.payload["arguments"] ?? null };
}

/**
 * Mint a grant from an approval that has already been read back from the store.
 *
 * Every branch here is a refusal path. There is no argument combination that
 * produces a grant without an `approved` row matching the exact call.
 */
export function mintEffectGrant(params: {
  readonly approval: ApprovalRecord;
  readonly runId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly now: Date;
}): EffectGrant {
  const { approval, runId, toolName, input, now } = params;

  if (approval.status !== "approved") {
    throw new ApprovalGateError(
      approval.status === "rejected" ? "approval_rejected" : "approval_not_approved",
      `Approval ${approval.id} is "${approval.status}", not "approved"; no grant can be minted.`,
      { approvalId: approval.id, status: approval.status, tool: toolName },
    );
  }
  if (approval.decidedAt === null) {
    throw new ApprovalGateError(
      "approval_not_approved",
      `Approval ${approval.id} claims to be approved but carries no decision timestamp.`,
      { approvalId: approval.id, tool: toolName },
    );
  }
  if (approval.expiresAt !== null && Date.parse(approval.expiresAt) <= now.getTime()) {
    throw new ApprovalGateError(
      "approval_expired",
      `Approval ${approval.id} expired at ${approval.expiresAt}.`,
      { approvalId: approval.id, tool: toolName },
    );
  }
  if (approval.requestedByRunId !== runId) {
    throw new ApprovalGateError(
      "approval_mismatch",
      `Approval ${approval.id} belongs to run ${String(approval.requestedByRunId)}, not ${runId}.`,
      { approvalId: approval.id, runId, tool: toolName },
    );
  }

  const shape = readPayloadShape(approval);
  if (shape === null) {
    throw new ApprovalGateError(
      "approval_mismatch",
      `Approval ${approval.id} has no tool payload; nothing can be derived from it.`,
      { approvalId: approval.id, tool: toolName },
    );
  }
  if (shape.tool !== toolName) {
    throw new ApprovalGateError(
      "grant_tool_mismatch",
      `Approval ${approval.id} approves "${shape.tool}", not "${toolName}".`,
      { approvalId: approval.id, approvedTool: shape.tool, requestedTool: toolName },
    );
  }

  const approvedFingerprint = fingerprint(shape.arguments);
  const actualFingerprint = fingerprint(input);
  if (approvedFingerprint !== actualFingerprint) {
    throw new ApprovalGateError(
      "grant_arguments_mismatch",
      `Approval ${approval.id} covers different arguments than the ones being executed.`,
      {
        approvalId: approval.id,
        tool: toolName,
        approvedFingerprint,
        actualFingerprint,
      },
    );
  }

  const grant: EffectGrant = Object.freeze({
    [GRANT_BRAND]: true as const,
    approvalId: approval.id,
    runId,
    toolName,
    argumentsFingerprint: actualFingerprint,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + EFFECT_GRANT_TTL_MS).toISOString(),
  });
  MINTED.add(grant);
  return grant;
}

/** Everything a grant is checked against at the moment of execution. */
export interface GrantUsage {
  readonly toolName: string;
  readonly runId: string;
  readonly input: unknown;
  readonly now: Date;
}

/**
 * Verify a grant without spending it. Throws {@link ApprovalGateError} on any
 * mismatch — forged, expired, spent, wrong tool, wrong run, wrong arguments.
 */
export function assertGrantUsable(grant: EffectGrant, usage: GrantUsage): void {
  if (!MINTED.has(grant)) {
    throw new ApprovalGateError(
      "grant_forged",
      "Effect grant was not minted by the runtime. Refusing to execute.",
      { tool: usage.toolName, runId: usage.runId },
    );
  }
  if (CONSUMED.has(grant)) {
    throw new ApprovalGateError(
      "grant_consumed",
      `Effect grant for "${grant.toolName}" has already been spent. Grants are single-use.`,
      { tool: usage.toolName, approvalId: grant.approvalId },
    );
  }
  if (Date.parse(grant.expiresAt) <= usage.now.getTime()) {
    throw new ApprovalGateError(
      "grant_expired",
      `Effect grant for "${grant.toolName}" expired at ${grant.expiresAt}.`,
      { tool: usage.toolName, approvalId: grant.approvalId },
    );
  }
  if (grant.toolName !== usage.toolName) {
    throw new ApprovalGateError(
      "grant_tool_mismatch",
      `Effect grant is for "${grant.toolName}", not "${usage.toolName}".`,
      { grantTool: grant.toolName, requestedTool: usage.toolName },
    );
  }
  if (grant.runId !== usage.runId) {
    throw new ApprovalGateError(
      "grant_run_mismatch",
      `Effect grant belongs to run ${grant.runId}, not ${usage.runId}.`,
      { grantRunId: grant.runId, runId: usage.runId },
    );
  }
  const actual = fingerprint(usage.input);
  if (grant.argumentsFingerprint !== actual) {
    throw new ApprovalGateError(
      "grant_arguments_mismatch",
      `Effect grant covers different arguments than the ones being executed.`,
      {
        tool: usage.toolName,
        approvalId: grant.approvalId,
        grantFingerprint: grant.argumentsFingerprint,
        actualFingerprint: actual,
      },
    );
  }
}

/** Verify and spend a grant. A grant authorises exactly one execution. */
export function consumeEffectGrant(grant: EffectGrant, usage: GrantUsage): void {
  assertGrantUsable(grant, usage);
  CONSUMED.add(grant);
}

/** Read-only view of a grant, safe to log and to persist alongside a tool call. */
export function describeGrant(grant: EffectGrant): {
  approvalId: string;
  runId: string;
  toolName: string;
  argumentsFingerprint: string;
  issuedAt: string;
  expiresAt: string;
} {
  return {
    approvalId: grant.approvalId,
    runId: grant.runId,
    toolName: grant.toolName,
    argumentsFingerprint: grant.argumentsFingerprint,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
  };
}
