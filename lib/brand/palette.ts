/**
 * HALF SOUR pigments — a 1:1 typed port of `brand/_src/palette.py`.
 *
 * This file is a MIRROR, not an authority. The brand team owns
 * `brand/_src/palette.py`; nothing here may add a colour, rename a colour,
 * or invent a foreground/background pair the brand did not sanction.
 * `tests/unit/brand-contrast.test.ts` re-derives every ratio from these hexes
 * and additionally asserts that `lib/brand/tokens.css` carries the identical
 * values, so a bad token edit fails CI rather than shipping.
 *
 * Light and dark are two separately authored palettes. Dark is NOT a filter,
 * inversion or programmatic transform of light: it has its own greens
 * (Night / Cellar / Shelf), its own neutrals (Salt / Ash), a Brine held back
 * one step for a dark ground, and two accents (Moss, Ember) that do not exist
 * in light at all.
 */

export interface Pigment {
  /** Six-digit hex, uppercase, exactly as authored in palette.py. */
  readonly hex: string;
  /** The name the brand team uses out loud. */
  readonly label: string;
  /** What the brand says this pigment is for. */
  readonly role: string;
}

export const LIGHT_PIGMENTS = {
  ink: { hex: "#0F1511", label: "Ink", role: "Primary type, rules, the mark" },
  pepper: {
    hex: "#4E554A",
    label: "Pepper",
    role: "Secondary type, captions, metadata",
  },
  dill: {
    hex: "#18402F",
    label: "Dill",
    role: "Second surface, footers, ingredient panels",
  },
  brine: {
    hex: "#C8D93B",
    label: "Brine",
    role: "The signature. Fields, highlights, the cap",
  },
  vinegar: {
    hex: "#E4E8BE",
    label: "Vinegar",
    role: "Quiet tint blocks, table stripes",
  },
  bone: { hex: "#F2EFE3", label: "Bone", role: "Page ground" },
  paper: {
    hex: "#FBFAF4",
    label: "Paper",
    role: "Raised surfaces, cards, inputs",
  },
  rind: {
    hex: "#D6D2C0",
    label: "Rind",
    role: "Hairlines, dividers, borders",
  },
  chilli: {
    hex: "#A83521",
    label: "Chilli",
    role: "Errors, sold-out, allergen notices",
  },
} as const satisfies Record<string, Pigment>;

export const DARK_PIGMENTS = {
  night: { hex: "#0A0F0C", label: "Night", role: "Page ground" },
  cellar: { hex: "#131A15", label: "Cellar", role: "Raised surfaces, cards" },
  shelf: {
    hex: "#1E2A21",
    label: "Shelf",
    role: "Hairlines, dividers, inset wells",
  },
  salt: { hex: "#EAE8DB", label: "Salt", role: "Primary type" },
  ash: {
    hex: "#9BA694",
    label: "Ash",
    role: "Secondary type, captions, metadata",
  },
  brine: {
    hex: "#BDD03A",
    label: "Brine 600",
    role: "The signature, held back one step for dark ground",
  },
  moss: {
    hex: "#6FA07C",
    label: "Moss",
    role: "Second accent, links, live status",
  },
  ember: { hex: "#E08163", label: "Ember", role: "Errors, sold-out" },
} as const satisfies Record<string, Pigment>;

export type LightPigment = keyof typeof LIGHT_PIGMENTS;
export type DarkPigment = keyof typeof DARK_PIGMENTS;

/** The two authored schemes. Never derive one from the other. */
export type Scheme = "light" | "dark";

/**
 * A foreground/background combination the brand explicitly approved, with the
 * size class it was approved for. Anything not in these two lists is
 * unsanctioned — the token layer deliberately gives it no name.
 */
export interface SanctionedPair<Name extends string = string> {
  readonly fg: Name;
  readonly bg: Name;
  readonly role: string;
  readonly sizeClass: "body" | "large";
}

export const PAIRS_LIGHT: readonly SanctionedPair<LightPigment>[] = [
  {
    fg: "ink",
    bg: "bone",
    role: "Body text on the page ground",
    sizeClass: "body",
  },
  { fg: "ink", bg: "paper", role: "Body text on a card", sizeClass: "body" },
  { fg: "ink", bg: "brine", role: "Type on a Brine field", sizeClass: "body" },
  {
    fg: "ink",
    bg: "vinegar",
    role: "Type on a Vinegar tint",
    sizeClass: "body",
  },
  {
    fg: "pepper",
    bg: "bone",
    role: "Captions and metadata",
    sizeClass: "body",
  },
  { fg: "pepper", bg: "paper", role: "Captions on a card", sizeClass: "body" },
  {
    fg: "chilli",
    bg: "bone",
    role: "Error and sold-out copy",
    sizeClass: "body",
  },
  {
    fg: "chilli",
    bg: "paper",
    role: "Error copy on a card",
    sizeClass: "body",
  },
  { fg: "bone", bg: "ink", role: "Reversed type on Ink", sizeClass: "body" },
  { fg: "bone", bg: "dill", role: "Reversed type on Dill", sizeClass: "body" },
  {
    fg: "brine",
    bg: "ink",
    role: "Brine type on Ink — display only",
    sizeClass: "large",
  },
  {
    fg: "brine",
    bg: "dill",
    role: "Brine type on Dill — display only",
    sizeClass: "large",
  },
] as const;

export const PAIRS_DARK: readonly SanctionedPair<DarkPigment>[] = [
  {
    fg: "salt",
    bg: "night",
    role: "Body text on the page ground",
    sizeClass: "body",
  },
  { fg: "salt", bg: "cellar", role: "Body text on a card", sizeClass: "body" },
  { fg: "salt", bg: "shelf", role: "Type in an inset well", sizeClass: "body" },
  { fg: "ash", bg: "night", role: "Captions and metadata", sizeClass: "body" },
  { fg: "ash", bg: "cellar", role: "Captions on a card", sizeClass: "body" },
  {
    fg: "brine",
    bg: "night",
    role: "Accent type and links",
    sizeClass: "body",
  },
  {
    fg: "brine",
    bg: "cellar",
    role: "Accent type on a card",
    sizeClass: "body",
  },
  {
    fg: "moss",
    bg: "night",
    role: "Second accent, live status",
    sizeClass: "body",
  },
  {
    fg: "ember",
    bg: "night",
    role: "Error and sold-out copy",
    sizeClass: "body",
  },
  {
    fg: "ember",
    bg: "cellar",
    role: "Error copy on a card",
    sizeClass: "body",
  },
  {
    fg: "night",
    bg: "brine",
    role: "Ink-side type on a Brine field",
    sizeClass: "body",
  },
] as const;

/** Pigments for a scheme, keyed by the brand's own names. */
export function pigmentsFor(scheme: Scheme): Readonly<Record<string, Pigment>> {
  return scheme === "light" ? LIGHT_PIGMENTS : DARK_PIGMENTS;
}

/** The sanctioned pair list for a scheme. */
export function pairsFor(scheme: Scheme): readonly SanctionedPair[] {
  return scheme === "light" ? PAIRS_LIGHT : PAIRS_DARK;
}

/** True when this exact (fg, bg) combination appears in the brand's list. */
export function isSanctioned(scheme: Scheme, fg: string, bg: string): boolean {
  return pairsFor(scheme).some((pair) => pair.fg === fg && pair.bg === bg);
}

/** The sanctioned pair record for an (fg, bg), or undefined if unsanctioned. */
export function sanctionedPair(
  scheme: Scheme,
  fg: string,
  bg: string,
): SanctionedPair | undefined {
  return pairsFor(scheme).find((pair) => pair.fg === fg && pair.bg === bg);
}
