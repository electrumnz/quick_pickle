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

import { links, partners } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

import { SLUG_PATTERN, UTM_KEYS } from "./links";

/** What may be kept about where a visit came from. Nothing else is. */
export const SOURCE_KEYS = ["via", ...UTM_KEYS] as const;

/** A utm label: short, lower case, no spaces. The same shape a link saves. */
const UTM_VALUE = /^[a-z0-9][a-z0-9._-]{0,59}$/;

/**
 * What the browser said about where the visit came from, cut down to the
 * four things we keep and to values that could be real. Anything else in
 * there is dropped without comment.
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
    const ok = key === "via" ? SLUG_PATTERN.test(tidy) : UTM_VALUE.test(tidy);
    if (ok) out[key] = tidy;
  }
  return out;
}

/** The same, with `via` kept only if it names a short link of ours. */
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
