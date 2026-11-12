import "server-only";

import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { cache } from "react";

import { FILE_OFFER, type Offer } from "./offer";
import { getStore } from "./store";

/**
 * What is on sale right now: the catalogue file with the back end's changes
 * laid over it (lib/backstage/shop/ops.ts).
 *
 * Two ways to ask, for two jobs.
 *
 * `offerForPage` is for drawing a page. Every page in the shop asks once
 * and hands the answer down, so the words, the prices and the jar on one
 * page are all from one offer. The shop's pages are built once and kept, so
 * this is read when a page is built and not on every visit. What makes a
 * kept page catch up:
 *
 *   - changing the shop throws the kept pages away at once
 *     (lib/backstage/shop/listeners.ts);
 *   - every kept page is also replaced after a minute (the shop layout's
 *     `revalidate`), which is what catches a fresh deployment, whose pages
 *     were built from the file alone.
 *
 * It is never why a page fails: with no answer it gives the last one it
 * had, and failing that the file's own offer. And building the site never
 * touches the database: at build time the offer is the file's.
 *
 * A page can therefore be a little behind. That is safe, because nothing is
 * ever charged on a page's say-so: `offerNow` is what an order is priced
 * from, read fresh as the order is placed, and an order whose page was
 * drawn from other prices is handed back with the new total first
 * (lib/shop/place-order.ts).
 */

/** The last offer read, kept for a page drawn while the database is away. */
let lastGood: Offer | null = null;

async function read(): Promise<Offer> {
  const offer = (await getStore().currentOffer?.()) ?? FILE_OFFER;
  lastGood = offer;
  return offer;
}

/** The offer to draw a page with. Asked once for each page drawn. */
export const offerForPage = cache(async (): Promise<Offer> => {
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return FILE_OFFER;
  try {
    return await read();
  } catch {
    return lastGood ?? FILE_OFFER;
  }
});

/**
 * The offer as it stands this instant, for pricing something a buyer is
 * about to pay for. Never a kept copy, and no fallback: if it cannot be
 * read, nothing can be sold on it.
 */
export async function offerNow(): Promise<Offer> {
  return read();
}
