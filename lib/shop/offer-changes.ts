/**
 * What the back end may change about the offer, and how a change is laid
 * over the catalogue file.
 *
 * The list is short and closed (see lib/shop/offer.ts for why). This file is
 * the server's: it checks what was stored with zod, which a page in the
 * browser has no need to carry.
 */

import { z } from "zod";

import { isGstNumber, isNzbn } from "./company-numbers";
import { FILE_OFFER, versioned, type Offer } from "./offer";

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

/** The most letters in the ingredients list, and in any other line. */
export const MOST_INGREDIENTS = 800;
export const MOST_LINE = 200;

/** One line of words: no line breaks, nothing but ordinary spaces. */
const line = (most: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(most)
    .regex(/^[^\n\r\t]*$/, "One line, with no line breaks");

/** Changes to one label: any of its three lines, null to take it off. */
const labelChanges = z
  .object({
    ingredients: line(MOST_INGREDIENTS).nullable(),
    contains: line(MOST_LINE).nullable(),
    storage: line(MOST_LINE).nullable(),
  })
  .partial();

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
        // Null is "no order earns free delivery". Never nothing: free for
        // everybody is said one way only, by a flat rate of nothing.
        freeOverCents: z
          .number()
          .int()
          .min(LEAST_PRICE_CENTS)
          .max(MOST_PRICE_CENTS * 10)
          .nullable(),
      })
      .partial(),
    /**
     * What the first flavour's label says, word for word. Null takes a line
     * off the site.
     */
    label: labelChanges,
    /** The same for each other flavour, by the flavour's key. */
    flavourLabels: z.record(z.string(), labelChanges),
    /** Who is behind the shop. The two numbers are digits only. */
    company: z
      .object({
        legalName: line(120).nullable(),
        nzbn: z
          .string()
          .refine(isNzbn, "That is not a New Zealand Business Number")
          .nullable(),
        address: line(MOST_LINE).nullable(),
        gstNumber: z
          .string()
          .refine(isGstNumber, "That is not a GST number")
          .nullable(),
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
    // The flavours are the file's: the back end cannot add one.
    flavours: base.flavours,
    shipping: {
      ...base.shipping,
      standardCents:
        changes.shipping?.standardCents ?? base.shipping.standardCents,
      ruralSurchargeCents:
        changes.shipping?.ruralSurchargeCents ??
        base.shipping.ruralSurchargeCents,
      freeOverCents:
        changes.shipping?.freeOverCents === undefined
          ? base.shipping.freeOverCents
          : changes.shipping.freeOverCents,
    },
    label: { ...base.label, ...defined(changes.label) },
    // A label for a flavour that is not on the shelf is dropped: a change
    // writes what a label says, it never makes a flavour.
    flavourLabels: Object.fromEntries(
      Object.entries(base.flavourLabels).map(([key, label]) => [
        key,
        { ...label, ...defined(changes.flavourLabels?.[key]) },
      ]),
    ),
    company: { ...base.company, ...defined(changes.company) },
    unconfirmed: base.unconfirmed.filter(
      (fact) => confirmed[fact.key] === undefined,
    ),
  });
}

/** Only the keys that were given. A key left out means "as it was". */
function defined<T extends object>(given: T | undefined): Partial<T> {
  const out: Partial<T> = {};
  if (given === undefined) return out;
  for (const key of Object.keys(given) as (keyof T)[]) {
    if (given[key] !== undefined) out[key] = given[key];
  }
  return out;
}
