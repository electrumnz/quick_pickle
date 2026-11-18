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
 * This file imports only the catalogue, so a page in the browser can read
 * the types and the offer's word without carrying anything else. What may be
 * changed, and how a change is laid over the file, is in ./offer-changes.ts,
 * which only the server reads.
 */

import {
  COMPANY,
  FLAVOURS,
  PACKS,
  PRODUCT,
  SHIPPING,
  STORE,
  UNCONFIRMED,
  type Flavour,
  type LaunchMode,
  type Pack,
  type Unconfirmed,
} from "@/content/offer";

export type Shipping = {
  /** Flat rate to an urban New Zealand address, cents. */
  readonly standardCents: number;
  /** Added on top for a rural delivery address, cents. */
  readonly ruralSurchargeCents: number;
  /**
   * Order value (before delivery) at which standard delivery is free, or
   * null when no order earns it. (To make delivery free for everybody, the
   * flat rate is set to nothing.)
   */
  readonly freeOverCents: number | null;
  /** The only country the checkout accepts. */
  readonly country: string;
};

/**
 * What the label says, word for word. Each is null until somebody with the
 * printed label in hand has typed it: nothing about what is in the bottle
 * is ever guessed.
 */
export type Label = {
  /** The ingredients list, as one run of words, as the label prints it. */
  readonly ingredients: string | null;
  /**
   * The label's allergen line ("Contains: ..."), or null. Null says nothing
   * either way: the site never states that there are no allergens.
   */
  readonly contains: string | null;
  /** The label's storage line. */
  readonly storage: string | null;
};

/** Who is behind the shop, for the terms of sale and a receipt. */
export type Company = {
  /** The legal name of whoever sells it, as it is registered. */
  readonly legalName: string | null;
  /** New Zealand Business Number: 13 digits. */
  readonly nzbn: string | null;
  /** Where the business is, on one line. */
  readonly address: string | null;
  /** GST number (the IRD number), digits only. */
  readonly gstNumber: string | null;
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
  /**
   * The flavours on the shelf, in the order the page offers them. Every
   * pack comes in every one, at the pack's price.
   */
  readonly flavours: readonly Flavour[];
  readonly shipping: Shipping;
  /**
   * What the first flavour's label says. Before there were two flavours
   * this was the one juice's label, which is the first flavour's.
   */
  readonly label: Label;
  /**
   * What each other flavour's label says, by the flavour's key. Every
   * flavour but the first has an entry. Read a label with `labelOf`.
   */
  readonly flavourLabels: Readonly<Record<string, Label>>;
  readonly company: Company;
  /** The facts that are still stand-ins. Empty means ready for search. */
  readonly unconfirmed: readonly Unconfirmed[];
  /**
   * A word for exactly these prices and this state of the shop. It changes
   * when anything that could move a buyer's total does, and stays put when
   * anything else does (the ship date, the contact address).
   */
  readonly version: string;
};

/**
 * The part of the offer a page in the browser is handed: enough to draw
 * every price and to say pre-order or live, and nothing else. The open
 * facts are notes for the people running the shop, and the contact address,
 * the ship date, the label and the company reach a page as words the server
 * has already written.
 */
export type OfferOnPage = Pick<
  Offer,
  | "open"
  | "launchMode"
  | "batchName"
  | "packs"
  | "flavours"
  | "shipping"
  | "version"
>;

export function forPage(offer: Offer): OfferOnPage {
  return {
    open: offer.open,
    launchMode: offer.launchMode,
    batchName: offer.batchName,
    packs: offer.packs,
    flavours: offer.flavours,
    shipping: offer.shipping,
    version: offer.version,
  };
}

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
      offer.flavours.map((flavour) => [flavour.key, flavour.skuSuffix]),
      offer.shipping.standardCents,
      offer.shipping.ruralSurchargeCents,
      offer.shipping.freeOverCents,
    ]),
  );
}

/** An offer with its word worked out. */
export function versioned(offer: Omit<Offer, "version">): Offer {
  return { ...offer, version: offerVersion(offer) };
}

/** A label nobody has typed yet. */
export const NO_LABEL: Label = {
  ingredients: null,
  contains: null,
  storage: null,
};

/** What one flavour's label says. */
export function labelOf(
  offer: Pick<Offer, "label" | "flavourLabels" | "flavours">,
  flavourKey: string,
): Label {
  if (offer.flavours[0]?.key === flavourKey) return offer.label;
  return offer.flavourLabels[flavourKey] ?? NO_LABEL;
}

/** Every flavour with its label, in the catalogue's order. */
export function labelsOf(
  offer: Pick<Offer, "label" | "flavourLabels" | "flavours">,
): { readonly flavour: Flavour; readonly label: Label }[] {
  return offer.flavours.map((flavour) => ({
    flavour,
    label: labelOf(offer, flavour.key),
  }));
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
  flavours: FLAVOURS,
  shipping: { ...SHIPPING },
  label: {
    ingredients: PRODUCT.ingredients,
    contains: PRODUCT.contains,
    storage: PRODUCT.storage,
  },
  // Nothing about what is in a flavour is ever guessed: the file starts
  // every other flavour's label blank.
  flavourLabels: Object.fromEntries(
    FLAVOURS.slice(1).map((flavour) => [
      flavour.key,
      { ingredients: null, contains: null, storage: null },
    ]),
  ),
  company: { ...COMPANY },
  unconfirmed: UNCONFIRMED,
});

/** True while any fact is still a stand-in. The site stays out of search. */
export function isPreview(offer: Offer): boolean {
  return offer.unconfirmed.length > 0;
}
