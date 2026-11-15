import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";

import { noticeStands, withoutNotice } from "@/lib/backstage/ui/notice";
import { asPromoCode } from "@/lib/shop/code";
import { fromAPersonsBrowser } from "@/lib/shop/person";
import {
  asRouting,
  BUYER_COOKIE,
  choosePage,
  HOME,
  PAGE_COOKIE,
  PAGE_COOKIE_DAYS,
  unpackSticky,
  type Facts,
  type Routing,
} from "@/lib/shop/routing";

/**
 * Runs in front of two things and nothing else: the back end, and the front
 * page of the shop. Every other page of the shop is static and never passes
 * through here.
 *
 * THE BACK END. Three small things and no deciding:
 *
 *   1. Tells the page which path was asked for (a layout cannot see it
 *      otherwise), so that signing in can send you back where you were going.
 *      Whatever a browser sent under that header name is overwritten.
 *   2. Marks every back-end response as private: never cached, never indexed.
 *   3. Takes a sentence out of the address if it is not the back end's own.
 *      A page shows the `notice` in its address in a notice box, and anybody
 *      can type an address. The back end seals the ones it writes
 *      (lib/backstage/ui/notice.ts). One that is not sealed, is for another
 *      page, or is more than a few minutes old is taken out before any page
 *      is drawn, by sending the browser to the same address without it.
 *
 * It is NOT the lock. Who may come in is checked by `requireStaff()` in the
 * page and in every action (lib/backstage/auth/current.ts), against the
 * database. A check that only lives here would be skipped by anything that
 * reaches a Server Action directly.
 *
 * THE FRONT PAGE. Which page a visitor sees. Almost always there is nothing
 * to decide: no rule is switched on and no test is running, the request is
 * passed straight through to the standard page, and no cookie is read or
 * set. When somebody has set something up (lib/backstage/pages/routing-ops),
 * this asks lib/shop/routing.ts which page the visitor gets, and if it is a
 * landing page serves that page at the front page's own address. The
 * landing pages are already built and kept, so this adds a decision, not a
 * page render.
 *
 * It must never be why the front page fails. If what is set up cannot be
 * read in time, the visitor gets the standard page.
 */

export const config = {
  matcher: ["/", "/backstage", "/backstage/:path*"],
};

export const PATH_HEADER = "x-qp-path";

/* ---- what is set up, asked for at most every few seconds ------------------ */

/** How long an answer is trusted before it is asked for again. */
const TRUST_MS = 10_000;
/**
 * How long a visitor waits for the first answer after a start. Past this
 * they get the standard page, and the answer goes on arriving behind them.
 */
const WAIT_MS = 400;
/** How long the question itself may take before it is given up on. */
const ASK_MS = 3_000;
/** After no answer at all, how long before asking again. */
const RETRY_MS = 2_000;

/** The last real answer, and when it came. */
let known: { readonly routing: Routing; readonly at: number } | null = null;
/** When the question last went unanswered. */
let failedAt = 0;
let asking: Promise<Routing | null> | null = null;

/** What is set up, or null when no answer came. */
async function ask(request: NextRequest): Promise<Routing | null> {
  try {
    const response = await fetch(new URL("/api/routing", request.url), {
      signal: AbortSignal.timeout(ASK_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return asRouting(body);
  } catch {
    return null;
  }
}

/**
 * A way to say "this is still wanted". Some hosts put the process to sleep
 * the moment a response has gone, and work left running would never finish.
 */
type KeepAlive = (work: Promise<unknown>) => void;

/** The work's own answer, or null if it has not come within `ms`. */
async function atMost<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, ms, null);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What is set up, as last answered. Null means nobody knows: the question
 * has never been answered. That is not the same as "nothing is set up", and
 * the difference matters: a visitor who is part of a test must not have
 * what is remembered about them wiped because the database blinked.
 */
async function currentRouting(
  request: NextRequest,
  keepAlive: KeepAlive,
): Promise<Routing | null> {
  const now = Date.now();
  if (known !== null && now - known.at < TRUST_MS) return known.routing;
  if (asking === null && now - failedAt >= RETRY_MS) {
    // One question at a time, however many visitors arrive at once.
    asking = ask(request).then((routing) => {
      if (routing === null) failedAt = Date.now();
      else known = { routing, at: Date.now() };
      asking = null;
      return routing;
    });
    // Without this, on a host that sleeps between requests, the answer
    // would never land and the old one would be believed for ever.
    keepAlive(asking);
  }
  // A visitor never waits on a slow answer when there is an older one, and
  // an old answer is better than none.
  if (known !== null) return known.routing;
  if (asking === null) return null;
  // The first visitors after a start wait a moment, not as long as it takes.
  return atMost(asking, WAIT_MS);
}

/** For tests: forget what was last answered. */
export function forgetRouting(): void {
  known = null;
  failedAt = 0;
  asking = null;
}

/* ---- how this visitor arrived ---------------------------------------------- */

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38})[a-z0-9]$/;
const LABEL = /^[a-z0-9][a-z0-9._-]{0,59}$/;

function cameFrom(request: NextRequest): string | null {
  const referrer = request.headers.get("referer") ?? "";
  if (referrer === "") return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    const own = request.nextUrl.hostname.toLowerCase().replace(/^www\./, "");
    return host === own ? null : host;
  } catch {
    return null;
  }
}

function factsOf(request: NextRequest): Facts {
  const params = request.nextUrl.searchParams;
  const via = (params.get("via") ?? "").trim().toLowerCase();
  const source = (params.get("utm_source") ?? "").trim().toLowerCase();
  return {
    via: SLUG.test(via) ? via : null,
    source: LABEL.test(source) ? source : null,
    site: cameFrom(request),
    code: asPromoCode(params.get("code")) !== null,
    buyer: request.cookies.get(BUYER_COOKIE)?.value === "1",
  };
}

async function frontPage(
  request: NextRequest,
  keepAlive: KeepAlive,
): Promise<NextResponse> {
  const had = request.cookies.get(PAGE_COOKIE)?.value;
  const answer = await currentRouting(request, keepAlive);
  // Nobody knows what is set up: the standard page, and nothing touched.
  if (answer === null) return NextResponse.next();
  const routing = answer;
  const nothingSetUp = routing.rules.length === 0 && routing.test === null;

  // The usual case, and a machine's case always: the standard page, and
  // nothing remembered. A search engine is never put in a test or sent to
  // a page that asks not to be indexed.
  if (nothingSetUp || !fromAPersonsBrowser(request.headers)) {
    const response = NextResponse.next();
    if (nothingSetUp && had !== undefined) response.cookies.delete(PAGE_COOKIE);
    return response;
  }

  const choice = choosePage(
    routing,
    factsOf(request),
    unpackSticky(had),
    Math.random(),
  );
  const response =
    choice.page === HOME
      ? NextResponse.next()
      : NextResponse.rewrite(
          new URL(`/for/${choice.page}${request.nextUrl.search}`, request.url),
        );
  if (choice.cookie.do === "set") {
    response.cookies.set(PAGE_COOKIE, choice.cookie.value, {
      maxAge: PAGE_COOKIE_DAYS * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      // Read by the page's own visit counter, to say which side of a test
      // it is on. It holds a page's name and nothing about the visitor.
      httpOnly: false,
    });
  } else if (choice.cookie.do === "clear") {
    response.cookies.delete(PAGE_COOKIE);
  }
  // Which page a visitor gets depends on their cookie, so nothing in
  // between may hand one visitor's page to another.
  response.headers.set("cache-control", "private, no-cache");
  response.headers.append("vary", "cookie");
  return response;
}

export async function proxy(
  request: NextRequest,
  event?: NextFetchEvent,
): Promise<NextResponse> {
  if (request.nextUrl.pathname === "/") {
    try {
      return await frontPage(request, (work) => event?.waitUntil(work));
    } catch {
      // Whatever went wrong in the deciding, the shop still opens.
      return NextResponse.next();
    }
  }

  // A sentence in the address that is not the back end's own goes no
  // further. Only where a page is being asked for: a form posts to the
  // address it is on, and what it gets back is drawn from a new address.
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    request.nextUrl.searchParams.has("notice")
  ) {
    const asked = new URL(request.url);
    if (!noticeStands(asked, new Date())) {
      const response = NextResponse.redirect(withoutNotice(asked), 307);
      response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
      response.headers.set("cache-control", "private, no-store");
      return response;
    }
  }

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
