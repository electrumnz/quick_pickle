/**
 * How each flavour looks on the page: one accent from the brand's three
 * colours, after the flavour system in Ashleigh's brand pack (a chip for
 * each flavour, and the accent carried into what is picked). Original wears
 * the olive, Mango Chilli Lime the pink.
 *
 * The classes are written out in full so the shop's stylesheet finds them.
 * Olive is never small type (CLAUDE.md), so on an olive chip the words are
 * navy; on pink they are white at 1.2rem bold, which is what lets white sit
 * on pink.
 */

export type FlavourLook = {
  /** The chip when it is picked, by the radio inside it. */
  readonly chip: string;
  /** The same, set from the page once it is alive. */
  readonly chipLit: string;
  /** The ground behind the bottles. */
  readonly wash: string;
  /** The dot in a picked pack's radio. */
  readonly dot: string;
};

const OLIVE: FlavourLook = {
  chip: "has-checked:bg-olive has-checked:text-navy",
  chipLit: "bg-olive text-navy",
  wash: "bg-olive-wash",
  dot: "bg-olive",
};

const PINK: FlavourLook = {
  chip: "has-checked:bg-pink has-checked:text-white",
  chipLit: "bg-pink text-white",
  wash: "bg-blush",
  dot: "bg-pink",
};

const LOOKS: Readonly<Record<string, FlavourLook>> = {
  original: OLIVE,
  "mango-chilli-lime": PINK,
};

/** A flavour with no look of its own wears the olive. */
export function lookOf(key: string): FlavourLook {
  return LOOKS[key] ?? OLIVE;
}
