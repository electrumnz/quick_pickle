/**
 * The homepage view model.
 *
 * The bottles themselves are NOT restated here. `content/brines.ts` owns the
 * product words — name, descriptor, price, the one line that says what the
 * bottle is for — and this file reads them. That is deliberate: the copy
 * auditor scans one place, the founder edits one place, and a price cannot
 * drift between the range section and the product page.
 *
 * What lives here is the copy that only the homepage has: the serves, the
 * process, the two conversion paths and the navigation. Every line has been
 * written against `legal/COPY-RULES.md` and `brand/brand-guide.md` §5 — lead
 * with the instruction, short declaratives, numbers do the talking, nothing at
 * all about what the product does to a body.
 */

import { ALL_BRINES, brineLabel, productHref } from "@/content/brines";
import type { Brine, BrineId } from "@/content/types";

export type { Brine, BrineId };
export { ALL_BRINES, brineLabel, productHref };

/** Where the range index lives once commerce publishes it. */
export const SHOP_HREF = "/products";

/* ------------------------------------------------------------------ range */

/**
 * The seal colour each bottle carries, named as an intent rather than a
 * pigment. The label art direction (`brand/brand-guide.md` §9) makes the foot
 * band and the seal the only thing that changes between SKUs, so the site
 * uses the same device: one token per bottle, nothing else varies.
 */
export type SealTone = "accent" | "inverse" | "danger" | "secondary";

export const SEAL_TONE: Readonly<Record<BrineId, SealTone>> = {
  "no-01-house": "accent",
  "no-02-dirty": "inverse",
  "no-03-smoke": "danger",
  "no-04-wild": "secondary",
};

/** The three-bottle box (01–03), which commerce carries as its own product. */
export const FULL_SET = {
  handle: "the-full-set",
  name: "THE FULL SET",
  descriptor: "One of each",
  priceNzd: 54,
  // copy-audit-approved: R-04 (no scarcity framing; this is a pack description)
  line: "Three bottles, one box, no decision required.",
} as const;

export function fullSetHref(): string {
  return `/products/${FULL_SET.handle}`;
}

/* -------------------------------------------------------------- occasions */

export interface Serve {
  readonly id: string;
  /** Two or three words, set in mono above the title. */
  readonly kicker: string;
  readonly title: string;
  /** The instruction. First sentence, always. */
  readonly line: string;
  /** The build, as a bartender would write it. Numbers carry this. */
  readonly build: readonly string[];
  readonly brine: BrineId;
  readonly glass: "shot" | "coupe" | "highball" | "shell";
}

export const SERVES: readonly Serve[] = [
  {
    id: "pickleback",
    kicker: "Two glasses",
    title: "The pickleback",
    // copy-audit-approved: R-13 (a named serve; no encouragement of rapid or excessive drinking, no under-18 framing, no suggestion it offsets alcohol)
    line: "Whiskey first. Brine straight after, cold, from the fridge.",
    // copy-audit-approved: R-13 (measures for a single serve, stated once)
    build: ["30 ml whiskey", "30 ml No. 01 HOUSE", "Both cold. No ice."],
    brine: "no-01-house",
    glass: "shot",
  },
  {
    id: "dirty-martini",
    kicker: "Stirred",
    title: "The dirty martini",
    // copy-audit-approved: R-13 (§5.3 names the dirty martini as safe use-and-occasion vocabulary)
    line: "Three parts gin. One part No. 02. Stirred, and no olive.",
    // copy-audit-approved: R-13 (a single-serve build)
    build: ["60 ml gin", "20 ml No. 02 DIRTY", "Stir 30 seconds. Lemon twist."],
    brine: "no-02-dirty",
    glass: "coupe",
  },
  {
    id: "michelada",
    kicker: "Long and cold",
    title: "The michelada",
    // copy-audit-approved: R-13 (a named serve; ingredient framing only)
    line: "Lager, lime and No. 03. Salt the rim or leave it.",
    // copy-audit-approved: R-13 (a single-serve build)
    build: [
      "330 ml lager",
      "25 ml No. 03 SMOKE",
      "15 ml lime. Ice to the top.",
    ],
    brine: "no-03-smoke",
    glass: "highball",
  },
  {
    id: "oysters",
    kicker: "No cooking",
    title: "Straight over oysters",
    line: "A teaspoon of No. 04 on the shell, where a mignonette would go.",
    build: [
      "1 tsp No. 04 WILD",
      "Six oysters, opened cold",
      "No lemon needed.",
    ],
    brine: "no-04-wild",
    glass: "shell",
  },
];

/** The culinary half of the positioning, kept out of the drinks grid. */
export const KITCHEN = {
  kicker: "And in the kitchen",
  title: "It was a brine before it was a mixer.",
  line: "One part No. 01 to three parts water. Twelve hours on a chicken, then roast it dry. The same measure works on pork shoulder over two days.",
  spec: [
    "1 : 3 with water",
    "12 hours, covered, in the fridge",
    "Pat dry before heat",
  ],
} as const;

/* ------------------------------------------------------------------ proof */

export interface ProcessStep {
  readonly index: string;
  readonly name: string;
  readonly detail: string;
}

export const PROCESS: readonly ProcessStep[] = [
  {
    index: "01",
    name: "Cure",
    // copy-audit-approved: TH-02 (the food sense of "cure" — COPY-RULES §3A Group B carve-out)
    detail:
      "Cucumbers, dill, garlic and black peppercorn go into salt brine. Three weeks in a 400-litre tank. Nothing is rushed to make a number look better.",
  },
  {
    index: "02",
    name: "Read",
    detail:
      "Every tank is read against the batch spec before it leaves. A brine that misses the spec is not thinned to hit it.",
  },
  {
    index: "03",
    name: "Filter",
    detail:
      "No. 02 takes a second filter so a stirred drink stays clear. No. 01 and No. 03 keep the haze, because that is where they taste of something.",
  },
  {
    index: "04",
    name: "Fill",
    detail:
      "500 ml of flint glass, a cap you can open one-handed, and the batch number printed on the bottle rather than kept in a database.",
  },
];

export interface SpecFigure {
  readonly value: string;
  readonly unit: string;
  readonly label: string;
}

export const SPEC_FIGURES: readonly SpecFigure[] = [
  { value: "400", unit: "L", label: "Batch size, fixed" },
  { value: "3", unit: "wk", label: "Cure time" },
  { value: "500", unit: "ml", label: "Flint glass" },
  { value: "4", unit: "", label: "In the range" },
];

/* ------------------------------------------------------------ navigation */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /** True for links that jump inside this page rather than leaving it. */
  readonly local?: boolean;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { href: "#range", label: "The range", local: true },
  { href: "#serves", label: "What it's for", local: true },
  { href: "#making", label: "How it's made", local: true },
  { href: "/recipes", label: "Recipes" },
  { href: "/stockists", label: "Stockists" },
];

export const FOOTER_NAV: readonly {
  readonly heading: string;
  readonly items: readonly NavItem[];
}[] = [
  {
    heading: "Bottles",
    items: [
      { href: "#range", label: "The range", local: true },
      { href: SHOP_HREF, label: "Shop all" },
      { href: fullSetHref(), label: "The Full Set" },
    ],
  },
  {
    heading: "Behind the bar",
    items: [
      { href: "#serves", label: "What it's for", local: true },
      { href: "/recipes", label: "Recipes" },
      { href: "/stockists", label: "Stockists" },
    ],
  },
  {
    heading: "The house",
    items: [
      { href: "#making", label: "How it's made", local: true },
      { href: "/story", label: "The story" },
      { href: "/suppliers", label: "Sourcing register" },
    ],
  },
  {
    heading: "Trade",
    items: [
      { href: "/wholesale", label: "Wholesale" },
      { href: "mailto:hello@halfsour.co.nz", label: "hello@halfsour.co.nz" },
    ],
  },
];

/* -------------------------------------------------------------- utilities */

/** "$18" — prices are whole dollars in NZD and are set in the mono face. */
export function price(nzd: number): string {
  return `$${nzd}`;
}

/** "500 ML" — the label's own form. */
export function volume(ml: number): string {
  return `${ml} ML`;
}
