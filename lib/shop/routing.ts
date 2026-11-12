/**
 * Who sees which page.
 *
 * Almost always the answer is "the standard page", decided in one line with
 * nothing read and nothing set. This file is for the times it is not: when
 * somebody has made a rule ("people who came through Kai's link see Kai's
 * page") or started a test between two pages.
 *
 * It is one function with no imports and no clock, so the thing in front of
 * the shop (proxy.ts), the "see it as" check in the back end and the tests
 * all ask the same question of the same code.
 *
 * The order it decides in:
 *
 *   1. A rule that matches how the visitor arrived THIS time. The first rule
 *      that matches wins. Arriving a new way is a fresh decision.
 *   2. Whatever they were shown before, if that still stands: the rule that
 *      picked it still exists, or the test they were put in is still
 *      running. A visitor keeps seeing the same page; nobody is flipped
 *      between two versions of the shop.
 *   3. A running test: one of its two pages, by the roll of a dice, and they
 *      keep that one.
 *   4. The standard page.
 *
 * What is remembered is one small first-party cookie naming the page and
 * why (qp_page). It is only ever set by a rule or a test, so with nothing
 * set up no cookie is set at all.
 */

/** The standard page's name. Every other page is a landing page's slug. */
export const HOME = "home";

/** The cookie that keeps a visitor on the page they were shown. */
export const PAGE_COOKIE = "qp_page";
/** Set when an order is placed, and only if a rule asks about it. */
export const BUYER_COOKIE = "qp_buyer";
/** How long a visitor stays on the page they were shown. Thirty days. */
export const PAGE_COOKIE_DAYS = 30;

export const RULE_KINDS = ["link", "source", "site", "code", "buyer"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export type Rule = {
  readonly id: string;
  /**
   *   link    came through this short link (/go/<value>)
   *   source  the advert's own label says this (utm_source=<value>)
   *   site    came from this website (<value> is its name)
   *   code    arrived carrying a promo code (no value)
   *   buyer   has ordered before, on this browser (no value)
   */
  readonly when: RuleKind;
  readonly value: string;
  /** The page they see: a live landing page's slug. */
  readonly page: string;
};

export type SplitTest = {
  readonly id: string;
  /** The page it is being tested against: "home", or a landing page. */
  readonly a: string;
  /** The challenger: a landing page. */
  readonly b: string;
};

/** Everything the decision needs. Made by the back end, read by the proxy. */
export type Routing = {
  /** In order. Only rules that are switched on and point at a live page. */
  readonly rules: readonly Rule[];
  /** Only while a test is running and both its pages are live. */
  readonly test: SplitTest | null;
};

export const NO_ROUTING: Routing = { rules: [], test: null };

/** How this visitor arrived, as far as one request can say. */
export type Facts = {
  /** The short link they followed, if this request says. */
  readonly via: string | null;
  /** The advert's own label, if this request carries one. */
  readonly source: string | null;
  /** The website they came from, by name. */
  readonly site: string | null;
  /** They arrived carrying a promo code. */
  readonly code: boolean;
  /** This browser has placed an order before. */
  readonly buyer: boolean;
};

export const NO_FACTS: Facts = {
  via: null,
  source: null,
  site: null,
  code: false,
  buyer: false,
};

/** Why a visitor was shown a page: a rule, or one side of a test. */
export type Reason =
  | { readonly by: "rule"; readonly ruleId: string }
  | { readonly by: "test"; readonly testId: string; readonly arm: "a" | "b" };

export type Choice = {
  /** "home", or a landing page's slug. */
  readonly page: string;
  /** Null: the standard page, for no reason but that it is the standard. */
  readonly reason: Reason | null;
  /**
   * What to do about the cookie: write this value, clear a stale one, or
   * leave it alone.
   */
  readonly cookie:
    | { readonly do: "set"; readonly value: string }
    | { readonly do: "clear" }
    | { readonly do: "keep" };
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38})[a-z0-9]$/;
const ID = /^[a-z]{3}_[a-z0-9]{6,40}$/;

/* ---- what is set up, read with suspicion --------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function isRule(value: unknown): value is Rule {
  if (!isRecord(value)) return false;
  const { id, when, value: about, page } = value;
  return (
    typeof id === "string" &&
    ID.test(id) &&
    typeof when === "string" &&
    (RULE_KINDS as readonly string[]).includes(when) &&
    typeof about === "string" &&
    about.length <= 120 &&
    typeof page === "string" &&
    SLUG.test(page) &&
    page !== HOME
  );
}

function isSplitTest(value: unknown): value is SplitTest {
  if (!isRecord(value)) return false;
  const { id, a, b } = value;
  return (
    typeof id === "string" &&
    ID.test(id) &&
    typeof a === "string" &&
    (a === HOME || SLUG.test(a)) &&
    typeof b === "string" &&
    SLUG.test(b) &&
    b !== HOME
  );
}

/**
 * What the back end says is set up, or null if it does not read as that.
 *
 * The front of the shop believes this answer and sends visitors where it
 * says, so it is checked to the letter: every id an id, every page a name a
 * page could have. One thing out of place and the whole answer is no answer,
 * which the caller treats as "nobody knows" and serves the standard page.
 */
export function asRouting(value: unknown): Routing | null {
  if (!isRecord(value)) return null;
  const { rules, test } = value;
  if (!Array.isArray(rules) || rules.length > 200) return null;
  if (!rules.every(isRule)) return null;
  if (test !== null && !isSplitTest(test)) return null;
  return { rules, test };
}

/* ---- the cookie ---------------------------------------------------------- */

/** "clubs~r.prl_abc" or "home~t.pts_xyz.a": the page, then why. */
export function packSticky(page: string, reason: Reason): string {
  return reason.by === "rule"
    ? `${page}~r.${reason.ruleId}`
    : `${page}~t.${reason.testId}.${reason.arm}`;
}

/** Read the cookie with suspicion. Anything odd is no cookie at all. */
export function unpackSticky(
  raw: string | null | undefined,
): { readonly page: string; readonly reason: Reason } | null {
  if (typeof raw !== "string" || raw.length > 120) return null;
  const [page = "", why = "", ...rest] = raw.split("~");
  if (rest.length > 0) return null;
  if (page !== HOME && !SLUG.test(page)) return null;
  const parts = why.split(".");
  if (parts[0] === "r" && parts.length === 2 && ID.test(parts[1] ?? "")) {
    return { page, reason: { by: "rule", ruleId: parts[1] ?? "" } };
  }
  if (
    parts[0] === "t" &&
    parts.length === 3 &&
    ID.test(parts[1] ?? "") &&
    (parts[2] === "a" || parts[2] === "b")
  ) {
    return {
      page,
      reason: { by: "test", testId: parts[1] ?? "", arm: parts[2] },
    };
  }
  return null;
}

/** The test and side a cookie says its visitor is on: "pts_xyz.a". */
export function testArmOf(raw: string | null | undefined): string | null {
  const sticky = unpackSticky(raw);
  return sticky?.reason.by === "test"
    ? `${sticky.reason.testId}.${sticky.reason.arm}`
    : null;
}

/* ---- the decision -------------------------------------------------------- */

/** Does this rule pick this visitor out? */
export function ruleMatches(rule: Rule, facts: Facts): boolean {
  switch (rule.when) {
    case "link":
      return facts.via !== null && facts.via === rule.value;
    case "source":
      return facts.source !== null && facts.source === rule.value;
    case "site":
      // "instagram.com" also covers "l.instagram.com".
      return (
        facts.site !== null &&
        (facts.site === rule.value || facts.site.endsWith(`.${rule.value}`))
      );
    case "code":
      return facts.code;
    case "buyer":
      return facts.buyer;
  }
}

/**
 * Which page this visitor sees, and what to remember.
 *
 * `sticky` is what their cookie says, already unpacked. `roll` is a number
 * from 0 up to (not including) 1: under a half is the first page of a test.
 */
export function choosePage(
  routing: Routing,
  facts: Facts,
  sticky: { readonly page: string; readonly reason: Reason } | null,
  roll: number,
): Choice {
  const had = sticky !== null;
  const stale: Choice["cookie"] = had ? { do: "clear" } : { do: "keep" };

  // 1. A rule that matches how they arrived this time.
  const matched = routing.rules.find((rule) => ruleMatches(rule, facts));
  if (matched !== undefined) {
    const reason: Reason = { by: "rule", ruleId: matched.id };
    const value = packSticky(matched.page, reason);
    return {
      page: matched.page,
      reason,
      // "Bought before" is asked afresh on every visit from its own cookie,
      // and a visitor who stops matching should stop seeing the page, so it
      // is the one kind of rule that is not remembered.
      cookie:
        matched.when === "buyer"
          ? stale
          : sticky !== null && packSticky(sticky.page, sticky.reason) === value
            ? { do: "keep" }
            : { do: "set", value },
    };
  }

  // 2. What they were shown before, if it still stands.
  if (sticky !== null) {
    const { reason } = sticky;
    if (reason.by === "rule") {
      const rule = routing.rules.find((each) => each.id === reason.ruleId);
      if (
        rule !== undefined &&
        rule.page === sticky.page &&
        rule.when !== "buyer"
      ) {
        return { page: sticky.page, reason, cookie: { do: "keep" } };
      }
    } else if (routing.test !== null && routing.test.id === reason.testId) {
      const page = reason.arm === "a" ? routing.test.a : routing.test.b;
      if (page === sticky.page) {
        return { page, reason, cookie: { do: "keep" } };
      }
    }
  }

  // 3. A running test.
  if (routing.test !== null) {
    const arm = roll < 0.5 ? "a" : "b";
    const page = arm === "a" ? routing.test.a : routing.test.b;
    const reason: Reason = { by: "test", testId: routing.test.id, arm };
    return {
      page,
      reason,
      cookie: { do: "set", value: packSticky(page, reason) },
    };
  }

  // 4. The standard page.
  return { page: HOME, reason: null, cookie: stale };
}
