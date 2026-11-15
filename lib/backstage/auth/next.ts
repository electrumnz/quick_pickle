/**
 * Where somebody is sent once they have signed in: the page they were on
 * their way to, if that is a page of the back end, and the front of the
 * back end otherwise.
 *
 * The address arrives from outside (it is in the link to the sign-in page),
 * so it is read to the letter:
 *
 *   - It has to be a path on this site, inside /backstage. Anything else is
 *     somewhere a stranger chose.
 *   - It never carries a sentence. A back-end page shows the `notice` in its
 *     address in a notice box, and what stands in front of the back end
 *     only takes a strange one out when a page is ASKED for
 *     (lib/backstage/ui/notice.ts, proxy.ts). Signing in is a form, and
 *     with scripting on its redirect sets the browser's address without a
 *     page being asked for at that address. So a notice in a return address
 *     would sit there unread until the next form on that page was drawn
 *     from it. It is taken out here, whoever sealed it.
 *
 * The sign-in page, its form and the lock all use this one function.
 */

import { withoutNotice } from "../ui/notice";

/** The front of the back end: where anybody goes with nowhere else to go. */
export const FRONT = "/backstage";

/** Only used to read a path apart. Never an address anybody is sent to. */
const PARSE_BASE = "https://site.invalid";

export function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/")) return FRONT;
  // "//host" is another site, and a backslash is read as a slash by some
  // browsers and not by others.
  if (next.startsWith("//") || next.includes("\\")) return FRONT;
  let url: URL;
  try {
    url = new URL(next, PARSE_BASE);
  } catch {
    return FRONT;
  }
  if (url.origin !== PARSE_BASE) return FRONT;
  // Read after the dots are worked out: "/backstage/../checkout" is not in
  // the back end, and neither is "/backstagefoo".
  if (url.pathname !== FRONT && !url.pathname.startsWith(`${FRONT}/`)) {
    return FRONT;
  }
  const clean = withoutNotice(url);
  return `${clean.pathname}${clean.search}${clean.hash}`;
}
