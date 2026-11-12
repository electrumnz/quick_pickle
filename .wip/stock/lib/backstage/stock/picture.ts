/**
 * The stock picture: what there is to sell right now, and what in stock
 * wants a person.
 *
 * One read that every screen and automation can share, so "how many shots
 * can be sold" has a single answer and never an optimistic one:
 *
 *   ready      on hand in batches that are released and still within their
 *              best-before date, worked out from the movements
 *   promised   shots in paid orders still waiting to be packed
 *   available  ready less promised: what a new order could really have
 *
 * Nothing in a batch that is past its date, recalled, closed or not yet
 * released is ever counted as sellable. Alongside the numbers, the things
 * worth acting on, each as a sentence with somewhere to go.
 */

import { and, count, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import {
  batches,
  materials,
  orders,
  purchaseOrders,
  suppliers,
  type BatchStatus,
} from "@/db/schema";

import { defineOp } from "../core/op";
import { releasedShelf } from "./allocation";
import {
  daysAwayText,
  daysBetween,
  formatDateKey,
  isGoodOn,
  todayKey,
} from "./dates";
import { lowStockAtSchema } from "./inputs";
import { onHandSql, promisedShots, readyShots, shotsText } from "./movements";
import { noBatchRecordedSql } from "./recall-list";
import { NEAR_BEST_BEFORE_DAYS } from "./status";

export type PictureBatch = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: BatchStatus;
  readonly bestBefore: string | null;
  /** Days until the best-before date. Negative once it has passed. */
  readonly daysToBestBefore: number | null;
  /** Still within its best-before date today (good through that day). */
  readonly good: boolean;
  readonly onHand: number;
};

export type AttentionItem = {
  /** What sort of thing it is, for anything that wants to group or filter. */
  readonly kind:
    | "past-best-before"
    | "short-for-orders"
    | "low-stock"
    | "purchase-overdue"
    | "near-best-before"
    | "material-low"
    | "not-released"
    | "no-batch-recorded";
  /** One sentence to show as it stands. */
  readonly text: string;
  /** Where in the back end to go to deal with it. */
  readonly href: string;
};

export type StockPicture = {
  /**
   * False until a batch has been recorded as made. Before that no shots are
   * counted anywhere and orders are packed without a batch.
   */
  readonly tracking: boolean;
  /**
   * Shots on hand in batches that are released and still within their
   * best-before date. What is physically there to be sold.
   */
  readonly ready: number;
  /** Shots in paid orders still waiting to be packed. Test orders left out. */
  readonly promised: number;
  /** Ready less promised, never below nothing: what is really free to sell. */
  readonly available: number;
  /** Released batches, earliest best-before date first, past-date ones too. */
  readonly byBatch: readonly PictureBatch[];
  /** Shots still on hand in released batches that are past their date. */
  readonly pastDate: number;
  /** Shots in batches that are made but not yet released. */
  readonly notReleased: number;
  /** The batches behind that number. */
  readonly waiting: readonly PictureBatch[];
  /** How many batches are planned and not made yet. */
  readonly planned: number;
  /**
   * Batches with shots on hand whose best-before date is within `nearDays`
   * or has already passed, soonest first.
   */
  readonly nearBestBefore: readonly PictureBatch[];
  readonly nearDays: number;
  /** True when what is available is under `lowStockAt`. */
  readonly low: boolean;
  readonly lowStockAt: number;
  /** Materials at or under their reorder level. */
  readonly materialsToReorder: readonly {
    readonly id: string;
    readonly name: string;
    readonly onHand: number;
    readonly reorderAt: number;
  }[];
  /** Purchase orders sent to a supplier and past the day they were due. */
  readonly purchasesOverdue: readonly {
    readonly number: string;
    readonly supplier: string;
    readonly expectedOn: string;
    readonly daysLate: number;
  }[];
  /** Orders packed or sent with no batch recorded. */
  readonly noBatchRecorded: number;
  /** Everything above that wants a person, most pressing first. */
  readonly attention: readonly AttentionItem[];
};

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-NZ")} ${count === 1 ? one : many}`;
}

export const stockPicture = defineOp({
  name: "stock.picture",
  title: "See what is in stock",
  description:
    "The stock picture in one call. `ready` is shots on hand in batches that are released and still within their best-before date; `promised` is shots in paid orders waiting to be packed; `available` is the first less the second, which is what can really still be sold. Also: each released batch with its shots, shots on hand that are past their date (never sellable), shots made but not yet released, batches at or near their best-before date (`nearDays`, 30 unless given), materials to reorder, purchase orders that are overdue, and orders that went out with no batch recorded. `attention` is the same things as sentences with a link each, most pressing first: show those where someone will see them. `tracking` is false until a first batch has been recorded as made.",
  access: "read",
  input: z.object({
    nearDays: z.number().int().min(0).max(365).default(NEAR_BEST_BEFORE_DAYS),
    lowStockAt: lowStockAtSchema,
  }),
  async run(ctx, input): Promise<StockPicture> {
    // Worked out for this request: the answer changes at midnight.
    const today = todayKey(ctx.now);

    const view = (row: {
      id: string;
      code: string;
      name: string;
      bestBefore: string | null;
      onHand: number;
      status: BatchStatus;
    }): PictureBatch => ({
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      bestBefore: row.bestBefore,
      daysToBestBefore:
        row.bestBefore === null ? null : daysBetween(today, row.bestBefore),
      good: isGoodOn(row.bestBefore, today),
      onHand: row.onHand,
    });

    const shelf = await releasedShelf(ctx.db, { today });
    const byBatch = shelf.map((row) => view({ ...row, status: "released" }));
    const made = await ctx.db
      .select({
        id: batches.id,
        code: batches.code,
        name: batches.name,
        status: batches.status,
        bestBefore: batches.bestBefore,
        onHand: onHandSql,
      })
      .from(batches)
      .where(eq(batches.status, "made"))
      .orderBy(batches.code);
    const waiting = made.map(view);

    const ready = byBatch
      .filter((batch) => batch.good)
      .reduce((sum, batch) => sum + batch.onHand, 0);
    const pastDate = byBatch
      .filter((batch) => !batch.good)
      .reduce((sum, batch) => sum + batch.onHand, 0);
    const notReleased = waiting.reduce((sum, batch) => sum + batch.onHand, 0);
    const promised = await promisedShots(ctx.db);
    const available = Math.max(0, ready - promised);

    const nearBestBefore = [...byBatch, ...waiting]
      .filter(
        (batch) =>
          batch.onHand > 0 &&
          batch.daysToBestBefore !== null &&
          batch.daysToBestBefore <= input.nearDays,
      )
      .sort((a, b) => (a.daysToBestBefore ?? 0) - (b.daysToBestBefore ?? 0));

    const [states] = await ctx.db
      .select({
        planned: sql<number>`count(*) filter (where ${batches.status} = 'planned')::int`,
        everMade: sql<number>`count(*) filter (where ${batches.status} <> 'planned')::int`,
      })
      .from(batches);
    const tracking = (states?.everMade ?? 0) > 0;

    const lowMaterials = await ctx.db
      .select({
        id: materials.id,
        name: materials.name,
        onHand: materials.onHand,
        reorderAt: materials.reorderAt,
      })
      .from(materials)
      .where(
        and(
          isNotNull(materials.reorderAt),
          sql`${materials.onHand} <= ${materials.reorderAt}`,
        ),
      )
      .orderBy(materials.name);
    const materialsToReorder = lowMaterials.map((row) => ({
      ...row,
      reorderAt: row.reorderAt ?? 0,
    }));

    const late = await ctx.db
      .select({
        number: purchaseOrders.number,
        supplier: suppliers.name,
        expectedOn: purchaseOrders.expectedOn,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(
        and(
          eq(purchaseOrders.status, "sent"),
          isNotNull(purchaseOrders.expectedOn),
          lt(purchaseOrders.expectedOn, today),
        ),
      )
      .orderBy(purchaseOrders.expectedOn);
    const purchasesOverdue = late.map((row) => {
      const expectedOn = row.expectedOn ?? today;
      return {
        number: row.number,
        supplier: row.supplier,
        expectedOn,
        daysLate: daysBetween(expectedOn, today),
      };
    });

    const [unrecorded] = tracking
      ? await ctx.db
          .select({ n: count() })
          .from(orders)
          .where(noBatchRecordedSql)
      : [{ n: 0 }];
    const noBatchRecorded = unrecorded?.n ?? 0;

    const low = tracking && available < input.lowStockAt;
    const batchHref = (code: string) => `/backstage/stock/batches/${code}`;
    const attention: AttentionItem[] = [];
    for (const batch of nearBestBefore) {
      if (batch.good || batch.bestBefore === null) continue;
      attention.push({
        kind: "past-best-before",
        text: `${batch.code} passed its best-before date on ${formatDateKey(batch.bestBefore)} and still has ${shotsText(batch.onHand)} on hand. They cannot be sold: write them off.`,
        href: batchHref(batch.code),
      });
    }
    if (tracking && promised > ready) {
      attention.push({
        kind: "short-for-orders",
        text: `Orders waiting to be packed need ${shotsText(promised)} and only ${ready.toLocaleString("en-NZ")} ${ready === 1 ? "is" : "are"} ready to sell.`,
        href: "/backstage/stock/batches",
      });
    } else if (low) {
      attention.push({
        kind: "low-stock",
        text:
          promised === 0
            ? `Stock is running low: ${shotsText(available)} free to sell.`
            : `Stock is running low: ${shotsText(available)} free to sell, once the ${promised.toLocaleString("en-NZ")} promised to orders are packed.`,
        href: "/backstage/stock/batches",
      });
    }
    for (const purchase of purchasesOverdue) {
      attention.push({
        kind: "purchase-overdue",
        text: `${purchase.number} from ${purchase.supplier} was due on ${formatDateKey(purchase.expectedOn)} and has not been marked as received.`,
        href: `/backstage/stock/purchase-orders/${purchase.number}`,
      });
    }
    for (const batch of nearBestBefore) {
      if (!batch.good || batch.bestBefore === null) continue;
      attention.push({
        kind: "near-best-before",
        text: `${batch.code} reaches its best-before date ${daysAwayText(batch.daysToBestBefore ?? 0)} (${formatDateKey(batch.bestBefore)}), with ${shotsText(batch.onHand)} on hand.`,
        href: batchHref(batch.code),
      });
    }
    for (const material of materialsToReorder) {
      attention.push({
        kind: "material-low",
        text: `${material.name}: ${material.onHand.toLocaleString("en-NZ")} on hand. Reorder at ${material.reorderAt.toLocaleString("en-NZ")}.`,
        href: `/backstage/stock/materials/${material.id}`,
      });
    }
    for (const batch of waiting) {
      if (batch.onHand <= 0 || (batch.bestBefore !== null && !batch.good)) {
        continue;
      }
      attention.push({
        kind: "not-released",
        text: `${batch.code} has been made but not released for sale: ${shotsText(batch.onHand)} waiting.`,
        href: batchHref(batch.code),
      });
    }
    if (noBatchRecorded > 0) {
      attention.push({
        kind: "no-batch-recorded",
        text: `${plural(noBatchRecorded, "order has", "orders have")} been packed or sent with no batch recorded.`,
        href: "/backstage/stock#no-batch",
      });
    }

    return {
      tracking,
      ready,
      promised,
      available,
      byBatch,
      pastDate,
      notReleased,
      waiting,
      planned: states?.planned ?? 0,
      nearBestBefore,
      nearDays: input.nearDays,
      low,
      lowStockAt: input.lowStockAt,
      materialsToReorder,
      purchasesOverdue,
      noBatchRecorded,
      attention,
    };
  },
});

export type Availability = {
  /** False until a batch has been recorded as made: nothing is counted yet. */
  readonly tracking: boolean;
  /** Shots on hand in batches that are released and within their date. */
  readonly ready: number;
  /** Shots in paid orders still waiting to be packed. */
  readonly promised: number;
  /** Ready less promised, never below nothing. */
  readonly available: number;
};

export const stockAvailable = defineOp({
  name: "stock.available",
  title: "See how many shots are free to sell",
  description:
    "How many shots could still be sold right now: on hand in batches that are released and within their best-before date, less the shots already promised to paid orders waiting to be packed. Packs share one pool of shots, so to ask whether an order can be met, compare its total shots across all its lines with `available`, never one line at a time. The quick answer for anything deciding whether to take an order; stock.picture has the detail. While `tracking` is false no batch has been recorded yet and the numbers are all nothing: that means stock is not being counted, not that the shelf is empty.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<Availability> {
    const [made] = await ctx.db
      .select({ n: count() })
      .from(batches)
      .where(inArray(batches.status, ["made", "released", "closed", "recalled"]));
    const ready = await readyShots(ctx.db, todayKey(ctx.now));
    const promised = await promisedShots(ctx.db);
    return {
      tracking: (made?.n ?? 0) > 0,
      ready,
      promised,
      available: Math.max(0, ready - promised),
    };
  },
});
