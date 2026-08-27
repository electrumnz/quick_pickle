import type { LoginFailureReason } from "./errors";
import type { AuditEntry } from "./store/types";

/**
 * Audit records for the admin gate.
 *
 * Every login attempt lands in `public.audit_log` — the successful one, the
 * mistyped one, the thousandth one from a script, and the ones refused before
 * the password was even hashed. That table is append-only by design, so it is
 * the record that survives an attacker who gets far enough to clear the
 * throttle counters.
 *
 * What is never written here: the password, the password hash, the session
 * token, the CSRF token, or any prefix of any of them.
 */

/** Mirrors `public.actor_type`. */
export type ActorType = "operator" | "agent" | "customer" | "system";

/** The subset of `public.audit_action` this package emits. */
export type AuditAction = "login" | "logout";

const ENTITY_TYPE_SESSION = "admin_session";

/** Outcome recorded on every login attempt. */
export type LoginOutcome =
  | { readonly kind: "success"; readonly sessionId: string }
  | { readonly kind: "failure"; readonly reason: LoginFailureReason };

export type LoginAuditContext = {
  readonly now: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
  /** Throttle counters after the attempt, for forensics on the row itself. */
  readonly ipFailureCount: number | null;
  readonly globalFailureCount: number | null;
  readonly lockedUntil: Date | null;
};

/**
 * Build the audit row for one login attempt.
 *
 * Failures are attributed to `system` rather than to an operator: with a
 * password-only door there is no claimed identity to attribute them to, and
 * inventing one would be the beginning of a user-enumeration surface.
 */
export function buildLoginAuditEntry(
  outcome: LoginOutcome,
  context: LoginAuditContext,
  operator: { readonly id: string; readonly fullName: string } | null,
): AuditEntry {
  const succeeded = outcome.kind === "success";
  return {
    occurredAt: context.now,
    actorType: succeeded ? "operator" : "system",
    actorId: succeeded && operator !== null ? operator.id : null,
    actorLabel:
      succeeded && operator !== null ? operator.fullName : "unauthenticated",
    action: "login",
    entityType: ENTITY_TYPE_SESSION,
    entityId: outcome.kind === "success" ? outcome.sessionId : null,
    entityLabel: succeeded ? "admin session opened" : "admin login refused",
    summary: succeeded
      ? "Admin signed in with the shared password."
      : `Admin sign-in refused (${outcome.reason}).`,
    afterData: {
      outcome: outcome.kind,
      reason: outcome.kind === "failure" ? outcome.reason : null,
      ipConsecutiveFailures: context.ipFailureCount,
      globalConsecutiveFailures: context.globalFailureCount,
      lockedUntil: context.lockedUntil?.toISOString() ?? null,
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
  };
}

/** Build the audit row for a sign-out or a server-side revocation. */
export function buildLogoutAuditEntry(input: {
  readonly now: Date;
  readonly sessionId: string | null;
  readonly operator: { readonly id: string; readonly fullName: string } | null;
  readonly reason: string;
  readonly revokedCount: number;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
}): AuditEntry {
  return {
    occurredAt: input.now,
    actorType: input.operator === null ? "system" : "operator",
    actorId: input.operator?.id ?? null,
    actorLabel: input.operator?.fullName ?? "system",
    action: "logout",
    entityType: ENTITY_TYPE_SESSION,
    entityId: input.sessionId,
    entityLabel: "admin session revoked",
    summary: `Admin session revoked (${input.reason}); ${String(input.revokedCount)} session(s) affected.`,
    afterData: {
      reason: input.reason,
      revokedCount: input.revokedCount,
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    requestId: input.requestId,
  };
}

export { ENTITY_TYPE_SESSION };
