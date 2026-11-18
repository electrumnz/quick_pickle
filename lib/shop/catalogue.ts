/**
 * Read helpers over the offer (lib/shop/offer.ts).
 *
 * Every one takes the offer it is asked about, because the offer is not a
 * constant: the back end can move a price. The page hands its own copy to
 * the browser, and the server reads its own again when an order is placed.
 *
 * Everything a "save $12" or "best value" label says is computed here from
 * the live prices. A saving that is written into copy goes wrong the first
 * time a price moves, and a wrong saving is a misrepresentation, not a typo.
 */

import type { Flavour, Pack } from "@/content/offer";

import type { Offer } from "./offer";

/** The part of the offer these read: what is on the shelf. */
export type Shelf = Pick<Offer, "packs" | "flavours">;

/**
 * One thing that can go in the jar: a pack size in a flavour. Its SKU is
 * what a jar line, an order line and the courier's file carry.
 */
export type Item = {
  readonly sku: string;
  readonly pack: Pack;
  readonly flavour: Flavour;
};

/** The SKU of a pack size in a flavour. The first flavour's are the packs' own. */
export function itemSku(pack: Pack, flavour: Flavour): string {
  return flavour.skuSuffix === ""
    ? pack.sku
    : `${pack.sku}-${flavour.skuSuffix}`;
}

/** Everything on the shelf, a flavour at a time, smallest pack first. */
export function shelfItems(offer: Shelf): Item[] {
  return offer.flavours.flatMap((flavour) =>
    offer.packs.map((pack) => ({ sku: itemSku(pack, flavour), pack, flavour })),
  );
}

export function itemBySku(offer: Shelf, sku: string): Item | null {
  return shelfItems(offer).find((item) => item.sku === sku) ?? null;
}

/** The same pack size in another flavour, or in the same one. */
export function itemOf(pack: Pack, flavour: Flavour): Item {
  return { sku: itemSku(pack, flavour), pack, flavour };
}

/**
 * The pack size a SKU is, whatever its flavour: what its price and its
 * number of shots come from.
 */
export function packBySku(offer: Shelf, sku: string): Pack | null {
  return itemBySku(offer, sku)?.pack ?? null;
}

export function flavourBySku(offer: Shelf, sku: string): Flavour | null {
  return itemBySku(offer, sku)?.flavour ?? null;
}

export function isKnownSku(offer: Shelf, sku: string): boolean {
  return itemBySku(offer, sku) !== null;
}

/** The flavour the page opens on: the first. */
export function firstFlavour(offer: Shelf): Flavour {
  const flavour = offer.flavours[0];
  if (flavour === undefined) throw new Error("The offer has no flavours");
  return flavour;
}

/**
 * What a line is called on an order, a receipt and the courier's file: "The
 * Starter, Mango Chilli Lime". The flavour is always said, so a box is never
 * packed from a name that could be either.
 */
export function itemName(item: Pick<Item, "pack" | "flavour">): string {
  return `${item.pack.name}, ${item.flavour.name}`;
}

/** The pack the page opens on. Falls back to the first if none is flagged. */
export function featuredPack(offer: Shelf): Pack {
  const pack = offer.packs.find((entry) => entry.featured) ?? offer.packs[0];
  if (pack === undefined) throw new Error("The offer has no packs");
  return pack;
}

/** Price per shot, rounded to the cent. */
export function perShotCents(pack: Pack): number {
  return Math.round(pack.priceCents / pack.shots);
}

/** The pack with the lowest price per shot. Ties go to the smaller pack. */
export function bestValuePack(offer: Shelf): Pack {
  let best = featuredPack(offer);
  let bestRate = Number.POSITIVE_INFINITY;
  for (const pack of offer.packs) {
    // Compare as cross-products so the ranking never depends on rounding.
    const rate = pack.priceCents / pack.shots;
    if (rate < bestRate) {
      best = pack;
      bestRate = rate;
    }
  }
  return best;
}

/**
 * What a pack saves against buying the same number of shots at the smallest
 * pack's rate. Zero for the smallest pack itself, and never negative.
 */
export function savingCents(offer: Shelf, pack: Pack): number {
  const smallest = offer.packs[0];
  if (smallest === undefined || smallest.sku === pack.sku) return 0;
  // (shots * smallest.price / smallest.shots) - price, in exact integers.
  const atSmallestRate = Math.round(
    (pack.shots * smallest.priceCents) / smallest.shots,
  );
  return Math.max(0, atSmallestRate - pack.priceCents);
}

/** The next size up from a pack, or null for the largest. */
export function nextSizeUp(offer: Shelf, pack: Pack): Pack | null {
  const index = offer.packs.findIndex((entry) => entry.sku === pack.sku);
  if (index === -1) return null;
  return offer.packs[index + 1] ?? null;
}

/** The next size up in the same flavour, or null for the largest. */
export function nextItemUp(offer: Shelf, item: Item): Item | null {
  const pack = nextSizeUp(offer, item.pack);
  return pack === null ? null : itemOf(pack, item.flavour);
}
