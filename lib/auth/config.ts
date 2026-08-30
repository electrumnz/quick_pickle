import "server-only";

import {
  demoOpensAdmin,
  isDemoMode,
  resolveDatabaseUrl,
} from "@/lib/demo/mode";

import type { Bytes } from "./crypto/encoding";
import { AuthConfigError } from "./errors";

/**
 * Configuration for the admin gate.
 *
 * HALF SOUR is a one-person business and the founder asked, knowingly, for a
 * single password on the front door. Everything here is therefore built so the
 * password is the *only* thing that is simple: the hash never leaves the
 * environment, the session is server-side and revocable, the throttle is
 * durable, and the second-factor chain already exists and already runs.
 *
 * Nothing in this file is read at module scope. Every value is resolved on
 * demand so that a missing variable is a runtime failure on the login path
 * rather than a build failure on an unrelated page, and so tests can vary the
 * environment between cases.
 */

// --- Cookie names ------------------------------------------------------------
//
// The `__Host-` prefix is not decoration. A browser will only accept it when the
// cookie is Secure, Path=/ and carries no Domain attribute, which means a
// sibling subdomain — including one an attacker gets control of — cannot write
// a cookie that our own origin will read back. Chrome and Firefox both treat
// http://localhost as a secure context, so this holds in local development too.

/** Sealed admin session cookie. */
export const SESSION_COOKIE_NAME = "__Host-half_sour_admin";

/** Sealed anti-CSRF cookie issued alongside the login form. */
export const LOGIN_CSRF_COOKIE_NAME = "__Host-half_sour_login_csrf";

/** Form field and header carrying the CSRF token counterpart. */
export const CSRF_FIELD_NAME = "csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

/** Form field carrying the password. The only credential field on the form. */
export const PASSWORD_FIELD_NAME = "password";

/** Query parameter recording where the visitor was heading before the gate. */
export const RETURN_TO_PARAM = "next";

// --- Routes ------------------------------------------------------------------

export const LOGIN_PATH = "/login";
export const LOGIN_SUBMIT_PATH = "/login/session";
export const LOGOUT_PATH = "/login/session/revoke";
export const ADMIN_ROOT_PATH = "/admin";

// --- Durations ---------------------------------------------------------------
//
// Named, exported and unit-suffixed so that no duration is a bare number at a
// call site.

/**
 * Floor on how long a login POST takes to answer, whatever happened inside.
 *
 * This is the control that removes the timing oracle. A locked-out attempt does
 * no Argon2 work (refusing to burn 19 MiB and 85 ms of CPU per packet is the
 * whole point of a lockout), a wrong password does; padding every outcome up to
 * a fixed floor means the two are indistinguishable from outside regardless.
 * The floor sits comfortably above the slowest internal path.
 */
export const LOGIN_MIN_RESPONSE_MS = 400;

/** How long a session may sit idle before the cookie and the row both die. */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Hard ceiling on a session regardless of activity. Sliding renewal cannot pass it. */
export const SESSION_ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** Renew the sliding window only once a session is this stale, to avoid a write per request. */
export const SESSION_RENEW_AFTER_MS = 5 * 60 * 1000;

/** Lifetime of the pre-authentication CSRF token attached to the login form. */
export const LOGIN_CSRF_TTL_MS = 60 * 60 * 1000;

// --- Throttle policy ---------------------------------------------------------

export type ThrottleScopePolicy = {
  /** Consecutive failures older than this stop counting. */
  readonly windowMs: number;
  /** Consecutive failures that arm a lockout. */
  readonly lockThreshold: number;
  /** First lockout duration. Each subsequent lockout doubles it. */
  readonly baseLockMs: number;
  /** Ceiling on the doubling. */
  readonly maxLockMs: number;
  /** Failures tolerated before the escalating delay starts biting. */
  readonly freeAttempts: number;
  /** Multiplier for the escalating delay, doubled per failure past `freeAttempts`. */
  readonly baseDelayMs: number;
  /** Ceiling on the escalating delay. */
  readonly maxDelayMs: number;
};

export type ThrottlePolicy = {
  readonly ip: ThrottleScopePolicy;
  readonly global: ThrottleScopePolicy;
  /** Rows quiet for longer than this are eligible for purge. */
  readonly retentionMs: number;
};

/**
 * Two budgets, because either alone is defeated trivially.
 *
 * Per-IP stops the obvious script. Global stops the same script run from a
 * botnet or behind a header-spoofed `X-Forwarded-For`, at the cost of letting a
 * determined attacker lock the founder out for fifteen minutes — an acceptable
 * trade for a door with one password behind it, and the reason the lockout
 * escalates rather than starting long.
 */
export const DEFAULT_THROTTLE_POLICY: ThrottlePolicy = {
  ip: {
    windowMs: 15 * 60 * 1000,
    lockThreshold: 8,
    baseLockMs: 15 * 60 * 1000,
    maxLockMs: 24 * 60 * 60 * 1000,
    freeAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30 * 1000,
  },
  global: {
    windowMs: 60 * 60 * 1000,
    lockThreshold: 40,
    baseLockMs: 5 * 60 * 1000,
    maxLockMs: 60 * 60 * 1000,
    freeAttempts: 20,
    baseDelayMs: 500,
    maxDelayMs: 10 * 1000,
  },
  retentionMs: 30 * 24 * 60 * 60 * 1000,
};

// --- Argon2id parameters -----------------------------------------------------

export type Argon2Params = {
  /** Memory cost in KiB. */
  readonly memoryKib: number;
  /** Time cost (passes). */
  readonly iterations: number;
  /** Lanes. */
  readonly parallelism: number;
  /** Derived key length in bytes. */
  readonly hashLengthBytes: number;
  /** Salt length in bytes. */
  readonly saltLengthBytes: number;
};

/**
 * OWASP's second recommended Argon2id configuration (19 MiB, t=2, p=1).
 *
 * Memory-hard by design: this is the reason the answer is argon2id and not
 * bcrypt, scrypt or anything that a GPU eats for breakfast. Measured at roughly
 * 85 ms per verification on the build machine, which is the right order for an
 * interactive login and an unpleasant one for an offline cracking rig.
 */
export const ARGON2_PARAMS: Argon2Params = {
  memoryKib: 19456,
  iterations: 2,
  parallelism: 1,
  hashLengthBytes: 32,
  saltLengthBytes: 16,
};

// --- Environment -------------------------------------------------------------

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The stored Argon2id PHC string for the admin password.
 *
 * Lives in the environment, never in the database and never in the repository:
 * a database dump of HALF SOUR must not contain anything that can be cracked
 * back into the front-door password. Generate one with
 * `npm run auth:hash-password`.
 */
export function getAdminPasswordHash(): string {
  const value = readEnv("ADMIN_PASSWORD_HASH");
  if (value === undefined) {
    throw new AuthConfigError(
      "ADMIN_PASSWORD_HASH is not set. Run `npm run auth:hash-password` and put the result in the environment.",
    );
  }
  if (!value.startsWith("$argon2id$")) {
    // The value itself is never echoed, here or anywhere else.
    throw new AuthConfigError(
      "ADMIN_PASSWORD_HASH is not an argon2id PHC string. Re-generate it with `npm run auth:hash-password`.",
    );
  }
  return value;
}

/** True when a password hash is configured at all, without revealing it. */
export function isAdminPasswordConfigured(): boolean {
  return readEnv("ADMIN_PASSWORD_HASH")?.startsWith("$argon2id$") === true;
}

/**
 * What the environment is missing, in words, without echoing a single value.
 *
 * The gate fails closed, which is right, and for a while it failed closed onto
 * the login page — including when the request WAS the login page. That is a
 * redirect to itself, and the front door became unopenable: no error, no form,
 * just a loop. Failing closed has to leave one door reachable, and the door has
 * to be able to say why it will not open.
 *
 * Each entry names an environment variable and what to do about it. Nothing
 * here reads a secret's contents beyond the shape check that decides whether it
 * is configured at all.
 */
export function describeAuthConfigGaps(): readonly string[] {
  const gaps: string[] = [];
  const hash = readEnv("ADMIN_PASSWORD_HASH");
  if (hash === undefined) {
    gaps.push(
      "ADMIN_PASSWORD_HASH is not set. Generate one with `npm run auth:hash-password`.",
    );
  } else if (!hash.startsWith("$argon2id$")) {
    // A PHC string is almost all dollar signs, which makes it the single worst
    // shape to put through anything that expands variables. An unquoted shell
    // export or a `.env` line eats `$argon2id`, `$v` and `$m` as empty
    // variables and leaves the parameter tail behind. The value that arrives is
    // wrong in a way that reads as a wrong password, so it is worth naming
    // rather than making someone find it twice.
    const looksExpanded = /(^|[^$])(m=\d+|t=\d+|p=\d+)/.test(hash);
    gaps.push(
      looksExpanded
        ? "ADMIN_PASSWORD_HASH is set but has had its `$` segments eaten by variable expansion — the argon2id parameters are there and the `$argon2id$v=19$` prefix is not. Wrap the value in SINGLE quotes, or paste it into the hosting dashboard rather than a shell."
        : "ADMIN_PASSWORD_HASH is set but is not an argon2id PHC string. Re-generate it with `npm run auth:hash-password`.",
    );
  }

  const secret = readEnv("ADMIN_SESSION_SECRET");
  if (secret === undefined) {
    gaps.push(
      "ADMIN_SESSION_SECRET is not set. It needs 32 or more random bytes, base64 or hex.",
    );
  } else if (decodeSecret(secret).length < 32) {
    gaps.push(
      "ADMIN_SESSION_SECRET is set but decodes to fewer than 32 bytes.",
    );
  }

  // Demo mode supplies a database and only a database. It does not appear in
  // either branch above and it never will: the two gaps that decide whether
  // anyone can sign in are the password hash and the session secret, and demo
  // mode has nothing to say about them. A deployment running with
  // HALF_SOUR_DEMO=1 and no ADMIN_PASSWORD_HASH still lands on this list and
  // still refuses, which is the intended behaviour and is covered by
  // `tests/demo/switch.test.ts`.
  if (resolveDatabaseUrl() === null) {
    gaps.push(
      "SUPABASE_DB_URL is not set. Sessions are stored in Postgres so they can be revoked, so there is no sign-in without it.",
    );
  }

  return gaps;
}

/**
 * Why the sign-in page is here at all on a deployment that says "Demo".
 *
 * `HALF_SOUR_DEMO=1` normally opens the admin without a password, so a
 * demonstration that presents a password prompt looks broken — and "looks
 * broken" is how an hour gets spent on a gate that is working exactly as
 * designed. It happens for one reason: the deployment also names a real
 * `SUPABASE_DB_URL`, and the open door is only ever opened over the database
 * image compiled into the build. A real database keeps its real gate.
 *
 * Returned as a sentence rather than pushed into {@link describeAuthConfigGaps}
 * on purpose. That list means "nobody can sign in here", and the sign-in page
 * replaces its whole form with it. This is the opposite case: signing in works
 * perfectly, and the form must still be there to sign in with. So this is a
 * note that sits BESIDE the form, and `null` whenever there is nothing to
 * explain — which is every deployment that is not in this one specific state.
 *
 * Names a variable, never a value, exactly as the gap reporter does.
 */
export function describeDemoAdminGate(): string | null {
  if (!isDemoMode()) return null;
  if (demoOpensAdmin()) return null;
  return (
    "This is a demonstration deployment, and on one the admin usually opens " +
    "without a password. It is asking for one because SUPABASE_DB_URL names a " +
    "real database: the open admin is only ever opened over the demonstration " +
    "database built into the deployment, never over a real one. That is " +
    "deliberate, and it is not a fault in this page. Unset SUPABASE_DB_URL to " +
    "run this deployment on the demonstration data, or sign in to reach the " +
    "real one."
  );
}

/**
 * Root key for sealing cookies. 32 bytes minimum, base64 or hex.
 *
 * Rotating it invalidates every outstanding session, which is the intended
 * emergency lever alongside per-row revocation.
 */
export function getSessionSecret(): Bytes {
  const value = readEnv("ADMIN_SESSION_SECRET");
  if (value === undefined) {
    throw new AuthConfigError(
      "ADMIN_SESSION_SECRET is not set. Generate 32+ random bytes and set it in the environment.",
    );
  }
  const bytes = decodeSecret(value);
  if (bytes.length < 32) {
    throw new AuthConfigError(
      `ADMIN_SESSION_SECRET decodes to ${String(bytes.length)} bytes; at least 32 are required.`,
    );
  }
  return bytes;
}

function decodeSecret(value: string): Bytes {
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    return Uint8Array.from(Buffer.from(value, "hex"));
  }
  return Uint8Array.from(Buffer.from(value, "base64"));
}

/**
 * Postgres connection string used by the auth store.
 *
 * In demo mode, and only when nothing else names a database, this is the
 * in-process image's stand-in. What it is not is a way in: the session store it
 * opens is empty of anything a cookie could match, and every sign-in still goes
 * through the same argon2id verification against `ADMIN_PASSWORD_HASH`.
 */
export function getDatabaseUrl(): string {
  const value = resolveDatabaseUrl() ?? undefined;
  if (value === undefined) {
    throw new AuthConfigError(
      "SUPABASE_DB_URL is not set. Admin auth is fail-closed: without a database there is no revocable session store and no durable throttle.",
    );
  }
  return value;
}

/** Email recorded on the founder's `operators` row, created on first sign-in. */
export function getOwnerOperatorEmail(): string {
  return readEnv("ADMIN_OPERATOR_EMAIL") ?? "owner@halfsour.co.nz";
}

/** Display name recorded on the founder's `operators` row. */
export function getOwnerOperatorName(): string {
  return readEnv("ADMIN_OPERATOR_NAME") ?? "Half Sour Owner";
}

/**
 * Whether to believe forwarded-for headers when identifying the client.
 *
 * True behind Vercel, where the edge rewrites them. Spoofing them only shifts
 * an attacker between per-IP buckets — the global budget still applies, which
 * is exactly why the global budget exists.
 */
export function trustsProxyHeaders(): boolean {
  const explicit = readEnv("ADMIN_TRUST_PROXY_HEADERS");
  if (explicit !== undefined) return explicit === "true";
  return process.env.NODE_ENV === "production" || readEnv("VERCEL") === "1";
}
