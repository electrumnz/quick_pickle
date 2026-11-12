/**
 * The offer, as one value: what is on sale, for how much, how it gets there,
 * and whether the shop is taking orders at all.
 *
 * `content/offer.ts` is where it starts. That file is still the place a
 * commercial fact is first written down, and with no database it is the
 * whole story. What this adds is a small set of changes kept by the back
 * end (prices, delivery rates, the ship date, pre-order or live, taking
 * orders or not) laid over the file, so that the person who runs the shop
 * can move a price or a date without a deploy.
 *
 * Three rules it keeps:
 *
 *   - What can be changed is a short, closed list. A change can move a
 *     price on a pack that exists; it cannot invent a pack, a size or a
 *     currency. Anything it does not recognise is dropped, never guessed at.
 *   - A fact that is still a stand-in stays on the list of open facts until
 *     a person says it is right. Changing the figure is not the same as
 *     confirming it.
 *   - Nothing here is a price a browser sent. The browser is handed the
 *     offer to draw the page with, and the server works every total out
 *     again from its own copy when an order is placed. What the form sends
 *     back is the offer's `version`, a word for "the prices I was shown",
 *     and never a number.
 *
 * This file imports only the catalogue and zod, so a page in the browser
 * can read the types and the sums.
 */

import { z } from "zod";

import {
  PACKS,
  SHIPPING,
  STORE,
  UNCONFIRMED,
  type LaunchMode,
  type Pack,
  type Unconfirmed,
} from "@/content/offer";

export type Shipping = {
  /** Flat rate to an urban New Zealand address, cents. */
  readonly standardCents: number;
  /** Added on top for a rural delivery address, cents. */
  readonly ruralSurchargeCents: number;
  /** Order value (before delivery) at which standard delivery is free. */
  readonly freeOverCents: number;
  /** The only country the checkout accepts. */
  readonly country: string;
};

export type Offer = {
  /** False when the shop is not taking orders: sold out, or shut for now. */
  readonly open: boolean;
  readonly launchMode: LaunchMode;
  /** What the run on sale is called on the page: "Batch 001". */
  readonly batchName: string;
  /** The date a pre-order ships from ("2026-12-01"), or null until it is set. */
  readonly preorderShipsFrom: string | null;
  /** Where customers write to, or null to show no address. */
  readonly contactEmail: string | null;
  /** Whether prices include GST, or null until the registration is known. */
  readonly gstRegistered: boolean | null;
  /** Smallest first. The page and the jar both rely on that order. */
  readonly packs: readonly Pack[];
  readonly shipping: Shipping;
  /** The facts that are still stand-ins. Empty means ready for search. */
  readonly unconfirmed: readonly Unconfirmed[];
  /**
   * A word for exactly these prices and this state of the shop. It changes
   * when anything that could move a buyer's total does, and stays put when
   * anything else does (the ship date, the contact address).
   */
  readonly version: string;
};

/* ---- the file's own offer ------------------------------------------------ */

/** A short word for a string: the same in a browser and on the server. */
function wordFor(text: string): string {
  // FNV-1a, 32 bit. Not a secret and not a lock: only a way to notice a
  // change, so anything that spreads its input evenly will do.
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

/** The word for everything in an offer that a buyer's total depends on. */
export function offerVersion(offer: Omit<Offer, "version">): string {
  return wordFor(
    JSON.stringify([
      offer.open,
      offer.launchMode,
      offer.packs.map((pack) => [pack.sku, pack.shots, pack.priceCents]),
      offer.shipping.standardCents,
      offer.shipping.ruralSurchargeCents,
      offer.shipping.freeOverCents,
    ]),
  );
}

function versioned(offer: Omit<Offer, "version">): Offer {
  return { ...offer, version: offerVersion(offer) };
}

/** The offer exactly as `content/offer.ts` has it. */
export const FILE_OFFER: Offer = versioned({
  open: true,
  launchMode: STORE.launchMode,
  batchName: STORE.batchName,
  preorderShipsFrom: STORE.preorderShipsFrom,
  contactEmail: STORE.contactEmail,
  gstRegistered: STORE.gstRegistered,
  packs: PACKS,
  shipping: { ...SHIPPING },
  unconfirmed: UNCONFIRMED,
});

/* ---- what the back end may change --------------------------------------- */

/** The least a pack may cost: a dollar. Nothing is given away by a slip. */
export const LEAST_PRICE_CENTS = 100;
/** The most a pack may cost. A figure past this is a typing mistake. */
export const MOST_PRICE_CENTS = 100_000;
/** The most delivery may cost, standard or the rural extra. */
export const MOST_DELIVERY_CENTS = 10_000;

const dateKey = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    "Dates look like 2026-12-01",
  )
  .refine((value) => {
    const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
    const made = new Date(Date.UTC(year, month - 1, day));
    return (
      made.getUTCFullYear() === year &&
      made.getUTCMonth() === month - 1 &&
      made.getUTCDate() === day
    );
  }, "That is not a day on the calendar");

const priceCents = z
  .number()
  .int()
  .min(LEAST_PRICE_CENTS)
  .max(MOST_PRICE_CENTS);
const deliveryCents = z.number().int().min(0).max(MOST_DELIVERY_CENTS);

/**
 * What is kept in the database: only what differs from the file. A key that
 * is absent means "as the file has it", so a later change to the file shows
 * through wherever nobody has said otherwise.
 */
export const offerChangesSchema = z
  .object({
    open: z.boolean(),
    launchMode: z.enum(["preorder", "live"]),
    batchName: z.string().trim().min(1).max(40),
    preorderShipsFrom: dateKey.nullable(),
    contactEmail: z.string().trim().toLowerCase().max(254).email().nullable(),
    gstRegistered: z.boolean().nullable(),
    /** A price for a pack, by its SKU, in cents. */
    prices: z.record(z.string(), priceCents),
    shipping: z
      .object({
        standardCents: deliveryCents,
        ruralSurchargeCents: deliveryCents,
        freeOverCents: z
          .number()
          .int()
          .min(0)
          .max(MOST_PRICE_CENTS * 10),
      })
      .partial(),
    /** Open facts a person has said are right: who, and when. */
    confirmed: z.record(
      z.string(),
      z.object({ by: z.string().max(120), at: z.string().max(40) }),
    ),
  })
  .partial();

export type OfferChanges = z.infer<typeof offerChangesSchema>;

/**
 * Whatever was stored, as changes that can be trusted. Anything that does
 * not fit is treated as no changes at all: a shop on the file's own prices
 * is always a safe place to land.
 */
export function asOfferChanges(stored: unknown): OfferChanges {
  const read = offerChangesSchema.safeParse(stored);
  return read.success ? read.data : {};
}

/** The file's offer with the back end's changes laid over it. */
export function offerWith(
  changes: OfferChanges,
  base: Offer = FILE_OFFER,
): Offer {
  const prices = changes.prices ?? {};
  const confirmed = changes.confirmed ?? {};
  return versioned({
    open: changes.open ?? base.open,
    launchMode: changes.launchMode ?? base.launchMode,
    batchName: changes.batchName ?? base.batchName,
    preorderShipsFrom:
      changes.preorderShipsFrom === undefined
        ? base.preorderShipsFrom
        : changes.preorderShipsFrom,
    contactEmail:
      changes.contactEmail === undefined
        ? base.contactEmail
        : changes.contactEmail,
    gstRegistered:
      changes.gstRegistered === undefined
        ? base.gstRegistered
        : changes.gstRegistered,
    // A price for a pack that is not on the shelf is dropped: a change
    // moves a price, it never makes a pack.
    packs: base.packs.map((pack) => {
      const price = prices[pack.sku];
      return price === undefined ? pack : { ...pack, priceCents: price };
    }),
    shipping: {
      ...base.shipping,
      standardCents:
        changes.shipping?.standardCents ?? base.shipping.standardCents,
      ruralSurchargeCents:
        changes.shipping?.ruralSurchargeCents ??
        base.shipping.ruralSurchargeCents,
      freeOverCents:
        changes.shipping?.freeOverCents ?? base.shipping.freeOverCents,
    },
    unconfirmed: base.unconfirmed.filter(
      (fact) => confirmed[fact.key] === undefined,
    ),
  });
}

/** True while any fact is still a stand-in. The site stays out of search. */
export function isPreview(offer: Offer): boolean {
  return offer.unconfirmed.length > 0;
}
