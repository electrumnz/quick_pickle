/**
 * The semantic layer.
 *
 * Components must never name a pigment. They name an *intent* —
 * `--surface-raised`, `--text-muted`, `--border-hairline`, `--accent`,
 * `--danger` — and this file is the single place where intent is bound to
 * pigment, once per scheme. Rebrand = edit this table. Nothing else changes.
 *
 * Light and dark are bound independently. Several bindings are deliberately
 * NOT mirror images, because the two palettes are different instruments:
 *
 *  - `surface-inverse` is Ink in light (a black block against a bone page) and
 *    Cellar in dark. A value flip has no meaning when the page is already at
 *    the black end of the range; Cellar is the only dark ground besides Night
 *    that sanctions both reversed type and Brine display type.
 *  - `surface-sunken` and `surface-deep` are two different greens in light
 *    (Vinegar tint, Dill panel) and both collapse to Shelf in dark. The dark
 *    palette authors three neutral grounds to light's five; the tint/panel
 *    distinction reads as noise on a dark ground, so it is not made.
 *  - `text-link` is Ink in light and Brine in dark. Brine is display-only over
 *    a light ground (the brand marks Brine-on-Ink and Brine-on-Dill "large"),
 *    but is body-safe over Night and Cellar. So links are underlined Ink in
 *    light and Brine in dark — an authored difference, not an inversion.
 *  - `accent-edge` exists because a Brine fill only clears 3:1 against its
 *    surroundings in dark. In light a Brine fill carries an Ink edge; in dark
 *    the fill needs no edge, so `accent-edge` equals the fill.
 */

import type { DarkPigment, LightPigment } from "./palette";

/** A semantic token bound to one pigment per scheme. */
export interface SemanticColor {
  /** What this token means, in component language. */
  readonly intent: string;
  readonly light: LightPigment;
  readonly dark: DarkPigment;
}

export const SEMANTIC_COLORS = {
  // ---------------------------------------------------------------- grounds
  "surface-page": {
    intent: "The page ground. Everything else sits on this.",
    light: "bone",
    dark: "night",
  },
  "surface-raised": {
    intent: "Cards, inputs, popovers — anything lifted off the page.",
    light: "paper",
    dark: "cellar",
  },
  "surface-sunken": {
    intent: "Quiet tint blocks, table stripes, inset wells.",
    light: "vinegar",
    dark: "shelf",
  },
  "surface-deep": {
    intent: "The second surface: footers, ingredient panels, spec blocks.",
    light: "dill",
    dark: "shelf",
  },
  "surface-inverse": {
    intent:
      "A deliberately reversed block — hero bands, full-bleed statements.",
    light: "ink",
    dark: "cellar",
  },
  "surface-accent": {
    intent: "A Brine field: the cap, primary buttons, highlight bands.",
    light: "brine",
    dark: "brine",
  },

  // ------------------------------------------------------------------- type
  "text-primary": {
    intent: "Body copy and headings on page, raised and sunken grounds.",
    light: "ink",
    dark: "salt",
  },
  "text-muted": {
    intent: "Captions, metadata, helper text.",
    light: "pepper",
    dark: "ash",
  },
  "text-danger": {
    intent: "Errors, sold-out, allergen notices.",
    light: "chilli",
    dark: "ember",
  },
  "text-link": {
    intent: "Inline links on page and raised grounds.",
    light: "ink",
    dark: "brine",
  },
  "text-accent": {
    intent: "Brine display type. Large sizes only — see SEMANTIC_PAIRS.",
    light: "brine",
    dark: "brine",
  },
  "text-on-deep": {
    intent: "Type sitting on the second surface.",
    light: "bone",
    dark: "salt",
  },
  "text-on-inverse": {
    intent: "Type sitting on a reversed block.",
    light: "bone",
    dark: "salt",
  },
  "text-on-accent": {
    intent: "Type sitting on a Brine field.",
    light: "ink",
    dark: "night",
  },

  // --------------------------------------------------------- lines and marks
  "border-hairline": {
    intent:
      "Decorative rules and dividers only. Carries no meaning, so it is exempt from 1.4.11 and is NOT in SEMANTIC_PAIRS.",
    light: "rind",
    dark: "shelf",
  },
  "border-strong": {
    intent: "Boundaries that carry meaning: inputs, buttons, selected states.",
    light: "pepper",
    dark: "ash",
  },
  "focus-ring": {
    intent: "The keyboard focus indicator.",
    light: "ink",
    dark: "brine",
  },
  accent: {
    intent: "The signature fill. Brine.",
    light: "brine",
    dark: "brine",
  },
  "accent-edge": {
    intent:
      "The 1px edge a Brine fill needs to clear 3:1 in light. Equals the fill in dark, where it already does.",
    light: "ink",
    dark: "brine",
  },
  "accent-secondary": {
    intent: "Second accent: live status, in-stock dots, secondary emphasis.",
    light: "dill",
    dark: "moss",
  },
  danger: {
    intent: "The error fill and mark.",
    light: "chilli",
    dark: "ember",
  },
} as const satisfies Record<string, SemanticColor>;

export type SemanticColorName = keyof typeof SEMANTIC_COLORS;

/**
 * Every foreground/ground combination the semantic layer approves.
 *
 * A combination that is not here has no name and no example — that is the
 * mechanism. `tests/unit/brand-contrast.test.ts` asserts that each entry
 * resolves, in BOTH schemes, to a combination present in the brand's own
 * sanctioned list, and that it clears its threshold.
 *
 * `sizeClass` is the strictest of the two schemes: if a pairing is display-only
 * in either palette it is display-only everywhere, so one component cannot be
 * legible in dark and marginal in light.
 */
export interface SemanticPair {
  readonly fg: SemanticColorName;
  readonly bg: SemanticColorName;
  /** "body" and "large" are text. "non-text" is WCAG 1.4.11 at 3:1. */
  readonly sizeClass: "body" | "large" | "non-text";
  readonly usage: string;
}

export const SEMANTIC_PAIRS: readonly SemanticPair[] = [
  // text ---------------------------------------------------------------
  {
    fg: "text-primary",
    bg: "surface-page",
    sizeClass: "body",
    usage: "Body copy",
  },
  {
    fg: "text-primary",
    bg: "surface-raised",
    sizeClass: "body",
    usage: "Card copy",
  },
  {
    fg: "text-primary",
    bg: "surface-sunken",
    sizeClass: "body",
    usage: "Table stripe, inset well",
  },
  {
    fg: "text-muted",
    bg: "surface-page",
    sizeClass: "body",
    usage: "Metadata",
  },
  {
    fg: "text-muted",
    bg: "surface-raised",
    sizeClass: "body",
    usage: "Card metadata",
  },
  {
    fg: "text-danger",
    bg: "surface-page",
    sizeClass: "body",
    usage: "Sold out, error",
  },
  {
    fg: "text-danger",
    bg: "surface-raised",
    sizeClass: "body",
    usage: "Card error",
  },
  {
    fg: "text-link",
    bg: "surface-page",
    sizeClass: "body",
    usage: "Inline link",
  },
  {
    fg: "text-link",
    bg: "surface-raised",
    sizeClass: "body",
    usage: "Card link",
  },
  {
    fg: "text-accent",
    bg: "surface-inverse",
    sizeClass: "large",
    usage: "Display headline in a reversed band",
  },
  {
    fg: "text-on-deep",
    bg: "surface-deep",
    sizeClass: "body",
    usage: "Footer and panel copy",
  },
  {
    fg: "text-on-inverse",
    bg: "surface-inverse",
    sizeClass: "body",
    usage: "Reversed band copy",
  },
  {
    fg: "text-on-accent",
    bg: "surface-accent",
    sizeClass: "body",
    usage: "Primary button label",
  },

  // non-text: boundaries, marks and indicators (WCAG 1.4.11, 3:1) --------
  {
    fg: "border-strong",
    bg: "surface-page",
    sizeClass: "non-text",
    usage: "Input and button boundary",
  },
  {
    fg: "border-strong",
    bg: "surface-raised",
    sizeClass: "non-text",
    usage: "Boundary on a card",
  },
  {
    fg: "focus-ring",
    bg: "surface-page",
    sizeClass: "non-text",
    usage: "Focus indicator",
  },
  {
    fg: "focus-ring",
    bg: "surface-raised",
    sizeClass: "non-text",
    usage: "Focus indicator on a card",
  },
  {
    fg: "accent-edge",
    bg: "surface-page",
    sizeClass: "non-text",
    usage: "Edge of a Brine fill",
  },
  {
    fg: "accent",
    bg: "surface-inverse",
    sizeClass: "non-text",
    usage: "Brine fill in a reversed band",
  },
  {
    fg: "accent-secondary",
    bg: "surface-page",
    sizeClass: "non-text",
    usage: "Live / in-stock dot",
  },
  {
    fg: "danger",
    bg: "surface-page",
    sizeClass: "non-text",
    usage: "Sold-out dot and error bar",
  },
] as const;

/**
 * Semantic tokens deliberately excluded from SEMANTIC_PAIRS, with the reason.
 * The test asserts this list and SEMANTIC_PAIRS together account for every
 * token, so nothing is quietly forgotten.
 */
export const PAIR_EXEMPT: ReadonlyArray<{
  readonly token: SemanticColorName;
  readonly reason: string;
}> = [
  {
    token: "border-hairline",
    reason:
      "Decorative rule. Conveys no state or boundary of a control, so WCAG 1.4.11 does not apply. Anything meaningful uses border-strong.",
  },
] as const;

/** Resolve a semantic token to its pigment name in a scheme. */
export function pigmentFor(
  token: SemanticColorName,
  scheme: "light" | "dark",
): string {
  return SEMANTIC_COLORS[token][scheme];
}
