/**
 * The storefront, as the audit sees it.
 *
 * The audit is worth something only if it reads the pages a customer reads, so
 * this module does exactly one thing: fetch real URLs over HTTP and turn the
 * response into the four views a check needs — the status, the visible text,
 * the links, and the raw HTML for the two checks that need to look at markup.
 *
 * Two rules:
 *
 *  1. **Nothing here knows what a check is.** Fetching and parsing are separate
 *     from judging, so a check cannot quietly re-fetch a page and grade its own
 *     homework.
 *  2. **A 404 is data, not an error.** Half the findings in this audit are
 *     routes that do not exist yet; a fetcher that threw on them would hide the
 *     thing being measured.
 */

/** One link as it appears on the page. */
export interface PageLink {
  readonly href: string;
  readonly text: string;
}

/** One fetched page. */
export interface RenderedPage {
  readonly path: string;
  readonly status: number;
  /** 200-ish. A redirect that landed is `ok` with the status it landed on. */
  readonly ok: boolean;
  readonly title: string;
  /** Visible text: scripts, styles and markup removed, whitespace collapsed. */
  readonly text: string;
  readonly html: string;
  readonly links: readonly PageLink[];
  /** Set when the request itself failed, rather than the page. */
  readonly error: string | null;
}

/** Everything one audit run read. */
export interface StorefrontPages {
  readonly baseUrl: string;
  readonly fetchedAt: string;
  readonly pages: readonly RenderedPage[];
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  times: "×",
  copy: "©",
  middot: "·",
  deg: "°",
};

/** Decode the entities a rendered React page actually emits. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * The words a person actually sees.
 *
 * `<script>` goes first and it matters: Next streams the whole page's copy back
 * a second time inside `self.__next_f.push(...)`, so a naive tag strip would
 * find every phrase twice and in the wrong order — and half of these checks are
 * about the order things appear in.
 */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function pageTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match === null ? "" : decodeEntities(match[1] ?? "").trim();
}

export function pageLinks(html: string): readonly PageLink[] {
  const links: PageLink[] = [];
  const pattern = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match = pattern.exec(html);
  while (match !== null) {
    links.push({
      href: decodeEntities(match[1] ?? ""),
      text: visibleText(match[2] ?? ""),
    });
    match = pattern.exec(html);
  }
  return links;
}

/** The fetch this module needs. Narrow enough for a test to hand one in. */
export type PageFetcher = (url: string) => Promise<{
  readonly status: number;
  text(): Promise<string>;
}>;

const DEFAULT_FETCHER: PageFetcher = async (url) =>
  fetch(url, {
    headers: {
      // Named so a request in an access log is identifiable as the audit and
      // not as a customer. It is the founder's own site either way.
      "user-agent": "half-sour-storefront-audit",
      accept: "text/html",
    },
    redirect: "follow",
    cache: "no-store",
  });

function emptyPage(path: string, error: string): RenderedPage {
  return {
    path,
    status: 0,
    ok: false,
    title: "",
    text: "",
    html: "",
    links: [],
    error,
  };
}

/** Fetch one path and parse it. Never throws: a failure becomes a page. */
export async function fetchPage(
  baseUrl: string,
  path: string,
  fetcher: PageFetcher = DEFAULT_FETCHER,
): Promise<RenderedPage> {
  try {
    const response = await fetcher(`${baseUrl}${path}`);
    const html = await response.text();
    return {
      path,
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      title: pageTitle(html),
      text: visibleText(html),
      html,
      links: pageLinks(html),
      error: null,
    };
  } catch (cause) {
    return emptyPage(
      path,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/**
 * Fetch every path the audit reads.
 *
 * Serially, on purpose. This runs against one small Next server — the founder's
 * own — and eleven parallel dynamic renders is a load test rather than an
 * audit.
 */
export async function fetchStorefront(
  baseUrl: string,
  paths: readonly string[],
  fetcher: PageFetcher = DEFAULT_FETCHER,
): Promise<StorefrontPages> {
  const base = baseUrl.replace(/\/+$/, "");
  const pages: RenderedPage[] = [];
  for (const path of paths) {
    pages.push(await fetchPage(base, path, fetcher));
  }
  return { baseUrl: base, fetchedAt: new Date().toISOString(), pages };
}
