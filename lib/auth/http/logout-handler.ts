import { buildLogoutAuditEntry } from "../audit";
import type { Clock } from "../clock";
import {
  CSRF_FIELD_NAME,
  CSRF_HEADER_NAME,
  LOGIN_CSRF_COOKIE_NAME,
  LOGIN_PATH,
  SESSION_COOKIE_NAME,
} from "../config";
import { verifySessionCsrf } from "../csrf";
import type { Bytes } from "../crypto/encoding";
import { randomRequestId } from "../crypto/random";
import type { AuthStore } from "../store/types";
import { resolveClientIp } from "./client-ip";
import { serializeClearCookie } from "./cookies";
import { authenticateRequest } from "./guard";
import { isSameOriginRequest } from "./origin";

/**
 * `POST /login/session/revoke` — sign out, and mean it.
 *
 * Clearing the cookie alone would only ask the browser nicely; anyone who had
 * already copied the cookie value would still be signed in. So the session row
 * is revoked server-side first, which invalidates that cookie everywhere at
 * once, and only then is the browser's copy cleared.
 *
 * `?scope=all` revokes every live session for the operator — the "sign out
 * everywhere" lever for a lost laptop.
 *
 * POST only, and CSRF-checked like any other admin mutation: a `GET /logout`
 * link is a denial-of-service that any `<img>` tag on the internet can fire.
 */

export type LogoutHandlerOptions = {
  readonly store: AuthStore;
  readonly sessionSecret: Bytes;
  readonly clock: Clock;
  readonly allowedOrigins: readonly string[];
  readonly trustProxyHeaders: boolean;
};

export async function handleLogoutPost(
  request: Request,
  options: LogoutHandlerOptions,
): Promise<Response> {
  const now = options.clock.now();
  const requestId = randomRequestId();

  if (!isSameOriginRequest(request, options.allowedOrigins)) {
    return refuse();
  }

  const auth = await authenticateRequest(request, {
    store: options.store,
    sessionSecret: options.sessionSecret,
    now,
  });

  // No live session: clear whatever is there and send them to the login page.
  // Not an error — signing out twice should not look like a failure.
  if (auth.status === "unauthenticated") {
    return clearedRedirect(LOGIN_PATH);
  }

  const submitted = await readCsrfToken(request);
  if (!verifySessionCsrf({ sessionCsrf: auth.payload.csrf, submitted })) {
    return refuse();
  }

  const url = new URL(request.url);
  const everywhere = url.searchParams.get("scope") === "all";
  const reason = everywhere ? "signed_out_everywhere" : "signed_out";

  const revokedCount = everywhere
    ? await options.store.revokeAllSessions({
        operatorId: auth.session.operatorId,
        at: now,
        reason,
      })
    : await options.store.revokeSession({
        id: auth.session.id,
        at: now,
        reason,
      });

  await options.store.writeAudit(
    buildLogoutAuditEntry({
      now,
      sessionId: auth.session.id,
      operator: { id: auth.session.operatorId, fullName: "admin" },
      reason,
      revokedCount,
      ipAddress: resolveClientIp(request.headers, options.trustProxyHeaders),
      userAgent: request.headers.get("user-agent"),
      requestId,
    }),
  );

  return clearedRedirect(LOGIN_PATH);
}

function baseHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store, max-age=0",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "same-origin",
  });
}

function clearedRedirect(location: string): Response {
  const headers = baseHeaders();
  headers.append(
    "set-cookie",
    serializeClearCookie(SESSION_COOKIE_NAME, {
      secure: true,
      sameSite: "Strict",
    }),
  );
  headers.append(
    "set-cookie",
    serializeClearCookie(LOGIN_CSRF_COOKIE_NAME, {
      secure: true,
      sameSite: "Strict",
    }),
  );
  headers.set("location", location);
  return new Response(null, { status: 303, headers });
}

/**
 * A refused sign-out leaves the session alone.
 *
 * Deliberately does not clear the cookie: obeying a forged sign-out would be a
 * (minor) denial of service, and a CSRF failure is not evidence that the person
 * at the keyboard wanted to leave.
 */
function refuse(): Response {
  return new Response(null, { status: 403, headers: baseHeaders() });
}

async function readCsrfToken(request: Request): Promise<string | undefined> {
  const header = request.headers.get(CSRF_HEADER_NAME);
  if (header !== null && header !== "") return header;

  const contentType = request.headers.get("content-type") ?? "";
  if (
    !contentType.includes("application/x-www-form-urlencoded") &&
    !contentType.includes("multipart/form-data")
  ) {
    return undefined;
  }
  try {
    const value = (await request.formData()).get(CSRF_FIELD_NAME);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}
