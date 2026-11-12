/**
 * The offer: what Quick Pickle sells, for how much, and how it gets there.
 *
 * This is where every commercial fact starts, and what the shop sells with
 * no database at all. The back end can lay a short, closed list of changes
 * over it (a price, a delivery rate, the ship date, pre-order or live:
 * lib/shop/offer.ts), so the shop's code never reads this file for a price:
 * it asks for the offer. Nothing a browser sends is ever trusted for a
 * price (see lib/shop/pricing.ts).
 *
 * ## Facts that are still placeholders
 *
 * Ashleigh's brand pack does not yet say what the pack sizes, prices,
 * ingredients, ship date or delivery rates are. Rather than leave
 * holes in the page, each of those carries a sensible stand-in below and is
 * listed in {@link UNCONFIRMED}. While that list is not empty:
 *
 *   - the site tells search engines to stay away (app/robots.ts and the
 *     shop's layout),
 *   - the checkout says plainly that it is in test mode,
 *   - `npm run prelaunch` exits non-zero and names what is missing.
 *
 * There is deliberately no banner on the public pages saying any of this.
 * Test mode is explained once, on the checkout, where a visitor would
 * otherwise expect a card field.
 *
 * To confirm a fact: every one of them is set and confirmed in the back
 * end, with no deploy. Prices, delivery rates, the ship date and the
 * contact address are in Settings, The shop; what the label says and who
 * the company is are in Settings, The label and the company; an owner says
 * each is right on the go-live list. lib/shop/offer.ts lays those changes
 * over this file. When nothing is left open the gate opens.
 *
 * Money is integer cents, always. Never a float in a price path.
 */

export type LaunchMode = "preorder" | "live";

export type Pack = {
  /** Stable identifier. Appears on orders; do not reuse for a different pack. */
  readonly sku: string;
  readonly shots: number;
  readonly name: string;
  /** One line that says who the pack is for. */
  readonly blurb: string;
  /** NZD cents, GST-inclusive when the business is GST-registered. */
  readonly priceCents: number;
  /** The pack the page opens on. Exactly one. */
  readonly featured?: boolean;
};

export const STORE = {
  name: "Quick Pickle",
  currency: "NZD",
  locale: "en-NZ",
  /**
   * `preorder`: buttons say pre-order and the ship date is stated everywhere
   * a price is. `live`: stock is on the shelf and ships as ordered.
   */
  launchMode: "preorder" as LaunchMode,
  /** What the first run is called on the page. */
  batchName: "Batch 001",
  /**
   * ISO date (YYYY-MM-DD) the pre-order batch ships from, or null until it is
   * locked in. Null renders as "date to be confirmed" and never as a guess.
   */
  preorderShipsFrom: null as string | null,
  /** Where customers write to. Null hides the address rather than faking one. */
  contactEmail: null as string | null,
  /** Whether prices include GST. Null until the registration is confirmed. */
  gstRegistered: null as boolean | null,
} as const;

export const PRODUCT = {
  name: "Quick Pickle",
  kind: "Pickle juice shots",
  /**
   * Millilitres per shot. Confirmed 12 November 2026, with photos of the
   * real thing: a 100 ml food-grade plastic bottle with a white screw cap.
   */
  shotVolumeMl: 100 as number | null,
  /**
   * The ingredients list, word for word as the label prints it, or null.
   * Never guessed: an ingredient named here is a statement of composition.
   * An owner types it in the back end with the printed label in hand
   * (Settings, The label and the company); anything put here is only where
   * that starts.
   */
  ingredients: null as string | null,
  /**
   * The label's allergen line ("Contains: ..."), or null. Null says nothing
   * either way: the site never states that there are no allergens.
   */
  contains: null as string | null,
  /** Storage line from the label ("Refrigerate after opening"), or null. */
  storage: null as string | null,
} as const;

/**
 * Who is behind the shop. Every one null until it is known: the terms of
 * sale say nothing they cannot stand behind. Set in the back end (Settings,
 * The label and the company).
 */
export const COMPANY = {
  /** The legal name of whoever sells it, as it is registered. */
  legalName: null as string | null,
  /** New Zealand Business Number: 13 digits. */
  nzbn: null as string | null,
  /** Where the business is, on one line. */
  address: null as string | null,
  /** GST number (the IRD number), digits only, once it is registered. */
  gstNumber: null as string | null,
} as const;

/** Smallest first. The page and the jar both rely on that order. */
export const PACKS: readonly Pack[] = [
  {
    sku: "QP-SHOT-06",
    shots: 6,
    name: "The Trial",
    blurb: "Six shots. Enough to find out if you pull the face.",
    priceCents: 2700,
  },
  {
    sku: "QP-SHOT-12",
    shots: 12,
    name: "The Starter",
    blurb: "A dozen. A few for you, a few to shout the team.",
    priceCents: 4800,
    featured: true,
  },
  {
    sku: "QP-SHOT-24",
    shots: 24,
    name: "The Squad",
    blurb: "Twenty-four. One box and the whole side is sorted.",
    priceCents: 8400,
  },
];

export const SHIPPING = {
  /** Flat rate to an urban New Zealand address, cents. */
  standardCents: 700,
  /** Added on top for a rural delivery address, cents. */
  ruralSurchargeCents: 450,
  /** Order value (before delivery) at which standard delivery is free. */
  freeOverCents: 6000,
  /** The only country the checkout accepts. */
  country: "NZ",
} as const;

/** Most packs of one size a single order may hold. */
export const MAX_PACKS_PER_LINE = 10;

export type Unconfirmed = {
  readonly key: string;
  /** What is missing, in plain words. */
  readonly what: string;
  /** Who can settle it. */
  readonly ask: string;
};

/**
 * Every commercial fact on the site that is still a stand-in.
 * Delete a line the moment the real value is in.
 */
export const UNCONFIRMED: readonly Unconfirmed[] = [
  {
    key: "packs",
    what: "Pack sizes, names and prices (The Trial, The Starter and The Squad, in 6, 12 and 24, started as stand-ins)",
    ask: "Ashleigh",
  },
  {
    key: "ingredients",
    what: "What the label says: the ingredients list, the allergen line if it has one, and the storage line",
    ask: "Ashleigh",
  },
  {
    key: "ship-date",
    what: "The date pre-orders ship from",
    ask: "Ashleigh",
  },
  {
    key: "shipping-rates",
    what: "Where we deliver and what it costs (New Zealand only, and all three delivery rates, started as stand-ins)",
    ask: "a courier, for a quote",
  },
  {
    key: "returns-promises",
    // copy-audit-approved: R-19 (a go-live note shown only in the back end; it describes the policy in content/policies.ts)
    what: "The promises in the fine print: a replacement or refund if an order arrives damaged, and a full refund on a pre-order cancelled before it ships",
    ask: "whoever runs the business side",
  },
  {
    key: "contact-email",
    what: "The customer email address",
    ask: "whoever runs the business side",
  },
  {
    key: "legal-entity",
    what: "Who is behind the store: the legal name, the NZBN, the address, and whether it is registered for GST",
    ask: "whoever runs the business side",
  },
];
