import type { AuditAction, ActorType } from "../audit";

/** A row of `public.operators`, narrowed to what the gate reads. */
export type OperatorRow = {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: string;
  readonly isActive: boolean;
};

/** A row of `public.admin_sessions`. */
export type AdminSessionRow = {
  readonly id: string;
  readonly operatorId: string;
  readonly sessionTokenHash: string;
  readonly startedAt: Date;
  readonly lastActiveAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedReason: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceLabel: string | null;
};

/** A row of `public.admin_auth_throttle`. */
export type ThrottleRow = {
  readonly scope: ThrottleScope;
  readonly subject: string;
  readonly consecutiveFailures: number;
  readonly totalFailures: number;
  readonly totalAttempts: number;
  readonly lastFailureAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly lockedUntil: Date | null;
  readonly lockCount: number;
};

export type ThrottleScope = "ip" | "global";

export type RegisterAttemptInput = {
  readonly scope: ThrottleScope;
  readonly subject: string;
  readonly failed: boolean;
  readonly now: Date;
  readonly windowMs: number;
  readonly lockThreshold: number;
  readonly baseLockMs: number;
  readonly maxLockMs: number;
};

export type CreateSessionInput = {
  readonly operatorId: string;
  readonly sessionTokenHash: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceLabel: string | null;
};

export type AuditEntry = {
  readonly occurredAt: Date;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly actorLabel: string;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly entityLabel: string | null;
  readonly summary: string;
  readonly afterData: Record<string, unknown> | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
};

export type PurgeResult = {
  readonly throttleRowsDeleted: number;
  readonly sessionsExpired: number;
};

/**
 * Everything the admin gate needs from durable storage.
 *
 * The interface exists so the throttle cannot quietly become an in-process Map:
 * every counter, every session and every audit row crosses this boundary and
 * lands in Postgres, which is what makes the controls survive the serverless
 * cold start that would otherwise reset them.
 */
export interface AuthStore {
  /** Atomically record one attempt against a budget and return the new state. */
  registerAttempt(input: RegisterAttemptInput): Promise<ThrottleRow>;
  /** Read a budget without recording anything. */
  readThrottle(
    scope: ThrottleScope,
    subject: string,
  ): Promise<ThrottleRow | null>;
  /** Find, or idempotently create, the founder's `operators` row. */
  ensureOwnerOperator(input: {
    readonly email: string;
    readonly fullName: string;
    readonly now: Date;
  }): Promise<OperatorRow>;
  createSession(input: CreateSessionInput): Promise<AdminSessionRow>;
  findSessionById(id: string): Promise<AdminSessionRow | null>;
  /** Slide the session window forward. */
  touchSession(input: {
    readonly id: string;
    readonly lastActiveAt: Date;
    readonly expiresAt: Date;
  }): Promise<void>;
  /** Revoke one session. Returns how many rows changed (0 if already revoked). */
  revokeSession(input: {
    readonly id: string;
    readonly at: Date;
    readonly reason: string;
  }): Promise<number>;
  /** Revoke every live session for an operator. Returns how many changed. */
  revokeAllSessions(input: {
    readonly operatorId: string;
    readonly at: Date;
    readonly reason: string;
  }): Promise<number>;
  writeAudit(entry: AuditEntry): Promise<void>;
  /** Count audit rows for an entity type, optionally since a time. */
  countAudit(input: {
    readonly entityType: string;
    readonly since?: Date;
  }): Promise<number>;
  purge(now: Date, retentionMs: number): Promise<PurgeResult>;
  close(): Promise<void>;
}
