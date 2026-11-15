/**
 * The sentence a back-end page shows after a form is saved.
 *
 * Every plain form in the back end ends by going to a page and saying how it
 * went ("Saved.", "Shipped."). The sentence travels in the address, so the
 * forms work with scripting off and a reload never repeats the change. But an
 * address can be typed by anybody: without more, a link somebody made by hand
 * could put any sentence they liked in a notice box on a back-end page, in
 * the back end's own voice.
 *
 * So a notice is sealed. The sentence, its tone, the page it is for and the
 * moment it was said are signed with a secret only the server holds, and the
 * seal travels with it. What stands in front of the back end (proxy.ts)
 * checks the seal before any page is drawn, and takes the sentence out of
 * the address if it does not hold. Pages go on reading `notice` and `tone`
 * from the address as they always did: only the back end's own words ever
 * get that far.
 *
 * A seal is good for ten minutes and for its own page. After that the
 * sentence is taken out, so a page that was bookmarked with "Saved." in its
 * address does not go on saying so for ever.
 *
 * The seal needs a secret, and it uses one the server already holds: the
 * clock's, else the set-up code, else the database's own address (which has
 * a password in it). So wherever real records are behind the door there is
 * something to seal with, and nobody has one more setting to look after.
 * With none of them there is nothing real behind the door (a preview, a
 * developer's machine), and nothing is sealed or checked.
 *
 * This file is read by proxy.ts, so it imports nothing of the app's.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

/** How long a sentence in an address goes on being shown. */
export const NOTICE_MINUTES = 10;

/** What a notice puts in an address: the two a page reads, and its seal. */
export const NOTICE_PARAMS = ["notice", "tone", "nat", "nsig"] as const;

/** Where a secret the server already holds can be found, best first. */
const SECRETS = [
  "CRON_SECRET",
  "BACKSTAGE_SETUP_CODE",
  "DATABASE_URL",
  "POSTGRES_URL",
] as const;

/** Anything shorter could be guessed from one sealed notice. */
const SHORTEST_SECRET = 16;

/**
 * The secret notices are sealed with: one the server already holds. Null
 * when it holds none, which only happens where nothing real is behind the
 * door.
 */
export function noticeSecret(env: Env = process.env): string | null {
  for (const name of SECRETS) {
    const value = (env[name] ?? "").trim();
    if (value.length >= SHORTEST_SECRET) return value;
  }
  return null;
}

/** Only used to read a path apart. Never an address anybody is sent to. */
const PARSE_BASE = "https://site.invalid";

function sealOf(
  secret: string,
  pathname: string,
  notice: string,
  tone: string,
  at: string,
): string {
  // Written as a list, so that no sentence can be read as two of the parts.
  return createHmac("sha256", `quick-pickle-notice:${secret}`)
    .update(JSON.stringify([pathname, tone, at, notice]))
    .digest("hex")
    .slice(0, 32);
}

/**
 * `path` with a sentence to show there, sealed where there is a secret to
 * seal it with. Anything after a # stays at the end.
 */
export function withNotice(
  path: string,
  notice: string,
  tone: "good" | "bad",
  options: { readonly now?: Date; readonly env?: Env } = {},
): string {
  const [base = "", hash = ""] = path.split("#");
  const joiner = base.includes("?") ? "&" : "?";
  const anchor = hash === "" ? "" : `#${hash}`;
  const said = `notice=${encodeURIComponent(notice)}&tone=${tone}`;
  const secret = noticeSecret(options.env);
  if (secret === null) return `${base}${joiner}${said}${anchor}`;
  const at = String((options.now ?? new Date()).getTime());
  const pathname = new URL(base, PARSE_BASE).pathname;
  const seal = sealOf(secret, pathname, notice, tone, at);
  return `${base}${joiner}${said}&nat=${at}&nsig=${seal}${anchor}`;
}

/**
 * Does the sentence in this address stand? True when there is none, when it
 * is the back end's own (sealed, for this page, and recent), and where
 * nothing is sealed at all.
 */
export function noticeStands(
  url: URL,
  now: Date,
  env: Env = process.env,
): boolean {
  const notice = url.searchParams.get("notice");
  if (notice === null) return true;
  const secret = noticeSecret(env);
  if (secret === null) return true;
  // Said twice, a page is handed both: the sealed one and one that is not.
  for (const name of NOTICE_PARAMS) {
    if (url.searchParams.getAll(name).length > 1) return false;
  }
  const tone = url.searchParams.get("tone") ?? "";
  const at = url.searchParams.get("nat") ?? "";
  const seal = url.searchParams.get("nsig") ?? "";
  if (!/^\d{10,16}$/.test(at) || !/^[a-f0-9]{32}$/.test(seal)) return false;
  const age = now.getTime() - Number(at);
  if (age < -60_000 || age > NOTICE_MINUTES * 60_000) return false;
  const wanted = sealOf(secret, url.pathname, notice, tone, at);
  return timingSafeEqual(Buffer.from(seal), Buffer.from(wanted));
}

/** The same address with the sentence, its tone and its seal taken out. */
export function withoutNotice(url: URL): URL {
  const clean = new URL(url);
  for (const name of NOTICE_PARAMS) clean.searchParams.delete(name);
  return clean;
}
