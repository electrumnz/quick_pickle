import "server-only";

import { systemClock } from "./clock";
import {
  DEFAULT_THROTTLE_POLICY,
  LOGIN_MIN_RESPONSE_MS,
  getOwnerOperatorEmail,
  getOwnerOperatorName,
  getSessionSecret,
  isAdminPasswordConfigured,
  getAdminPasswordHash,
  trustsProxyHeaders,
} from "./config";
import { REGISTERED_FACTORS } from "./factors/registry";
import type { LoginDependencies } from "./login";
import { getAuthStore } from "./store/pg";

/**
 * Wiring: environment and singletons into the plain objects the pure layers take.
 *
 * Everything below this line in the package is dependency-injected — the login
 * flow, the throttle, the session layer and both route handlers accept their
 * store, clock, policy and secrets as arguments. This file is the only place
 * that reads `process.env` and the only place that reaches for a connection
 * pool, which is what lets the test suite run the identical code against a real
 * Postgres and a controlled clock.
 */

/** Origins accepted on state-changing admin requests. */
export function allowedOrigins(): readonly string[] {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured === undefined || configured === "") return [];
  try {
    return [new URL(configured).origin];
  } catch {
    return [];
  }
}

/** Dependencies for the sign-in flow. */
export function loginDependencies(): LoginDependencies {
  return {
    store: getAuthStore(),
    clock: systemClock,
    policy: DEFAULT_THROTTLE_POLICY,
    factors: REGISTERED_FACTORS,
    sessionSecret: getSessionSecret(),
    passwordHash: isAdminPasswordConfigured() ? getAdminPasswordHash() : null,
    ownerEmail: getOwnerOperatorEmail(),
    ownerName: getOwnerOperatorName(),
    minResponseMs: LOGIN_MIN_RESPONSE_MS,
    trustProxyHeaders: trustsProxyHeaders(),
  };
}

/** Dependencies for the guard and the sign-out handler. */
export function sessionDependencies(): {
  readonly store: ReturnType<typeof getAuthStore>;
  readonly sessionSecret: ReturnType<typeof getSessionSecret>;
  readonly clock: typeof systemClock;
  readonly allowedOrigins: readonly string[];
  readonly trustProxyHeaders: boolean;
} {
  return {
    store: getAuthStore(),
    sessionSecret: getSessionSecret(),
    clock: systemClock,
    allowedOrigins: allowedOrigins(),
    trustProxyHeaders: trustsProxyHeaders(),
  };
}
