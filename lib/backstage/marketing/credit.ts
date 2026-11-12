/**
 * Who brought an order in.
 *
 * Two things can say so. A promo code that belongs to a partner is the firm
 * one: the code is checked on the server and written on the order. The other
 * is the link the buyer came through, which their own browser remembers and
 * reports at the checkout. That is only ever a label. It cannot change a
 * price, a link that does not exist is dropped, and the worst a made-up one
 * can do is credit a sale to a partner who did not earn it.
 *
 * When both are there the code wins: it is the one a person chose to type.
 *
 * The order keeps its own copy of who was credited and the cut they were on
 * at that moment (orders.partner_id, orders.commission_percent). Results are
 * added up from those copies, so changing a deal later, or handing a code or
 * a link to somebody else, never rewrites what has already happened.
 */

import { eq } from "drizzle-orm";

import { links, pages, partners } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

import { SLUG_PATTERN, UTM_KEYS } from "./links";

/**
 * What may be kept about a visit. Nothing else is.
 *
 *   via, utm_*  the short link followed, and an advert's own labels
 *   ref         the website the visit came from, host only
 *   page        which page was shown: "home", or a landing page's name
 *   visit       the visit's own random id, to tie an order to its steps
 *   device      phone or desk
 *
 * None of it says who anybody is.
 */
export const SOURCE_KEYS = [
  "via",
  ...UTM_KEYS,
  "ref",
  "page",
  "visit",
  "device",
] as const;

/** A utm label: short, lower case, no spaces. The same shape a link saves. */
const UTM_VALUE = /^[a-z0-9][a-z0-9._-]{0,59}$/;
const HOST = /^(?=.{1,100}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const VISIT = /^[a-z0-9]{16,32}$/;

const SHAPE: Readonly<Record<(typeof SOURCE_KEYS)[number], RegExp>> = {
  via: SLUG_PATTERN,
  utm_source: UTM_VALUE,
  utm_medium: UTM_VALUE,
  utm_campaign: UTM_VALUE,
  ref: HOST,
  page: SLUG_PATTERN,
  visit: VISIT,
  device: /^(?:phone|desk)$/,
};

/**
 * What the browser said about the visit, cut down to the things we keep and
 * to values that could be real. Anything else in there is dropped without
 * comment.
 */
export function tidySource(
  raw: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === null || raw === undefined) return out;
  for (const key of SOURCE_KEYS) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    const tidy = value.trim().toLowerCase();
    if (SHAPE[key].test(tidy)) out[key] = tidy;
  }
  return out;
}

/** The standard page. Every other page is a landing page, by its slug. */
const HOME = "home";

/**
 * The same, with `via` kept only if it names a short link of ours and
 * `page` only if it names a page of ours.
 */
export async function knownSource(
  db: DbOrTx,
  raw: Readonly<Record<string, unknown>> | null | undefined,
): Promise<Record<string, string> | null> {
  const source = tidySource(raw);
  if (source.via !== undefined) {
    const [link] = await db
      .select({ id: links.id })
      .from(links)
      .where(eq(links.slug, source.via));
    if (link === undefined) delete source.via;
  }
  if (source.page !== undefined && source.page !== HOME) {
    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.slug, source.page));
    if (page === undefined) delete source.page;
  }
  return Object.keys(source).length === 0 ? null : source;
}

export type Credit = {
  readonly partnerId: string;
  /** The cut they are on right now, a whole percentage. */
  readonly commissionPercent: number;
  /** What earned it. */
  readonly by: "code" | "link";
};

/**
 * The partner an order is credited to, and the cut they are on: whoever owns
 * the code that was used or, failing that, the link the buyer came through.
 */
export async function creditFor(
  db: DbOrTx,
  order: {
    /** The partner the order's promo code belongs to, if it has one. */
    readonly promoPartnerId: string | null;
    /** The short link the buyer came through, if they did. */
    readonly viaSlug: string | null;
  },
): Promise<Credit | null> {
  let partnerId = order.promoPartnerId;
  let by: Credit["by"] = "code";
  if (partnerId === null && order.viaSlug !== null) {
    const [link] = await db
      .select({ partnerId: links.partnerId })
      .from(links)
      .where(eq(links.slug, order.viaSlug));
    partnerId = link?.partnerId ?? null;
    by = "link";
  }
  if (partnerId === null) return null;
  const [partner] = await db
    .select({ commissionPercent: partners.commissionPercent })
    .from(partners)
    .where(eq(partners.id, partnerId));
  return partner === undefined
    ? null
    : { partnerId, commissionPercent: partner.commissionPercent, by };
}
