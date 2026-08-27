/**
 * Failure taxonomy for the admin gate.
 *
 * The distinction between these reasons exists for `audit_log` and for the
 * server console. It is deliberately NOT surfaced to the client: every failed
 * sign-in produces the same status, the same body and the same elapsed time,
 * so the response cannot be used as an oracle for which door is shut.
 */
export const LOGIN_FAILURE_REASONS = [
  "invalid_request",
  "csrf_failed",
  "cross_site",
  "rate_limited",
  "locked_out",
  "bad_password",
  "factor_failed",
  "factor_challenge",
  "not_configured",
  "server_error",
] as const;

export type LoginFailureReason = (typeof LOGIN_FAILURE_REASONS)[number];

/**
 * The single message the client ever sees for a failed sign-in.
 *
 * It names no field, no account and no throttle state. The second sentence is a
 * constant, shown on every failure, so the founder knows lockout exists without
 * an attacker learning whether it has engaged.
 */
export const GENERIC_LOGIN_FAILURE_MESSAGE =
  "Sign in failed. Repeated failures temporarily disable sign in.";

/** Raised when required auth configuration is missing or malformed. */
export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

/**
 * Raised when a request reaching a protected surface is not authenticated.
 * Carries no detail: callers turn it into a redirect, not a diagnostic.
 */
export class NotAuthenticatedError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

/** Raised when a state-changing admin request fails its CSRF check. */
export class CsrfError extends Error {
  constructor(message = "CSRF validation failed") {
    super(message);
    this.name = "CsrfError";
  }
}
