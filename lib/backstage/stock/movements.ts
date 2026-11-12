/**
 * Stock movements: the only way a count of shots ever changes.
 *
 * Nothing in the back end stores "how many are left". A batch's shots on
 * hand is the sum of its movements: made (in), sold (out, on an order),
 * returned (back in from an order), sample and waste (out), adjust (either
 * way, after a count). That is what makes a recall answerable: which orders
 * had shots from a batch is a question about movements, not about memory.
 *
 * This file holds the arithmetic every stock operation shares: reading a
 * count, writing a movement, and saying when stock has run low. Filling
 * orders from batches is built on it, in allocation.ts.
 */

import { and, eq, gte, ne, sql } from "drizzle-orm";

import {
  batches,
  orderLines,
  orders,
  stockMovements,
  type MovementKind,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import type { Actor } from "../core/actor";
import { notFound } from "../core/errors";
import type { OpContext } from "../core/op";

/** A count as it is written in a sentence: "24", "1,200". */
export function countText(count: number): string {
  return count.toLocaleString("en-NZ");
}

/** "1 shot", "24 shots", "1,200 shots". */
export function shotsText(count: number): string {
  return `${countText(count)} ${count === 1 ? "shot" : "shots"}`;
}

/**
 * A sum of movements out of a batch (which is negative) as a count of shots.
 * Not written as a bare minus sign, because nothing out would then be minus
 * zero, which prints as "-0".
 */
export function shotsOut(sum: number): number {
  return sum === 0 ? 0 : -sum;
}

/** Who a movement is put down to: the member of staff, or nobody. */
export function movedBy(actor: Actor): string | null {
  return actor.type === "system" ? null : actor.userId;
}

/**
 * A batch's shots on hand, for a query that reads from `batches`.
 *
 * The sub-query names the outer row in full ("batches"."id"): Drizzle leaves
 * the table name off a column when a query reads one table, and a bare "id"
 * in here would mean the movement's own.
 */
export const onHandSql = sql<number>`coalesce((
  select sum(m.shots)::int from stock_movements m
  where m.batch_id = "batches"."id"
), 0)`;

export type BatchRow = typeof batches.$inferSelect;

/**
 * Find a batch by the code on its bottles. With `lock`, hold its row until
 * the transaction ends, so two people changing the same batch at once take
 * turns and each sees what the other did.
 */
export async function loadBatch(
  db: DbOrTx,
  code: string,
  options: { readonly lock?: boolean } = {},
): Promise<BatchRow> {
  const query = db.select().from(batches).where(eq(batches.code, code));
  const [batch] = await (options.lock === true ? query.for("update") : query);
  if (batch === undefined) throw notFound(`Batch ${code}`);
  return batch;
}

/**
 * Whether stock is being counted at all: true once any batch has been
 * recorded as made. Until then there are no shots anywhere to count, orders
 * are packed with no batch, and nothing outside the Stock screens says a
 * word about stock. It is off until somebody starts it.
 */
export async function stockIsCounted(db: DbOrTx): Promise<boolean> {
  const [made] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(ne(batches.status, "planned"))
    .limit(1);
  return made !== undefined;
}

/** Shots on hand in one batch: the sum of everything that has moved. */
export async function batchOnHand(
  db: DbOrTx,
  batchId: string,
): Promise<number> {
  const [row] = await db
    .select({
      shots: sql<number>`coalesce(sum(${stockMovements.shots}), 0)::int`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.batchId, batchId));
  return row?.shots ?? 0;
}

/**
 * Shots ready to sell: on hand in every batch that is released and still
 * good on `today` (a New Zealand date; see isGoodOn in dates.ts, which this
 * mirrors in SQL). Stock in a batch that is past its best-before date,
 * recalled, closed or not yet released is never counted as sellable.
 */
export async function readyShots(db: DbOrTx, today: string): Promise<number> {
  const [row] = await db
    .select({
      shots: sql<number>`coalesce(sum(${stockMovements.shots}), 0)::int`,
    })
    .from(stockMovements)
    .innerJoin(batches, eq(batches.id, stockMovements.batchId))
    .where(and(eq(batches.status, "released"), gte(batches.bestBefore, today)));
  return row?.shots ?? 0;
}

/**
 * Shots promised and not yet taken out of stock: every shot in an order
 * that is paid and still waiting to be packed. An order's packs all draw on
 * the one pool of shots, so this is the order's total across its lines. Test
 * orders are left out: nobody paid for them and they are never sent.
 */
export async function promisedShots(db: DbOrTx): Promise<number> {
  const [row] = await db
    .select({
      shots: sql<number>`coalesce(sum(${orderLines.qty} * ${orderLines.shots}), 0)::int`,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orders.status, "paid"), eq(orders.isTest, false)));
  return row?.shots ?? 0;
}

/** Write one movement down. `shots` is positive in, negative out. */
export async function writeMovement(
  db: DbOrTx,
  movement: {
    readonly batchId: string;
    readonly kind: MovementKind;
    readonly shots: number;
    readonly orderId?: string | null;
    readonly note?: string;
    readonly now: Date;
    readonly actor: Actor;
  },
): Promise<string> {
  const id = newId("stk");
  await db.insert(stockMovements).values({
    id,
    at: movement.now,
    batchId: movement.batchId,
    kind: movement.kind,
    shots: movement.shots,
    orderId: movement.orderId ?? null,
    note: movement.note ?? "",
    createdBy: movedBy(movement.actor),
  });
  return id;
}

/**
 * Tell anything listening that stock has run low, at the moment it does.
 * Only the step that crosses the line raises it: going from 50 to 40 with
 * the line at 48 does, going on from 40 to 30 does not.
 *
 * `before` and `after` are shots ready to sell (readyShots). The event also
 * carries how many of those are already promised to paid orders waiting to
 * be packed, so a listener can tell what is really free.
 */
export async function flagIfLow(
  ctx: OpContext,
  change: {
    readonly before: number;
    readonly after: number;
    readonly threshold: number;
    readonly because: string;
    readonly code?: string;
    readonly order?: string;
  },
): Promise<boolean> {
  if (change.before < change.threshold || change.after >= change.threshold) {
    return false;
  }
  await ctx.emit({
    type: "stock.low",
    payload: {
      onHand: change.after,
      promised: await promisedShots(ctx.db),
      threshold: change.threshold,
      because: change.because,
      ...(change.code === undefined ? {} : { code: change.code }),
      ...(change.order === undefined ? {} : { order: change.order }),
    },
  });
  return true;
}
