import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs in front of the back end, and only the back end. The shop's pages are
 * static and never pass through here.
 *
 * It does two small things and no deciding:
 *
 *   1. Tells the page which path was asked for (a layout cannot see it
 *      otherwise), so that signing in can send you back where you were going.
 *      Whatever a browser sent under that header name is overwritten.
 *   2. Marks every back-end response as private: never cached, never indexed.
 *
 * It is NOT the lock. Who may come in is checked by `requireStaff()` in the
 * page and in every action (lib/backstage/auth/current.ts), against the
 * database. A check that only lives here would be skipped by anything that
 * reaches a Server Action directly.
 */

export const config = {
  matcher: ["/backstage", "/backstage/:path*"],
};

export const PATH_HEADER = "x-qp-path";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(
    PATH_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  response.headers.set("cache-control", "private, no-store");
  return response;
}
