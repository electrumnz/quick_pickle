import { SESSION_COOKIE_NAME } from "../config";
import type { Bytes } from "../crypto/encoding";
import type { SessionCookiePayload, SessionRejection } from "../session";
import { renewSession, verifySessionCookie } from "../session";
import type { AdminSessionRow, AuthStore } from "../store/types";
import { readCookie } from "./cookies";

/**
 * The check every protected surface runs.
 *
 * Used in two places, deliberately: the request proxy runs it so an
 * unauthenticated visitor is redirected before a single byte of admin markup is
 * rendered, and `requireAdminSession()` runs it again inside the render so that
 * a route the proxy's matcher happens not to cover is still shut. Next's own
 * documentation is explicit that a matcher change can silently remove proxy
 * coverage, so the door is checked at the door and again at the desk.
 *
 * It is a full check in both places — sealed cookie opened, row loaded, token
 * digest compared in constant time, revocation and expiry honoured — not an
 * optimistic one. A session revoked from another device stops working on the
 * very next request, which is the whole reason the row exists alongside the
 * cookie.
 */

export type SessionRenewal = {
  readonly cookieValue: string;
  readonly expiresAt: Date;
};

export type AdminAuthState =
  | {
      readonly status: "authenticated";
      readonly session: AdminSessionRow;
      readonly payload: SessionCookiePayload;
      /** Present when the sliding window moved and the cookie must be re-sent. */
      readonly renewal: SessionRenewal | null;
    }
  | { readonly status: "unauthenticated"; readonly reason: SessionRejection };

export type GuardDependencies = {
  readonly store: AuthStore;
  readonly sessionSecret: Bytes;
  readonly now: Date;
};

/** Authenticate a request from its sealed session cookie. */
export async function authenticateRequest(
  request: Request,
  deps: GuardDependencies,
): Promise<AdminAuthState> {
  return authenticateCookieValue(
    readCookie(request, SESSION_COOKIE_NAME),
    deps,
  );
}

/** Authenticate from a cookie value already in hand (server components). */
export async function authenticateCookieValue(
  cookieValue: string | undefined,
  deps: GuardDependencies,
): Promise<AdminAuthState> {
  const verification = await verifySessionCookie({
    store: deps.store,
    secret: deps.sessionSecret,
    cookieValue,
    now: deps.now,
  });

  if (verification.status === "rejected") {
    return { status: "unauthenticated", reason: verification.reason };
  }

  const renewal = await renewSession({
    store: deps.store,
    secret: deps.sessionSecret,
    row: verification.row,
    payload: verification.payload,
    now: deps.now,
  });

  return {
    status: "authenticated",
    session: verification.row,
    payload: verification.payload,
    renewal,
  };
}
