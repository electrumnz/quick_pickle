import { ControlledClock } from "@/lib/auth/clock";
import {
  CSRF_FIELD_NAME,
  DEFAULT_THROTTLE_POLICY,
  LOGIN_CSRF_COOKIE_NAME,
  LOGIN_MIN_RESPONSE_MS,
  PASSWORD_FIELD_NAME,
  SESSION_COOKIE_NAME,
  type ThrottlePolicy,
} from "@/lib/auth/config";
import { issueLoginCsrf } from "@/lib/auth/csrf";
import { hashPassword } from "@/lib/auth/crypto/argon2";
import type { Bytes } from "@/lib/auth/crypto/encoding";
import { randomBytes } from "@/lib/auth/crypto/random";
import { REGISTERED_FACTORS } from "@/lib/auth/factors/registry";
import type { AuthFactor } from "@/lib/auth/factors/types";
import type { LoginHandlerOptions } from "@/lib/auth/http/login-handler";
import type { LoginDependencies } from "@/lib/auth/login";
import { createTestDatabase, type TestDatabase } from "./pglite";

/**
 * Shared wiring for the admin auth tests.
 *
 * The password below is a throwaway used only by this suite. The real admin
 * password never appears in this repository — not in a fixture, not in a test,
 * not in a comment. What ships is the argon2id hash of it, in the environment.
 */
export const TEST_PASSWORD = "test-only-passphrase-9f3a-not-production";
export const TEST_ORIGIN = "https://half-sour.test";

export type Harness = {
  readonly database: TestDatabase;
  readonly clock: ControlledClock;
  readonly deps: LoginDependencies;
  readonly secret: Bytes;
  readonly handlerOptions: LoginHandlerOptions;
  readonly passwordHash: string;
  close(): Promise<void>;
};

/**
 * Hash the throwaway password once per worker.
 *
 * Argon2id at production parameters costs ~85 ms a call by design; paying that
 * in every `beforeEach` would buy nothing. The verification path under test
 * still runs the full hash on every attempt.
 */
let cachedPasswordHash: Promise<string> | null = null;
function testPasswordHash(): Promise<string> {
  cachedPasswordHash ??= hashPassword(TEST_PASSWORD);
  return cachedPasswordHash;
}

export async function createHarness(options?: {
  readonly factors?: readonly AuthFactor[];
  readonly policy?: ThrottlePolicy;
  readonly passwordHash?: string;
  /** Real waiting is unnecessary; the controlled clock records sleeps instead. */
  readonly minResponseMs?: number;
}): Promise<Harness> {
  const database = await createTestDatabase();
  const clock = new ControlledClock();
  const secret = randomBytes(32);
  const passwordHash = options?.passwordHash ?? (await testPasswordHash());

  const deps: LoginDependencies = {
    store: database.store,
    clock,
    policy: options?.policy ?? DEFAULT_THROTTLE_POLICY,
    factors: options?.factors ?? REGISTERED_FACTORS,
    sessionSecret: secret,
    passwordHash,
    ownerEmail: "owner@halfsour.test",
    ownerName: "Half Sour Owner",
    minResponseMs: options?.minResponseMs ?? LOGIN_MIN_RESPONSE_MS,
    trustProxyHeaders: true,
  };

  return {
    database,
    clock,
    deps,
    secret,
    passwordHash,
    handlerOptions: {
      deps,
      allowedOrigins: [TEST_ORIGIN],
      secureCookies: true,
    },
    close: () => database.close(),
  };
}

/** Mint a matching CSRF token and sealed cookie, as the proxy would. */
export async function mintCsrf(
  harness: Harness,
): Promise<{ token: string; cookie: string }> {
  const issued = await issueLoginCsrf(harness.secret, harness.clock.now());
  return { token: issued.token, cookie: issued.cookieValue };
}

export type LoginRequestOptions = {
  readonly password: string;
  readonly csrfToken?: string | null;
  readonly csrfCookie?: string | null;
  readonly sessionCookie?: string | null;
  readonly origin?: string | null;
  readonly fetchSite?: string | null;
  readonly ip?: string | null;
  readonly extraFields?: Readonly<Record<string, string>>;
  readonly url?: string;
};

/** Build the exact request a browser would send from the login form. */
export function buildLoginRequest(options: LoginRequestOptions): Request {
  const body = new URLSearchParams();
  body.set(PASSWORD_FIELD_NAME, options.password);
  if (options.csrfToken !== null && options.csrfToken !== undefined) {
    body.set(CSRF_FIELD_NAME, options.csrfToken);
  }
  for (const [key, value] of Object.entries(options.extraFields ?? {})) {
    body.set(key, value);
  }

  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
    "user-agent": "half-sour-tests/1.0",
  });
  headers.set("origin", options.origin ?? TEST_ORIGIN);
  if (options.fetchSite !== null) {
    headers.set("sec-fetch-site", options.fetchSite ?? "same-origin");
  }
  if (options.ip !== null) {
    headers.set("x-forwarded-for", options.ip ?? "203.0.113.10");
  }

  const jar: string[] = [];
  if (options.csrfCookie !== null && options.csrfCookie !== undefined) {
    jar.push(`${LOGIN_CSRF_COOKIE_NAME}=${options.csrfCookie}`);
  }
  if (options.sessionCookie !== null && options.sessionCookie !== undefined) {
    jar.push(`${SESSION_COOKIE_NAME}=${options.sessionCookie}`);
  }
  if (jar.length > 0) headers.set("cookie", jar.join("; "));

  return new Request(options.url ?? `${TEST_ORIGIN}/login/session`, {
    method: "POST",
    headers,
    body,
  });
}

/** Pull one `Set-Cookie` header by cookie name out of a response. */
export function setCookieFor(
  response: Response,
  name: string,
): string | undefined {
  return response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`));
}

/** Parse a `Set-Cookie` header into its value and its attributes. */
export function parseSetCookie(header: string): {
  value: string;
  attributes: string[];
} {
  const [first, ...rest] = header.split("; ");
  const value = (first ?? "").slice((first ?? "").indexOf("=") + 1);
  return { value, attributes: rest };
}
