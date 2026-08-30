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

/**
 * The canonical collection page. `/products` also resolves — it is a permanent
 * redirect kept for older links — but the homepage's own call to action should
 * not spend a hop on it.
 */
export const SHOP_HREF = "/shop";

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

/**
 * The three-bottle box (01–03), which commerce carries as its own product.
 *
 * NAMED FOR WHAT IS IN IT. It was "The Full Set" while the range was three
 * bottles; No 04 WILD made that a claim about composition rather than a name —
 * a set sold as full that is missing a quarter of the range is caught by Fair
 * Trading Act s 13(a) (kind, quantity, composition), not merely by good taste.
 * "The First Three" leans on the numbering the labels already carry, is
 * literally true, and reads as though No 04 sits beyond it rather than having
 * been forgotten. The handle stays `the-full-set`: a live URL that 404s costs
 * more than a stale slug, and there is no redirect layer to catch it.
 */
export const FULL_SET = {
  handle: "the-full-set",
  name: "THE FIRST THREE",
  descriptor: "One each of 01, 02 and 03",
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
  // copy-audit-approved: R-13 (a glass shape, not a measure — ASA alcohol code checked)
  readonly glass: "shot" | "coupe" | "highball" | "shell";
}

export const SERVES: readonly Serve[] = [
  {
    // copy-audit-approved: R-13 (the slug of a named serve)
    id: "pickleback",
    kicker: "Two glasses",
    // copy-audit-approved: R-13 (a named serve; the line and build below carry the same check)
    title: "The pickleback",
    // copy-audit-approved: R-13 (a named serve; no encouragement of rapid or excessive drinking, no under-18 framing, no suggestion it offsets alcohol)
    line: "Whiskey first. Brine straight after, cold, from the fridge.",
    // copy-audit-approved: R-13 (measures for a single serve, stated once)
    build: ["30 ml whiskey", "30 ml No. 01 HOUSE", "Both cold. No ice."],
    brine: "no-01-house",
    // copy-audit-approved: R-13 (a glass shape)
    glass: "shot",
  },
  {
    // copy-audit-approved: R-13 (the slug of a named serve)
    id: "dirty-martini",
    kicker: "Stirred",
    // copy-audit-approved: R-13 (§5.3 names the dirty martini as safe use-and-occasion vocabulary)
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

/* -------------------------------------------------------------------- buy */

/**
 * The conversion block.
 *
 * It used to carry two `mailto:` links and a note explaining that there was no
 * form behind either of them. Both are gone. The list is a real one-field form
 * posting to a Server Action that writes to a table (`components/site/`), and
 * the trade route is a page with the price on it rather than an invitation to
 * write a letter and wait two working days. The honesty note that sat here was
 * true when it was written and would be a lie now, so it went with them.
 */
export const BUY = {
  kicker: "Getting hold of it",
  title: "Buy a bottle.",
  // copy-audit-approved: R-04 (a stated dispatch rhythm, not urgency)
  line: "Four brines, 500 ml each. We pick and pack on Tuesdays and Thursdays, so a Friday order moves on Tuesday.",
  shop: {
    href: SHOP_HREF,
    label: "Shop the range",
    line: "Every bottle, plus the box of three.",
  },
  trade: {
    href: "/wholesale",
    label: "See the trade price",
    heading: "For a bar or a kitchen.",
    line: "The trade price, the case size and the cost per pour, published on one page. No enquiry, no wait.",
  },
} as const;

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
];

/**
 * The destinations that are not on this page.
 *
 * One list, rendered by BOTH mastheads — the homepage's and the shop's — so a
 * route that ships appears in the navigation everywhere at once instead of in
 * whichever header somebody remembered. `routes.ts` filters it, so a link here
 * that is not deployed is simply not drawn rather than drawn at a 404.
 *
 * Ordered the way a visitor needs them rather than the way the site is built:
 * the bottles first, then what to do with them, then the trade door, then the
 * two the range still owes.
 */
export const SITE_NAV: readonly NavItem[] = [
  { href: SHOP_HREF, label: "Shop" },
  { href: "/recipes", label: "Recipes" },
  { href: "/wholesale", label: "Wholesale" },
  { href: "/story", label: "The story" },
  { href: "/stockists", label: "Stockists" },
];

/** What the small-screen disclosure calls itself. Never a bare icon. */
export const NAV_MENU_LABEL = "Menu";

/** The masthead's home link, named for a screen reader and drawn as the wordmark. */
export const NAV_HOME_LABEL = "Half Sour — home";

/**
 * The masthead's one call to action, kept out of PRIMARY_NAV so it can be
 * styled as a control rather than a list item.
 */
export const HEADER_CTA: NavItem = {
  href: "#buy",
  label: "Buy",
  local: true,
};

export const FOOTER_NAV: readonly {
  readonly heading: string;
  readonly items: readonly NavItem[];
}[] = [
  {
    heading: "Bottles",
    items: [
      { href: "#range", label: "The range", local: true },
      { href: SHOP_HREF, label: "Shop all" },
      { href: fullSetHref(), label: "The First Three" },
      { href: "#buy", label: "How to buy", local: true },
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
      { href: "/delivery", label: "Delivery and returns" },
      { href: "/terms", label: "Terms of sale" },
    ],
  },
  {
    heading: "Trade",
    items: [
      { href: "/wholesale", label: "Wholesale" },
      { href: "/wholesale#samples", label: "Ask for two samples" },
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
