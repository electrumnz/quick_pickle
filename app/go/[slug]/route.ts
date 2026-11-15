import { after, NextResponse, type NextRequest } from "next/server";

import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  countLinkClick,
  isCountedVisit,
  resolveLink,
} from "@/lib/backstage/marketing/links";
import { countAsk } from "@/lib/shop/caller";

/**
 * /go/<slug>: one of our tracked short links.
 *
 * It looks the slug up, passes the visitor on, and then counts the click.
 * Where it sends them comes from the saved link and from nowhere else:
 * nothing in the request (no query, no header, not even the address it came
 * in on) can choose the destination, so this cannot be used to bounce
 * somebody from our address to a stranger's. The saved target is itself only
 * ever a page on this site or a full https address, checked when it is saved
 * and again by `links.resolve` each time.
 *
 * A page on this site is sent as a relative address ("/checkout"), the same
 * as Next's own `redirect()` does. It names no website, so the visitor stays
 * on whichever address they used, and a proxy that reports the wrong host to
 * the app cannot send anyone to it.
 *
 * The redirect is a 307: temporary, so a browser asks again next time and
 * the next visit is counted too. A permanent one would be remembered and the
 * count would stop.
 *
 * A click is counted after the redirect has been sent, and only for a visit
 * that looks like a person: not a HEAD request, a link preview, a search
 * engine or a page fetched ahead of time. Nor past a ceiling from one
 * internet address in ten minutes (lib/shop/limit.ts), so a link's count
 * cannot be padded out by following it over and over: the visitor is still
 * sent on, and the click is simply not counted. Anything that goes wrong (no such
 * link, switched off, the database out of reach) lands on the front page of
 * the shop. Nothing about the visitor is kept and no cookie is set.
 */

const VISITOR = systemCaller("The shop", "storefront");

/** The front page of the shop, on whichever address the visitor used. */
const HOME = "/";

/** Only used to read a saved path apart. Never the destination. */
const PARSE_BASE = "https://site.invalid";

/**
 * A saved page on this site as a relative address. A browser reads two
 * slashes or a backslash at the start as another website, so anything but
 * one plain leading slash goes home instead. `links.resolve` has already
 * checked this. It is the last look before the address is sent.
 */
function onThisSite(saved: string): string {
  const url = new URL(saved, PARSE_BASE);
  if (url.origin !== PARSE_BASE) return HOME;
  const path = `${url.pathname}${url.search}${url.hash}`;
  return /^\/(?![/\\])/.test(path) ? path : HOME;
}

function logFailure(event: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event,
      message: error instanceof Error ? error.message : "unknown",
    }),
  );
}

/**
 * Count the click once the redirect is on its way. `from` is the request's
 * own headers, copied, because the request itself is gone by then.
 */
async function countAfterwards(slug: string, from: Headers): Promise<void> {
  const count = async () => {
    try {
      // Under the ceiling for one address? Asked here, after the visitor
      // has been sent on, so it never slows a link down.
      if (!(await countAsk("link", from)).allowed) return;
      await execute(countLinkClick, { slug }, VISITOR);
    } catch (error) {
      logFailure("link.count_failed", error);
    }
  };
  try {
    after(count);
  } catch {
    // Not in a request Next can keep working after (a test, say): count now.
    await count();
  }
}

async function follow(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  let location = HOME;

  try {
    const { slug } = await context.params;
    const found = await execute(resolveLink, { slug, count: false }, VISITOR);
    if (found.found) {
      location =
        found.kind === "https"
          ? new URL(found.url).href
          : onThisSite(found.url);
      if (isCountedVisit(request)) {
        await countAfterwards(found.slug, new Headers(request.headers));
      }
    }
  } catch (error) {
    logFailure("link.follow_failed", error);
  }

  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  return follow(request, context);
}

/**
 * A HEAD request is a machine asking where the link goes. It gets the same
 * answer and is not a click (`isCountedVisit` only counts a GET).
 */
export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  return follow(request, context);
}
