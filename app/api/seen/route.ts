import { NextResponse, type NextRequest } from "next/server";

import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { fromAPersonsBrowser } from "@/lib/backstage/marketing/links";
import { recordSeen } from "@/lib/backstage/numbers/ops";

/**
 * The shop's visit counter. A page tells it "viewed", "something went in the
 * jar" or "opened the checkout", with the visit's own random id.
 *
 * It answers 204 whatever happens: counted, ignored, malformed, or the
 * database out of reach. A counter must never get in a visitor's way, and it
 * tells a script that is poking at it nothing at all.
 *
 * What it will not count:
 *   - anything not sent by one of our own pages (another site cannot use
 *     this to count for us, or to fill the table);
 *   - a machine that says it is one, or a page being fetched ahead of time;
 *   - a browser that asks not to be tracked (the page does not even send in
 *     that case; this is the same check again, on the server);
 *   - an order. An order is counted by the server when it is placed, in the
 *     same transaction, and never on a browser's say-so.
 *
 * No cookie is read or set, and nothing here says who the visitor is.
 */

const SHOP = systemCaller("The shop", "storefront");

const done = () =>
  new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });

/** Sent by one of our own pages, as far as the browser will say. */
function fromOurOwnPage(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  // An older browser: fall back to where it says the request came from.
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

const askedNotToBeTracked = (request: NextRequest) =>
  request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!fromOurOwnPage(request)) return done();
    if (askedNotToBeTracked(request)) return done();
    if (!fromAPersonsBrowser(request.headers)) return done();

    const text = await request.text();
    if (text.length === 0 || text.length > 2000) return done();
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null) return done();
    const step = body as Record<string, unknown>;
    if (step.kind === "order") return done();

    await execute(
      recordSeen,
      {
        kind: step.kind as "view",
        visit: step.visit as string,
        path: typeof step.path === "string" ? step.path : "/",
        page: typeof step.page === "string" ? step.page : "home",
        source:
          typeof step.source === "object" && step.source !== null
            ? (step.source as Record<string, unknown>)
            : undefined,
        referrer: typeof step.referrer === "string" ? step.referrer : null,
        device:
          step.device === "phone" || step.device === "desk"
            ? step.device
            : null,
        test: typeof step.test === "string" ? step.test : null,
      },
      SHOP,
    );
  } catch {
    // Not counted. Nothing to tell anyone.
  }
  return done();
}
