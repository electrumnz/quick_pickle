/**
 * Header names the request proxy uses to talk to the render.
 *
 * A Server Component cannot set a cookie, so the login page cannot mint its own
 * CSRF cookie. The proxy mints it, sets the sealed cookie on the response, and
 * passes the matching token forward on the request under this header. Nothing
 * outside the proxy may set it: it is stripped from every inbound request
 * first, so a client cannot supply its own token and have the page render it.
 */
export const LOGIN_CSRF_HEADER = "x-half-sour-login-csrf";

/** Response header that keeps every admin surface out of search indexes. */
export const ROBOTS_HEADER = "x-robots-tag";
export const ROBOTS_NOINDEX = "noindex, nofollow, noarchive";

/** Response header that keeps admin responses out of every cache. */
export const CACHE_HEADER = "cache-control";
export const CACHE_NO_STORE = "no-store, max-age=0, must-revalidate";
