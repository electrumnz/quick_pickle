/**
 * Batches: one run of making, from a line on the calendar to the last
 * bottle.
 *
 * A batch has a code (what is printed on the bottle), a state, a production
 * record, and movements. It is planned, then made (which counts its shots
 * into stock), then released (cleared to sell: orders are filled from it),
 * then closed. At any point once it exists as bottles it can be recalled,
 * and a recalled batch is never sold from again.
 *
 * This file is reading batches, planning them and correcting their details.
 * Moving one from state to state is in batch-states.ts, and the recall list
 * in recall-list.ts.
 */

import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  batches,
  orders,
  stockMovements,
  users,
  type BatchStatus,
  type MovementKind,
  type OrderStatus,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzd } from "@/lib/shop/money";

import { conflict, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import {
  dateKeySchema,
  daysBetween,
  formatDateKey,
  isGoodOn,
  todayKey,
} from "./dates";
import {
  batchCodeSchema,
  centsSchema,
  isUniqueViolation,
  longTextSchema,
  shotsSchema,
} from "./inputs";
import {
  countText,
  loadBatch,
  onHandSql,
  shotsOut,
  shotsText,
} from "./movements";
import {
  mergeRecord,
  readRecall,
  readRecord,
  recordChanges,
  recordInputSchema,
  type BatchRecord,
  type RecallNote,
} from "./record";
import { BATCH_STATUS_IS, BATCH_STATUSES, NEXT_BATCH_STATUS } from "./status";

const batchName = z
  .string({ error: "Give the batch a name" })
  .trim()
  .min(1, "Give the batch a name")
  .max(80, "Keep the name to a few words");

export type BatchSummary = {
  readonly id: string;
  /** What is printed on the bottle: "B001". */
  readonly code: string;
  readonly name: string;
  readonly status: BatchStatus;
  /** The day it was made. For a planned batch, the day it is planned for. */
  readonly madeOn: string | null;
  readonly bestBefore: string | null;
  /** Days until the best-before date. Negative once it has passed. */
  readonly daysToBestBefore: number | null;
  /** Still within its best-before date today: good through that day. */
  readonly good: boolean;
  /** The plan, until it is made. After that, what was counted. */
  readonly shotsPlanned: number | null;
  /** Shots on hand: the sum of every movement. */
  readonly onHand: number;
  readonly createdAt: Date;
};

function daysLeft(bestBefore: string | null, now: Date): number | null {
  return bestBefore === null ? null : daysBetween(todayKey(now), bestBefore);
}

export const listBatches = defineOp({
  name: "stock.listBatches",
  title: "List batches",
  description:
    "Batches, newest first, each with its state (planned, made, released, closed or recalled), its dates and how many shots are on hand, worked out from its movements. `status` narrows to one state. Use stock.picture for what is ready to sell right now.",
  access: "read",
  input: z.object({
    status: z.enum([...BATCH_STATUSES, "all"]).default("all"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async run(ctx, input): Promise<BatchSummary[]> {
    const rows = await ctx.db
      .select({
        id: batches.id,
        code: batches.code,
        name: batches.name,
        status: batches.status,
        madeOn: batches.madeOn,
        bestBefore: batches.bestBefore,
        shotsPlanned: batches.shotsPlanned,
        onHand: onHandSql,
        createdAt: batches.createdAt,
      })
      .from(batches)
      .where(
        input.status === "all" ? undefined : eq(batches.status, input.status),
      )
      .orderBy(desc(batches.createdAt), desc(batches.id))
      .limit(input.limit);
    return rows.map((row) => ({
      ...row,
      daysToBestBefore: daysLeft(row.bestBefore, ctx.now),
      good: isGoodOn(row.bestBefore, todayKey(ctx.now)),
    }));
  },
});

export type MovementRow = {
  readonly id: string;
  readonly at: Date;
  readonly kind: MovementKind;
  /** Positive in, negative out. */
  readonly shots: number;
  readonly note: string;
  /** The order it went out on or came back from, if there was one. */
  readonly orderNumber: string | null;
  /** Who recorded it. Null when it was the system (the shop, an automation). */
  readonly by: string | null;
};

export type BatchOrderRow = {
  readonly id: string;
  readonly number: string;
  readonly status: OrderStatus;
  readonly name: string;
  readonly city: string;
  readonly placedAt: Date;
  /** Shots the order holds from this batch, after anything put back. */
  readonly shots: number;
};

export type BatchDetail = BatchSummary & {
  /** Everything the batch cost to make, in cents, if known. */
  readonly costCents: number | null;
  readonly notes: string;
  readonly record: BatchRecord;
  /** Why and when it was recalled, if it has been. */
  readonly recall: RecallNote | null;
  /** Shots by kind of movement. Ins are positive, outs negative. */
  readonly totals: Readonly<Record<MovementKind, number>>;
  /** Shots out on orders, after anything put back. */
  readonly sold: number;
  /** Newest first. */
  readonly movements: readonly MovementRow[];
  /** Orders that hold shots from it, newest first. */
  readonly orders: readonly BatchOrderRow[];
  /** How many orders hold shots from it in all (the list above may be cut). */
  readonly orderCount: number;
  /** The states it can move to from here. */
  readonly next: readonly BatchStatus[];
  readonly updatedAt: Date;
};

/**
 * Shots an order holds from a batch: what went out less what came back.
 * For a query that joins movements to orders and groups by the order.
 */
export const heldSql = sql<number>`(-sum(${stockMovements.shots}))::int`;

/** The movements that tie orders to one batch. */
export function ordersHolding(batchId: string): SQL | undefined {
  return and(
    eq(stockMovements.batchId, batchId),
    inArray(stockMovements.kind, ["sold", "returned"]),
  );
}

/** How many orders hold shots from a batch, and how many shots in all. */
export async function countHolders(
  db: DbOrTx,
  batchId: string,
): Promise<{ orders: number; shots: number }> {
  const rows = await db
    .select({ shots: heldSql })
    .from(stockMovements)
    .innerJoin(orders, eq(orders.id, stockMovements.orderId))
    .where(ordersHolding(batchId))
    .groupBy(orders.id)
    .having(sql`sum(${stockMovements.shots}) < 0`);
  return {
    orders: rows.length,
    shots: rows.reduce((sum, row) => sum + row.shots, 0),
  };
}

export const getBatch = defineOp({
  name: "stock.getBatch",
  title: "Open one batch",
  description:
    "Everything about one batch, by its code (B001): its state and what it can move to next, its dates, cost and notes, its production record, shots on hand with the totals behind that number, its movements newest first, and the orders that were filled from it. For the full list of who to contact in a recall, use stock.recallList.",
  access: "read",
  input: z.object({
    code: batchCodeSchema,
    movements: z.number().int().min(1).max(500).default(100),
    orders: z.number().int().min(1).max(500).default(100),
  }),
  async run(ctx, input): Promise<BatchDetail> {
    const batch = await loadBatch(ctx.db, input.code);

    const sums = await ctx.db
      .select({
        kind: stockMovements.kind,
        shots: sql<number>`coalesce(sum(${stockMovements.shots}), 0)::int`,
      })
      .from(stockMovements)
      .where(eq(stockMovements.batchId, batch.id))
      .groupBy(stockMovements.kind);
    const totals: Record<MovementKind, number> = {
      made: 0,
      sold: 0,
      returned: 0,
      sample: 0,
      waste: 0,
      adjust: 0,
    };
    for (const row of sums) totals[row.kind] = row.shots;
    const onHand = Object.values(totals).reduce((sum, n) => sum + n, 0);

    const movements = await ctx.db
      .select({
        id: stockMovements.id,
        at: stockMovements.at,
        kind: stockMovements.kind,
        shots: stockMovements.shots,
        note: stockMovements.note,
        orderNumber: orders.number,
        by: users.name,
      })
      .from(stockMovements)
      .leftJoin(orders, eq(orders.id, stockMovements.orderId))
      .leftJoin(users, eq(users.id, stockMovements.createdBy))
      .where(eq(stockMovements.batchId, batch.id))
      .orderBy(desc(stockMovements.at), desc(stockMovements.id))
      .limit(input.movements);

    const filled = await ctx.db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        firstName: orders.firstName,
        lastName: orders.lastName,
        city: orders.city,
        placedAt: orders.placedAt,
        shots: heldSql,
      })
      .from(stockMovements)
      .innerJoin(orders, eq(orders.id, stockMovements.orderId))
      .where(ordersHolding(batch.id))
      .groupBy(orders.id)
      .having(sql`sum(${stockMovements.shots}) < 0`)
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(input.orders);
    const holders = await countHolders(ctx.db, batch.id);

    return {
      id: batch.id,
      code: batch.code,
      name: batch.name,
      status: batch.status,
      madeOn: batch.madeOn,
      bestBefore: batch.bestBefore,
      daysToBestBefore: daysLeft(batch.bestBefore, ctx.now),
      good: isGoodOn(batch.bestBefore, todayKey(ctx.now)),
      shotsPlanned: batch.shotsPlanned,
      onHand,
      costCents: batch.costCents,
      notes: batch.notes,
      record: readRecord(batch.record),
      recall: readRecall(batch.record),
      totals,
      sold: shotsOut(totals.sold + totals.returned),
      movements,
      orders: filled.map(({ firstName, lastName, ...row }) => ({
        ...row,
        name: `${firstName} ${lastName}`.trim(),
      })),
      orderCount: holders.orders,
      next: NEXT_BATCH_STATUS[batch.status],
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
  },
});

/** The next code in the B001, B002 run, whatever else is on the list. */
async function nextBatchCode(db: DbOrTx): Promise<string> {
  const rows = await db.select({ code: batches.code }).from(batches);
  let highest = 0;
  for (const row of rows) {
    const match = /^B(\d{1,8})$/.exec(row.code);
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  return `B${String(highest + 1).padStart(3, "0")}`;
}

async function codeIsTaken(db: DbOrTx, code: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(eq(batches.code, code));
  return existing !== undefined;
}

function codeTaken(code: string): OpError {
  return new OpError(
    "conflict",
    `There is already a batch ${code}. Every batch needs its own code.`,
    { code: `${code} is already used` },
  );
}

export const suggestBatchCode = defineOp({
  name: "stock.suggestBatchCode",
  title: "Suggest the next batch code",
  description:
    "The next unused code in the run B001, B002, B003. A suggestion only: stock.planBatch takes any code that is not already used.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<{ code: string }> {
    return { code: await nextBatchCode(ctx.db) };
  },
});

export const planBatch = defineOp({
  name: "stock.planBatch",
  title: "Plan a batch",
  description:
    "Puts a new batch on the list as planned: a code (what will be printed on the bottle; the next in the B001 run if none is given), a name, and if known the day it is planned for and how many shots it should make. Nothing goes into stock until stock.recordMade says it was made.",
  access: "write",
  input: z.object({
    code: batchCodeSchema.optional(),
    name: batchName.optional(),
    /** The day it is planned for, as a New Zealand date. */
    plannedFor: dateKeySchema.optional(),
    shotsPlanned: shotsSchema.optional(),
    notes: longTextSchema.optional(),
  }),
  async run(ctx, input): Promise<{ id: string; code: string }> {
    const code = input.code ?? (await nextBatchCode(ctx.db));
    if (await codeIsTaken(ctx.db, code)) throw codeTaken(code);
    const name = input.name ?? `Batch ${code}`;

    const id = newId("bat");
    try {
      await ctx.db.insert(batches).values({
        id,
        code,
        name,
        status: "planned",
        madeOn: input.plannedFor ?? null,
        shotsPlanned: input.shotsPlanned ?? null,
        notes: input.notes ?? "",
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    } catch (error) {
      // Two people planning the same code at the same moment.
      if (isUniqueViolation(error)) throw codeTaken(code);
      throw error;
    }

    const details = [
      input.plannedFor === undefined
        ? null
        : `for ${formatDateKey(input.plannedFor)}`,
      input.shotsPlanned === undefined ? null : shotsText(input.shotsPlanned),
    ].filter((part) => part !== null);
    await ctx.audit({
      entity: { type: "batch", id },
      summary: `Planned batch ${code}${name === `Batch ${code}` ? "" : ` (${name})`}${details.length === 0 ? "" : `: ${details.join(", ")}`}`,
      data: {
        code,
        plannedFor: input.plannedFor ?? null,
        shotsPlanned: input.shotsPlanned ?? null,
      },
    });
    return { id, code };
  },
});

export const updateBatch = defineOp({
  name: "stock.updateBatch",
  title: "Change a batch's details",
  description:
    "Corrects a batch's name, dates, cost, notes or production record. Only what is given changes. The code can be changed until the batch is released; the planned number of shots only while it is still planned (after that the count is corrected with stock.adjustCount). `madeOn` is the planned day while a batch is planned and the day it was made afterwards. The best-before date can be corrected at any time but not cleared once the batch is released. Once a batch is recalled only its notes can be changed. It does not move the batch from one state to another.",
  access: "write",
  input: z.object({
    code: batchCodeSchema,
    newCode: batchCodeSchema.optional(),
    name: batchName.optional(),
    madeOn: dateKeySchema.nullable().optional(),
    bestBefore: dateKeySchema.nullable().optional(),
    shotsPlanned: shotsSchema.nullable().optional(),
    costCents: centsSchema.nullable().optional(),
    notes: longTextSchema.optional(),
    record: recordInputSchema.optional(),
  }),
  async run(ctx, input): Promise<{ id: string; code: string }> {
    const batch = await loadBatch(ctx.db, input.code, { lock: true });
    const planned = batch.status === "planned";
    const changed: string[] = [];
    const day = (key: string | null) =>
      key === null ? "no date" : formatDateKey(key);

    const code = input.newCode ?? batch.code;
    if (code !== batch.code) {
      if (!planned && batch.status !== "made") {
        throw conflict(
          `${batch.code} is ${BATCH_STATUS_IS[batch.status]}, and its code is on orders by now, so the code cannot be changed.`,
        );
      }
      if (await codeIsTaken(ctx.db, code)) throw codeTaken(code);
      changed.push(`code ${batch.code} to ${code}`);
    }

    const name = input.name ?? batch.name;
    if (name !== batch.name) changed.push("name");

    const madeOn = input.madeOn === undefined ? batch.madeOn : input.madeOn;
    if (madeOn !== batch.madeOn) {
      if (!planned && madeOn === null) {
        throw new OpError(
          "invalid_input",
          `${batch.code} has been made, so it needs the day it was made.`,
          { madeOn: "Give the day it was made" },
        );
      }
      if (!planned && madeOn !== null && madeOn > todayKey(ctx.now)) {
        throw new OpError(
          "invalid_input",
          "The day it was made cannot be a day that has not happened yet.",
          { madeOn: "That day has not happened yet" },
        );
      }
      changed.push(
        `${planned ? "planned for" : "made on"} ${day(batch.madeOn)} to ${day(madeOn)}`,
      );
    }

    const bestBefore =
      input.bestBefore === undefined ? batch.bestBefore : input.bestBefore;
    if (bestBefore !== batch.bestBefore) {
      // What is on sale is sold oldest first, by this date. It can be
      // corrected, never taken away.
      if (bestBefore === null && batch.status === "released") {
        throw new OpError(
          "conflict",
          `${batch.code} is released, so it has to keep a best-before date.`,
          { bestBefore: "A released batch needs one" },
        );
      }
      changed.push(
        `best before ${day(batch.bestBefore)} to ${day(bestBefore)}`,
      );
    }
    if (
      (madeOn !== batch.madeOn || bestBefore !== batch.bestBefore) &&
      madeOn !== null &&
      bestBefore !== null &&
      bestBefore < madeOn
    ) {
      throw new OpError(
        "invalid_input",
        "The best-before date is earlier than the day it is made.",
        { bestBefore: "Earlier than the day it is made" },
      );
    }

    const shotsPlanned =
      input.shotsPlanned === undefined
        ? batch.shotsPlanned
        : input.shotsPlanned;
    if (shotsPlanned !== batch.shotsPlanned) {
      if (!planned) {
        throw conflict(
          `${batch.code} has been made, so its count is changed with a correction after a count, not here.`,
        );
      }
      changed.push(
        `planned shots ${batch.shotsPlanned === null ? "not set" : countText(batch.shotsPlanned)} to ${shotsPlanned === null ? "not set" : countText(shotsPlanned)}`,
      );
    }

    const costCents =
      input.costCents === undefined ? batch.costCents : input.costCents;
    if (costCents !== batch.costCents) {
      const money = (cents: number | null) =>
        cents === null ? "not known" : formatNzd(cents);
      changed.push(`cost ${money(batch.costCents)} to ${money(costCents)}`);
    }

    const record =
      input.record === undefined
        ? batch.record
        : mergeRecord(batch.record, input.record);
    const recordParts = recordChanges(batch.record, record);
    if (recordParts.length > 0) {
      changed.push(`the record (${recordParts.join(", ")})`);
    }

    const notes = input.notes ?? batch.notes;
    const notesChanged = notes !== batch.notes;

    if (changed.length === 0 && !notesChanged) {
      return { id: batch.id, code: batch.code };
    }
    if (batch.status === "recalled" && changed.length > 0) {
      throw conflict(
        `${batch.code} has been recalled, so only its notes can be changed.`,
      );
    }
    if (notesChanged) changed.push("notes");

    try {
      await ctx.db
        .update(batches)
        .set({
          code,
          name,
          madeOn,
          bestBefore,
          shotsPlanned,
          costCents,
          notes,
          record,
          updatedAt: ctx.now,
        })
        .where(eq(batches.id, batch.id));
    } catch (error) {
      if (isUniqueViolation(error)) throw codeTaken(code);
      throw error;
    }
    await ctx.audit({
      entity: { type: "batch", id: batch.id },
      summary: `Changed ${batch.code}: ${changed.join(", ")}`,
      data: {
        before: {
          code: batch.code,
          name: batch.name,
          madeOn: batch.madeOn,
          bestBefore: batch.bestBefore,
          shotsPlanned: batch.shotsPlanned,
          costCents: batch.costCents,
        },
        after: { code, name, madeOn, bestBefore, shotsPlanned, costCents },
      },
    });
    return { id: batch.id, code };
  },
});
