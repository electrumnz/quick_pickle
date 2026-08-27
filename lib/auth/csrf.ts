import { LOGIN_CSRF_TTL_MS } from "./config";
import { timingSafeEqualStrings } from "./crypto/constant-time";
import type { Bytes } from "./crypto/encoding";
import { randomToken } from "./crypto/random";
import { seal, unseal } from "./crypto/seal";

/**
 * CSRF protection.
 *
 * Three layers, because each covers the others' edges:
 *
 *   1. `SameSite=Strict` on both cookies. A cross-site POST arrives with no
 *      cookies at all, so it cannot even reach step 3 with a token to submit.
 *   2. An `Origin` / `Sec-Fetch-Site` check on every unsafe method, which also
 *      catches the browsers and the flows where SameSite is not applied.
 *   3. A sealed double-submit token: the server holds one copy encrypted in a
 *      cookie (or, after sign-in, inside the sealed session), the form carries
 *      the other, and the two are compared in constant time.
 *
 * Before sign-in there is no session to bind a token to, so the login form gets
 * its own short-lived sealed cookie. After sign-in the token lives inside the
 * session seal, so admin mutations need no extra cookie and a token cannot
 * outlive the session it belongs to.
 */

type LoginCsrfPayload = { readonly t: string };

function parseLoginCsrf(value: unknown): LoginCsrfPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<LoginCsrfPayload>;
  return typeof candidate.t === "string" ? { t: candidate.t } : null;
}

export type LoginCsrfIssue = {
  /** Goes in the form's hidden field. */
  readonly token: string;
  /** Goes in the sealed cookie. */
  readonly cookieValue: string;
  readonly expiresAt: Date;
};

/** Mint a login CSRF token and its sealed cookie counterpart. */
export async function issueLoginCsrf(
  secret: Bytes,
  now: Date,
): Promise<LoginCsrfIssue> {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + LOGIN_CSRF_TTL_MS);
  const cookieValue = await seal(secret, "login-csrf", { t: token }, expiresAt);
  return { token, cookieValue, expiresAt };
}

/**
 * Check a submitted login CSRF token against its sealed cookie.
 *
 * Returns false — never throws, never distinguishes "no cookie" from "wrong
 * token" to the caller — for an absent cookie, an expired one, one sealed for
 * another purpose or under another key, and a mismatched token.
 */
export async function verifyLoginCsrf(input: {
  readonly secret: Bytes;
  readonly cookieValue: string | undefined | null;
  readonly submitted: string | undefined | null;
  readonly now: Date;
}): Promise<boolean> {
  if (
    input.submitted === undefined ||
    input.submitted === null ||
    input.submitted === ""
  ) {
    return false;
  }
  const payload = await unseal(
    input.secret,
    "login-csrf",
    input.cookieValue,
    input.now,
    parseLoginCsrf,
  );
  if (payload === null) return false;
  return timingSafeEqualStrings(payload.t, input.submitted);
}

/**
 * Check a submitted token against the CSRF secret carried in a live session.
 *
 * This is the check every admin mutation runs. Exported so that the admin
 * feature surfaces — route handlers and server actions alike — have one
 * function to call rather than each inventing their own.
 */
export function verifySessionCsrf(input: {
  readonly sessionCsrf: string;
  readonly submitted: string | undefined | null;
}): boolean {
  if (
    input.submitted === undefined ||
    input.submitted === null ||
    input.submitted === ""
  ) {
    return false;
  }
  return timingSafeEqualStrings(input.sessionCsrf, input.submitted);
}

/**
 * Read the token out of an existing sealed login CSRF cookie.
 *
 * Lets the proxy reuse a still-valid token across page views instead of
 * re-minting one on every render, which would break a form left open in a
 * second tab.
 */
export async function readLoginCsrfToken(
  secret: Bytes,
  cookieValue: string | undefined | null,
  now: Date,
): Promise<string | null> {
  const payload = await unseal(
    secret,
    "login-csrf",
    cookieValue,
    now,
    parseLoginCsrf,
  );
  return payload === null ? null : payload.t;
}
