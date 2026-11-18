import "server-only";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { getStore, type ShownReviews } from "./store";

/**
 * The reviews a page is built with: the newest published ones, how many
 * there are and their average (lib/backstage/marketing/reviews.ts).
 *
 * The shop's pages are built once and kept, so this is read when a page is
 * built and not on every visit. Publishing or taking down a review throws
 * the kept pages away at once; every kept page is also replaced after a
 * minute, which is what catches a fresh deployment.
 *
 * It is never why a page fails. With no answer it gives the last one it
 * had, so a review somebody took down does not come back because the
 * database blinked, and failing that none. Building the site never touches
 * the database. With none, the shop shows no reviews at all: nothing is
 * ever made up to fill the space.
 */

export const NO_REVIEWS: ShownReviews = {
  reviews: [],
  count: 0,
  average: null,
};

/** The last answer read, for each number asked for. */
const lastGood = new Map<number, ShownReviews>();

/**
 * `limit` is how many reviews to show: six on the shop's page, every one
 * (up to 100) on the page of reviews. The count and the average are always
 * over all of them.
 */
export async function reviewsForPage(limit = 6): Promise<ShownReviews> {
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return NO_REVIEWS;
  try {
    const shown = (await getStore().currentReviews?.(limit)) ?? NO_REVIEWS;
    lastGood.set(limit, shown);
    return shown;
  } catch {
    return lastGood.get(limit) ?? NO_REVIEWS;
  }
}

/** Forget the last answers. For tests. */
export function forgetReviews(): void {
  lastGood.clear();
}
