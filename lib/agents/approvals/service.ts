/**
 * The approval gate.
 *
 * One object — `public.approvals` — backs every human-in-the-loop queue in the
 * admin. This service is the only thing in the runtime that raises rows in it,
 * decides them, and turns an approved row into a capability the tool layer will
 * accept.
 *
 * `grantFor` is the single choke point: it re-reads the row from the store at
 * execution time and hands the result to {@link mintEffectGrant}, which refuses
 * anything that is not an approved row covering these exact arguments. There is
 * no other path to an {@link EffectGrant} anywhere in the codebase.
 */

import type { Clock } from "../clock";
import { ApprovalGateError } from "../errors";
import { toJsonValue, type JsonObject, type JsonValue } from "../json";
import type { AgentLogger } from "../logger";
import type { AgentStore } from "../store/types";
import { mintEffectGrant, type EffectGrant } from "../tools/effects";
import { resolveRisk } from "../tools/authorization";
import type { ApprovalPresentation, ToolDefinition } from "../tools/registry";
import type { AgentDefinition, ApprovalRecord } from "../types";

/** What the runtime knows when it decides to ask a human. */
export interface ApprovalRequestInput {
  readonly definition: AgentDefinition;
  readonly agentId: string;
  readonly runId: string;
  readonly tool: ToolDefinition<never, never>;
  readonly input: unknown;
  readonly presentation: ApprovalPresentation;
  /** The model's own stated reason for wanting this. Stored verbatim. */
  readonly rationale: string | null;
  readonly expiresAt?: string | null;
}

export class ApprovalService {
  constructor(
    private readonly store: AgentStore,
    private readonly clock: Clock,
    private readonly logger: AgentLogger,
  ) {}

  /**
   * Raise a pending approval for a tool call.
   *
   * The payload is the exact call to make on approval — tool name plus
   * arguments — so applying an approval is a replay, never a re-derivation.
   */
  async request(input: ApprovalRequestInput): Promise<ApprovalRecord> {
    const spec = input.tool.approval;
    if (spec === undefined) {
      throw new ApprovalGateError(
        "approval_mismatch",
        `Tool "${input.tool.name}" has no approval subject and cannot be escalated.`,
        { tool: input.tool.name },
      );
    }
    const payload: JsonObject = {
      tool: input.tool.name,
      arguments: toJsonValue(input.input),
      effect: input.tool.effect,
      agentSlug: input.definition.slug,
    };
    const approval = await this.store.createApproval({
      subjectType: spec.subjectType,
      subjectTable: spec.subjectTable,
      subjectId: null,
      title: input.presentation.title,
      summary: input.presentation.summary,
      rationale: input.rationale,
      payload,
      preview: input.presentation.preview ?? {},
      risk: resolveRisk(spec.risk, input.presentation.amountCents),
      amountCents: input.presentation.amountCents ?? null,
      currency: "NZD",
      requestedByAgentId: input.agentId,
      requestedByRunId: input.runId,
      expiresAt: input.expiresAt ?? null,
    });

    await this.store.appendAudit({
      actorType: "agent",
      actorId: input.agentId,
      actorLabel: input.definition.slug,
      action: "create",
      entityType: "approvals",
      entityId: approval.id,
      entityLabel: approval.title,
      summary: `Approval requested for ${input.tool.name}: ${approval.summary}`,
      beforeData: null,
      afterData: payload,
      agentRunId: input.runId,
      approvalId: approval.id,
    });

    this.logger.log({
      level: "info",
      event: "agent.approval.requested",
      at: approval.requestedAt,
      runId: input.runId,
      agentSlug: input.definition.slug,
      fields: {
        approvalId: approval.id,
        tool: input.tool.name,
        effect: input.tool.effect,
        subjectType: approval.subjectType,
        risk: approval.risk,
        amountCents: approval.amountCents,
      },
    });
    return approval;
  }

  /** Record a human decision. Rejections must carry a note; the schema insists. */
  async decide(params: {
    readonly approvalId: string;
    readonly status: "approved" | "rejected" | "cancelled" | "expired";
    readonly decidedBy: string | null;
    readonly note: string | null;
  }): Promise<ApprovalRecord> {
    const decidedAt = this.clock.now().toISOString();
    const approval = await this.store.decideApproval({
      approvalId: params.approvalId,
      status: params.status,
      decidedBy: params.decidedBy,
      decidedAt,
      decisionNote: params.note,
    });
    await this.store.appendAudit({
      actorType: params.decidedBy === null ? "system" : "operator",
      actorId: params.decidedBy,
      actorLabel: params.decidedBy ?? "system",
      action: params.status === "approved" ? "approve" : "reject",
      entityType: "approvals",
      entityId: approval.id,
      entityLabel: approval.title,
      summary: `Approval ${params.status}${params.note === null ? "" : `: ${params.note}`}`,
      beforeData: { status: "pending" },
      afterData: { status: params.status },
      agentRunId: approval.requestedByRunId,
      approvalId: approval.id,
    });
    this.logger.log({
      level: "info",
      event: "agent.approval.decided",
      at: decidedAt,
      ...(approval.requestedByRunId === null
        ? {}
        : { runId: approval.requestedByRunId }),
      fields: {
        approvalId: approval.id,
        status: params.status,
        decidedBy: params.decidedBy,
        note: params.note,
      },
    });
    return approval;
  }

  async get(approvalId: string): Promise<ApprovalRecord | null> {
    return this.store.getApproval(approvalId);
  }

  /** The founder's inbox: every pending decision, highest risk first. */
  async pending(limit?: number): Promise<ApprovalRecord[]> {
    const rows = await this.store.listApprovals({
      status: ["pending"],
      ...(limit === undefined ? {} : { limit }),
    });
    const order: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return rows.sort((left, right) => {
      const byRisk = (order[left.risk] ?? 9) - (order[right.risk] ?? 9);
      return byRisk !== 0
        ? byRisk
        : Date.parse(left.requestedAt) - Date.parse(right.requestedAt);
    });
  }

  /**
   * Turn an approved row into a capability.
   *
   * This is the ONLY caller of `mintEffectGrant` in the runtime. It re-reads the
   * row from the store first, so an approval revoked between the decision and
   * the execution still blocks the call.
   */
  async grantFor(params: {
    readonly approvalId: string;
    readonly runId: string;
    readonly toolName: string;
    readonly input: unknown;
  }): Promise<EffectGrant> {
    const approval = await this.store.getApproval(params.approvalId);
    if (approval === null) {
      throw new ApprovalGateError(
        "approval_not_approved",
        `Approval ${params.approvalId} does not exist; nothing can be granted.`,
        { approvalId: params.approvalId, tool: params.toolName },
      );
    }
    return mintEffectGrant({
      approval,
      runId: params.runId,
      toolName: params.toolName,
      input: params.input,
      now: this.clock.now(),
    });
  }

  /** Stamp an approved row as carried out, with what happened. */
  async markApplied(
    approvalId: string,
    result: JsonValue,
  ): Promise<ApprovalRecord> {
    return this.store.markApprovalApplied(
      approvalId,
      this.clock.now().toISOString(),
      result,
    );
  }
}
