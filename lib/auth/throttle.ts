import type { ThrottleScopePolicy, ThrottlePolicy } from "./config";
import type { AuthStore, ThrottleRow, ThrottleScope } from "./store/types";

/**
 * Rate limiting for the admin gate.
 *
 * Two independent budgets are kept, both in Postgres:
 *
 *   per-IP    catches the single script hammering the door
 *   global    catches the same script spread across a botnet, or one that
 *             spoofs `X-Forwarded-For` to land in a fresh per-IP bucket every
 *             request — a per-IP limit alone is trivially defeated that way
 *
 * Each budget has two teeth. First an **escalating delay**: after a few free
 * attempts, a subject must wait 1s, then 2s, 4s, 8s... between tries, so an
 * online guessing rate collapses from thousands per second to a handful per
 * minute. Then a **hard lockout**: at the threshold the subject is refused
 * outright for a window that doubles with each lockout it earns, up to a day.
 *
 * The counters live in `public.admin_auth_throttle` rather than in module
 * scope. On Vercel the login function's module scope dies with the container,
 * so an in-memory counter would reset on every cold start — and an attacker who
 * can provoke cold starts has an unlimited budget. The database is the only
 * place this state is safe.
 */

export const GLOBAL_THROTTLE_SUBJECT = "*";

/** The reason a throttle refuses an attempt, or `null` when it does not. */
export type ThrottleRefusal =
  | {
      readonly kind: "locked_out";
      readonly scope: ThrottleScope;
      readonly until: Date;
    }
  | {
      readonly kind: "rate_limited";
      readonly scope: ThrottleScope;
      readonly retryAt: Date;
    };

export type ThrottleSnapshot = {
  readonly ip: ThrottleRow | null;
  readonly global: ThrottleRow | null;
  readonly refusal: ThrottleRefusal | null;
};

/**
 * How long a subject must wait after `consecutiveFailures` before the next
 * attempt is even considered.
 *
 * Doubles per failure past the free allowance and is capped, so a mistyped
 * password twice costs nothing while a script pays exponentially.
 */
export function escalatingDelayMs(
  consecutiveFailures: number,
  policy: ThrottleScopePolicy,
): number {
  const excess = consecutiveFailures - policy.freeAttempts;
  if (excess <= 0) return 0;
  const scaled = policy.baseDelayMs * Math.pow(2, excess - 1);
  return Math.min(policy.maxDelayMs, scaled);
}

function refusalFor(
  row: ThrottleRow | null,
  scope: ThrottleScope,
  policy: ThrottleScopePolicy,
  now: Date,
): ThrottleRefusal | null {
  if (row === null) return null;

  if (row.lockedUntil !== null && row.lockedUntil.getTime() > now.getTime()) {
    return { kind: "locked_out", scope, until: row.lockedUntil };
  }

  if (row.lastFailureAt === null) return null;

  // A lapsed window means the recorded failures no longer count against the
  // subject, so neither does the delay they earned.
  const windowLapsed =
    now.getTime() - row.lastFailureAt.getTime() >= policy.windowMs;
  if (windowLapsed) return null;

  const wait = escalatingDelayMs(row.consecutiveFailures, policy);
  if (wait <= 0) return null;

  const retryAt = new Date(row.lastFailureAt.getTime() + wait);
  if (retryAt.getTime() <= now.getTime()) return null;
  return { kind: "rate_limited", scope, retryAt };
}

/**
 * Read both budgets and decide whether this attempt may proceed.
 *
 * Read-only: nothing is recorded here, because an attempt that is refused is
 * still recorded afterwards by {@link recordAttempt} — being refused must cost
 * the attacker budget, or the lockout could be waited out for free.
 */
export async function evaluateThrottle(input: {
  readonly store: AuthStore;
  readonly policy: ThrottlePolicy;
  readonly ipSubject: string;
  readonly now: Date;
}): Promise<ThrottleSnapshot> {
  const [ip, global] = await Promise.all([
    input.store.readThrottle("ip", input.ipSubject),
    input.store.readThrottle("global", GLOBAL_THROTTLE_SUBJECT),
  ]);

  // Lockout outranks delay, and the per-IP budget is checked first so that the
  // common case — one attacker, one address — reports the tighter of the two.
  const refusal =
    refusalFor(ip, "ip", input.policy.ip, input.now) ??
    refusalFor(global, "global", input.policy.global, input.now);

  return { ip, global, refusal };
}

/**
 * Record the outcome of one attempt against both budgets.
 *
 * Called for every attempt without exception, including ones refused before the
 * password was looked at, so that hammering a locked door digs the hole deeper
 * rather than costing nothing.
 */
export async function recordAttempt(input: {
  readonly store: AuthStore;
  readonly policy: ThrottlePolicy;
  readonly ipSubject: string;
  readonly failed: boolean;
  readonly now: Date;
}): Promise<{ readonly ip: ThrottleRow; readonly global: ThrottleRow }> {
  const ip = await input.store.registerAttempt({
    scope: "ip",
    subject: input.ipSubject,
    failed: input.failed,
    now: input.now,
    windowMs: input.policy.ip.windowMs,
    lockThreshold: input.policy.ip.lockThreshold,
    baseLockMs: input.policy.ip.baseLockMs,
    maxLockMs: input.policy.ip.maxLockMs,
  });
  const global = await input.store.registerAttempt({
    scope: "global",
    subject: GLOBAL_THROTTLE_SUBJECT,
    failed: input.failed,
    now: input.now,
    windowMs: input.policy.global.windowMs,
    lockThreshold: input.policy.global.lockThreshold,
    baseLockMs: input.policy.global.baseLockMs,
    maxLockMs: input.policy.global.maxLockMs,
  });
  return { ip, global };
}

/** The later of the two budgets' lockouts, for the audit row. */
export function latestLockout(
  ip: ThrottleRow | null,
  global: ThrottleRow | null,
): Date | null {
  const candidates = [ip?.lockedUntil, global?.lockedUntil].filter(
    (value): value is Date => value instanceof Date,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, value) =>
    value.getTime() > latest.getTime() ? value : latest,
  );
}
