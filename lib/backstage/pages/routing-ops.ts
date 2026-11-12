/**
 * Who sees which page: the rules, the test, and the check before either
 * goes live.
 *
 * Two things can send a visitor to a page other than the standard one:
 *
 *   a rule   "people who came through Kai's link see Kai's page". Read in
 *            order; the first that matches wins.
 *   a test   everybody no rule picks out is split evenly between two pages
 *            and kept on the one they landed on, and the numbers say which
 *            sells more. Set up switched off. One at a time.
 *
 * The deciding itself is lib/shop/routing.ts: one function with no database
 * in it, which the thing in front of the shop runs on every visit to the
 * front page, and which `pages.whoSees` runs here so a person can ask "what
 * would somebody from Instagram see?" and get the same answer the site
 * would give.
 *
 * Every page a rule or a test can show has already been published, so
 * nothing here lets new words out. But each of these changes what customers
 * see, so each is an outward operation and needs a yes.
 *
 * With no rule switched on and no test running, `pages.routing` is empty,
 * everybody sees the standard page, and no cookie is set for anybody.
 */

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import {
  links,
  orders,
  pageEvents,
  pageRules,
  pageTests,
  pages,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import {
  choosePage,
  HOME,
  RULE_KINDS,
  type Facts,
  type Routing,
  type RuleKind,
} from "@/lib/shop/routing";

import { conflict, notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { SLUG_PATTERN } from "../marketing/links";
import { recordId, userIdOf } from "../marketing/shared";

const UTM_VALUE = /^[a-z0-9][a-z0-9._-]{0,59}$/;
const HOST = /^(?=.{1,100}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+$/;

/* ---- saying it in words -------------------------------------------------- */

/** "People who came through /go/kai": who a rule picks out. */
export function whoInWords(when: RuleKind, value: string): string {
  switch (when) {
    case "link":
      return `People who came through /go/${value}`;
    case "source":
      return `People from an advert labelled "${value}"`;
    case "site":
      return `People who came from ${value}`;
    case "code":
      return "People who arrive carrying a promo code";
    case "buyer":
      return "People who have bought before, on the same browser";
  }
}

export const RULE_KIND_LABEL: Readonly<Record<RuleKind, string>> = {
  link: "Came through one of our short links",
  source: "Came from an advert with this label",
  site: "Came from this website",
  code: "Arrived carrying a promo code",
  buyer: "Has bought before",
};

/* ---- rules --------------------------------------------------------------- */

export type RuleRow = {
  readonly id: string;
  readonly when: RuleKind;
  readonly value: string;
  /** Who it picks out, as a sentence. */
  readonly who: string;
  readonly pageId: string;
  readonly pageName: string;
  readonly pageSlug: string;
  readonly active: boolean;
  /**
   * Switched on but doing nothing, because its page is not up. It starts
   * working by itself when the page is published.
   */
  readonly waiting: boolean;
};

async function rulesIn(db: DbOrTx): Promise<RuleRow[]> {
  const rows = await db
    .select({
      rule: pageRules,
      pageName: pages.name,
      pageSlug: pages.slug,
      pageLive: pages.live,
    })
    .from(pageRules)
    .innerJoin(pages, eq(pages.id, pageRules.pageId))
    .orderBy(asc(pageRules.position), asc(pageRules.createdAt));
  return rows.map(({ rule, pageName, pageSlug, pageLive }) => ({
    id: rule.id,
    when: rule.whenKind,
    value: rule.whenValue,
    who: whoInWords(rule.whenKind, rule.whenValue),
    pageId: rule.pageId,
    pageName,
    pageSlug,
    active: rule.active,
    waiting: rule.active && !pageLive,
  }));
}

export const listPageRules = defineOp({
  name: "pages.listRules",
  title: "The rules for who sees which page",
  description:
    "The rules that send some visitors to a landing page when they come to the front of the shop, in the order they are asked (the first that matches wins): who each picks out, which page they see, whether it is switched on, and whether it is waiting on a page that is not published. Everybody no rule picks out sees the standard page.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<RuleRow[]> {
    return rulesIn(ctx.db);
  },
});

/** The value a rule is asked about, tidied and checked for its kind. */
async function ruleValue(
  db: DbOrTx,
  when: RuleKind,
  raw: string,
): Promise<string> {
  const refuse = (message: string): never => {
    throw new OpError("invalid_input", message, { value: message });
  };
  const value = raw.trim().toLowerCase();
  switch (when) {
    case "code":
    case "buyer":
      return "";
    case "link": {
      const slug = value.replace(/^\/?go\//, "");
      if (!SLUG_PATTERN.test(slug)) {
        return refuse("Pick which short link, like insta");
      }
      const [link] = await db
        .select({ id: links.id })
        .from(links)
        .where(eq(links.slug, slug));
      if (link === undefined) {
        return refuse(
          `There is no short link /go/${slug}. Make it first, under Links.`,
        );
      }
      return slug;
    }
    case "source":
      return UTM_VALUE.test(value)
        ? value
        : refuse(
            "An advert's label is letters, numbers, dots or hyphens with no spaces, like facebook",
          );
    case "site": {
      const host = value
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split(/[/?#]/)[0];
      return host !== undefined && HOST.test(host)
        ? host
        : refuse("Give the website's name, like instagram.com");
    }
  }
}

async function pageNamed(
  db: DbOrTx,
  id: string,
): Promise<{ id: string; name: string; slug: string; live: boolean }> {
  const [page] = await db
    .select({
      id: pages.id,
      name: pages.name,
      slug: pages.slug,
      live: pages.live,
    })
    .from(pages)
    .where(eq(pages.id, id));
  if (page === undefined) {
    const message = "That page is not on the list. Pick another.";
    throw new OpError("invalid_input", message, { pageId: message });
  }
  return page;
}

const ruleEntity = (id: string) => ({ type: "page_rule", id });

export const addPageRule = defineOp({
  name: "pages.addRule",
  title: "Send some visitors to a landing page",
  description:
    "Adds a rule: visitors of one kind see a landing page when they come to the front of the shop. `when` is link (came through the short link named in `value`), source (the advert's own label, utm_source, is `value`), site (came from the website named in `value`, and its sub-sites), code (arrived carrying a promo code; no value) or buyer (has ordered before on the same browser; no value). `pageId` is the page they see. It goes last in the order, and the first rule that matches a visitor wins. It only does anything while the page is published and up. A visitor a rule picks out keeps seeing that page for thirty days, by a small cookie that is only set for them. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({
    when: z.enum(RULE_KINDS, { error: "Pick who it is for" }),
    value: z.string().max(200).default(""),
    pageId: recordId,
  }),
  explain: () =>
    "This changes which page some visitors see at the front of the shop.",
  async run(ctx, input): Promise<{ id: string }> {
    const value = await ruleValue(ctx.db, input.when, input.value);
    const page = await pageNamed(ctx.db, input.pageId);
    const [same] = await ctx.db
      .select({ id: pageRules.id })
      .from(pageRules)
      .where(
        and(eq(pageRules.whenKind, input.when), eq(pageRules.whenValue, value)),
      );
    if (same !== undefined) {
      throw conflict(
        `There is already a rule for ${whoInWords(input.when, value).toLowerCase()}. Change or remove that one.`,
      );
    }
    const [last] = await ctx.db
      .select({
        top: sql<number>`coalesce(max(${pageRules.position}), 0)::int`,
      })
      .from(pageRules);
    const id = newId("prl");
    await ctx.db.insert(pageRules).values({
      id,
      position: (last?.top ?? 0) + 1,
      whenKind: input.when,
      whenValue: value,
      pageId: page.id,
      createdBy: userIdOf(ctx),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.audit({
      entity: ruleEntity(id),
      summary: `Added a rule: ${whoInWords(input.when, value).toLowerCase()} see the landing page "${page.name}"${page.live ? "" : " (once it is published)"}`,
      data: { when: input.when, value, pageId: page.id },
    });
    await ctx.emit({
      type: "pages.routing_changed",
      entity: ruleEntity(id),
      payload: { ruleId: id },
    });
    return { id };
  },
});

async function loadRule(db: DbOrTx, id: string) {
  const [rule] = await db.select().from(pageRules).where(eq(pageRules.id, id));
  if (rule === undefined) throw notFound("That rule");
  return rule;
}

export const setPageRuleActive = defineOp({
  name: "pages.setRuleActive",
  title: "Switch a rule on or off",
  description:
    "Switches a rule for who sees which page off, so the visitors it picked out see the standard page again, or back on. Nothing is deleted. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId, active: z.boolean() }),
  explain: (input) =>
    input.active
      ? "This sends the visitors this rule picks out to its landing page."
      : "The visitors this rule picked out will see the standard page again.",
  async run(ctx, input): Promise<{ active: boolean }> {
    const rule = await loadRule(ctx.db, input.id);
    if (rule.active === input.active) {
      ctx.nothingChanged();
      return { active: rule.active };
    }
    await ctx.db
      .update(pageRules)
      .set({ active: input.active, updatedAt: ctx.now })
      .where(eq(pageRules.id, rule.id));
    await ctx.audit({
      entity: ruleEntity(rule.id),
      summary: `Switched ${input.active ? "on" : "off"} the rule for ${whoInWords(rule.whenKind, rule.whenValue).toLowerCase()}`,
    });
    await ctx.emit({
      type: "pages.routing_changed",
      entity: ruleEntity(rule.id),
      payload: { ruleId: rule.id },
    });
    return { active: input.active };
  },
});

export const removePageRule = defineOp({
  name: "pages.removeRule",
  title: "Remove a rule",
  description:
    "Removes a rule for who sees which page. The visitors it picked out see the standard page from then on. The landing page itself is not touched. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId }),
  explain: () =>
    "The visitors this rule picked out will see the standard page again.",
  async run(ctx, input): Promise<{ removed: boolean }> {
    const rule = await loadRule(ctx.db, input.id);
    await ctx.db.delete(pageRules).where(eq(pageRules.id, rule.id));
    await ctx.audit({
      entity: ruleEntity(rule.id),
      summary: `Removed the rule for ${whoInWords(rule.whenKind, rule.whenValue).toLowerCase()}`,
      data: { when: rule.whenKind, value: rule.whenValue, pageId: rule.pageId },
    });
    await ctx.emit({
      type: "pages.routing_changed",
      entity: ruleEntity(rule.id),
      payload: { ruleId: rule.id },
    });
    return { removed: true };
  },
});

export const movePageRule = defineOp({
  name: "pages.moveRule",
  title: "Move a rule up or down the order",
  description:
    "Moves a rule one place up or down. Rules are asked in order and the first that matches a visitor wins, so the order only matters for a visitor two rules would both pick out. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId, direction: z.enum(["up", "down"]) }),
  explain: () =>
    "This changes which rule wins for a visitor two rules both pick out.",
  async run(ctx, input): Promise<{ moved: boolean }> {
    const all = await ctx.db
      .select({ id: pageRules.id, position: pageRules.position })
      .from(pageRules)
      .orderBy(asc(pageRules.position), asc(pageRules.createdAt));
    const at = all.findIndex((rule) => rule.id === input.id);
    if (at === -1) throw notFound("That rule");
    const to = input.direction === "up" ? at - 1 : at + 1;
    const here = all[at];
    const there = all[to];
    if (here === undefined || there === undefined) {
      ctx.nothingChanged();
      return { moved: false };
    }
    // Numbered afresh, so two rules can never share a place.
    const order = all.map((rule) => rule.id);
    order[at] = there.id;
    order[to] = here.id;
    for (const [index, id] of order.entries()) {
      await ctx.db
        .update(pageRules)
        .set({ position: index + 1, updatedAt: ctx.now })
        .where(eq(pageRules.id, id));
    }
    await ctx.audit({
      entity: ruleEntity(here.id),
      summary: `Moved a rule ${input.direction} the order for who sees which page`,
    });
    await ctx.emit({
      type: "pages.routing_changed",
      entity: ruleEntity(here.id),
      payload: { ruleId: here.id },
    });
    return { moved: true };
  },
});

/* ---- the test ------------------------------------------------------------ */

export type TestStatus = "off" | "running" | "ended";

export type TestRow = {
  readonly id: string;
  readonly name: string;
  readonly status: TestStatus;
  /** What the challenger is up against. Null: the standard page. */
  readonly a: { readonly id: string; readonly name: string } | null;
  readonly b: { readonly id: string; readonly name: string };
  /** Why it cannot be started as things stand, or null if it can. */
  readonly blocked: string | null;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
};

type TestRecord = typeof pageTests.$inferSelect;

async function testRow(db: DbOrTx, test: TestRecord): Promise<TestRow> {
  const ids = [test.bPageId, ...(test.aPageId === null ? [] : [test.aPageId])];
  const found = await db
    .select({ id: pages.id, name: pages.name, live: pages.live })
    .from(pages)
    .where(inArray(pages.id, ids));
  const byId = new Map(found.map((page) => [page.id, page]));
  const a = test.aPageId === null ? null : byId.get(test.aPageId);
  const b = byId.get(test.bPageId);
  const notUp = [a, b].find((page) => page != null && !page.live);
  return {
    id: test.id,
    name: test.name,
    status: test.status,
    a: a == null ? null : { id: a.id, name: a.name },
    b: { id: test.bPageId, name: b?.name ?? "A page that has gone" },
    blocked:
      notUp == null
        ? null
        : `"${notUp.name}" is not published. Publish it before the test starts.`,
    startedAt: test.startedAt,
    endedAt: test.endedAt,
  };
}

async function loadTest(db: DbOrTx, id: string): Promise<TestRecord> {
  const [test] = await db.select().from(pageTests).where(eq(pageTests.id, id));
  if (test === undefined) throw notFound("That test");
  return test;
}

const testEntity = (id: string) => ({ type: "page_test", id });

export const listPageTests = defineOp({
  name: "pages.listTests",
  title: "The tests between pages",
  description:
    "Every test between two pages, newest first: its name, the two pages (the first may be the standard page), whether it is off, running or ended, when it started and ended, and what is stopping it from starting if anything is. Only one can be running at a time, and one is only ever running because a person started it.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<TestRow[]> {
    const rows = await ctx.db
      .select()
      .from(pageTests)
      .orderBy(sql`${pageTests.createdAt} desc`);
    return Promise.all(rows.map((test) => testRow(ctx.db, test)));
  },
});

export const setUpPageTest = defineOp({
  name: "pages.setUpTest",
  title: "Set up a test between two pages",
  description:
    "Sets up a test between two pages and leaves it switched OFF. `bPageId` is the challenger, a landing page. `aPageId` is what it is up against: another landing page, or leave it out for the standard page. Nothing changes for any visitor until the test is started (pages.startTest). Only one test can be set up or running at a time: finish or remove the one there is first.",
  access: "write",
  input: z.object({
    name: z
      .string()
      .max(240)
      .transform((value) => value.replace(/\s+/g, " ").trim())
      .refine((value) => value.length >= 1, "Give the test a name")
      .refine((value) => value.length <= 80, "Keep the name under 80 letters"),
    aPageId: recordId.nullable().default(null),
    bPageId: recordId,
  }),
  async run(ctx, input): Promise<{ id: string }> {
    if (input.aPageId === input.bPageId) {
      const message = "Pick two different pages to test against each other.";
      throw new OpError("invalid_input", message, { bPageId: message });
    }
    const b = await pageNamed(ctx.db, input.bPageId);
    const a =
      input.aPageId === null ? null : await pageNamed(ctx.db, input.aPageId);
    const [open] = await ctx.db
      .select({ name: pageTests.name, status: pageTests.status })
      .from(pageTests)
      .where(ne(pageTests.status, "ended"));
    if (open !== undefined) {
      throw conflict(
        open.status === "running"
          ? `"${open.name}" is running. Stop it before setting up another.`
          : `"${open.name}" is already set up. Start it or remove it before setting up another.`,
      );
    }
    const id = newId("pts");
    await ctx.db.insert(pageTests).values({
      id,
      name: input.name,
      aPageId: a?.id ?? null,
      bPageId: b.id,
      createdBy: userIdOf(ctx),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.audit({
      entity: testEntity(id),
      summary: `Set up the test "${input.name}": ${a?.name ?? "the standard page"} against "${b.name}". It is switched off`,
      data: { aPageId: a?.id ?? null, bPageId: b.id },
    });
    return { id };
  },
});

export const startPageTest = defineOp({
  name: "pages.startTest",
  title: "Start a test between two pages",
  description:
    "Starts a test that has been set up. From then on, every visitor to the front of the shop that no rule picks out is put on one of the two pages, half each, and kept on it for thirty days by a small cookie. Both pages have to be published and up. Only one test can run at a time. A machine that says it is one (a search engine, a link preview) is never put in a test: it sees the standard page. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId }),
  explain: () =>
    "From now on, half of the visitors to the front of the shop will see the other page.",
  async run(ctx, input): Promise<{ status: TestStatus }> {
    const test = await loadTest(ctx.db, input.id);
    if (test.status === "running") {
      ctx.nothingChanged();
      return { status: "running" };
    }
    if (test.status === "ended") {
      throw conflict(
        `"${test.name}" has finished. Set up a new test to run it again, so the two sets of numbers stay apart.`,
      );
    }
    const row = await testRow(ctx.db, test);
    if (row.blocked !== null) throw conflict(row.blocked);
    const [other] = await ctx.db
      .select({ name: pageTests.name })
      .from(pageTests)
      .where(eq(pageTests.status, "running"));
    if (other !== undefined) {
      throw conflict(`"${other.name}" is already running. Stop it first.`);
    }
    await ctx.db
      .update(pageTests)
      .set({ status: "running", startedAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(pageTests.id, test.id), eq(pageTests.status, "off")));
    await ctx.audit({
      entity: testEntity(test.id),
      summary: `Started the test "${test.name}": half of the visitors no rule picks out now see "${row.b.name}"`,
    });
    await ctx.emit({
      type: "pages.routing_changed",
      entity: testEntity(test.id),
      payload: { testId: test.id },
    });
    return { status: "running" };
  },
});

export const stopPageTest = defineOp({
  name: "pages.stopTest",
  title: "Stop a test between two pages",
  description:
    "Stops a running test. Everybody it had put on a page sees the standard page again (unless a rule picks them out), and its numbers are kept as they stood. It cannot be started again: set up a new one, so two runs never share a set of numbers. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId }),
  explain: () =>
    "Everybody in the test will see the standard page again. Its numbers are kept.",
  async run(ctx, input): Promise<{ status: TestStatus }> {
    const test = await loadTest(ctx.db, input.id);
    if (test.status !== "running") {
      ctx.nothingChanged();
      return { status: test.status };
    }
    await ctx.db
      .update(pageTests)
      .set({ status: "ended", endedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(pageTests.id, test.id));
    await ctx.audit({
      entity: testEntity(test.id),
      summary: `Stopped the test "${test.name}". Everybody sees the standard page again`,
    });
    await ctx.emit({
      type: "pages.routing_changed",
      entity: testEntity(test.id),
      payload: { testId: test.id },
    });
    return { status: "ended" };
  },
});

export const removePageTest = defineOp({
  name: "pages.removeTest",
  title: "Remove a test that was never started",
  description:
    "Removes a test that was set up and never started. A test that has run cannot be removed: its numbers are part of the record.",
  access: "write",
  effect: "destructive",
  input: z.object({ id: recordId }),
  explain: () => "This removes the test. It never ran, so nothing is lost.",
  async run(ctx, input): Promise<{ removed: boolean }> {
    const test = await loadTest(ctx.db, input.id);
    if (test.status !== "off") {
      throw conflict(
        `"${test.name}" has run, so it is kept with its numbers. ${test.status === "running" ? "Stop it instead." : ""}`.trim(),
      );
    }
    await ctx.db.delete(pageTests).where(eq(pageTests.id, test.id));
    await ctx.audit({
      entity: testEntity(test.id),
      summary: `Removed the test "${test.name}", which was never started`,
    });
    return { removed: true };
  },
});

/* ---- how a test is going ------------------------------------------------- */

export type ArmResult = {
  readonly arm: "a" | "b";
  readonly name: string;
  /** Visits that were shown this page as part of the test. */
  readonly visits: number;
  readonly added: number;
  /** Visits that ended in an order being placed. */
  readonly ordered: number;
  /** Paid orders from those visits, and what they came to. */
  readonly orders: number;
  readonly salesCents: number;
};

export type Verdict = {
  /**
   *   early  not enough visits or orders for the numbers to mean anything
   *   level  enough to look at, and too close to call
   *   a, b   that side is ahead by more than luck would usually explain
   */
  readonly state: "early" | "level" | "a" | "b";
  readonly sentence: string;
};

/** Each side needs this many visits before the numbers are worth reading. */
export const ENOUGH_VISITS = 100;
/** And this many orders between them. */
export const ENOUGH_ORDERS = 10;

const rate = (part: number, whole: number) =>
  whole === 0 ? 0 : (part / whole) * 100;
const oneDp = (value: number) =>
  (Math.round(value * 10) / 10).toLocaleString("en-NZ");

/**
 * Which side is ahead, said the way a person would.
 *
 * The sum is the ordinary one for comparing two rates (a two-sided test of
 * two proportions, at the usual one-in-twenty line). It is here to stop a
 * page being crowned on a lucky week, not to be argued with: "ahead by more
 * than luck would usually explain" is all it ever claims.
 */
export function verdictOn(
  a: Pick<ArmResult, "name" | "visits" | "ordered">,
  b: Pick<ArmResult, "name" | "visits" | "ordered">,
): Verdict {
  if (
    a.visits < ENOUGH_VISITS ||
    b.visits < ENOUGH_VISITS ||
    a.ordered + b.ordered < ENOUGH_ORDERS
  ) {
    return {
      state: "early",
      sentence: `Too early to say. Each page needs ${String(ENOUGH_VISITS)} visits, and there need to be ${String(ENOUGH_ORDERS)} orders between them, before the numbers mean much.`,
    };
  }
  const pa = a.ordered / a.visits;
  const pb = b.ordered / b.visits;
  const pooled = (a.ordered + b.ordered) / (a.visits + b.visits);
  const spread = Math.sqrt(
    pooled * (1 - pooled) * (1 / a.visits + 1 / b.visits),
  );
  const z = spread === 0 ? 0 : (pb - pa) / spread;
  const figures = `${oneDp(rate(b.ordered, b.visits))} orders for every 100 visits on ${b.name}, against ${oneDp(rate(a.ordered, a.visits))} on ${a.name}`;
  if (Math.abs(z) < 1.96) {
    return {
      state: "level",
      sentence: `Too close to call: ${figures}. A gap that size could easily be luck. Leave it running.`,
    };
  }
  const ahead = z > 0 ? b : a;
  return {
    state: z > 0 ? "b" : "a",
    sentence: `${ahead.name} is ahead: ${figures}. A gap that size would be unlikely by luck alone.`,
  };
}

export type TestResults = TestRow & {
  readonly arms: readonly [ArmResult, ArmResult];
  readonly verdict: Verdict;
};

export const pageTestResults = defineOp({
  name: "pages.testResults",
  title: "How a test between two pages is going",
  description:
    "For one test: each of its two pages with the visits it was shown to as part of the test, how many put something in the jar and placed an order, and the paid orders and sales from them, plus a verdict in a sentence: too early to say, too close to call, or one page ahead by more than luck would usually explain. Only visits and orders that were part of the test are counted: somebody who reached either page another way is left out.",
  access: "read",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<TestResults> {
    const test = await loadTest(ctx.db, input.id);
    const row = await testRow(ctx.db, test);
    const arm = async (which: "a" | "b", name: string): Promise<ArmResult> => {
      const tag = `${test.id}.${which}`;
      const [[seen], [sold]] = await Promise.all([
        ctx.db
          .select({
            visits: sql<number>`(count(distinct ${pageEvents.visit}) filter (where ${pageEvents.kind} = 'view'))::int`,
            added: sql<number>`(count(distinct ${pageEvents.visit}) filter (where ${pageEvents.kind} = 'add'))::int`,
            ordered: sql<number>`(count(distinct ${pageEvents.visit}) filter (where ${pageEvents.kind} = 'order'))::int`,
          })
          .from(pageEvents)
          .where(eq(pageEvents.test, tag)),
        ctx.db
          .select({
            orders: sql<number>`count(*)::int`,
            salesCents: sql<number>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}), 0)::int`,
          })
          .from(orders)
          .where(
            and(
              sql`${orders.source}->>'test' = ${tag}`,
              sql`not ${orders.isTest} and ${orders.status} <> 'cancelled' and ${orders.paymentStatus} in ('paid', 'part_refunded')`,
            ),
          ),
      ]);
      return {
        arm: which,
        name,
        visits: seen?.visits ?? 0,
        added: seen?.added ?? 0,
        ordered: seen?.ordered ?? 0,
        orders: sold?.orders ?? 0,
        salesCents: sold?.salesCents ?? 0,
      };
    };
    const [a, b] = await Promise.all([
      arm("a", row.a?.name ?? "The standard page"),
      arm("b", row.b.name),
    ]);
    return { ...row, arms: [a, b], verdict: verdictOn(a, b) };
  },
});

/* ---- what the shop asks -------------------------------------------------- */

export type PublicRouting = Routing & {
  /** True when some rule asks whether a visitor has bought before. */
  readonly asksBuyer: boolean;
};

/**
 * The rules that are switched on and point at a page that is up, in order,
 * and the test if one is running with both its pages up. Everything the
 * decision in lib/shop/routing.ts needs, and nothing that is not public
 * already: it names pages and links, never a person.
 */
export async function routingIn(db: DbOrTx): Promise<PublicRouting> {
  const ruleRows = await db
    .select({
      id: pageRules.id,
      when: pageRules.whenKind,
      value: pageRules.whenValue,
      page: pages.slug,
    })
    .from(pageRules)
    .innerJoin(pages, eq(pages.id, pageRules.pageId))
    .where(and(eq(pageRules.active, true), eq(pages.live, true)))
    .orderBy(asc(pageRules.position), asc(pageRules.createdAt));

  const [running] = await db
    .select()
    .from(pageTests)
    .where(eq(pageTests.status, "running"));
  let test: Routing["test"] = null;
  if (running !== undefined) {
    const ids = [
      running.bPageId,
      ...(running.aPageId === null ? [] : [running.aPageId]),
    ];
    const live = await db
      .select({ id: pages.id, slug: pages.slug })
      .from(pages)
      .where(and(inArray(pages.id, ids), eq(pages.live, true)));
    const slugOf = new Map(live.map((page) => [page.id, page.slug]));
    const b = slugOf.get(running.bPageId);
    const a = running.aPageId === null ? HOME : slugOf.get(running.aPageId);
    // A test with a page that has been taken down does nothing until it is
    // put back, and sends nobody to a page that is not there.
    if (a !== undefined && b !== undefined) test = { id: running.id, a, b };
  }
  return {
    rules: ruleRows,
    test,
    asksBuyer: ruleRows.some((rule) => rule.when === "buyer"),
  };
}

export const pagesRouting = defineOp({
  name: "pages.routing",
  title: "Who sees which page, as the shop needs it",
  description:
    "For the shop itself: the rules that are switched on and point at a page that is published and up, in order, and the test if one is running. Empty when nothing is set up, which is the usual case, and then everybody sees the standard page and no cookie is set. It names pages and links and never a person.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<PublicRouting> {
    return routingIn(ctx.db);
  },
});

/* ---- see it as ----------------------------------------------------------- */

export type WhoSees = {
  /** "home", or a landing page's slug. */
  readonly page: string;
  /** The landing page's id, to preview it. Null for the standard page. */
  readonly pageId: string | null;
  readonly pageName: string;
  /** Why, in a sentence. */
  readonly because: string;
  /**
   * When a test would decide: the other page half of such visitors see.
   * Null when a rule decides, or nothing does.
   */
  readonly orElse: {
    readonly page: string;
    readonly pageId: string | null;
    readonly pageName: string;
  } | null;
};

export const whoSees = defineOp({
  name: "pages.whoSees",
  title: "See it as: which page would this visitor get?",
  description:
    "Asks the same question the shop asks on every visit to its front page, for a visitor you describe: the short link they came through (`via`), the advert's label (`source`), the website they came from (`site`), whether they arrived carrying a promo code (`code`) and whether they have bought before (`buyer`). Says which page they would see and why, in a sentence. When a running test would decide, it names both pages: half of such visitors see each. A first visit is assumed: nothing is remembered about this visitor. It changes nothing.",
  access: "read",
  input: z.object({
    via: z.string().trim().toLowerCase().max(60).default(""),
    source: z.string().trim().toLowerCase().max(80).default(""),
    site: z.string().trim().toLowerCase().max(120).default(""),
    code: z.boolean().default(false),
    buyer: z.boolean().default(false),
  }),
  async run(ctx, input): Promise<WhoSees> {
    const routing = await routingIn(ctx.db);
    const facts: Facts = {
      via: input.via === "" ? null : input.via.replace(/^\/?go\//, ""),
      source: input.source === "" ? null : input.source,
      site:
        input.site === ""
          ? null
          : (input.site
              .replace(/^https?:\/\//, "")
              .replace(/^www\./, "")
              .split(/[/?#]/)[0] ?? null),
      code: input.code,
      buyer: input.buyer,
    };
    const known = await ctx.db
      .select({ id: pages.id, slug: pages.slug, name: pages.name })
      .from(pages);
    const named = (slug: string) => {
      const page = known.find((each) => each.slug === slug);
      return {
        page: slug,
        pageId: page?.id ?? null,
        pageName: page?.name ?? "The standard page",
      };
    };

    const first = choosePage(routing, facts, null, 0);
    if (first.reason === null) {
      return {
        ...named(HOME),
        because:
          routing.rules.length === 0
            ? "Nothing is set up, so everybody sees the standard page."
            : "No rule picks this visitor out and no test is running, so they see the standard page.",
        orElse: null,
      };
    }
    if (first.reason.by === "rule") {
      const { ruleId } = first.reason;
      const at = routing.rules.findIndex((rule) => rule.id === ruleId);
      const rule = routing.rules[at];
      return {
        ...named(first.page),
        because: `Rule ${String(at + 1)} picks them out: ${whoInWords(rule?.when ?? "link", rule?.value ?? "").toLowerCase()}.`,
        orElse: null,
      };
    }
    const other = choosePage(routing, facts, null, 0.99);
    return {
      ...named(first.page),
      because:
        "No rule picks them out, so the test decides: half of visitors like this see one page and half the other, and each keeps the one they got.",
      orElse: named(other.page),
    };
  },
});

/** Every operation here, for a registry to pick up in one go. */
export const PAGE_ROUTING_OPS = [
  listPageRules,
  addPageRule,
  setPageRuleActive,
  removePageRule,
  movePageRule,
  listPageTests,
  setUpPageTest,
  startPageTest,
  stopPageTest,
  removePageTest,
  pageTestResults,
  pagesRouting,
  whoSees,
] as const;
