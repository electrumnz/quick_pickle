import { buildLoginAuditEntry } from "./audit";
import type { Clock } from "./clock";
import type { ThrottlePolicy } from "./config";
import { verifyLoginCsrf } from "./csrf";
import { verifyPassword } from "./crypto/argon2";
import type { Bytes } from "./crypto/encoding";
import { randomRequestId } from "./crypto/random";
import type { LoginFailureReason } from "./errors";
import { runFactorChain } from "./factors/registry";
import type { AuthFactor, FactorChallenge } from "./factors/types";
import { createSession } from "./session";
import type { AuthStore, OperatorRow, ThrottleRow } from "./store/types";
import { evaluateThrottle, latestLockout, recordAttempt } from "./throttle";

/**
 * The sign-in flow.
 *
 * HTTP-free on purpose: this function takes a description of an attempt and
 * returns a description of the outcome, so the whole policy — throttle,
 * password, factor chain, session minting, audit — is exercised directly by
 * tests, including the thousand-attempt lockout run, without a server.
 *
 * Ordering is a security decision, not an aesthetic one:
 *
 *   1. origin, then CSRF — refused before anything is read or written, and
 *      deliberately NOT counted against the throttle. Neither can ever become a
 *      successful guess, so counting them would buy nothing while handing any
 *      website on the internet a way to lock the founder out of her own
 *      business by making her browser POST here.
 *   2. throttle — checked before the password is hashed. A locked-out request
 *      must not cost 19 MiB and 85 ms of server CPU, or the lockout becomes an
 *      amplifier rather than a defence.
 *   3. password — argon2id, constant-time.
 *   4. factor chain — every enrolled factor, every time.
 *   5. session — only now does a row or a cookie exist.
 *
 * Every path, including every early refusal, ends in one `audit_log` row and
 * one response that took the same wall-clock time as every other. See
 * {@link LOGIN_MIN_RESPONSE_MS}.
 */

export type LoginAttemptInput = {
  /** The submitted password. Never logged, never stored, never echoed. */
  readonly password: string;
  /** Token from the form's hidden field. */
  readonly csrfToken: string | undefined;
  /** Sealed CSRF cookie presented with the request. */
  readonly csrfCookie: string | undefined;
  /** Remaining form fields, for any enrolled factor. Password and CSRF removed. */
  readonly factorFields: ReadonlyMap<string, string>;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  /** Result of the `Origin`/`Sec-Fetch-Site` check. */
  readonly sameOrigin: boolean;
};

export type LoginDependencies = {
  readonly store: AuthStore;
  readonly clock: Clock;
  readonly policy: ThrottlePolicy;
  readonly factors: readonly AuthFactor[];
  readonly sessionSecret: Bytes;
  /** Argon2id PHC string from the environment. */
  readonly passwordHash: string | null;
  readonly ownerEmail: string;
  readonly ownerName: string;
  /** Wall-clock floor applied to every outcome. */
  readonly minResponseMs: number;
  /** Whether forwarded-for headers may be believed when identifying the client. */
  readonly trustProxyHeaders: boolean;
};

export type LoginResult =
  | {
      readonly kind: "success";
      readonly requestId: string;
      readonly sessionId: string;
      readonly cookieValue: string;
      readonly expiresAt: Date;
      readonly operator: OperatorRow;
    }
  | {
      readonly kind: "challenge";
      readonly requestId: string;
      readonly factorId: string;
      readonly challenge: FactorChallenge;
    }
  | {
      readonly kind: "failure";
      readonly requestId: string;
      readonly reason: LoginFailureReason;
    };

/** Field names stripped before the remainder is handed to the factor chain. */
export const RESERVED_LOGIN_FIELDS: readonly string[] = [
  "password",
  "csrf_token",
];

export async function attemptLogin(
  deps: LoginDependencies,
  input: LoginAttemptInput,
): Promise<LoginResult> {
  const startedAt = deps.clock.now();
  const requestId = randomRequestId();
  const ipSubject = input.ipAddress ?? "unknown";

  let result: LoginResult;
  try {
    result = await runAttempt(deps, input, requestId, ipSubject);
  } catch (cause) {
    // A store outage must fail closed and must not leak its shape to the client.
    console.error(
      `[admin-auth] sign-in aborted (request ${requestId}):`,
      cause instanceof Error ? cause.name : "unknown error",
    );
    result = { kind: "failure", requestId, reason: "server_error" };
  }

  await applyResponseFloor(deps, startedAt);
  return result;
}

/**
 * Pad the attempt out to a fixed wall-clock duration.
 *
 * This is what removes the timing oracle. Internally the paths differ wildly —
 * a lockout does no hashing at all, a wrong password does 85 ms of it — but
 * from outside every outcome takes the same time, so response latency tells an
 * attacker nothing about which door is shut. The floor sits above the slowest
 * internal path so it is a floor and not a race.
 */
async function applyResponseFloor(
  deps: LoginDependencies,
  startedAt: Date,
): Promise<void> {
  const elapsed = deps.clock.now().getTime() - startedAt.getTime();
  await deps.clock.sleep(deps.minResponseMs - elapsed);
}

async function runAttempt(
  deps: LoginDependencies,
  input: LoginAttemptInput,
  requestId: string,
  ipSubject: string,
): Promise<LoginResult> {
  const now = deps.clock.now();

  const audit = async (
    reason: LoginFailureReason,
    counters: { ip: ThrottleRow | null; global: ThrottleRow | null },
  ): Promise<LoginResult> => {
    await deps.store.writeAudit(
      buildLoginAuditEntry(
        { kind: "failure", reason },
        {
          now: deps.clock.now(),
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          requestId,
          ipFailureCount: counters.ip?.consecutiveFailures ?? null,
          globalFailureCount: counters.global?.consecutiveFailures ?? null,
          lockedUntil: latestLockout(counters.ip, counters.global),
        },
        null,
      ),
    );
    return { kind: "failure", requestId, reason };
  };

  const empty = { ip: null, global: null };

  if (!input.sameOrigin) {
    return audit("cross_site", empty);
  }

  const csrfOk = await verifyLoginCsrf({
    secret: deps.sessionSecret,
    cookieValue: input.csrfCookie,
    submitted: input.csrfToken,
    now,
  });
  if (!csrfOk) {
    return audit("csrf_failed", empty);
  }

  if (deps.passwordHash === null) {
    return audit("not_configured", empty);
  }

  const snapshot = await evaluateThrottle({
    store: deps.store,
    policy: deps.policy,
    ipSubject,
    now,
  });

  if (snapshot.refusal !== null) {
    // Refused attempts still consume budget: hammering a shut door must cost
    // the attacker more, not nothing.
    const counters = await recordAttempt({
      store: deps.store,
      policy: deps.policy,
      ipSubject,
      failed: true,
      now,
    });
    return audit(
      snapshot.refusal.kind === "locked_out" ? "locked_out" : "rate_limited",
      counters,
    );
  }

  const passwordOk = await verifyPassword(input.password, deps.passwordHash);
  if (!passwordOk) {
    const counters = await recordAttempt({
      store: deps.store,
      policy: deps.policy,
      ipSubject,
      failed: true,
      now,
    });
    return audit("bad_password", counters);
  }

  const operator = await deps.store.ensureOwnerOperator({
    email: deps.ownerEmail,
    fullName: deps.ownerName,
    now,
  });

  const chain = await runFactorChain(deps.factors, {
    operator: { id: operator.id, email: operator.email },
    submitted: input.factorFields,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    requestId,
    now,
  });

  if (chain.kind === "failed") {
    const counters = await recordAttempt({
      store: deps.store,
      policy: deps.policy,
      ipSubject,
      failed: true,
      now,
    });
    return audit("factor_failed", counters);
  }

  if (chain.kind === "challenge") {
    // Not a failure: the password was right and the factor simply wants more.
    // No budget is consumed, and no session exists yet.
    await deps.store.writeAudit(
      buildLoginAuditEntry(
        { kind: "failure", reason: "factor_challenge" },
        {
          now: deps.clock.now(),
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          requestId,
          ipFailureCount: null,
          globalFailureCount: null,
          lockedUntil: null,
        },
        null,
      ),
    );
    return {
      kind: "challenge",
      requestId,
      factorId: chain.factorId,
      challenge: chain.challenge,
    };
  }

  const session = await createSession({
    store: deps.store,
    secret: deps.sessionSecret,
    operatorId: operator.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    deviceLabel: null,
    now,
  });

  await recordAttempt({
    store: deps.store,
    policy: deps.policy,
    ipSubject,
    failed: false,
    now,
  });

  await deps.store.writeAudit(
    buildLoginAuditEntry(
      { kind: "success", sessionId: session.row.id },
      {
        now: deps.clock.now(),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        requestId,
        ipFailureCount: 0,
        globalFailureCount: 0,
        lockedUntil: null,
      },
      { id: operator.id, fullName: operator.fullName },
    ),
  );

  return {
    kind: "success",
    requestId,
    sessionId: session.row.id,
    cookieValue: session.cookieValue,
    expiresAt: session.expiresAt,
    operator,
  };
}
