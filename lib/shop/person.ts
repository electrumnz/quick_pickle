/**
 * Is this request a person's own browser, or a machine?
 *
 * Asked in three places, which must all give the same answer: counting a
 * click on a short link, counting a visit to the shop, and deciding whether
 * a visitor can be put in a test between two pages. This file imports
 * nothing, so the thing in front of the shop (proxy.ts) can use it too.
 *
 * Nothing here is stored. It reads what the request says about itself and
 * answers yes or no.
 */

/**
 * Machines that say what they are: search engines, link previews, uptime
 * checks, scripts. It is a short list on purpose. Missing a machine adds a
 * click or two; mistaking a person for one would hide a real visit. (The
 * one exception written in: "bot" at the end of a word is a machine, except
 * in the name of a make of phone.)
 */
const MACHINE =
  /(?<!cu)bot\b|crawler|spider|slurp|facebookexternalhit|whatsapp\/|preview|embedly|iframely|feedfetcher|mediapartners|googleother|headless|lighthouse|pingdom|uptime|monitor|scrapy|curl\/|wget\/|python-|go-http-client|okhttp|java\/|http\.rb|libwww|node-fetch|undici|axios\/|postman/i;

/** Headers a browser sends when it fetches a page before anyone asked for it. */
const AHEAD_OF_TIME = ["purpose", "sec-purpose", "x-purpose", "x-moz"];

/**
 * True when a request's headers look like a person's own browser: it says
 * what it is, it is not a machine that says so, and it is not fetching a
 * page ahead of time.
 */
export function fromAPersonsBrowser(headers: {
  get(name: string): string | null;
}): boolean {
  const agent = (headers.get("user-agent") ?? "").trim();
  if (agent === "" || MACHINE.test(agent)) return false;
  return !AHEAD_OF_TIME.some((name) =>
    /prefetch|prerender|preview/i.test(headers.get(name) ?? ""),
  );
}
