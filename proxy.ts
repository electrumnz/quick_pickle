import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { decideProxy } from "@/lib/auth/http/proxy-core";
import {
  CACHE_HEADER,
  CACHE_NO_STORE,
  ROBOTS_HEADER,
  ROBOTS_NOINDEX,
} from "@/lib/auth/proxy-headers";
import { sessionDependencies } from "@/lib/auth/runtime";

/**
 * The admin gate.
 *
 * `proxy.ts` is Next 16's name for what used to be `middleware.ts`; the
 * `middleware` convention is deprecated in this version and the file is
 * expected here, at the project root, exporting `proxy`. It runs on the Node.js
 * runtime, which is what lets the gate consult the session row in Postgres and
 * honour a revocation immediately rather than trusting the cookie alone.
 *
 * All of the decision-making lives in `lib/auth/http/proxy-core.ts` so that it
 * is unit-testable. This file is the adapter.
 *
 * The gate fails closed. If the store cannot be reached, or the environment is
 * not configured, the visitor is redirected to the login page rather than let
 * through — an admin surface that opens when the database is down is not a
 * surface that is protected by the database.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  let decision;
  try {
    const deps = sessionDependencies();
    decision = await decideProxy(request, {
      store: deps.store,
      sessionSecret: deps.sessionSecret,
      clock: deps.clock,
    });
  } catch (cause) {
    console.error(
      "[admin-auth] proxy failed closed:",
      cause instanceof Error ? cause.name : "unknown error",
    );
    return guard(
      NextResponse.redirect(new URL("/login", request.url), 307),
      true,
    );
  }

  if (decision.kind === "redirect") {
    const response = NextResponse.redirect(
      new URL(decision.location, request.url),
      decision.status,
    );
    for (const cookie of decision.setCookies) {
      response.headers.append("set-cookie", cookie);
    }
    return guard(response, true);
  }

  const requestHeaders = new Headers(request.headers);
  for (const name of decision.stripRequestHeaders) {
    requestHeaders.delete(name);
  }
  for (const [name, value] of decision.requestHeaders) {
    requestHeaders.set(name, value);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const cookie of decision.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return guard(response, decision.guarded);
}

/** Admin surfaces are never indexed and never cached. */
function guard(response: NextResponse, guarded: boolean): NextResponse {
  if (guarded) {
    response.headers.set(ROBOTS_HEADER, ROBOTS_NOINDEX);
    response.headers.set(CACHE_HEADER, CACHE_NO_STORE);
    response.headers.set("referrer-policy", "same-origin");
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("x-frame-options", "DENY");
  }
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/login", "/login/:path*"],
};
