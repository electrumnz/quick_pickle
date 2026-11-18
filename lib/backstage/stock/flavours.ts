/**
 * Flavours, as Stock knows them.
 *
 * A batch is one flavour, and an order's shots of a flavour only ever come
 * from a batch of that flavour: each flavour is its own pool. The flavours
 * are the catalogue's (content/offer.ts). The back end cannot add one.
 *
 * Sentences name a flavour only when there is more than one in play, so a
 * shop that has only ever made one reads exactly as it always did.
 */

import { z } from "zod";

import { FLAVOURS } from "@/content/offer";

const [FIRST, ...REST] = FLAVOURS.map((flavour) => flavour.key);
if (FIRST === undefined) throw new Error("The catalogue has no flavours");

/** One of the catalogue's flavours, by its key. */
export const flavourSchema = z.enum([FIRST, ...REST], {
  error: `Pick a flavour: ${FLAVOURS.map((flavour) => flavour.name).join(" or ")}`,
});

/** The first flavour: what every batch and order from before was. */
export const FIRST_FLAVOUR = FIRST;

/** "Mango Chilli Lime" from its key. A key nobody knows is said as it is. */
export function flavourName(key: string): string {
  return FLAVOURS.find((flavour) => flavour.key === key)?.name ?? key;
}

/** The catalogue's order: Original first. Unknown keys go last. */
export function byFlavour(a: string, b: string): number {
  const at = (key: string) => {
    const index = FLAVOURS.findIndex((flavour) => flavour.key === key);
    return index === -1 ? FLAVOURS.length : index;
  };
  return at(a) - at(b);
}

/**
 * Whether sentences should name flavours: true once anything about a
 * flavour other than the first is in play.
 */
export function namesFlavours(keys: Iterable<string>): boolean {
  for (const key of keys) if (key !== FIRST) return true;
  return false;
}

/** "24 shots", or "24 Mango Chilli Lime shots" when flavours are named. */
export function flavourShots(
  count: number,
  key: string,
  named: boolean,
): string {
  const n = count.toLocaleString("en-NZ");
  if (!named) return `${n} ${count === 1 ? "shot" : "shots"}`;
  return `${n} ${flavourName(key)} ${count === 1 ? "shot" : "shots"}`;
}
