/**
 * A batch's life: made, released, closed, recalled.
 *
 * Each operation here moves a batch from one state to the next. The moves
 * that are allowed are written down once, in status.ts; anything else is
 * refused with a sentence a person can read. Only "made" puts shots into
 * stock. Releasing changes no count, closing can write off what is left,
 * and a recall cannot be undone.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { batches, type BatchStatus } from "@/db/schema";

import { conflict, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { countHolders } from "./batches";
import { dateKeySchema, formatDateKey, isGoodOn, todayKey } from "./dates";
import {
  batchCodeSchema,
  centsSchema,
  lowStockAtSchema,
  shotsSchema,
} from "./inputs";
import {
  batchOnHand,
  flagIfLow,
  loadBatch,
  readyShots,
  shotsText,
  writeMovement,
  type BatchRow,
} from "./movements";
import { mergeRecord, recordInputSchema } from "./record";
import { BATCH_STATUS_IS, canMoveBatch } from "./status";

const TO_VERB: Readonly<Record<BatchStatus, string>> = {
  planned: "planned again",
  made: "recorded as made",
  released: "released",
  closed: "closed",
  recalled: "recalled",
};

function refuseMove(batch: BatchRow, to: BatchStatus): never {
  throw conflict(
    `${batch.code} is ${BATCH_STATUS_IS[batch.status]}, so it cannot be ${TO_VERB[to]}.`,
  );
}

export const recordMade = defineOp({
  name: "stock.recordMade",
  title: "Record that a batch was made",
  description:
    "Says a planned batch has been made, and counts its shots into stock. Give how many shots were counted, and if known the day it was made (today if left out), its best-before date, what it cost and the production record (who made it, where, the checks taken, the lot numbers of what went in, anything else). The batch is then made but not yet for sale: stock.releaseBatch clears it. Recording the same batch a second time changes nothing; correct the count with stock.adjustCount and the dates or record with stock.updateBatch. It checks nothing about what is written on the record.",
  access: "write",
  input: z.object({
    code: batchCodeSchema,
    shots: shotsSchema,
    /** New Zealand date. Today if left out. */
    madeOn: dateKeySchema.optional(),
    bestBefore: dateKeySchema.optional(),
    costCents: centsSchema.optional(),
    record: recordInputSchema.optional(),
  }),
  async run(
    ctx,
    input,
  ): Promise<{ code: string; status: BatchStatus; onHand: number }> {
    const batch = await loadBatch(ctx.db, input.code, { lock: true });
    if (batch.status === "made") {
      ctx.nothingChanged();
      return {
        code: batch.code,
        status: "made",
        onHand: await batchOnHand(ctx.db, batch.id),
      };
    }
    if (!canMoveBatch(batch.status, "made")) refuseMove(batch, "made");

    const today = todayKey(ctx.now);
    const madeOn = input.madeOn ?? today;
    if (madeOn > today) {
      throw new OpError(
        "invalid_input",
        "The day it was made cannot be a day that has not happened yet.",
        { madeOn: "That day has not happened yet" },
      );
    }
    const bestBefore = input.bestBefore ?? batch.bestBefore;
    if (bestBefore !== null && bestBefore < madeOn) {
      throw new OpError(
        "invalid_input",
        "The best-before date is earlier than the day it was made.",
        { bestBefore: "Earlier than the day it was made" },
      );
    }

    await ctx.db
      .update(batches)
      .set({
        status: "made",
        madeOn,
        bestBefore,
        shotsPlanned: input.shots,
        costCents: input.costCents ?? batch.costCents,
        record:
          input.record === undefined
            ? batch.record
            : mergeRecord(batch.record, input.record),
        updatedAt: ctx.now,
      })
      .where(eq(batches.id, batch.id));
    await writeMovement(ctx.db, {
      batchId: batch.id,
      kind: "made",
      shots: input.shots,
      note: "Counted when the batch was made",
      now: ctx.now,
      actor: ctx.actor,
    });

    const entity = { type: "batch", id: batch.id };
    await ctx.audit({
      entity,
      summary: `Made ${batch.code}: ${shotsText(input.shots)}${bestBefore === null ? "" : `, best before ${formatDateKey(bestBefore)}`}`,
      data: {
        shots: input.shots,
        planned: batch.shotsPlanned,
        madeOn,
        bestBefore,
        costCents: input.costCents ?? batch.costCents,
      },
    });
    await ctx.emit({
      type: "batch.made",
      entity,
      payload: { code: batch.code, shots: input.shots, madeOn, bestBefore },
    });
    return { code: batch.code, status: "made", onHand: input.shots };
  },
});

export const releaseBatch = defineOp({
  name: "stock.releaseBatch",
  title: "Release a batch for sale",
  description:
    "Clears a batch that has been made, so orders can be filled from it. Only for a batch that is made and not yet released, and only once it has a best-before date that has not passed: a batch with no date, or past its date, is refused (set the date with stock.updateBatch). From then on its shots count as ready to sell until the end of its best-before day. It writes no movement: the count does not change. A released batch cannot be un-released; if it must stop being sold, close it or recall it.",
  access: "write",
  // Putting food on sale. Whoever says yes should have the batch record in
  // front of them.
  effect: "outward",
  input: z.object({ code: batchCodeSchema }),
  explain: (input) =>
    `This puts batch ${input.code} on sale: orders are filled from it from now until the end of its best-before day. Look at its best-before date and its count on the batch's own page before saying yes.`,
  async run(
    ctx,
    input,
  ): Promise<{ code: string; status: BatchStatus; onHand: number }> {
    const batch = await loadBatch(ctx.db, input.code, { lock: true });
    const onHand = await batchOnHand(ctx.db, batch.id);
    if (batch.status === "released") {
      ctx.nothingChanged();
      return { code: batch.code, status: "released", onHand };
    }
    if (!canMoveBatch(batch.status, "released")) refuseMove(batch, "released");
    // Which stock goes out first is decided by this date, so it is asked for
    // here rather than guessed at later.
    if (batch.bestBefore === null) {
      throw new OpError(
        "conflict",
        `${batch.code} has no best-before date. Add one, then release it.`,
        { bestBefore: "Needed before the batch can be released" },
      );
    }
    if (!isGoodOn(batch.bestBefore, todayKey(ctx.now))) {
      throw conflict(
        `${batch.code} passed its best-before date on ${formatDateKey(batch.bestBefore)}, so it cannot be released for sale.`,
      );
    }

    await ctx.db
      .update(batches)
      .set({ status: "released", updatedAt: ctx.now })
      .where(eq(batches.id, batch.id));
    const entity = { type: "batch", id: batch.id };
    await ctx.audit({
      entity,
      summary: `Released ${batch.code} for sale with ${shotsText(onHand)} on hand`,
      data: { onHand, bestBefore: batch.bestBefore },
    });
    await ctx.emit({
      type: "batch.released",
      entity,
      payload: { code: batch.code, onHand, bestBefore: batch.bestBefore },
    });
    return { code: batch.code, status: "released", onHand };
  },
});

export const closeBatch = defineOp({
  name: "stock.closeBatch",
  title: "Close a batch",
  description:
    "Finishes a released batch: nothing more is sold from it. If it still has shots on hand it is refused, with the number, unless `writeOff` is true, in which case what is left is written off as waste in the same step. A closed batch cannot be reopened, though it can still be recalled.",
  access: "write",
  input: z.object({
    code: batchCodeSchema,
    /** Write off whatever is still on hand as waste. */
    writeOff: z.boolean().default(false),
    lowStockAt: lowStockAtSchema,
  }),
  async run(
    ctx,
    input,
  ): Promise<{ code: string; status: BatchStatus; writtenOff: number }> {
    const batch = await loadBatch(ctx.db, input.code, { lock: true });
    if (batch.status === "closed") {
      ctx.nothingChanged();
      return { code: batch.code, status: "closed", writtenOff: 0 };
    }
    if (!canMoveBatch(batch.status, "closed")) refuseMove(batch, "closed");

    const onHand = await batchOnHand(ctx.db, batch.id);
    if (onHand > 0 && !input.writeOff) {
      throw conflict(
        `${batch.code} still has ${shotsText(onHand)} on hand. Say what happened to them first, or close it and write them off as waste.`,
      );
    }
    const today = todayKey(ctx.now);
    const ready = await readyShots(ctx.db, today);
    // What this batch was adding to "ready to sell" until now.
    const leaving = isGoodOn(batch.bestBefore, today) ? onHand : 0;

    if (onHand > 0) {
      await writeMovement(ctx.db, {
        batchId: batch.id,
        kind: "waste",
        shots: -onHand,
        note: "Written off when the batch was closed",
        now: ctx.now,
        actor: ctx.actor,
      });
    }
    await ctx.db
      .update(batches)
      .set({ status: "closed", updatedAt: ctx.now })
      .where(eq(batches.id, batch.id));

    const entity = { type: "batch", id: batch.id };
    await ctx.audit({
      entity,
      summary:
        onHand > 0
          ? `Closed ${batch.code} and wrote off the last ${shotsText(onHand)}`
          : `Closed ${batch.code}`,
      data: { writtenOff: onHand },
    });
    await ctx.emit({
      type: "batch.closed",
      entity,
      payload: { code: batch.code, writtenOff: onHand },
    });
    await flagIfLow(ctx, {
      before: ready,
      after: ready - leaving,
      threshold: input.lowStockAt,
      because: "closed",
      code: batch.code,
    });
    return { code: batch.code, status: "closed", writtenOff: onHand };
  },
});

export const recallBatch = defineOp({
  name: "stock.recallBatch",
  title: "Recall a batch",
  description:
    "Pulls a batch back, with the reason. From that moment no order is filled from it, and it can never be released or sold from again: nothing undoes a recall. Works on a batch that is made, released or closed. It does not contact customers, change any order or tell anyone outside the business: use stock.recallList for who has shots from it. Shots still on hand stay on its count until they are written off with stock.recordWaste.",
  access: "write",
  effect: "destructive",
  input: z.object({
    code: batchCodeSchema,
    reason: z
      .string({ error: "Say why it is being recalled" })
      .trim()
      .min(3, "Say why it is being recalled")
      .max(500, "Keep the reason to a few lines"),
    lowStockAt: lowStockAtSchema,
  }),
  explain: (input) =>
    `This recalls batch ${input.code}. No more orders will be filled from it and it can never be released again. It does not contact customers or anyone else: the recall list says who has shots from it.`,
  async run(
    ctx,
    input,
  ): Promise<{
    code: string;
    status: BatchStatus;
    orders: number;
    shots: number;
    onHand: number;
  }> {
    const batch = await loadBatch(ctx.db, input.code, { lock: true });
    const onHand = await batchOnHand(ctx.db, batch.id);
    const holders = await countHolders(ctx.db, batch.id);
    if (batch.status === "recalled") {
      ctx.nothingChanged();
      return { code: batch.code, status: "recalled", ...holders, onHand };
    }
    if (!canMoveBatch(batch.status, "recalled")) refuseMove(batch, "recalled");

    // Was it adding to "ready to sell" until now?
    const today = todayKey(ctx.now);
    const wasReleased =
      batch.status === "released" && isGoodOn(batch.bestBefore, today);
    const ready = wasReleased ? await readyShots(ctx.db, today) : 0;
    await ctx.db
      .update(batches)
      .set({
        status: "recalled",
        record: {
          ...batch.record,
          recall: { reason: input.reason, on: todayKey(ctx.now) },
        },
        updatedAt: ctx.now,
      })
      .where(eq(batches.id, batch.id));

    const entity = { type: "batch", id: batch.id };
    await ctx.audit({
      entity,
      summary: `Recalled ${batch.code}: ${input.reason}`,
      data: {
        reason: input.reason,
        was: batch.status,
        orders: holders.orders,
        shots: holders.shots,
        onHand,
      },
    });
    await ctx.emit({
      type: "batch.recalled",
      entity,
      payload: {
        code: batch.code,
        reason: input.reason,
        orders: holders.orders,
        shots: holders.shots,
        onHand,
      },
    });
    if (wasReleased) {
      await flagIfLow(ctx, {
        before: ready,
        after: ready - onHand,
        threshold: input.lowStockAt,
        because: "recalled",
        code: batch.code,
      });
    }
    return { code: batch.code, status: "recalled", ...holders, onHand };
  },
});
