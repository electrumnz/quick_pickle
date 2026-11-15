import "server-only";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { getStore } from "./store";

/**
 * The line of words across the top of the shop, when the back end has
 * published one (lib/backstage/shop/top-line.ts). Null means the site's
 * own line, which is almost always the answer.
 *
 * The shop's pages are built once and kept, so this is read when a page is
 * built and not on every visit. Publishing a line, or putting the site's
 * own back, throws the kept pages away at once; every kept page is also
 * replaced after a minute, which is what catches a fresh deployment.
 *
 * It is never why a page fails. With no answer it gives the last one it
 * had, so a line somebody took down does not come back because the
 * database blinked, and failing that the site's own. And building the site
 * never touches the database.
 */

/** The last answer read. `undefined` until there has been one. */
let lastGood: readonly string[] | null | undefined;

export async function topLineForPage(): Promise<readonly string[] | null> {
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return null;
  try {
    const lines = (await getStore().currentTopLine?.()) ?? null;
    lastGood = lines;
    return lines;
  } catch {
    return lastGood ?? null;
  }
}

/** Forget the last answer. For tests. */
export function forgetTopLine(): void {
  lastGood = undefined;
}
