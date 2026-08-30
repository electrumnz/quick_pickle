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
import { isDemoMode } from "@/lib/demo/mode";

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

/**
 * How a render came to be allowed to draw an admin screen.
 *
 * Two states, and the second one is not a weaker version of the first — it is
 * the absence of the first. `"open"` means demo mode, and demo mode means
 * nobody is signed in: there is no session row, no operator id and no CSRF
 * token, and every one of those absences is honest rather than filled in with
 * a stand-in. A page holding an `"open"` access can read. It cannot write,
 * because {@link requireAdminSession} — which every write goes through — still
 * demands the real thing.
 */
export type AdminAccess =
  | {
      readonly kind: "session";
      readonly session: AdminSessionRow;
      readonly csrfToken: string;
    }
  | { readonly kind: "open" };

/**
 * Authenticate the current request without redirecting.
 *
 * `sessionDependencies()` throws when `ADMIN_SESSION_SECRET` is absent, and
 * outside demo mode that throw stands: an admin surface must not read a broken
 * configuration as an ordinary anonymous visitor and carry on. A demo
 * deployment need never set the variable at all, and on one the answer to "is
 * this request signed in" is plainly no — so there the throw becomes the same
 * `unauthenticated` an unsealable cookie produces, and each caller decides what
 * that means. Nothing about the answer changes: still no session, still no
 * operator, still no CSRF token.
 */
export async function getAdminSession(): Promise<AdminAuthState> {
  let deps;
  try {
    deps = sessionDependencies();
  } catch (cause) {
    if (!isDemoMode()) throw cause;
    return { status: "unauthenticated", reason: "absent" };
  }
  const jar = await cookies();
  return authenticateCookieValue(jar.get(SESSION_COOKIE_NAME)?.value, {
    store: deps.store,
    sessionSecret: deps.sessionSecret,
    now: deps.clock.now(),
  });
}

/**
 * What this request may do on an admin screen.
 *
 * Call this instead of {@link requireAdminSession} on a page that only READS.
 * A live session still returns a session; in demo mode, and only there, a
 * request with no session is allowed through as `"open"` rather than redirected
 * — which is the whole of "the demo admin needs no password". Everywhere else
 * it redirects exactly as it always did.
 */
export async function requireAdminAccess(
  returnTo?: string,
): Promise<AdminAccess> {
  const state = await getAdminSession();
  if (state.status === "authenticated") {
    return {
      kind: "session",
      session: state.session,
      csrfToken: state.payload.csrf,
    };
  }
  if (isDemoMode()) return { kind: "open" };
  redirect(await loginDestination(returnTo));
}

/**
 * Whether this request may READ an admin answer, outside a page render.
 *
 * For the route handlers behind the admin — the command palette's search and
 * the private file reader. Same rule as {@link requireAdminAccess}, expressed
 * as a boolean because a route handler answers with a status code rather than
 * a redirect.
 */
export async function hasAdminReadAccess(): Promise<boolean> {
  const state = await getAdminSession();
  return state.status === "authenticated" || isDemoMode();
}

/**
 * The token to put in a form's hidden field, or the empty string when nobody
 * is signed in.
 *
 * The empty string is not a weak token, it is the absence of one:
 * {@link assertAdminCsrf} refuses an unauthenticated request before it compares
 * anything, so `""` can never be accepted. Screens already use `""` to mean
 * "render no write controls here" — see the history rows on
 * `app/(admin)/admin/social/page.tsx`.
 */
export function adminFormToken(access: AdminAccess): string {
  return access.kind === "session" ? access.csrfToken : "";
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
  // Deliberately NOT demo-aware. This is the function every write in the admin
  // reaches through `components/admin/write/guard.ts`, and a write is stamped
  // with an operator id into an append-only audit row. Demo mode has no
  // operator to stamp and will not invent one, so on an open demo this
  // redirects to the sign-in page — the password is optional for looking, and
  // required for changing. See the report in `lib/demo/README.md`.
  const state = await getAdminSession();
  if (state.status === "authenticated") {
    return { session: state.session, csrfToken: state.payload.csrf };
  }
  redirect(await loginDestination(returnTo));
}

/** `/login`, carrying wherever the visitor was heading. */
async function loginDestination(returnTo?: string): Promise<string> {
  const destination = new URL(LOGIN_PATH, "https://placeholder.invalid");
  const target = returnTo ?? (await currentPath());
  if (target !== null) destination.searchParams.set(RETURN_TO_PARAM, target);
  return `${destination.pathname}${destination.search}`;
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
