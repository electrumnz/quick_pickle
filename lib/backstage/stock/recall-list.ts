/**
 * The recall list: who has shots from a batch.
 *
 * Because every shot that leaves on an order is a movement with the order's
 * id on it, "which orders had shots from batch B002" is one query. And
 * because the batch on each movement is the one the person packing named,
 * the answer is what was really in the boxes, not a guess.
 *
 * This file is that query, with the customer's details beside each order.
 * With it: where every other shot of the batch went (samples, waste, count
 * corrections, still on hand) laid out so it can be seen to add up to what
 * was made, and an honest count of what the list cannot know: orders that
 * were sent before any batch was recorded.
 */

import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  orders,
  stockMovements,
  type BatchStatus,
  type OrderStatus,
} from "@/db/schema";

import { defineOp } from "../core/op";
import { countHolders, heldSql, ordersHolding } from "./batches";
import { batchCodeSchema } from "./inputs";
import { loadBatch, shotsOut } from "./movements";
import { readRecall, type RecallNote } from "./record";

export type RecallRow = {
  readonly number: string;
  readonly status: OrderStatus;
  /** True once the box has left the building: shipped or delivered. */
  readonly sent: boolean;
  readonly placedAt: Date;
  readonly shippedAt: Date | null;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  /** The delivery address, a line at a time. */
  readonly address: readonly string[];
  /** Shots this order holds from the batch, after anything put back. */
  readonly shots: number;
};

/**
 * A movement with no order behind it, and what was written down at the time.
 * For samples and waste `shots` is how many left. For a count correction it
 * is the change: more than zero if the count went up, less if it went down.
 */
export type RecallNoteLine = {
  readonly at: Date;
  readonly shots: number;
  readonly note: string;
};

export type RecallList = {
  readonly batch: {
    readonly code: string;
    readonly name: string;
    readonly status: BatchStatus;
    readonly madeOn: string | null;
    readonly bestBefore: string | null;
    readonly onHand: number;
    readonly recall: RecallNote | null;
  };
  /** Every order holding shots from the batch, newest first. */
  readonly orders: readonly RecallRow[];
  /** False if there were more orders than `limit` and the list was cut. */
  readonly complete: boolean;
  readonly totals: {
    readonly orders: number;
    readonly shots: number;
    /** Orders already shipped or delivered. */
    readonly sent: number;
    /** Orders packed but still here. */
    readonly notSent: number;
  };
  /** Shots given away, with the note made each time. No order behind them. */
  readonly samples: {
    readonly shots: number;
    readonly notes: readonly RecallNoteLine[];
  };
  /** Shots written off, with the note made each time. */
  readonly waste: {
    readonly shots: number;
    readonly notes: readonly RecallNoteLine[];
  };
  /**
   * Count corrections, with the reason given each time. `shots` is what they
   * come to in all: less than zero means shots nobody could find.
   */
  readonly corrections: {
    readonly shots: number;
    readonly notes: readonly RecallNoteLine[];
  };
  /**
   * Where every shot of the batch went. `adjustments` is what count
   * corrections added (or, if negative, took away). They always satisfy
   *   made + adjustments = sold + samples + waste + onHand
   * and `addsUp` says so, so a person can see nothing is unaccounted for.
   */
  readonly balance: {
    readonly made: number;
    readonly adjustments: number;
    /** Out on orders, after anything put back. */
    readonly sold: number;
    readonly samples: number;
    readonly waste: number;
    readonly onHand: number;
    readonly addsUp: boolean;
  };
  /**
   * Orders packed or sent with no batch recorded at all. They are on no
   * batch's list, and could have had shots from any batch on hand that day.
   */
  readonly noBatchRecorded: number;
};

/**
 * Orders that have been packed or sent with no batch written against them.
 * Names the outer row in full ("orders"."id") inside the sub-query.
 */
export const noBatchRecordedSql = sql`not "orders"."is_test"
  and "orders"."status" in ('packed', 'shipped', 'delivered')
  and coalesce((
    select sum(m.shots) from stock_movements m
    where m.order_id = "orders"."id" and m.kind in ('sold', 'returned')
  ), 0) >= 0`;

export const recallList = defineOp({
  name: "stock.recallList",
  title: "List who has shots from a batch",
  description:
    "The recall list for one batch: every order that holds shots from it, with the customer's name, email, phone and delivery address, how many shots, and whether the box has been sent or is still here. The batch against each order is the one named when it was packed. Also where the rest of the batch went: samples given away, shots written off and count corrections, each with the note made at the time, and what is still on hand, with a `balance` that shows made plus corrections equals sold plus samples plus waste plus on hand. And a count of orders that went out with no batch recorded at all, since those are on no batch's list. Read-only: it changes nothing and contacts nobody. Works for any batch, recalled or not.",
  access: "read",
  input: z.object({
    code: batchCodeSchema,
    limit: z.number().int().min(1).max(5000).default(2000),
  }),
  async run(ctx, input): Promise<RecallList> {
    const batch = await loadBatch(ctx.db, input.code);
    const rows = await ctx.db
      .select({
        number: orders.number,
        status: orders.status,
        placedAt: orders.placedAt,
        shippedAt: orders.shippedAt,
        firstName: orders.firstName,
        lastName: orders.lastName,
        email: orders.email,
        phone: orders.phone,
        line1: orders.line1,
        line2: orders.line2,
        suburb: orders.suburb,
        city: orders.city,
        region: orders.region,
        postcode: orders.postcode,
        shots: heldSql,
      })
      .from(stockMovements)
      .innerJoin(orders, eq(orders.id, stockMovements.orderId))
      .where(ordersHolding(batch.id))
      .groupBy(orders.id)
      .having(sql`sum(${stockMovements.shots}) < 0`)
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(input.limit + 1);
    const complete = rows.length <= input.limit;
    const listed = rows.slice(0, input.limit).map((row): RecallRow => ({
      number: row.number,
      status: row.status,
      sent: row.status === "shipped" || row.status === "delivered",
      placedAt: row.placedAt,
      shippedAt: row.shippedAt,
      name: `${row.firstName} ${row.lastName}`.trim(),
      email: row.email,
      phone: row.phone,
      address: [
        row.line1,
        row.line2,
        row.suburb,
        `${row.city} ${row.postcode}`,
        row.region,
      ].filter((line): line is string => line !== null && line !== ""),
      shots: row.shots,
    }));
    const holders = complete
      ? {
          orders: listed.length,
          shots: listed.reduce((sum, row) => sum + row.shots, 0),
        }
      : await countHolders(ctx.db, batch.id);
    const sent = listed.filter((row) => row.sent).length;

    // Everything that moved with no order behind it, with what was written
    // down at the time.
    const loose = await ctx.db
      .select({
        kind: stockMovements.kind,
        at: stockMovements.at,
        shots: stockMovements.shots,
        note: stockMovements.note,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.batchId, batch.id),
          inArray(stockMovements.kind, ["sample", "waste", "adjust"]),
        ),
      )
      .orderBy(desc(stockMovements.at), desc(stockMovements.id));
    const notesOf = (kind: "sample" | "waste"): RecallNoteLine[] =>
      loose
        .filter((row) => row.kind === kind)
        .map((row) => ({
          at: row.at,
          shots: shotsOut(row.shots),
          note: row.note,
        }));
    const total = (lines: readonly RecallNoteLine[]) =>
      lines.reduce((sum, line) => sum + line.shots, 0);
    const samples = notesOf("sample");
    const waste = notesOf("waste");
    const corrections = loose
      .filter((row) => row.kind === "adjust")
      .map((row) => ({ at: row.at, shots: row.shots, note: row.note }));

    // The whole batch, by kind of movement, straight from the movements.
    const sums = await ctx.db
      .select({
        kind: stockMovements.kind,
        shots: sql<number>`coalesce(sum(${stockMovements.shots}), 0)::int`,
      })
      .from(stockMovements)
      .where(eq(stockMovements.batchId, batch.id))
      .groupBy(stockMovements.kind);
    const by = (kind: string) =>
      sums.find((row) => row.kind === kind)?.shots ?? 0;
    const onHand = sums.reduce((sum, row) => sum + row.shots, 0);
    const balance = {
      made: by("made"),
      adjustments: by("adjust"),
      sold: shotsOut(by("sold") + by("returned")),
      samples: shotsOut(by("sample")),
      waste: shotsOut(by("waste")),
      onHand,
    };

    const [unrecorded] = await ctx.db
      .select({ n: count() })
      .from(orders)
      .where(noBatchRecordedSql);

    return {
      batch: {
        code: batch.code,
        name: batch.name,
        status: batch.status,
        madeOn: batch.madeOn,
        bestBefore: batch.bestBefore,
        onHand,
        recall: readRecall(batch.record),
      },
      orders: listed,
      complete,
      totals: {
        orders: holders.orders,
        shots: holders.shots,
        sent,
        notSent: listed.length - sent,
      },
      samples: { shots: total(samples), notes: samples },
      waste: { shots: total(waste), notes: waste },
      corrections: { shots: total(corrections), notes: corrections },
      balance: {
        ...balance,
        addsUp:
          balance.made + balance.adjustments ===
          balance.sold + balance.samples + balance.waste + balance.onHand,
      },
      noBatchRecorded: unrecorded?.n ?? 0,
    };
  },
});
