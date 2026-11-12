/**
 * Read helpers over the offer in content/offer.ts.
 *
 * Everything a "save $12" or "best value" label says is computed here from
 * the live prices. A saving that is written into copy goes wrong the first
 * time a price moves, and a wrong saving is a misrepresentation, not a typo.
 */

import { PACKS, type Pack } from "@/content/offer";

export function packBySku(sku: string): Pack | null {
  return PACKS.find((pack) => pack.sku === sku) ?? null;
}

export function isKnownSku(sku: string): boolean {
  return packBySku(sku) !== null;
}

/** The pack the page opens on. Falls back to the first if none is flagged. */
export function featuredPack(): Pack {
  const pack = PACKS.find((entry) => entry.featured) ?? PACKS[0];
  if (pack === undefined) throw new Error("The offer has no packs");
  return pack;
}

/** Price per shot, rounded to the cent. */
export function perShotCents(pack: Pack): number {
  return Math.round(pack.priceCents / pack.shots);
}

/** The pack with the lowest price per shot. Ties go to the smaller pack. */
export function bestValuePack(): Pack {
  let best = featuredPack();
  let bestRate = Number.POSITIVE_INFINITY;
  for (const pack of PACKS) {
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
export function savingCents(pack: Pack): number {
  const smallest = PACKS[0];
  if (smallest === undefined || smallest.sku === pack.sku) return 0;
  // (shots * smallest.price / smallest.shots) - price, in exact integers.
  const atSmallestRate = Math.round(
    (pack.shots * smallest.priceCents) / smallest.shots,
  );
  return Math.max(0, atSmallestRate - pack.priceCents);
}

/** The next size up from a pack, or null for the largest. */
export function nextSizeUp(pack: Pack): Pack | null {
  const index = PACKS.findIndex((entry) => entry.sku === pack.sku);
  if (index === -1) return null;
  return PACKS[index + 1] ?? null;
}
