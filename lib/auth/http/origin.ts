/**
 * Same-origin enforcement for state-changing admin requests.
 *
 * This is the cheap layer that runs before anything is parsed: a request whose
 * `Origin` is somebody else's site, or whose `Sec-Fetch-Site` says it was
 * initiated cross-site, is refused before the body is read and before any
 * database work happens.
 *
 * It is not a replacement for the token check — a non-browser client sets
 * whatever headers it likes — but against the actual CSRF threat, which is a
 * browser a victim is logged into, these headers are set by the browser and
 * cannot be forged by the page requesting them.
 */

export type OriginVerdict = "same-origin" | "cross-site" | "indeterminate";

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Classify where a request came from.
 *
 * `allowedOrigins` normally holds just the site's own origin. The request's own
 * URL is always accepted as an origin too, so preview deployments and local
 * development do not need configuration to work.
 */
export function classifyOrigin(
  request: Request,
  allowedOrigins: readonly string[],
): OriginVerdict {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    // `same-site` still means a different origin — a sibling subdomain — which
    // is exactly the neighbour a `__Host-` cookie is meant to keep out.
    return "cross-site";
  }

  const origin = request.headers.get("origin");
  if (origin !== null && origin !== "null") {
    const permitted = new Set(allowedOrigins);
    const own = originOf(request.url);
    if (own !== null) permitted.add(own);
    return permitted.has(origin) ? "same-origin" : "cross-site";
  }

  if (fetchSite === "same-origin" || fetchSite === "none") return "same-origin";
  return "indeterminate";
}

/**
 * Whether an unsafe request may proceed.
 *
 * `indeterminate` — no `Origin`, no `Sec-Fetch-Site` — is refused. Every
 * browser released this decade sends at least one of them on a form POST, so
 * the only things this turns away are hand-rolled clients, which have no
 * business at the admin door anyway.
 */
export function isSameOriginRequest(
  request: Request,
  allowedOrigins: readonly string[],
): boolean {
  return classifyOrigin(request, allowedOrigins) === "same-origin";
}
