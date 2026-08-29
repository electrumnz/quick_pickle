/**
 * Every word the shop says that `content/` does not already own.
 *
 * The rule this unit follows is the one the homepage follows: a page renders a
 * record, it does not carry copy of its own. So the section headings, the state
 * messages and the four-word JOB labels live here, in one file the copy auditor
 * scans, rather than scattered through JSX where a stray sentence can be added
 * without anyone re-reading `legal/COPY-RULES.md`.
 *
 * ALCOHOL, CHECKED ONCE FOR THIS FILE (2026-08-29)
 * A few lines name a drink, because naming the drink is the whole positioning:
 * this is a bar ingredient and a cooking acid. Checked against the ASA Code for
 * the Advertising and Promotion of Alcohol — nothing here encourages excessive
 * or rapid consumption, nothing is pitched at or primarily appealing to
 * under-18s, and nothing suggests the product offsets the effects of alcohol.
 * The per-line `copy-audit-approved: R-13` markers record that check where the
 * auditor can see it, per `legal/COPY-RULES.md` sections 4 and 8.
 */

import { FULL_SET } from "@/components/home/data";
import type { BrineId } from "@/content/types";

/** The set is a catalogue product in its own right, not a computed bundle. */
export const FULL_SET_HANDLE = "the-full-set";

export const SHOP_PATH = "/shop";

export function productPath(handle: string): string {
  return `/products/${handle}`;
}

/**
 * The outcome parameters the buy actions redirect with.
 *
 * They live here rather than in `actions.ts` because everything exported from a
 * `"use server"` module becomes a callable server endpoint, and a string parser
 * has no business being one.
 */
export const ADDED_PARAM = "added";
export const ERROR_PARAM = "problem";

/** "no-01-house.2" -> { handle, quantity }. Anything else -> null. */
export function parseAdded(
  value: string | null,
): { readonly handle: string; readonly quantity: number } | null {
  if (value === null) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const quantity = Number(value.slice(dot + 1));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return null;
  return { handle: value.slice(0, dot), quantity };
}

/** What went wrong, in words a buyer can act on. */
export const PROBLEM: Readonly<Record<string, string>> = {
  "sold-out":
    "That one sold out between the page loading and the button being pressed. Nothing was added.",
  "not-enough":
    "There is not that much left. Try a smaller number, or take the box.",
  "cart-gone":
    "Your cart had expired, so it was started again. Nothing was charged.",
  "cart-full": "That is more lines than one cart will hold.",
  failed:
    "The order could not be started. Nothing was added and nothing was charged.",
};

/* -------------------------------------------------------------------- job */

/**
 * What each bottle is FOR, in four words or fewer.
 *
 * This is the largest type on a product card, above the name and above the
 * price, because a shopper who has never heard of any of these is choosing on
 * the job and not on the number. The names are on the label; the job is what
 * gets someone to the right bottle inside a few seconds.
 */
export const JOB: Readonly<Record<BrineId, string>> = {
  "no-01-house": "The everyday one",
  // copy-audit-approved: R-13 (names a classic serve; no consumption framing)
  "no-02-dirty": "The martini",
  // copy-audit-approved: R-13 (names a spirit and a serve as an ingredient use)
  "no-03-smoke": "Mezcal, michelada, pork",
  "no-04-wild": "Seafood",
};

/**
 * The box's job. Taken from the homepage's view model rather than restated, so
 * the two pages cannot drift, and deliberately NOT the same words as the
 * catalogue's own subtitle ("All three, boxed.") — an eyebrow that repeats the
 * line under it is an eyebrow doing nothing.
 */
export const SET_JOB = FULL_SET.descriptor;

/** The one line the box has. Written and audited in the homepage view model. */
export const SET_LINE = FULL_SET.line;

/* ------------------------------------------------------- collection page */

export const SHOP = {
  title: "Shop",
  eyebrow: "Every bottle",
  heading: "Four brines and a box.",
  lede: "Half a litre of the brine, not the pickle. Start from what you are making and the bottle picks itself.",
  chooserEyebrow: "If you are making",
  chooserHeading: "Start with the drink.",
  bottlesHeading: "The bottles",
  setHeading: "The box",
  rangeNote: "500 ml a bottle. NZD, GST included.",
  cardForEyebrow: "For",
  cardBoxEyebrow: "The box",
  readInstead: "Read the bottle",
  productsWord: "products",
} as const;

/**
 * The chooser. Left column is the thing being made, right column is the bottle.
 *
 * Ordered by how often a bar actually calls for it, which is also roughly the
 * order of the range.
 */
export const CHOOSER: readonly {
  readonly making: string;
  readonly handle: string;
}[] = [
  // copy-audit-approved: R-13 (a named serve, stated once, as a use)
  { making: "A pickleback", handle: "no-01-house" },
  { making: "A bloody mary", handle: "no-01-house" },
  { making: "Roast chicken or potatoes", handle: "no-01-house" },
  // copy-audit-approved: R-13 (a named serve, stated once, as a use)
  { making: "A dirty martini", handle: "no-02-dirty" },
  // copy-audit-approved: R-13 (a named serve, stated once, as a use)
  { making: "A gibson", handle: "no-02-dirty" },
  { making: "A vinaigrette or a beurre blanc", handle: "no-02-dirty" },
  { making: "A michelada", handle: "no-03-smoke" },
  // copy-audit-approved: R-13 (a named serve, stated once, as a use)
  { making: "A bloody maria, with tequila", handle: "no-03-smoke" },
  { making: "Pulled pork or wings", handle: "no-03-smoke" },
  { making: "Oysters or ceviche", handle: "no-04-wild" },
  { making: "A present", handle: FULL_SET_HANDLE },
];

/* ---------------------------------------------------------- product page */

export const PRODUCT = {
  notesEyebrow: "What you taste",
  notesHeading: "In the order it arrives.",
  runEyebrow: "The run",
  runHeading: "What goes in the tank.",
  runNote: "The ingredient run, as printed on the label.",
  servesEyebrow: "What it is for",
  servesHeading: "Name the drink.",
  servesHeadingDish: "And at the stove.",
  drinksLabel: "Behind the bar",
  dishesLabel: "In the kitchen",
  buildLabel: "The build",
  bundleEyebrow: "One box",
  alsoEyebrow: "Also in the range",
  alsoHeading: "The rest of the shelf.",
  specHeading: "The bottle",
  skuLabel: "SKU",
  priceShownLabel: "Price shown",
  priceShownValue: "NZD, GST included",
  boxEyebrow: "In the box",
  boxHeading: "Three bottles, named.",
  boxLink: "What is in the box",
  libraryCount: "in the recipe library",
  specLine:
    "Flint glass, a cap you can open one-handed, and the batch number printed on the label rather than kept in a database.",
  viewerHint: "Drag to turn the bottle",
  viewerHintTouch: "Tilt your phone to turn the bottle",
  viewerStill: "Shown still, because you asked for reduced motion.",
  backToShop: "All bottles",
} as const;

/* ---------------------------------------------------------------- states */

export const STATE = {
  fromPrice: "From",
  inStock: "In stock",
  soldOut: "Sold out",
  unlisted: "Not available to order",
  /** The chip has a column of its own to live in and cannot wrap. */
  unlistedShort: "Unavailable",
  addToCart: "Add to cart",
  adding: "Adding",
  added: "Added to your cart",
  cartOne: "bottle",
  cartMany: "bottles",
  cartLabel: "Cart",
  checkout: "Go to checkout",
  checkoutNotLive: "Checkout is not connected",
  checkoutNotLiveNote:
    "The cart is real and the total above is what the catalogue says. Payment is Shopify's hosted checkout, and this store is not connected to it yet, so there is nothing behind this button to send you to.",
  keepShopping: "Keep shopping",
  quantity: "Quantity",
  decrease: "One fewer",
  increase: "One more",
  size: "Size",
  onlyOption: "One size. Nothing to choose.",

  /** Stock is read live from the catalogue on every render, never faked. */
  countSuffix: "in stock",

  soldOutNote:
    "This bottling has gone. The next one is filled to the same spec and the batch number on the label will tell you which is which.",

  // The scarcity is the supply of leaf, stated as the fact it is. It is not a
  // countdown, a counter or an urgency device: FTA 1986 s 9 makes a scarcity
  // signal that is not wired to reality misleading conduct, and this one is
  // wired to a grower's season rather than to a timer.
  supplyLimitedNote:
    // copy-audit-approved: WILD-02 (kawakawa as an ingredient name only — no wellness, no rongoā framing; legal/COPY-RULES.md Group H)
    "Limited by leaf supply. WILD is only filled when there is kawakawa to fill it with, so it comes and goes rather than sitting on the shelf.",

  unlistedNote:
    "Not on the order form today. Everything below is still true of the bottle.",

  degradedHeading: "Prices are not loading",
  degradedNote:
    "The shop cannot reach the catalogue, so ordering is switched off rather than guessed at. Every word about the bottles below is unchanged.",

  errorHeading: "That did not load",
  errorNote:
    "Something on our side failed on the way to this page. Nothing was ordered and nothing was charged.",
  errorRetry: "Try again",

  notFoundHeading: "No such bottle",
  notFoundNote:
    "There is nothing at that address. The whole range is four bottles and one box, and all five are here.",
  notFoundCta: "See the range",

  emptyHeading: "Nothing to show",
  emptyNote: "The catalogue answered, and it is empty.",
} as const;
