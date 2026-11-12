/**
 * Numbers: how many people came, how far they got, and what they bought.
 *
 * Two sources, kept apart on purpose:
 *
 *   visits   our own count, from the shop's pages (db/schema/analytics.ts).
 *            No cookie and nobody identified: each page load carries a random
 *            id that lives only in that page's memory, so the steps of one
 *            visit can be strung together and the same person tomorrow is a
 *            stranger. A visitor whose browser asks not to be tracked is not
 *            counted at all.
 *   sales    the orders themselves. Paid orders less refunds, the same rule
 *            as the Customers screen and every collab figure. Test orders
 *            and cancelled ones are never sales.
 *
 * So "orders" on a funnel is a count of visits that ended in an order being
 * placed, and "sales" beside it is money that really came in. They are close
 * but not the same thing, and the screen says which is which.
 *
 * Where a visit came from is one label, worked out the same way for a visit
 * and for an order so the two line up: the short link it followed, or failing
 * that the advert's own label (utm_source), or failing that the website it
 * came from, or "direct".
 */

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { crewMembers, orders, pageEvents } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { addDays, nzDateKey, startOfNzDay } from "@/lib/time";

import { defineOp } from "../core/op";
import { tidySource } from "../marketing/credit";

/* ---- writing a visit down ------------------------------------------------ */

/** A visit's own random id: made by the page, kept only in its memory. */
export const VISIT_PATTERN = /^[a-z0-9]{16,32}$/;
/** A page's short name: "home", or a landing page's slug. */
export const PAGE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38})[a-z0-9]$/;
/** A test and one of its two sides: "pts_….a" or "pts_….b". */
export const TEST_PATTERN = /^pts_[a-z0-9]{6,40}\.[ab]$/;
const HOST_PATTERN = /^(?=.{1,100}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

export const SEEN_KINDS = ["view", "add", "checkout", "order"] as const;
export type SeenKind = (typeof SEEN_KINDS)[number];

/** A path on this site, without its query: "/checkout". Anything else is "/". */
function tidyPath(raw: string): string {
  const path = raw.split(/[?#]/)[0] ?? "";
  return /^\/[A-Za-z0-9\-._~/]{0,119}$/.test(path) && !path.startsWith("//")
    ? path
    : "/";
}

const seenInput = z.object({
  kind: z.enum(SEEN_KINDS),
  visit: z.string().regex(VISIT_PATTERN),
  path: z.string().max(300).default("/"),
  page: z.string().max(60).default("home"),
  source: z.record(z.string().max(40), z.unknown()).optional(),
  /** The website the visit came from, host only. */
  referrer: z.string().max(200).nullable().default(null),
  device: z.enum(["phone", "desk"]).nullable().default(null),
  /** The test this visit is part of and its side: "<test id>.a". */
  test: z.string().max(60).nullable().default(null),
});

export type SeenInput = z.input<typeof seenInput>;

/**
 * One step of a visit, as it is stored: tidied, and cut down to the labels
 * a visit is counted by. Everything a browser sends passes through here.
 */
export function seenRow(
  raw: SeenInput,
  at: Date,
): typeof pageEvents.$inferInsert {
  const input = seenInput.parse(raw);
  const source = tidySource(input.source);
  const referrer = (input.referrer ?? "").trim().toLowerCase();
  return {
    at,
    kind: input.kind,
    visit: input.visit,
    path: tidyPath(input.path),
    page: PAGE_PATTERN.test(input.page) ? input.page : "home",
    source: Object.fromEntries(
      Object.entries(source).filter(
        ([key]) => key === "via" || key.startsWith("utm_"),
      ),
    ),
    referrer: HOST_PATTERN.test(referrer) ? referrer : (source.ref ?? null),
    device: input.device,
    test:
      input.test !== null && TEST_PATTERN.test(input.test) ? input.test : null,
  };
}

export const recordSeen = defineOp({
  name: "numbers.record",
  title: "Count a step of a visit",
  description:
    "Writes down one step of one visit to the shop: a page was viewed, something went in the jar, the checkout was opened, or an order was placed. It carries the visit's own random id (made by the page and kept only in its memory), which page was shown, where the visit came from and whether it was a phone. Nothing in it says who the visitor is. Called by the shop's own pages; it is listed as a read so that visits do not fill the activity log, and it is not something to call by hand.",
  access: "read",
  input: seenInput,
  async run(ctx, input): Promise<{ counted: boolean }> {
    await ctx.db.insert(pageEvents).values(seenRow(input, ctx.now));
    return { counted: true };
  },
});

/** How long a visit is kept. Thirteen months: a year, to compare with. */
export const KEEP_VISITS_DAYS = 400;

/** Throw away visits older than we keep them for. Safe to run any time. */
export async function pruneVisits(db: DbOrTx, now: Date): Promise<number> {
  const before = new Date(now.getTime() - KEEP_VISITS_DAYS * 24 * 60 * 60_000);
  const gone = await db
    .delete(pageEvents)
    .where(lt(pageEvents.at, before))
    .returning({ id: pageEvents.id });
  return gone.length;
}

/* ---- reading them back --------------------------------------------------- */

export type Funnel = {
  /** Visits that saw a page. */
  readonly visits: number;
  /** Of those, visits that put something in the jar. */
  readonly added: number;
  /** Visits that opened the checkout. */
  readonly checkout: number;
  /** Visits that placed an order. */
  readonly ordered: number;
};

export type SourceRow = {
  /** "/go/insta", "instagram", "example.co.nz" or "direct". */
  readonly label: string;
  readonly visits: number;
  /** Paid orders from visits like these, and what they came to. */
  readonly orders: number;
  readonly salesCents: number;
};

export type PageRow = Funnel & {
  /** "home", or a landing page's short name. */
  readonly page: string;
  readonly orders: number;
  readonly salesCents: number;
};

export type DayRow = {
  /** A New Zealand day, as 2026-11-12. */
  readonly day: string;
  readonly visits: number;
  readonly orders: number;
  readonly salesCents: number;
};

export type NumbersSummary = {
  readonly days: number;
  /** The first and last New Zealand days it covers. */
  readonly firstDay: string;
  readonly lastDay: string;
  readonly sales: {
    readonly orders: number;
    readonly salesCents: number;
    /** Sales over orders. Zero with no orders. */
    readonly averageCents: number;
    readonly newCustomers: number;
    readonly returningCustomers: number;
  };
  /** The same length of time straight before, to compare with. */
  readonly before: {
    readonly orders: number;
    readonly salesCents: number;
    readonly visits: number;
  };
  readonly funnel: Funnel;
  readonly devices: readonly {
    readonly device: "phone" | "desk";
    readonly visits: number;
    readonly ordered: number;
  }[];
  readonly sources: readonly SourceRow[];
  readonly pages: readonly PageRow[];
  readonly daily: readonly DayRow[];
  readonly crew: {
    readonly joined: number;
    readonly left: number;
    /** On the list right now. */
    readonly total: number;
  };
  /** True when not one visit has ever been counted: the counter is new. */
  readonly noVisitsYet: boolean;
};

/** An order that counts as a sale: paid for real, and not called off. */
const isSale = sql`not ${orders.isTest} and ${orders.status} <> 'cancelled' and ${orders.paymentStatus} in ('paid', 'part_refunded')`;

/** Where a visit came from, as one label. The same on a visit and an order. */
const visitLabel = sql<string>`coalesce('/go/' || (${pageEvents.source}->>'via'), ${pageEvents.source}->>'utm_source', ${pageEvents.referrer}, 'direct')`;
const orderLabel = sql<string>`coalesce('/go/' || (${orders.source}->>'via'), ${orders.source}->>'utm_source', ${orders.source}->>'ref', 'direct')`;
const orderPage = sql<string>`coalesce(${orders.source}->>'page', 'home')`;

/**
 * "Group by the first thing selected." The day a moment falls on is worked
 * out with the range's own dates as parameters, and Postgres will not see
 * the same sum written twice with differently numbered parameters as one
 * expression, so the grouping names the column by its place instead.
 */
const FIRST_COLUMN = sql.raw("1");

const visitsOf = (kind: SeenKind) =>
  sql<number>`(count(distinct ${pageEvents.visit}) filter (where ${pageEvents.kind} = ${kind}))::int`;

const funnelColumns = {
  visits: visitsOf("view"),
  added: visitsOf("add"),
  checkout: visitsOf("checkout"),
  ordered: visitsOf("order"),
};

const salesColumns = {
  orders: sql<number>`count(*)::int`,
  salesCents: sql<number>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}), 0)::int`,
};

export const numbersSummary = defineOp({
  name: "numbers.summary",
  title: "The numbers for the last while",
  description:
    "For the last 7, 30 or 90 New Zealand days up to today: sales (paid orders, what they came to less refunds, the average order, and how many buyers were new), the funnel (visits that saw a page, put something in the jar, opened the checkout and placed an order), the same by phone and desktop, where visits came from with the paid orders and sales from each (a short link, an advert's own label, the website it came from, or direct), the same for each page when there is more than one, a count for each day, and how the Pickle Crew list has moved. `before` has sales, orders and visits for the same length of time straight before, to compare with. Visits are our own count with no cookie: nobody is identified and a visitor who asks not to be tracked is not counted, so they run a little low. Sales are real money: test orders and cancelled ones are left out.",
  access: "read",
  input: z.object({
    days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
  }),
  async run(ctx, input): Promise<NumbersSummary> {
    const lastDay = nzDateKey(ctx.now);
    const firstDay = addDays(lastDay, -(input.days - 1));
    const from = startOfNzDay(firstDay);
    const to = startOfNzDay(addDays(lastDay, 1));

    const earlier = startOfNzDay(addDays(firstDay, -input.days));
    const seenIn = and(gte(pageEvents.at, from), lt(pageEvents.at, to));
    const soldIn = and(
      gte(orders.placedAt, from),
      lt(orders.placedAt, to),
      isSale,
    );

    // The start of each day in the range, and of the day after it. Which day
    // a moment falls on is worked out against these, so a day that is 23 or
    // 25 hours long (daylight saving) is still one day.
    const edges = Array.from({ length: input.days + 1 }, (_, index) =>
      startOfNzDay(addDays(firstDay, index)),
    );
    const edgeList = sql.join(
      edges.map((edge) => sql`${edge.toISOString()}::timestamptz`),
      sql`, `,
    );
    const dayOf = (moment: unknown) =>
      sql<number>`width_bucket(${moment}, array[${edgeList}])`;

    const [
      [funnel],
      devices,
      visitSources,
      orderSources,
      visitPages,
      orderPages,
      visitDays,
      orderDays,
      [sales],
      [crewMoves],
      [everSeen],
      [soldBefore],
      [seenBefore],
    ] = await Promise.all([
      ctx.db.select(funnelColumns).from(pageEvents).where(seenIn),
      ctx.db
        .select({
          device: pageEvents.device,
          visits: visitsOf("view"),
          ordered: visitsOf("order"),
        })
        .from(pageEvents)
        .where(seenIn)
        .groupBy(pageEvents.device),
      ctx.db
        .select({ label: visitLabel, visits: visitsOf("view") })
        .from(pageEvents)
        .where(seenIn)
        .groupBy(visitLabel),
      ctx.db
        .select({ label: orderLabel, ...salesColumns })
        .from(orders)
        .where(soldIn)
        .groupBy(orderLabel),
      ctx.db
        .select({ page: pageEvents.page, ...funnelColumns })
        .from(pageEvents)
        .where(seenIn)
        .groupBy(pageEvents.page),
      ctx.db
        .select({ page: orderPage, ...salesColumns })
        .from(orders)
        .where(soldIn)
        .groupBy(orderPage),
      ctx.db
        .select({ bucket: dayOf(pageEvents.at), visits: visitsOf("view") })
        .from(pageEvents)
        .where(seenIn)
        .groupBy(FIRST_COLUMN),
      ctx.db
        .select({ bucket: dayOf(orders.placedAt), ...salesColumns })
        .from(orders)
        .where(soldIn)
        .groupBy(FIRST_COLUMN),
      ctx.db
        .select({
          ...salesColumns,
          // Looks back at the outer order, so its columns are written in full.
          newCustomers: sql<number>`(count(*) filter (where not exists (
            select 1 from orders e
            where e.email = "orders"."email"
              and e.placed_at < "orders"."placed_at"
              and not e.is_test
              and e.status <> 'cancelled'
              and e.payment_status in ('paid', 'part_refunded')
          )))::int`,
        })
        .from(orders)
        .where(soldIn),
      ctx.db
        .select({
          joined: sql<number>`(count(*) filter (where ${crewMembers.consentAt} >= ${from.toISOString()}::timestamptz and ${crewMembers.consentAt} < ${to.toISOString()}::timestamptz))::int`,
          left: sql<number>`(count(*) filter (where ${crewMembers.unsubscribedAt} >= ${from.toISOString()}::timestamptz and ${crewMembers.unsubscribedAt} < ${to.toISOString()}::timestamptz))::int`,
          total: sql<number>`(count(*) filter (where ${eq(crewMembers.status, "subscribed")}))::int`,
        })
        .from(crewMembers),
      ctx.db.select({ id: pageEvents.id }).from(pageEvents).limit(1),
      ctx.db
        .select(salesColumns)
        .from(orders)
        .where(
          and(gte(orders.placedAt, earlier), lt(orders.placedAt, from), isSale),
        ),
      ctx.db
        .select({ visits: visitsOf("view") })
        .from(pageEvents)
        .where(and(gte(pageEvents.at, earlier), lt(pageEvents.at, from))),
    ]);

    // Visits and sales for one label, side by side.
    const sourceMap = new Map<string, SourceRow>();
    for (const row of visitSources) {
      sourceMap.set(row.label, {
        label: row.label,
        visits: row.visits,
        orders: 0,
        salesCents: 0,
      });
    }
    for (const row of orderSources) {
      const seen = sourceMap.get(row.label);
      sourceMap.set(row.label, {
        label: row.label,
        visits: seen?.visits ?? 0,
        orders: row.orders,
        salesCents: row.salesCents,
      });
    }

    const pageMap = new Map<string, PageRow>();
    for (const row of visitPages) {
      pageMap.set(row.page, { ...row, orders: 0, salesCents: 0 });
    }
    for (const row of orderPages) {
      const seen = pageMap.get(row.page);
      pageMap.set(row.page, {
        page: row.page,
        visits: seen?.visits ?? 0,
        added: seen?.added ?? 0,
        checkout: seen?.checkout ?? 0,
        ordered: seen?.ordered ?? 0,
        orders: row.orders,
        salesCents: row.salesCents,
      });
    }

    const daily: DayRow[] = Array.from({ length: input.days }, (_, index) => ({
      day: addDays(firstDay, index),
      visits: 0,
      orders: 0,
      salesCents: 0,
    }));
    // width_bucket counts from 1: bucket 1 is the first day.
    for (const row of visitDays) {
      const day = daily[row.bucket - 1];
      if (day) daily[row.bucket - 1] = { ...day, visits: row.visits };
    }
    for (const row of orderDays) {
      const day = daily[row.bucket - 1];
      if (day) {
        daily[row.bucket - 1] = {
          ...day,
          orders: row.orders,
          salesCents: row.salesCents,
        };
      }
    }

    const ordersSold = sales?.orders ?? 0;
    const salesCents = sales?.salesCents ?? 0;
    const newCustomers = sales?.newCustomers ?? 0;
    return {
      days: input.days,
      firstDay,
      lastDay,
      sales: {
        orders: ordersSold,
        salesCents,
        averageCents:
          ordersSold === 0 ? 0 : Math.round(salesCents / ordersSold),
        newCustomers,
        returningCustomers: ordersSold - newCustomers,
      },
      before: {
        orders: soldBefore?.orders ?? 0,
        salesCents: soldBefore?.salesCents ?? 0,
        visits: seenBefore?.visits ?? 0,
      },
      funnel: funnel ?? { visits: 0, added: 0, checkout: 0, ordered: 0 },
      devices: devices.flatMap((row) =>
        row.device === null
          ? []
          : [{ device: row.device, visits: row.visits, ordered: row.ordered }],
      ),
      sources: [...sourceMap.values()].sort(
        (a, b) =>
          b.salesCents - a.salesCents ||
          b.visits - a.visits ||
          a.label.localeCompare(b.label),
      ),
      pages: [...pageMap.values()].sort(
        (a, b) => b.visits - a.visits || a.page.localeCompare(b.page),
      ),
      daily,
      crew: {
        joined: crewMoves?.joined ?? 0,
        left: crewMoves?.left ?? 0,
        total: crewMoves?.total ?? 0,
      },
      noVisitsYet: everSeen === undefined,
    };
  },
});

/** Every operation in the area, for a registry to pick up in one go. */
/* ---- today so far ---------------------------------------------------------- */

export type DayNumbers = {
  /** The New Zealand day, as a date key. */
  readonly day: string;
  /** Paid orders placed that day, not counting test orders or ones called off. */
  readonly orders: number;
  /** What they came to, delivery included, less refunds. */
  readonly salesCents: number;
  /** Visits to the shop that day, by our own count. */
  readonly visits: number;
};

export type TodaySoFar = {
  readonly today: DayNumbers;
  readonly yesterday: DayNumbers;
  /** True when not one visit has ever been counted: the counter is new. */
  readonly noVisitsYet: boolean;
};

export const numbersToday = defineOp({
  name: "numbers.today",
  title: "Today so far",
  description:
    "Sales and visits for today so far and for yesterday, as New Zealand days: paid orders (test orders and cancelled ones are never sales), what they came to less refunds, and visits to the shop by its own count, which runs a little low. The same rules as `numbers.summary`, for the two days a person asks about first.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<TodaySoFar> {
    const todayKey = nzDateKey(ctx.now);
    const yesterdayKey = addDays(todayKey, -1);
    const from = startOfNzDay(yesterdayKey);
    const middle = startOfNzDay(todayKey);
    const to = startOfNzDay(addDays(todayKey, 1));
    const cut = middle.toISOString();

    const [[sold], [seen], [everSeen]] = await Promise.all([
      ctx.db
        .select({
          ordersToday: sql<number>`(count(*) filter (where ${orders.placedAt} >= ${cut}::timestamptz))::int`,
          ordersYesterday: sql<number>`(count(*) filter (where ${orders.placedAt} < ${cut}::timestamptz))::int`,
          salesToday: sql<number>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}) filter (where ${orders.placedAt} >= ${cut}::timestamptz), 0)::int`,
          salesYesterday: sql<number>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}) filter (where ${orders.placedAt} < ${cut}::timestamptz), 0)::int`,
        })
        .from(orders)
        .where(
          and(gte(orders.placedAt, from), lt(orders.placedAt, to), isSale),
        ),
      ctx.db
        .select({
          today: sql<number>`(count(distinct ${pageEvents.visit}) filter (where ${pageEvents.at} >= ${cut}::timestamptz))::int`,
          yesterday: sql<number>`(count(distinct ${pageEvents.visit}) filter (where ${pageEvents.at} < ${cut}::timestamptz))::int`,
        })
        .from(pageEvents)
        .where(
          and(
            gte(pageEvents.at, from),
            lt(pageEvents.at, to),
            eq(pageEvents.kind, "view"),
          ),
        ),
      ctx.db.select({ id: pageEvents.id }).from(pageEvents).limit(1),
    ]);

    return {
      today: {
        day: todayKey,
        orders: sold?.ordersToday ?? 0,
        salesCents: sold?.salesToday ?? 0,
        visits: seen?.today ?? 0,
      },
      yesterday: {
        day: yesterdayKey,
        orders: sold?.ordersYesterday ?? 0,
        salesCents: sold?.salesYesterday ?? 0,
        visits: seen?.yesterday ?? 0,
      },
      noVisitsYet: everSeen === undefined,
    };
  },
});

export const NUMBERS_OPS = [recordSeen, numbersSummary, numbersToday] as const;
