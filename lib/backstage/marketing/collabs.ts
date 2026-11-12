/**
 * Collabs: what working with a partner has brought in, and what it has cost.
 *
 * A partner (a club, a creator, an event) can have promo codes and short
 * links of their own. An order placed with one of their codes, or by someone
 * who came through one of their links, is credited to them when it is placed
 * (see credit.ts) and keeps that credit for good.
 *
 * Paying a partner works two ways, often both: a cut of each sale they bring
 * in (set on the partner), and flat costs written down here as they happen
 * (a fee for a post, a box of product, a stall). The sums are in
 * collab-sums.ts.
 *
 * Only real sales count: paid orders, less refunds. Test orders and orders
 * that were called off are left out everywhere, the same as on the Customers
 * screen.
 *
 * This is a reckoning for whoever runs the business, not the books. Paying a
 * creator is not recorded for tax here. That is Xero's job.
 */

import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import { links, orders, partnerCosts, partners, promoCodes } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzdExact } from "@/lib/shop/money";
import { nzDateKey } from "@/lib/time";

import { notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import {
  COST_KIND_LABEL,
  COST_KINDS,
  collabReturn,
  NO_SPEND,
  NO_TAKINGS,
  type CollabReturn,
  type CostKind,
  type Spend,
  type Takings,
} from "./collab-sums";
import { dayLabel, isDateKey } from "./dates";
import { promoLabel, promoState } from "./promo";
import { recordId, userIdOf } from "./shared";
import type { PartnerKind, PartnerStatus, PromoState } from "./status";

/* ---- adding orders up ---------------------------------------------------- */

/** An order that counts as a sale: paid for real, and not called off. */
const isSale = sql`not ${orders.isTest} and ${orders.status} <> 'cancelled' and ${orders.paymentStatus} in ('paid', 'part_refunded')`;

/**
 * The figures for a set of orders. The cut is the same sum as `cutOn` in
 * collab-sums.ts, done by the database: a whole percentage of the goods as
 * paid for, rounded to the nearest cent, order by order.
 *
 * The last one looks back at the outer row, so the outer columns are written
 * in full: a bare "email" inside the sub-query would mean the inner order's.
 */
const takingsColumns = {
  orders: sql<number>`count(*)::int`,
  salesCents: sql<number>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}), 0)::int`,
  discountCents: sql<number>`coalesce(sum(${orders.discountCents} + ${orders.deliveryDiscountCents}), 0)::int`,
  commissionCents: sql<number>`coalesce(sum((greatest(${orders.subtotalCents} - ${orders.discountCents} - ${orders.refundedCents}, 0)::bigint * ${orders.commissionPercent} + 50) / 100), 0)::int`,
  newCustomers: sql<number>`(count(*) filter (where not exists (
    select 1 from orders e
    where e.email = "orders"."email"
      and e.placed_at < "orders"."placed_at"
      and not e.is_test
      and e.status <> 'cancelled'
      and e.payment_status in ('paid', 'part_refunded')
  )))::int`,
};

/** The link an order came through, as the order holds it. */
const viaSql = sql<string | null>`${orders.source}->>'via'`;

async function takingsWhere(db: DbOrTx, where: SQL): Promise<Takings> {
  const [row] = await db
    .select(takingsColumns)
    .from(orders)
    .where(and(where, isSale));
  return row ?? NO_TAKINGS;
}

async function takingsBy(
  db: DbOrTx,
  key: SQL<string | null>,
  where: SQL,
): Promise<Map<string, Takings>> {
  const rows = await db
    .select({ key, ...takingsColumns })
    .from(orders)
    .where(and(where, isSale))
    .groupBy(key);
  const out = new Map<string, Takings>();
  for (const { key: name, ...takings } of rows) {
    if (name !== null) out.set(name, takings);
  }
  return out;
}

/* ---- what it has cost ---------------------------------------------------- */

export type CostRow = {
  readonly id: string;
  readonly kind: CostKind;
  readonly amountCents: number;
  /** The New Zealand day it was paid or sent, as 2026-11-12. */
  readonly paidOn: string;
  readonly note: string;
  readonly createdAt: Date;
};

const amountField = z
  .number({ error: "Enter the amount in numbers, like 150 or 42.50" })
  .int("Enter the amount in numbers, like 150 or 42.50")
  .min(1, "Enter an amount more than nothing")
  .max(100_000_000, "That is more than this can hold");
const kindField = z.enum(COST_KINDS, { error: "Pick what it was" });
const dayField = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || isDateKey(value),
    "Pick a day, like 2026-11-20",
  );

async function partnerName(db: DbOrTx, id: string): Promise<string> {
  const [partner] = await db
    .select({ name: partners.name })
    .from(partners)
    .where(eq(partners.id, id));
  if (partner === undefined) throw notFound("That partner");
  return partner.name;
}

async function costsOf(db: DbOrTx, partnerId: string): Promise<CostRow[]> {
  return db
    .select({
      id: partnerCosts.id,
      kind: partnerCosts.kind,
      amountCents: partnerCosts.amountCents,
      paidOn: partnerCosts.paidOn,
      note: partnerCosts.note,
      createdAt: partnerCosts.createdAt,
    })
    .from(partnerCosts)
    .where(eq(partnerCosts.partnerId, partnerId))
    .orderBy(desc(partnerCosts.paidOn), desc(partnerCosts.createdAt));
}

function spendOf(
  costs: readonly Pick<CostRow, "kind" | "amountCents">[],
): Spend {
  const spend = { ...NO_SPEND };
  for (const cost of costs) spend[cost.kind] += cost.amountCents;
  return spend;
}

export const addPartnerCost = defineOp({
  name: "partners.addCost",
  title: "Write down something a partnership cost",
  description:
    "Records one thing paid or given to a partner, so the return on working with them can be worked out. `kind` is fee (a flat payment: for a post, a reel, a stall, a season), product (product given away, at what it is worth), commission (a payout of the cut they have earned) or other. `amountCents` is what it came to. `paidOn` is the New Zealand day, as 2026-11-20; leave it out for today. This writes a note for the owner. It moves no money and is not the accounts.",
  access: "write",
  input: z.object({
    partnerId: recordId,
    kind: kindField,
    amountCents: amountField,
    paidOn: dayField.default(""),
    note: z
      .string()
      .trim()
      .max(280, "Keep the note under 280 letters")
      .default(""),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const name = await partnerName(ctx.db, input.partnerId);
    const today = nzDateKey(ctx.now);
    const paidOn = input.paidOn === "" ? today : input.paidOn;
    if (paidOn > today) {
      const message =
        "That day has not come yet. Write a cost down once it has been paid or sent.";
      throw new OpError("invalid_input", message, { paidOn: message });
    }
    const id = newId("pcs");
    await ctx.db.insert(partnerCosts).values({
      id,
      partnerId: input.partnerId,
      kind: input.kind,
      amountCents: input.amountCents,
      paidOn,
      note: input.note,
      createdBy: userIdOf(ctx),
      createdAt: ctx.now,
    });
    await ctx.audit({
      entity: { type: "partner", id: input.partnerId },
      summary: `Wrote down ${formatNzdExact(input.amountCents)} for ${name}: ${COST_KIND_LABEL[input.kind].toLowerCase()}, ${dayLabel(paidOn)}${input.note === "" ? "" : ` (${input.note})`}`,
      data: { costId: id, kind: input.kind, amountCents: input.amountCents },
    });
    return { id };
  },
});

export const removePartnerCost = defineOp({
  name: "partners.removeCost",
  title: "Take a cost off a partner",
  description:
    "Removes one cost line that was written down against a partner, for a mistake. The activity log keeps a note of what it was. The return is worked out again without it.",
  access: "write",
  effect: "destructive",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<{ partnerId: string }> {
    const [cost] = await ctx.db
      .select()
      .from(partnerCosts)
      .where(eq(partnerCosts.id, input.id));
    if (cost === undefined) throw notFound("That cost");
    const name = await partnerName(ctx.db, cost.partnerId);
    await ctx.db.delete(partnerCosts).where(eq(partnerCosts.id, cost.id));
    await ctx.audit({
      entity: { type: "partner", id: cost.partnerId },
      summary: `Took off the ${formatNzdExact(cost.amountCents)} written down for ${name} on ${dayLabel(cost.paidOn)} (${COST_KIND_LABEL[cost.kind].toLowerCase()})`,
      data: {
        costId: cost.id,
        kind: cost.kind,
        amountCents: cost.amountCents,
        paidOn: cost.paidOn,
        note: cost.note,
      },
    });
    return { partnerId: cost.partnerId };
  },
});

/* ---- one partner --------------------------------------------------------- */

export type CodeResult = Takings & {
  readonly id: string;
  readonly code: string;
  /** "10% off", "$5 off", "Free standard delivery". */
  readonly label: string;
  readonly state: PromoState;
};

export type LinkResult = {
  readonly id: string;
  readonly slug: string;
  /** The short address on this site: "/go/rovers". */
  readonly path: string;
  readonly label: string;
  readonly active: boolean;
  /** Visits, not people. */
  readonly clicks: number;
  /** The code it carries into the checkout, if it carries one. */
  readonly code: string | null;
  /** Sales by people who came through it. */
  readonly orders: number;
  readonly salesCents: number;
};

export type PartnerResults = {
  readonly partnerId: string;
  readonly name: string;
  /** Their cut of each sale they bring in, a whole percentage. */
  readonly commissionPercent: number;
  /** Every sale credited to them, by code or by link. */
  readonly takings: Takings;
  readonly costs: readonly CostRow[];
  readonly spend: Spend;
  readonly result: CollabReturn;
  readonly codes: readonly CodeResult[];
  readonly links: readonly LinkResult[];
  /** Visits through all of their links. */
  readonly clicks: number;
};

export const partnerResults = defineOp({
  name: "partners.results",
  title: "What a partner has brought in, and what they have cost",
  description:
    "For one partner: the sales credited to them (orders placed with one of their codes or by someone who came through one of their links), what promo codes took off those orders, the cut they have earned, how many of those buyers were new, every cost written down against them, and the return: what the partnership has cost in all, sales less that cost, and sales back for each dollar spent (null when nothing has been spent). Also each of their codes and links with its own figures, and the clicks on their links. Only real, paid sales count, less refunds: test orders and cancelled ones are left out. Sales, not profit: what the product and postage cost is not taken off.",
  access: "read",
  input: z.object({ partnerId: recordId }),
  async run(ctx, input): Promise<PartnerResults> {
    const [partner] = await ctx.db
      .select({
        name: partners.name,
        commissionPercent: partners.commissionPercent,
      })
      .from(partners)
      .where(eq(partners.id, input.partnerId));
    if (partner === undefined) throw notFound("That partner");

    const [takings, costs, codes, theirLinks] = await Promise.all([
      takingsWhere(ctx.db, eq(orders.partnerId, input.partnerId)),
      costsOf(ctx.db, input.partnerId),
      ctx.db
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.partnerId, input.partnerId))
        .orderBy(desc(promoCodes.createdAt), desc(promoCodes.id)),
      ctx.db
        .select({ link: links, code: promoCodes.code })
        .from(links)
        .leftJoin(promoCodes, eq(promoCodes.id, links.promoCodeId))
        .where(eq(links.partnerId, input.partnerId))
        .orderBy(desc(links.clicks), asc(links.slug)),
    ]);

    const [byCode, byLink] = await Promise.all([
      codes.length === 0
        ? new Map<string, Takings>()
        : takingsBy(
            ctx.db,
            sql<string | null>`${orders.promoCode}`,
            inArray(
              orders.promoCode,
              codes.map((promo) => promo.code),
            ),
          ),
      theirLinks.length === 0
        ? new Map<string, Takings>()
        : takingsBy(
            ctx.db,
            viaSql,
            inArray(
              viaSql,
              theirLinks.map((row) => row.link.slug),
            ),
          ),
    ]);

    const spend = spendOf(costs);
    return {
      partnerId: input.partnerId,
      name: partner.name,
      commissionPercent: partner.commissionPercent,
      takings,
      costs,
      spend,
      result: collabReturn(takings, spend),
      codes: codes.map((promo) => ({
        id: promo.id,
        code: promo.code,
        label: promoLabel(promo),
        state: promoState(promo, ctx.now),
        ...(byCode.get(promo.code) ?? NO_TAKINGS),
      })),
      links: theirLinks.map(({ link, code }) => {
        const through = byLink.get(link.slug) ?? NO_TAKINGS;
        return {
          id: link.id,
          slug: link.slug,
          path: `/go/${link.slug}`,
          label: link.label,
          active: link.active,
          clicks: link.clicks,
          code,
          orders: through.orders,
          salesCents: through.salesCents,
        };
      }),
      clicks: theirLinks.reduce((sum, row) => sum + row.link.clicks, 0),
    };
  },
});

/* ---- everybody, side by side --------------------------------------------- */

export type CollabRow = {
  readonly partnerId: string;
  readonly name: string;
  readonly kind: PartnerKind;
  readonly status: PartnerStatus;
  readonly orders: number;
  readonly salesCents: number;
  readonly newCustomers: number;
  /** Everything the partnership has cost. */
  readonly spendCents: number;
  /** Cut earned and not yet paid out. */
  readonly cutOwingCents: number;
  /** Sales back for each dollar spent, in cents. Null: nothing spent. */
  readonly backPerDollarCents: number | null;
};

export const collabBoard = defineOp({
  name: "collabs.board",
  title: "Every collab, side by side",
  description:
    "Every partner who has a promo code, a short link, a cost written down or a sale credited to them, with what they have brought in (paid orders and sales, less refunds), how many of those buyers were new, what the partnership has cost, the cut still to pay them, and sales back for each dollar spent (null when nothing has been spent). Biggest sales first. Sales, not profit.",
  access: "read",
  input: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
  async run(ctx, input): Promise<CollabRow[]> {
    const [byPartner, costRows, withCode, withLink] = await Promise.all([
      takingsBy(
        ctx.db,
        sql<string | null>`${orders.partnerId}`,
        isNotNull(orders.partnerId),
      ),
      ctx.db
        .select({
          partnerId: partnerCosts.partnerId,
          kind: partnerCosts.kind,
          amountCents: sql<number>`sum(${partnerCosts.amountCents})::int`,
        })
        .from(partnerCosts)
        .groupBy(partnerCosts.partnerId, partnerCosts.kind),
      ctx.db
        .selectDistinct({ partnerId: promoCodes.partnerId })
        .from(promoCodes)
        .where(isNotNull(promoCodes.partnerId)),
      ctx.db
        .selectDistinct({ partnerId: links.partnerId })
        .from(links)
        .where(isNotNull(links.partnerId)),
    ]);

    const spendBy = new Map<
      string,
      { kind: CostKind; amountCents: number }[]
    >();
    for (const row of costRows) {
      const list = spendBy.get(row.partnerId) ?? [];
      list.push({ kind: row.kind, amountCents: row.amountCents });
      spendBy.set(row.partnerId, list);
    }
    const ids = new Set<string>([...byPartner.keys(), ...spendBy.keys()]);
    for (const row of [...withCode, ...withLink]) {
      if (row.partnerId !== null) ids.add(row.partnerId);
    }
    if (ids.size === 0) return [];

    const who = await ctx.db
      .select({
        id: partners.id,
        name: partners.name,
        kind: partners.kind,
        status: partners.status,
      })
      .from(partners)
      .where(inArray(partners.id, [...ids]));

    return who
      .map((partner) => {
        const takings = byPartner.get(partner.id) ?? NO_TAKINGS;
        const result = collabReturn(
          takings,
          spendOf(spendBy.get(partner.id) ?? []),
        );
        return {
          partnerId: partner.id,
          name: partner.name,
          kind: partner.kind,
          status: partner.status,
          orders: takings.orders,
          salesCents: takings.salesCents,
          newCustomers: takings.newCustomers,
          spendCents: result.spendCents,
          cutOwingCents: result.cutOwingCents,
          backPerDollarCents: result.backPerDollarCents,
        };
      })
      .sort(
        (a, b) =>
          b.salesCents - a.salesCents ||
          b.spendCents - a.spendCents ||
          a.name.localeCompare(b.name),
      )
      .slice(0, input.limit);
  },
});

/* ---- one code ------------------------------------------------------------ */

export const promoCodeResults = defineOp({
  name: "promoCodes.results",
  title: "What a promo code has brought in",
  description:
    "For one promo code, by its id: the paid orders placed with it, what customers paid on them (delivery included, less refunds), what the code took off, how many of those buyers were new, and the cut those orders earned whoever they were credited to. Test orders and cancelled ones are left out, so this can be lower than the number of times the code has been used.",
  access: "read",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<Takings & { readonly code: string }> {
    const [promo] = await ctx.db
      .select({ code: promoCodes.code })
      .from(promoCodes)
      .where(eq(promoCodes.id, input.id));
    if (promo === undefined) throw notFound("That code");
    const takings = await takingsWhere(
      ctx.db,
      eq(orders.promoCode, promo.code),
    );
    return { code: promo.code, ...takings };
  },
});
