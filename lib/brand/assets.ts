/**
 * The logo suite, described in token terms.
 *
 * The files themselves are built and owned by the brand workstream in
 * `brand/assets/`. This manifest exists so a component never has to guess
 * which cut goes on which ground: each entry names the semantic surface the
 * artwork was drawn for, and the pairing is contrast-checked in CI alongside
 * the colour tokens.
 *
 * `file` is the repository path. Publishing these to a served URL is the brand
 * unit's job; nothing here fabricates one.
 */

import type { SemanticColorName } from "./semantics";

export type BrandAssetKind = "mark" | "wordmark" | "lockup" | "label" | "misc";

export interface BrandAsset {
  readonly id: string;
  readonly kind: BrandAssetKind;
  readonly file: string;
  readonly label: string;
  /**
   * The semantic ground this cut is drawn for. `null` means the artwork
   * carries its own ground (the fill is baked into the SVG).
   */
  readonly ground: SemanticColorName | null;
  readonly usage: string;
}

export const BRAND_ASSETS: readonly BrandAsset[] = [
  {
    id: "mark",
    kind: "mark",
    file: "brand/assets/mark.svg",
    label: "Mark",
    ground: "surface-page",
    usage: "Ink on a light ground. The default mark.",
  },
  {
    id: "mark-reversed",
    kind: "mark",
    file: "brand/assets/mark-reversed.svg",
    label: "Mark, reversed",
    ground: "surface-inverse",
    usage: "Bone on Ink. For reversed bands and the dark scheme.",
  },
  {
    id: "mark-brine",
    kind: "mark",
    file: "brand/assets/mark-brine.svg",
    label: "Mark on Brine",
    ground: "surface-accent",
    usage: "Ink on a Brine field. Caps, stickers, the accent band.",
  },
  {
    id: "wordmark",
    kind: "wordmark",
    file: "brand/assets/wordmark.svg",
    label: "Wordmark",
    ground: "surface-page",
    usage: "Ink on a light ground.",
  },
  {
    id: "wordmark-reversed",
    kind: "wordmark",
    file: "brand/assets/wordmark-reversed.svg",
    label: "Wordmark, reversed",
    ground: "surface-inverse",
    usage: "Bone on Ink.",
  },
  {
    id: "wordmark-brine",
    kind: "wordmark",
    file: "brand/assets/wordmark-brine.svg",
    label: "Wordmark on Brine",
    ground: "surface-accent",
    usage: "Ink on a Brine field.",
  },
  {
    id: "lockup-horizontal",
    kind: "lockup",
    file: "brand/assets/lockup-horizontal.svg",
    label: "Lockup, horizontal",
    ground: "surface-page",
    usage: "Site header, invoices, anything wider than it is tall.",
  },
  {
    id: "lockup-stacked",
    kind: "lockup",
    file: "brand/assets/lockup-stacked.svg",
    label: "Lockup, stacked",
    ground: "surface-page",
    usage: "Narrow columns and the 375px header.",
  },
  {
    id: "lockup-masthead",
    kind: "lockup",
    file: "brand/assets/lockup-masthead.svg",
    label: "Lockup, masthead",
    ground: "surface-page",
    usage: "The editorial masthead treatment.",
  },
  {
    id: "favicon",
    kind: "misc",
    file: "brand/assets/favicon.svg",
    label: "Favicon",
    ground: null,
    usage: "A separate 16px-safe cut. Carries its own Brine ground.",
  },
  {
    id: "avatar",
    kind: "misc",
    file: "brand/assets/avatar.svg",
    label: "Social avatar",
    ground: null,
    usage: "512px square. Carries its own Brine ground.",
  },
  {
    id: "bottles",
    kind: "misc",
    file: "brand/assets/bottles.svg",
    label: "Bottle illustration",
    ground: "surface-page",
    usage: "Editorial illustration for the range.",
  },
  {
    id: "label-01-house",
    kind: "label",
    file: "brand/assets/label-01-house.svg",
    label: "Label — House",
    ground: null,
    usage: "Product label artwork. Carries its own ground.",
  },
  {
    id: "label-02-dirty",
    kind: "label",
    file: "brand/assets/label-02-dirty.svg",
    label: "Label — Dirty",
    ground: null,
    usage: "Product label artwork. Carries its own ground.",
  },
  {
    id: "label-03-smoke",
    kind: "label",
    file: "brand/assets/label-03-smoke.svg",
    label: "Label — Smoke",
    ground: null,
    usage: "Product label artwork. Carries its own ground.",
  },
  {
    id: "label-04-wild",
    kind: "label",
    file: "brand/assets/label-04-wild.svg",
    label: "Label — Wild",
    ground: null,
    usage: "Product label artwork. Carries its own ground.",
  },
] as const;

/** Look one up by id. */
export function brandAsset(id: string): BrandAsset | undefined {
  return BRAND_ASSETS.find((asset) => asset.id === id);
}
