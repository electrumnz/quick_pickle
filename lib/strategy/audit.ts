/**
 * THE AVATAR AUDIT — the storefront, tested against the two people it is for.
 *
 * An avatar written into a document is a document. An avatar written as
 * assertions about the live store is a test, and a test is a thing that can be
 * wrong in public. Every check below is one binary question asked of real
 * fetched HTML, and every one of them carries the two things that make a red
 * check actionable: which avatar it serves, and what it costs when it fails.
 *
 * Rules the checks are written to:
 *
 *  1. **It reads the page, not the plan.** A check that inspected
 *     `content/strategy/avatars.ts` would pass forever and prove nothing. Every
 *     predicate here takes fetched HTML from `audit-pages.ts`.
 *  2. **Binary.** Passed or failed, with a `detail` that quotes the page. There
 *     is no "partially".
 *  3. **A failure has to be worth fixing.** `whyItMatters` is the sentence the
 *     founder reads at 9pm; if it cannot be written without hedging, the check
 *     should not exist.
 *  4. **Derived, not invented.** `derivedFrom` names the avatar field the check
 *     comes from, so a change to the avatar can be traced to the checks it
 *     ought to move.
 *
 * The canonical range data — names, prices, handles, which bottle is limited by
 * supply — is imported from `content/brines.ts` rather than retyped, so a check
 * cannot pass because the audit and the storefront share a stale assumption.
 */

import { ALL_BRINES } from "@/content/brines";
import type { AudienceId } from "@/content/strategy/types";

import type { RenderedPage, StorefrontPages } from "./audit-pages";

/* ------------------------------------------------------------- the shapes */

/**
 * How much a red check costs.
 *
 * - `blocking` a person in the avatar cannot complete the thing they came for.
 * - `serious`  they can, but a predictable share of them will not.
 * - `friction` it costs trust or a repeat rather than the first order.
 */
export type AuditSeverity = "blocking" | "serious" | "friction";

export const SEVERITY_ORDER: readonly AuditSeverity[] = [
  "blocking",
  "serious",
  "friction",
];

/** What a predicate answers. */
export interface CheckOutcome {
  readonly passed: boolean;
  /** What was actually on the page. Quoted, not summarised. */
  readonly detail: string;
}

/** One binary question about the live storefront. */
export interface AuditCheck {
  readonly id: string;
  readonly avatar: AudienceId;
  /** The question, as a person would ask it out loud. */
  readonly question: string;
  /** What failing costs, in plain words. */
  readonly whyItMatters: string;
  readonly severity: AuditSeverity;
  /** The avatar field this comes from. */
  readonly derivedFrom: string;
  /** What to do about a failure. Shared `fix` strings group in the admin. */
  readonly fix: string;
  /** Paths this check reads. The runner fetches the union of these. */
  readonly paths: readonly string[];
  run(pages: PageIndex): CheckOutcome;
}

/** A check's result, flattened so it can cross a serialisation boundary. */
export interface AuditFinding {
  readonly id: string;
  readonly avatar: AudienceId;
  readonly question: string;
  readonly whyItMatters: string;
  readonly severity: AuditSeverity;
  readonly derivedFrom: string;
  readonly fix: string;
  readonly paths: readonly string[];
  readonly passed: boolean;
  readonly detail: string;
}

export interface AuditScore {
  readonly avatar: AudienceId;
  readonly passed: number;
  readonly total: number;
  /** Failing checks at `blocking`. The number that decides whether to ship. */
  readonly blocking: number;
}

/** One fix, and every check waiting on it. */
export interface FixGroup {
  readonly fix: string;
  readonly severity: AuditSeverity;
  readonly checkIds: readonly string[];
}

export interface AuditRun {
  readonly baseUrl: string;
  readonly ranAt: string;
  readonly findings: readonly AuditFinding[];
  readonly scores: readonly AuditScore[];
  readonly passed: number;
  readonly total: number;
  /** Failing checks, worst first, then grouped by the fix that clears them. */
  readonly fixFirst: readonly FixGroup[];
  /** Pages that could not be fetched at all. An audit on nothing is not a pass. */
  readonly unreachable: readonly string[];
}

/* ------------------------------------------------------------- the pages */

export const HOME = "/";
export const SHOP = "/shop";
export const RECIPES = "/recipes";
/** Either address is a trade destination; neither exists today. */
export const TRADE_PATHS = ["/wholesale", "/trade"] as const;

export const PRODUCT_PATHS: readonly string[] = ALL_BRINES.map(
  (brine) => `/products/${brine.handle}`,
);

/** The bottle both avatars are sent to first. */
export const LEAD_PRODUCT = "/products/no-02-dirty";

/**
 * Pages, indexed by path, with the small amount of reading a check does.
 *
 * The helpers are deliberately blunt — find a phrase, find where it is, list
 * the links. A check that needed a parser would be a check nobody could argue
 * with, and every one of these has to be arguable.
 */
export class PageIndex {
  private readonly byPath: ReadonlyMap<string, RenderedPage>;

  constructor(private readonly fetched: StorefrontPages) {
    this.byPath = new Map(fetched.pages.map((page) => [page.path, page]));
  }

  get baseUrl(): string {
    return this.fetched.baseUrl;
  }

  get all(): readonly RenderedPage[] {
    return this.fetched.pages;
  }

  /** The page, or a blank one. A check reads a missing page as an empty page. */
  page(path: string): RenderedPage {
    return (
      this.byPath.get(path) ?? {
        path,
        status: 0,
        ok: false,
        title: "",
        text: "",
        html: "",
        links: [],
        error: "not fetched",
      }
    );
  }

  text(path: string): string {
    return this.page(path).text;
  }
}

/* ------------------------------------------------------------- predicates */

/** Case-insensitive position of a phrase, or -1. */
function at(haystack: string, needle: string): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase());
}

function has(haystack: string, needle: string): boolean {
  return at(haystack, needle) !== -1;
}

function hasAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => has(haystack, needle));
}

/** A short quotation of what surrounds a phrase, for the detail line. */
function around(text: string, index: number, width = 90): string {
  if (index < 0) return "";
  const start = Math.max(0, index - width / 3);
  return `…${text.slice(start, index + width).trim()}…`;
}

function pass(detail: string): CheckOutcome {
  return { passed: true, detail };
}

function fail(detail: string): CheckOutcome {
  return { passed: false, detail };
}

/** Links that go somewhere on the site rather than into an email client. */
function siteLinks(
  page: RenderedPage,
): readonly { href: string; text: string }[] {
  return page.links.filter(
    (link) => !link.href.startsWith("mailto:") && !link.href.startsWith("tel:"),
  );
}

/**
 * The words the storefront's own serve vocabulary is built from.
 *
 * Used by one check — whether the first screen of the homepage names a drink or
 * a dish at all. It is a list rather than a regex because the question is
 * literally "does it name a serve", and the answer has to be readable in the
 * detail line when it fails.
 */
const SERVE_WORDS: readonly string[] = [
  "drink",
  "glass",
  "martini",
  "pickleback",
  "michelada",
  "oyster",
  "roast",
  "pour",
  "stirred",
];

const DELIVERY_WORDS: readonly string[] = [
  "courier",
  "delivery",
  "deliver",
  "shipping",
  "postage",
  "freight",
  "ships ",
];

const TRADE_WORDS: readonly string[] = ["trade", "wholesale", "stockist"];

/* --------------------------------------------------------------- B2C ---- */

const B2C_CHECKS: readonly AuditCheck[] = [
  {
    id: "b2c-bottle-names-its-job",
    avatar: "b2c",
    question:
      "Can she tell which of the four bottles is hers without reading a paragraph?",
    whyItMatters:
      "Four bottles that look like four flavours are a decision. Four bottles that each name a job are a shortlist of one. A visitor who cannot choose does not buy the safe one — she closes the tab.",
    severity: "blocking",
    derivedFrom: "avatars.b2c.whatStopsThem[Which of the four is mine?]",
    fix: "Keep the one-line job beside every bottle name on the collection page.",
    paths: [SHOP],
    run(pages) {
      const text = pages.text(SHOP);
      const missing: string[] = [];
      for (const brine of ALL_BRINES) {
        const name = `No. ${brine.number} ${brine.name}`;
        const nameAt = at(text, name);
        const lineAt = at(text, brine.line.split(".")[0] ?? brine.line);
        if (nameAt === -1 || lineAt === -1 || Math.abs(lineAt - nameAt) > 200) {
          missing.push(name);
        }
      }
      return missing.length === 0
        ? pass(
            `All four bottles carry their job within 200 characters of their name on ${SHOP}.`,
          )
        : fail(`No job line found beside: ${missing.join(", ")} on ${SHOP}.`);
    },
  },
  {
    id: "b2c-price-before-the-click",
    avatar: "b2c",
    question:
      "Is the price of every bottle visible before she clicks into one?",
    whyItMatters:
      "She is comparing a $20 bottle against a $12 jar of olives in her head. A price behind a click makes her do that comparison four times, and the fourth time she stops.",
    severity: "serious",
    derivedFrom: "avatars.b2c.price.comparedWith",
    fix: "Keep every price on the collection page.",
    paths: [SHOP],
    run(pages) {
      const text = pages.text(SHOP);
      const missing = ALL_BRINES.filter(
        (brine) => !has(text, `$${String(brine.priceNzd)}`),
      ).map((brine) => `No. ${brine.number} ${brine.name}`);
      return missing.length === 0
        ? pass(`Every bottle price is on ${SHOP} without a click.`)
        : fail(`No price on ${SHOP} for: ${missing.join(", ")}.`);
    },
  },
  {
    id: "b2c-price-per-drink-before-the-ask",
    avatar: "b2c",
    question:
      "Before it asks for $20, does the product page show what to do with the bottle and how many times?",
    whyItMatters:
      "She prices this against a $24 drink at a bar, and the two things that make $20 obvious — the pour count and one ratio she could follow tonight — both sit below the buy button. The button is asking her to decide before the page has given her anything to decide with.",
    severity: "serious",
    derivedFrom: "avatars.b2c.price.anchor",
    fix: "Put the pour count and one build — the ratio — above the buy control on every product page.",
    paths: [LEAD_PRODUCT, "/products/no-01-house"],
    run(pages) {
      const problems: string[] = [];
      for (const path of [LEAD_PRODUCT, "/products/no-01-house"]) {
        const text = pages.text(path);
        const buy = at(text, "add to cart");
        if (buy === -1) {
          problems.push(`${path}: no buy control found`);
          continue;
        }
        // The pour count ("About 25 ×") and the first build line that measures
        // the brine itself ("20 ml No. 02"). Both are on the page already; the
        // question is only whether they arrive before the ask.
        const pours = /about\s+\d+\s*×/i.exec(text);
        const build = /\d+\s*ml\s+No\.\s*\d+/i.exec(text);
        if (pours === null || pours.index > buy) {
          problems.push(
            pours === null
              ? `${path}: no pour count anywhere`
              : `${path}: pour count ${String(pours.index - buy)} characters below the buy control`,
          );
        }
        if (build === null || build.index > buy) {
          problems.push(
            build === null
              ? `${path}: no build with a measure of the brine anywhere`
              : `${path}: the first build ("${build[0]}") is ${String(build.index - buy)} characters below the buy control`,
          );
        }
      }
      return problems.length === 0
        ? pass("The pour count and a build both come before the buy control.")
        : fail(problems.join("; "));
    },
  },
  {
    id: "b2c-delivery-cost-on-the-path",
    avatar: "b2c",
    question:
      "Can she find out what it costs to get the bottle to her, before the checkout?",
    whyItMatters:
      "A courier charge on an $18 bottle can be half the price of the bottle. Unstated, it is discovered at the last step of a checkout she has already committed to — which is the commonest abandoned cart in New Zealand direct-to-consumer, and the one she never comes back from.",
    severity: "blocking",
    derivedFrom: "avatars.b2c.price.hiddenCost",
    fix: "Put the delivery charge and the dispatch day on the shop page and every product page.",
    paths: [SHOP, LEAD_PRODUCT],
    run(pages) {
      const bare: string[] = [];
      for (const path of [SHOP, LEAD_PRODUCT]) {
        const page = pages.page(path);
        const words = DELIVERY_WORDS.filter((word) => has(page.text, word));
        const linked = siteLinks(page).some((link) =>
          hasAny(`${link.href} ${link.text}`, [
            "shipping",
            "delivery",
            "postage",
          ]),
        );
        if (words.length === 0 && !linked) bare.push(path);
      }
      return bare.length === 0
        ? pass("Delivery is priced or linked on the pages before the cart.")
        : fail(
            `Neither a delivery cost nor a link to one on: ${bare.join(", ")}. None of the words ${DELIVERY_WORDS.join(", ")} appears.`,
          );
    },
  },
  {
    id: "b2c-recipe-library-resolves",
    avatar: "b2c",
    question:
      "The product pages count the recipes for each bottle. Is there a library to send her to?",
    whyItMatters:
      "The recipe library is the low-risk yes — the thing she can take without paying, and the only thing on this site that could honestly earn an email address. Counting recipes on a page with nowhere to read them is a promise the store breaks in the same sentence it makes it.",
    severity: "serious",
    derivedFrom: "avatars.b2c.repeat.whatBringsThemBack",
    fix: "Ship /recipes and link the recipe count to it.",
    paths: [RECIPES, LEAD_PRODUCT],
    run(pages) {
      const library = pages.page(RECIPES);
      const advertised = at(pages.text(LEAD_PRODUCT), "in the recipe library");
      if (library.ok) {
        return pass(`${RECIPES} answers ${String(library.status)}.`);
      }
      return fail(
        `${RECIPES} answers ${String(library.status)}` +
          (advertised === -1
            ? "."
            : `, and ${LEAD_PRODUCT} advertises it anyway: "${around(pages.text(LEAD_PRODUCT), advertised, 40)}"`),
      );
    },
  },
  {
    id: "b2c-reorder-without-an-inbox",
    avatar: "b2c",
    question:
      "Can she ask to be told when the next batch lands, without composing an email?",
    whyItMatters:
      "Two bottles a year is the whole B2C plan, so the second order is not a bonus — it is half the revenue. The only way to reach her between orders is a list, and a list that has to be joined by writing an email gets joined by nobody.",
    severity: "blocking",
    derivedFrom: "avatars.b2c.repeat.whatLosesThem",
    fix: "Put a real sign-up form on the site — one field — and a reorder email at week ten.",
    paths: [HOME, SHOP, LEAD_PRODUCT],
    run(pages) {
      for (const path of [HOME, SHOP, LEAD_PRODUCT]) {
        const page = pages.page(path);
        if (/<input[^>]+type="email"/i.test(page.html)) {
          return pass(`${path} carries an email field.`);
        }
        const signup = siteLinks(page).find((link) =>
          hasAny(`${link.href} ${link.text}`, [
            "newsletter",
            "subscribe",
            "notify",
            "join the list",
            "/list",
          ]),
        );
        if (signup !== undefined) {
          return pass(`${path} links to ${signup.href} to join the list.`);
        }
      }
      const mailto = pages
        .page(HOME)
        .links.find((link) => link.href.startsWith("mailto:"));
      return fail(
        `No email field and no sign-up route on ${HOME}, ${SHOP} or ${LEAD_PRODUCT}. The only way onto the list is ${mailto === undefined ? "nothing at all" : mailto.href}.`,
      );
    },
  },
  {
    id: "b2c-consumer-rights-reachable",
    avatar: "b2c",
    question:
      "If the parcel arrives broken, can she find out where she stands without asking?",
    whyItMatters:
      "The BrandScript promises her rights are set out and that we will not talk her out of them. There is no page where they are set out. A first-time buyer sending $54 to a company she has never heard of is the person that page is for.",
    severity: "friction",
    derivedFrom:
      "avatars.b2c.whatStopsThem[What happens if it arrives broken?]",
    fix: "Publish terms of sale and a delivery page, and link both from the footer.",
    paths: [SHOP, LEAD_PRODUCT, HOME],
    run(pages) {
      for (const path of [SHOP, LEAD_PRODUCT, HOME]) {
        const found = siteLinks(pages.page(path)).find((link) =>
          hasAny(`${link.href} ${link.text}`, [
            "terms",
            "returns",
            "policy",
            "shipping",
          ]),
        );
        if (found !== undefined) {
          return pass(`${path} links to ${found.href}.`);
        }
      }
      return fail(
        `No terms, delivery or returns link on ${HOME}, ${SHOP} or ${LEAD_PRODUCT}. The footers offer one email address and nothing else.`,
      );
    },
  },
  {
    id: "b2c-serve-named-early",
    avatar: "b2c",
    question:
      "In the first few lines of the homepage, does she learn this is for a glass rather than for a shelf she is not on?",
    whyItMatters:
      "The only pickle juice on a New Zealand shelf today is an imported bottle in a running shop, in the supplement aisle. A stranger who reads three lines without meeting a drink files this next to that bottle, and the whole culinary position is lost before she scrolls.",
    severity: "friction",
    derivedFrom:
      "avatars.b2c.insteadToday[The imported bottle in the running shop]",
    fix: "Name a drink or a dish in the first sentence of the homepage.",
    paths: [HOME],
    run(pages) {
      const opening = pages.text(HOME).slice(0, 300);
      const found = SERVE_WORDS.filter((word) => has(opening, word));
      return found.length > 0
        ? pass(`The first 300 characters name: ${found.join(", ")}.`)
        : fail(
            `No serve named in the first 300 characters: "${opening.slice(0, 180)}…"`,
          );
    },
  },
  {
    id: "b2c-every-bottle-has-a-page",
    avatar: "b2c",
    question:
      "Does every bottle in the range have a page of its own that answers with a price?",
    whyItMatters:
      "She arrives from a search or from someone naming one bottle. A bottle without a page is a bottle she cannot buy at the moment she wants it, and No 04 is the one most likely to be named out loud.",
    severity: "blocking",
    derivedFrom: "avatars.b2c.triggers[Somebody poured them a good one]",
    fix: "Keep a resolving product page, with its price, for every bottle in the range.",
    paths: PRODUCT_PATHS,
    run(pages) {
      const broken: string[] = [];
      for (const brine of ALL_BRINES) {
        const path = `/products/${brine.handle}`;
        const page = pages.page(path);
        if (!page.ok) {
          broken.push(`${path} answered ${String(page.status)}`);
        } else if (!has(page.text, `$${String(brine.priceNzd)}`)) {
          broken.push(`${path} shows no price`);
        }
      }
      return broken.length === 0
        ? pass(
            `All ${String(ALL_BRINES.length)} bottles resolve with a price shown.`,
          )
        : fail(broken.join("; "));
    },
  },
];

/* --------------------------------------------------------------- B2B ---- */

const B2B_CHECKS: readonly AuditCheck[] = [
  {
    id: "b2b-trade-destination-resolves",
    avatar: "b2b",
    question: "Is there a page on this site for a venue at all?",
    whyItMatters:
      "The trade cycle runs for weeks against one named human, and it starts the moment a bar manager looks the company up. Today that look-up lands on a storefront with no venue page, so the first impression of a supplier who promises consistency is a 404.",
    severity: "blocking",
    derivedFrom: "avatars.b2b.triggers[A customer asked for it by name]",
    fix: "Ship /wholesale: the trade price, the case size, the pour cost and how to ask for samples, on one page.",
    paths: [...TRADE_PATHS],
    run(pages) {
      const live = TRADE_PATHS.filter((path) => pages.page(path).ok);
      return live.length > 0
        ? pass(`${live.join(", ")} resolves.`)
        : fail(
            TRADE_PATHS.map(
              (path) => `${path} answered ${String(pages.page(path).status)}`,
            ).join("; "),
          );
    },
  },
  {
    id: "b2b-trade-price-published",
    avatar: "b2b",
    question:
      "Can a venue work out its cost per pour without sending an email and waiting?",
    whyItMatters:
      "A bar manager buys on cost per pour on a Monday morning between two services. The BrandScript promises one published trade price so nobody finds out later that another venue got a better one — a price sent privately on request is not published, and it costs two working days at the exact moment they are deciding.",
    severity: "blocking",
    derivedFrom: "avatars.b2b.whatStopsThem[What does it cost me per pour?]",
    fix: "Ship /wholesale: the trade price, the case size, the pour cost and how to ask for samples, on one page.",
    paths: [HOME, SHOP, LEAD_PRODUCT, ...TRADE_PATHS],
    run(pages) {
      for (const page of pages.all) {
        const signal = [
          "trade price",
          "wholesale price",
          "per case",
          "+ gst",
        ].find((phrase) => has(page.text, phrase));
        if (signal !== undefined && /\$\s?\d/.test(page.text)) {
          return pass(
            `${page.path} publishes a trade figure: "${around(page.text, at(page.text, signal), 60)}"`,
          );
        }
      }
      const promise = at(pages.text(HOME), "inside two working days");
      return fail(
        "No trade price anywhere on the site." +
          (promise === -1
            ? ""
            : ` The homepage offers instead: "${around(pages.text(HOME), promise, 60)}"`),
      );
    },
  },
  {
    id: "b2b-case-and-minimum-named",
    avatar: "b2b",
    question: "Does the site say what a case is and what the minimum order is?",
    whyItMatters:
      "Six bottles to a case, never split, is the term that makes the trade margin work at all — and it is a term a venue has to agree to before it orders. Discovering it after the first enquiry reads as a condition that appeared later.",
    severity: "serious",
    derivedFrom:
      "avatars.b2b.whatStopsThem[What is the minimum, and how often do I have to order?]",
    fix: "Ship /wholesale: the trade price, the case size, the pour cost and how to ask for samples, on one page.",
    paths: [HOME, SHOP, LEAD_PRODUCT, ...TRADE_PATHS],
    run(pages) {
      for (const page of pages.all) {
        const phrase = [
          "six bottles",
          "case of six",
          "minimum order",
          "a case is",
        ].find((candidate) => has(page.text, candidate));
        if (phrase !== undefined) {
          return pass(
            `${page.path}: "${around(page.text, at(page.text, phrase), 60)}"`,
          );
        }
      }
      return fail(
        "Neither a case size nor a minimum order appears anywhere on the site. The product pages offer a quantity selector that goes to 12 single bottles.",
      );
    },
  },
  {
    id: "b2b-trade-path-from-a-product-page",
    avatar: "b2b",
    question:
      "From the pages a venue actually lands on, is there a trade route that is not an email address?",
    whyItMatters:
      "A bar manager arriving from a search lands on a bottle, not on the homepage. The footer there offers one address and no trade page, so the venue's next step is to write a letter to a stranger — at 4.30pm, between two services, which means never.",
    severity: "serious",
    derivedFrom: "avatars.b2b.whereTheyAre[Their inbox, at 10am on a Monday]",
    fix: "Ship /wholesale: the trade price, the case size, the pour cost and how to ask for samples, on one page.",
    paths: [SHOP, LEAD_PRODUCT],
    run(pages) {
      const bare: string[] = [];
      for (const path of [SHOP, LEAD_PRODUCT]) {
        const found = siteLinks(pages.page(path)).find((link) =>
          hasAny(`${link.href} ${link.text}`, TRADE_WORDS),
        );
        if (found === undefined) bare.push(path);
      }
      return bare.length === 0
        ? pass("Every landing page carries a trade link.")
        : fail(
            `No trade link that is not a mailto on: ${bare.join(", ")}. The footer's Trade heading is followed by an email address.`,
          );
    },
  },
  {
    id: "b2b-menu-promise-has-a-door",
    avatar: "b2b",
    question:
      "The site tells a stranger this is good enough to put on a menu. If they agree, is there a door?",
    whyItMatters:
      "This is the one line on the homepage aimed at a venue, and it works — it is the positioning. Making the claim and then offering no destination spends the single moment a bar manager is interested, and they do not come back to check whether it was built.",
    severity: "blocking",
    derivedFrom: "avatars.b2b.triggers[A list rewrite]",
    fix: "Ship /wholesale: the trade price, the case size, the pour cost and how to ask for samples, on one page.",
    paths: [HOME, ...TRADE_PATHS],
    run(pages) {
      const text = pages.text(HOME);
      const claim = [
        "on a menu",
        "for a bar",
        "on the list",
        "behind the bar",
      ].find((phrase) => has(text, phrase));
      if (claim === undefined) {
        return pass(
          "The homepage makes no trade claim, so it owes a venue no destination.",
        );
      }
      const live = TRADE_PATHS.filter((path) => pages.page(path).ok);
      return live.length > 0
        ? pass(`The claim is made and ${live.join(", ")} answers it.`)
        : fail(
            `The homepage says "${around(text, at(text, claim), 60)}" and every trade route 404s (${TRADE_PATHS.join(", ")}).`,
          );
    },
  },
  {
    id: "b2b-pour-maths-published",
    avatar: "b2b",
    question:
      "Are the two numbers a venue costs a serve with — millilitres per pour and pours per bottle — on the page?",
    whyItMatters:
      "Cost per pour is trade price divided by pours per bottle. Publishing the pour count means a bar manager can do that division the moment the price exists, without asking anyone.",
    severity: "serious",
    derivedFrom: "avatars.b2b.jobToBeDone",
    fix: "Keep the pour count and the measure on every product page.",
    paths: [LEAD_PRODUCT],
    run(pages) {
      const text = pages.text(LEAD_PRODUCT);
      const pours = /about\s+(\d+)\s*×/i.exec(text);
      const measure = /(\d+)\s*ml\s+a\s+drink/i.exec(text);
      return pours !== null && measure !== null
        ? pass(
            `${LEAD_PRODUCT}: ${pours[1] ?? "?"} pours a bottle at ${measure[1] ?? "?"} ml a serve.`,
          )
        : fail(
            `${LEAD_PRODUCT} states ${pours === null ? "no pour count" : "a pour count"} and ${measure === null ? "no serve measure" : "a serve measure"}.`,
          );
    },
  },
  {
    id: "b2b-batch-traceability-visible",
    avatar: "b2b",
    question:
      "Can a venue see that every bottle is traceable to a batch before it commits?",
    whyItMatters:
      "A venue's real risk with a one-person supplier is not price, it is an off bottle on a Saturday with no answer attached. Batch numbering printed where a buyer reads it is the cheapest trust this company owns.",
    severity: "friction",
    derivedFrom:
      "avatars.b2b.whatStopsThem[Will it still be here in six months?]",
    fix: "Keep the batch-number line on every product page.",
    paths: [LEAD_PRODUCT],
    run(pages) {
      const text = pages.text(LEAD_PRODUCT);
      const index = at(text, "batch number");
      return index === -1
        ? fail(`${LEAD_PRODUCT} does not mention a batch number.`)
        : pass(`${LEAD_PRODUCT}: "${around(text, index, 70)}"`);
    },
  },
  {
    id: "b2b-supply-honesty-on-wild",
    avatar: "b2b",
    question:
      "Wherever the supply-limited bottle is sold, does it say so before someone builds a list around it?",
    whyItMatters:
      "A venue that puts a serve on a printed list and then cannot restock it does not blame the leaf supply, it blames the supplier — and it is the one failure that ends an account permanently. Saying it before the order is what the BrandScript promises.",
    severity: "serious",
    derivedFrom: "avatars.b2b.repeat.whatBringsThemBack",
    fix: "Keep the supply note on the shop page and on the limited bottle's own page.",
    paths: [SHOP, ...PRODUCT_PATHS],
    run(pages) {
      const limited = ALL_BRINES.filter((brine) => brine.supplyLimited);
      const missing: string[] = [];
      for (const brine of limited) {
        const paths = [SHOP, `/products/${brine.handle}`];
        for (const path of paths) {
          if (
            !hasAny(pages.text(path), [
              "leaf supply",
              "limited",
              "comes and goes",
            ])
          ) {
            missing.push(`${brine.name} on ${path}`);
          }
        }
      }
      return missing.length === 0
        ? pass(
            `Every supply-limited bottle (${limited.map((brine) => brine.name).join(", ")}) says so on the shop page and on its own.`,
          )
        : fail(`No supply note for: ${missing.join(", ")}.`);
    },
  },
];

export const AUDIT_CHECKS: readonly AuditCheck[] = [
  ...B2C_CHECKS,
  ...B2B_CHECKS,
];

/** Every path the audit needs, de-duplicated, in a stable order. */
export function auditPaths(
  checks: readonly AuditCheck[] = AUDIT_CHECKS,
): readonly string[] {
  const seen = new Set<string>();
  for (const check of checks) {
    for (const path of check.paths) seen.add(path);
  }
  return [...seen].sort();
}

/* -------------------------------------------------------------- the runner */

function scoreFor(
  avatar: AudienceId,
  findings: readonly AuditFinding[],
): AuditScore {
  const mine = findings.filter((finding) => finding.avatar === avatar);
  return {
    avatar,
    passed: mine.filter((finding) => finding.passed).length,
    total: mine.length,
    blocking: mine.filter(
      (finding) => !finding.passed && finding.severity === "blocking",
    ).length,
  };
}

/** Failing checks, grouped by the fix that clears them, worst first. */
export function fixGroups(
  findings: readonly AuditFinding[],
): readonly FixGroup[] {
  const groups = new Map<string, { severity: AuditSeverity; ids: string[] }>();
  for (const finding of findings) {
    if (finding.passed) continue;
    const existing = groups.get(finding.fix);
    if (existing === undefined) {
      groups.set(finding.fix, {
        severity: finding.severity,
        ids: [finding.id],
      });
      continue;
    }
    existing.ids.push(finding.id);
    if (
      SEVERITY_ORDER.indexOf(finding.severity) <
      SEVERITY_ORDER.indexOf(existing.severity)
    ) {
      existing.severity = finding.severity;
    }
  }
  return [...groups.entries()]
    .map(([fix, group]) => ({
      fix,
      severity: group.severity,
      checkIds: group.ids,
    }))
    .sort((left, right) => {
      const bySeverity =
        SEVERITY_ORDER.indexOf(left.severity) -
        SEVERITY_ORDER.indexOf(right.severity);
      if (bySeverity !== 0) return bySeverity;
      // Then the fix that clears the most checks. One route, five findings.
      return right.checkIds.length - left.checkIds.length;
    });
}

/**
 * Run every check against the fetched pages.
 *
 * Pure: same pages in, same findings out. The fetching happened in
 * `audit-pages.ts` and is not repeated here, so a run can be replayed from
 * saved HTML and produce the same score.
 */
export function runAudit(
  fetched: StorefrontPages,
  checks: readonly AuditCheck[] = AUDIT_CHECKS,
): AuditRun {
  const index = new PageIndex(fetched);
  const findings: AuditFinding[] = checks.map((check) => {
    const outcome = check.run(index);
    return {
      id: check.id,
      avatar: check.avatar,
      question: check.question,
      whyItMatters: check.whyItMatters,
      severity: check.severity,
      derivedFrom: check.derivedFrom,
      fix: check.fix,
      paths: check.paths,
      passed: outcome.passed,
      detail: outcome.detail,
    };
  });

  return {
    baseUrl: fetched.baseUrl,
    ranAt: fetched.fetchedAt,
    findings,
    scores: [scoreFor("b2c", findings), scoreFor("b2b", findings)],
    passed: findings.filter((finding) => finding.passed).length,
    total: findings.length,
    fixFirst: fixGroups(findings),
    unreachable: fetched.pages
      .filter((page) => page.error !== null)
      .map((page) => `${page.path} (${page.error ?? ""})`),
  };
}
