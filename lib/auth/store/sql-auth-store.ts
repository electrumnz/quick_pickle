import type { SqlClient, SqlRow } from "./sql-client";
import type {
  AdminSessionRow,
  AuditEntry,
  AuthStore,
  CreateSessionInput,
  OperatorRow,
  PurgeResult,
  RegisterAttemptInput,
  ThrottleRow,
  ThrottleScope,
} from "./types";

/**
 * The one implementation of {@link AuthStore}.
 *
 * Every statement is written once here and executed verbatim against Supabase
 * in production and against PGlite in the test suite, so the throttle policy,
 * the session lifecycle and the audit trail are all exercised as real SQL
 * against the real schema rather than against a stand-in.
 *
 * Parameters are bound with explicit casts and ISO strings rather than relying
 * on either driver's inference, because the two drivers do not infer alike and
 * a silent difference between test and production is precisely the class of bug
 * this arrangement exists to remove.
 */
export class SqlAuthStore implements AuthStore {
  constructor(private readonly sql: SqlClient) {}

  async registerAttempt(input: RegisterAttemptInput): Promise<ThrottleRow> {
    const { rows } = await this.sql.query(
      `select scope, subject, consecutive_failures, total_failures,
              total_attempts, last_failure_at, last_success_at,
              locked_until, lock_count
         from public.admin_auth_register_attempt(
           $1::text, $2::text, $3::boolean, $4::timestamptz,
           $5::double precision, $6::integer,
           $7::double precision, $8::double precision)`,
      [
        input.scope,
        input.subject,
        input.failed,
        input.now.toISOString(),
        input.windowMs / 1000,
        input.lockThreshold,
        input.baseLockMs / 1000,
        input.maxLockMs / 1000,
      ],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error("admin_auth_register_attempt returned no row");
    }
    return toThrottleRow(row);
  }

  async readThrottle(
    scope: ThrottleScope,
    subject: string,
  ): Promise<ThrottleRow | null> {
    const { rows } = await this.sql.query(
      `select scope, subject, consecutive_failures, total_failures,
              total_attempts, last_failure_at, last_success_at,
              locked_until, lock_count
         from public.admin_auth_throttle
        where scope = $1::text and subject = $2::text`,
      [scope, subject],
    );
    const row = rows[0];
    return row === undefined ? null : toThrottleRow(row);
  }

  async ensureOwnerOperator(input: {
    readonly email: string;
    readonly fullName: string;
    readonly now: Date;
  }): Promise<OperatorRow> {
    const existing = await this.sql.query(
      `select id, email, full_name, role, is_active
         from public.operators
        where is_active and role = 'owner'
        order by created_at asc
        limit 1`,
    );
    const found = existing.rows[0];
    if (found !== undefined) return toOperatorRow(found);

    const created = await this.sql.query(
      `insert into public.operators (email, full_name, role, is_active, created_at, updated_at)
       values ($1::text, $2::text, 'owner', true, $3::timestamptz, $3::timestamptz)
       on conflict do nothing
       returning id, email, full_name, role, is_active`,
      [input.email, input.fullName, input.now.toISOString()],
    );
    const inserted = created.rows[0];
    if (inserted !== undefined) return toOperatorRow(inserted);

    // Lost a race, or the email already belongs to a non-owner row.
    const fallback = await this.sql.query(
      `select id, email, full_name, role, is_active
         from public.operators
        where lower(email) = lower($1::text)
        limit 1`,
      [input.email],
    );
    const resolved = fallback.rows[0];
    if (resolved === undefined) {
      throw new Error("Could not resolve or create the owner operator row");
    }
    return toOperatorRow(resolved);
  }

  async createSession(input: CreateSessionInput): Promise<AdminSessionRow> {
    const { rows } = await this.sql.query(
      `insert into public.admin_sessions (
         operator_id, session_token_hash, started_at, last_active_at,
         expires_at, ip_address, user_agent, device_label,
         created_at, updated_at)
       values ($1::uuid, $2::text, $3::timestamptz, $3::timestamptz,
               $4::timestamptz, $5::inet, $6::text, $7::text,
               $3::timestamptz, $3::timestamptz)
       returning ${SESSION_COLUMNS}`,
      [
        input.operatorId,
        input.sessionTokenHash,
        input.startedAt.toISOString(),
        input.expiresAt.toISOString(),
        input.ipAddress,
        input.userAgent,
        input.deviceLabel,
      ],
    );
    const row = rows[0];
    if (row === undefined) throw new Error("Session insert returned no row");
    return toSessionRow(row);
  }

  async findSessionById(id: string): Promise<AdminSessionRow | null> {
    if (!UUID_PATTERN.test(id)) return null;
    const { rows } = await this.sql.query(
      `select ${SESSION_COLUMNS} from public.admin_sessions where id = $1::uuid`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : toSessionRow(row);
  }

  async touchSession(input: {
    readonly id: string;
    readonly lastActiveAt: Date;
    readonly expiresAt: Date;
  }): Promise<void> {
    await this.sql.query(
      `update public.admin_sessions
          set last_active_at = $2::timestamptz,
              expires_at     = $3::timestamptz,
              updated_at     = $2::timestamptz
        where id = $1::uuid and revoked_at is null`,
      [
        input.id,
        input.lastActiveAt.toISOString(),
        input.expiresAt.toISOString(),
      ],
    );
  }

  async revokeSession(input: {
    readonly id: string;
    readonly at: Date;
    readonly reason: string;
  }): Promise<number> {
    if (!UUID_PATTERN.test(input.id)) return 0;
    const { rows } = await this.sql.query(
      `update public.admin_sessions
          set revoked_at = $2::timestamptz,
              revoked_reason = $3::text,
              updated_at = $2::timestamptz
        where id = $1::uuid and revoked_at is null
        returning id`,
      [input.id, input.at.toISOString(), input.reason],
    );
    return rows.length;
  }

  async revokeAllSessions(input: {
    readonly operatorId: string;
    readonly at: Date;
    readonly reason: string;
  }): Promise<number> {
    const { rows } = await this.sql.query(
      `update public.admin_sessions
          set revoked_at = $2::timestamptz,
              revoked_reason = $3::text,
              updated_at = $2::timestamptz
        where operator_id = $1::uuid and revoked_at is null
        returning id`,
      [input.operatorId, input.at.toISOString(), input.reason],
    );
    return rows.length;
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    await this.sql.query(
      `insert into public.audit_log (
         occurred_at, actor_type, actor_id, actor_label, action,
         entity_type, entity_id, entity_label, summary, after_data,
         ip_address, user_agent, request_id)
       values ($1::timestamptz, $2::public.actor_type, $3::uuid, $4::text,
               $5::public.audit_action, $6::text, $7::uuid, $8::text, $9::text,
               $10::jsonb, $11::inet, $12::text, $13::text)`,
      [
        entry.occurredAt.toISOString(),
        entry.actorType,
        entry.actorId,
        entry.actorLabel,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.entityLabel,
        entry.summary,
        entry.afterData === null ? null : JSON.stringify(entry.afterData),
        entry.ipAddress,
        entry.userAgent,
        entry.requestId,
      ],
    );
  }

  async countAudit(input: {
    readonly entityType: string;
    readonly since?: Date;
  }): Promise<number> {
    const { rows } = await this.sql.query(
      `select count(*) as total
         from public.audit_log
        where entity_type = $1::text
          and ($2::timestamptz is null or occurred_at >= $2::timestamptz)`,
      [input.entityType, input.since?.toISOString() ?? null],
    );
    return toNumber(rows[0]?.total);
  }

  async purge(now: Date, retentionMs: number): Promise<PurgeResult> {
    const { rows } = await this.sql.query(
      `select throttle_rows_deleted, sessions_expired
         from public.admin_auth_purge($1::timestamptz, $2::double precision)`,
      [now.toISOString(), retentionMs / 1000],
    );
    const row = rows[0];
    return {
      throttleRowsDeleted: toNumber(row?.throttle_rows_deleted),
      sessionsExpired: toNumber(row?.sessions_expired),
    };
  }

  async close(): Promise<void> {
    await this.sql.close();
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SESSION_COLUMNS = `id, operator_id, session_token_hash, started_at,
              last_active_at, expires_at, revoked_at, revoked_reason,
              ip_address, user_agent, device_label`;

/** `bigint` arrives as a string from `pg` and as a number from PGlite. */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number.parseInt(value, 10);
  return 0;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  return null;
}

function requireDate(value: unknown, column: string): Date {
  const parsed = toDate(value);
  if (parsed === null) throw new Error(`Expected a timestamp in ${column}`);
  return parsed;
}

function toText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requireText(value: unknown, column: string): string {
  const text = toText(value);
  if (text === null) throw new Error(`Expected text in ${column}`);
  return text;
}

function toThrottleRow(row: SqlRow): ThrottleRow {
  const scope = requireText(row.scope, "scope");
  return {
    scope: scope === "global" ? "global" : "ip",
    subject: requireText(row.subject, "subject"),
    consecutiveFailures: toNumber(row.consecutive_failures),
    totalFailures: toNumber(row.total_failures),
    totalAttempts: toNumber(row.total_attempts),
    lastFailureAt: toDate(row.last_failure_at),
    lastSuccessAt: toDate(row.last_success_at),
    lockedUntil: toDate(row.locked_until),
    lockCount: toNumber(row.lock_count),
  };
}

function toOperatorRow(row: SqlRow): OperatorRow {
  return {
    id: requireText(row.id, "id"),
    email: requireText(row.email, "email"),
    fullName: requireText(row.full_name, "full_name"),
    role: requireText(row.role, "role"),
    isActive: row.is_active === true,
  };
}

function toSessionRow(row: SqlRow): AdminSessionRow {
  return {
    id: requireText(row.id, "id"),
    operatorId: requireText(row.operator_id, "operator_id"),
    sessionTokenHash: requireText(row.session_token_hash, "session_token_hash"),
    startedAt: requireDate(row.started_at, "started_at"),
    lastActiveAt: requireDate(row.last_active_at, "last_active_at"),
    expiresAt: requireDate(row.expires_at, "expires_at"),
    revokedAt: toDate(row.revoked_at),
    revokedReason: toText(row.revoked_reason),
    ipAddress: toText(row.ip_address),
    userAgent: toText(row.user_agent),
    deviceLabel: toText(row.device_label),
  };
}
