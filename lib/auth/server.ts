import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  CSRF_FIELD_NAME,
  CSRF_HEADER_NAME,
  LOGIN_PATH,
  RETURN_TO_PARAM,
  SESSION_COOKIE_NAME,
} from "./config";
import { verifySessionCsrf } from "./csrf";
import { CsrfError } from "./errors";
import type { AdminAuthState } from "./http/guard";
import { authenticateCookieValue } from "./http/guard";
import { LOGIN_CSRF_HEADER } from "./proxy-headers";
import { sessionDependencies } from "./runtime";
import type { AdminSessionRow } from "./store/types";

/**
 * The server-side surface the admin feature pages consume.
 *
 * The request proxy already turns an unauthenticated visitor away before any
 * admin markup renders. This module is the second, non-optional check: Next's
 * own guidance is that a proxy matcher change — or a Server Function that moves
 * to a route the matcher no longer covers — can silently remove that coverage,
 * so authorisation is re-established here, inside the render, against the
 * database.
 *
 * A later unit builds the admin dashboard. It should need exactly three things
 * from this file: {@link requireAdminSession} at the top of a page,
 * {@link getAdminCsrfToken} in any form, and {@link assertAdminCsrf} at the top
 * of any mutation.
 */

export type AuthenticatedAdmin = {
  readonly session: AdminSessionRow;
  /** Per-session CSRF secret. Render it into forms via {@link getAdminCsrfToken}. */
  readonly csrfToken: string;
};

/** Authenticate the current request without redirecting. */
export async function getAdminSession(): Promise<AdminAuthState> {
  const deps = sessionDependencies();
  const jar = await cookies();
  return authenticateCookieValue(jar.get(SESSION_COOKIE_NAME)?.value, {
    store: deps.store,
    sessionSecret: deps.sessionSecret,
    now: deps.clock.now(),
  });
}

/**
 * Require a live admin session, or redirect to the login page.
 *
 * Call this at the top of every admin page and every admin server action. The
 * redirect carries the path the visitor was after, so signing in returns them
 * to where they were going.
 */
export async function requireAdminSession(
  returnTo?: string,
): Promise<AuthenticatedAdmin> {
  const state = await getAdminSession();
  if (state.status === "authenticated") {
    return { session: state.session, csrfToken: state.payload.csrf };
  }

  const destination = new URL(LOGIN_PATH, "https://placeholder.invalid");
  const target = returnTo ?? (await currentPath());
  if (target !== null) destination.searchParams.set(RETURN_TO_PARAM, target);
  redirect(`${destination.pathname}${destination.search}`);
}

async function currentPath(): Promise<string | null> {
  try {
    const requestHeaders = await headers();
    // Next sets this on every request it routes; absent under some adapters.
    return requestHeaders.get("x-invoke-path") ?? null;
  } catch {
    return null;
  }
}

/**
 * The CSRF token for the current session, for rendering into a form.
 *
 * Bound to the session seal rather than to a second cookie, so it cannot
 * outlive the session and cannot be lifted from a cookie the browser would send
 * on its own.
 */
export async function getAdminCsrfToken(): Promise<string> {
  const state = await getAdminSession();
  if (state.status !== "authenticated") {
    throw new CsrfError("No admin session to bind a CSRF token to");
  }
  return state.payload.csrf;
}

/**
 * Name of the hidden input every admin form must carry.
 *
 * Exported so the admin unit renders the field the checker actually reads,
 * rather than a string that happens to match today.
 */
export const ADMIN_CSRF_FIELD_NAME = CSRF_FIELD_NAME;
export const ADMIN_CSRF_HEADER_NAME = CSRF_HEADER_NAME;

/**
 * Enforce CSRF on an admin mutation.
 *
 * Accepts the token from the `x-csrf-token` header or from a `csrf_token` form
 * field, so fetch-based and plain-form mutations are both covered.
 *
 * @throws {CsrfError} when the request is not authenticated or the token does
 *   not match. Callers should turn that into a 403, never into a detail.
 */
export async function assertAdminCsrf(
  submitted: string | undefined | null,
): Promise<void> {
  const state = await getAdminSession();
  if (state.status !== "authenticated") {
    throw new CsrfError("Not authenticated");
  }
  if (!verifySessionCsrf({ sessionCsrf: state.payload.csrf, submitted })) {
    throw new CsrfError("CSRF token mismatch");
  }
}

/**
 * The login form's CSRF token for the current request.
 *
 * Minted by the proxy — a Server Component cannot set a cookie — and handed
 * forward on a request header so the page and the sealed cookie always agree.
 */
export async function getLoginCsrfToken(): Promise<string | null> {
  const requestHeaders = await headers();
  return requestHeaders.get(LOGIN_CSRF_HEADER);
}
