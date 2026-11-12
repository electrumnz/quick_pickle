/**
 * Movements recorded by hand: a sample given away, shots written off, and a
 * correction after a count.
 *
 * Each takes a batch by its code, locks it, refuses to take it below zero
 * and says how many there are, and leaves a line in the activity log. A
 * correction needs a reason, because it is the one movement with no story of
 * its own.
 *
 * Nothing here overwrites a number. A count is turned into the difference
 * and that difference is written as a movement, so a sale that lands while
 * someone is counting is not undone. Every movement is dated the moment it
 * is recorded: if the thing happened on another day, that goes in the note.
 */

import { z } from "zod";

import { conflict, OpError } from "../core/errors";
import { defineOp, type OpContext } from "../core/op";
import { isGoodOn, todayKey } from "./dates";
import {
  batchCodeSchema,
  lowStockAtSchema,
  noteSchema,
  reasonSchema,
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
import { HAND_MOVEMENTS } from "./status";

type HandKind = "sample" | "waste" | "adjust";

function refuseHand(batch: BatchRow, kind: HandKind): never {
  if (batch.status === "planned") {
    throw conflict(
      `${batch.code} has not been made yet, so there is nothing to record against it.`,
    );
  }
  throw conflict(
    kind === "sample"
      ? `${batch.code} has been recalled, so nothing more can be given away from it.`
      : `Nothing more can be recorded against ${batch.code}.`,
  );
}

function refuseBelowZero(
  batch: BatchRow,
  onHand: number,
  taking: number,
): never {
  throw new OpError(
    "conflict",
    `${batch.code} has ${shotsText(onHand)} on hand, so ${taking.toLocaleString("en-NZ")} cannot be taken from it.`,
    { shots: `Only ${onHand.toLocaleString("en-NZ")} on hand` },
  );
}

/**
 * Shots ready to sell before a change to this batch, or null if the batch
 * does not count towards them (not released, or past its best-before date)
 * and so cannot be what makes stock run low.
 */
async function readyBefore(
  ctx: OpContext,
  batch: BatchRow,
): Promise<number | null> {
  const today = todayKey(ctx.now);
  return batch.status === "released" && isGoodOn(batch.bestBefore, today)
    ? readyShots(ctx.db, today)
    : null;
}

export type HandMovementResult = {
  readonly code: string;
  /** Shots on hand in the batch once this is done. */
  readonly onHand: number;
};

export const recordSample = defineOp({
  name: "stock.recordSample",
  title: "Record samples given away",
  description:
    "Takes shots out of a batch because they were given away: a tasting, a market, a gift. Give the batch code, how many, and a note saying who or what they were for (the note is all there is to go on if that batch is ever recalled, since a sample has no order behind it). It is dated now: if they were given away on another day, say so in the note. Refused if the batch does not have that many on hand, if it has not been made yet, or if it has been recalled.",
  access: "write",
  input: z.object({
    code: batchCodeSchema,
    shots: shotsSchema,
    note: noteSchema.optional(),
    lowStockAt: lowStockAtSchema,
  }),
  async run(ctx, input): Promise<HandMovementResult> {
    const batch = await loadBatch(ctx.db, input.code, { lock: true });
    if (!HAND_MOVEMENTS[batch.status].includes("sample")) {
      refuseHand(batch, "sample");
    }
    const onHand = await batchOnHand(ctx.db, batch.id);
    if (input.shots > onHand) refuseBelowZero(batch, onHand, input.shots);
    const ready = await readyBefore(ctx, batch);

    await writeMovement(ctx.db, {
      batchId: batch.id,
      kind: "sample",
      shots: -input.shots,
      note: input.note ?? "",
      now: ctx.now,
      actor: ctx.actor,
    });
    await ctx.audit({
      entity: { type: "batch", id: batch.id },
      summary: `Gave away ${shotsText(input.shots)} from ${batch.code}${input.note ? `: ${input.note}` : ""}`,
      data: { shots: input.shots, onHand: onHand - input.shots },
    });
    if (ready !== null) {
      await flagIfLow(ctx, {
        before: ready,
        after: ready - input.shots,
        threshold: input.lowStockAt,
        because: "sample",
        code: batch.code,
      });
    }
    return { code: batch.code, onHand: onHand - input.shots };
  },
});

const WASTE_WORDS = {
  damaged: "damaged",
  expired: "past its date",
  other: "other",
} as const;

export const recordWaste = defineOp({
  name: "stock.recordWaste",
  title: "Write off wasted shots",
  description:
    "Takes shots out of a batch because they can no longer be sold: `damaged` (dropped, leaking, a bad cap), `expired` (past its date) or `other`, with a note saying what happened (the note is required for `other`). Use it too for what is destroyed from a recalled batch. It is dated now: if it happened on another day, say so in the note. Refused if the batch does not have that many on hand or has not been made yet.",
  access: "write",
  input: z
    .object({
      code: batchCodeSchema,
      shots: shotsSchema,
      why: z.enum(["damaged", "expired", "other"], {
        error: "Say whether they were damaged, expired or something else",
      }),
      note: noteSchema.optional(),
      lowStockAt: lowStockAtSchema,
    })
    .refine((value) => value.why !== "other" || (value.note ?? "") !== "", {
      message: "Say what happened to them",
      path: ["note"],
    }),
  async run(ctx, input): Promise<HandMovementResult> {
    const batch = await loadBatch(ctx.db, input.code, { lock: true });
    if (!HAND_MOVEMENTS[batch.status].includes("waste")) {
      refuseHand(batch, "waste");
    }
    const onHand = await batchOnHand(ctx.db, batch.id);
    if (input.shots > onHand) refuseBelowZero(batch, onHand, input.shots);
    const ready = await readyBefore(ctx, batch);

    const words =
      input.why === "other"
        ? (input.note ?? "")
        : `${WASTE_WORDS[input.why]}${input.note ? `: ${input.note}` : ""}`;
    await writeMovement(ctx.db, {
      batchId: batch.id,
      kind: "waste",
      shots: -input.shots,
      note: words.charAt(0).toUpperCase() + words.slice(1),
      now: ctx.now,
      actor: ctx.actor,
    });
    await ctx.audit({
      entity: { type: "batch", id: batch.id },
      summary: `Wrote off ${shotsText(input.shots)} from ${batch.code}: ${words}`,
      data: {
        shots: input.shots,
        why: input.why,
        onHand: onHand - input.shots,
      },
    });
    if (ready !== null) {
      await flagIfLow(ctx, {
        before: ready,
        after: ready - input.shots,
        threshold: input.lowStockAt,
        because: "waste",
        code: batch.code,
      });
    }
    return { code: batch.code, onHand: onHand - input.shots };
  },
});

export const adjustCount = defineOp({
  name: "stock.adjustCount",
  title: "Correct a batch's count",
  description:
    "Puts a batch's shots on hand right after a count, either way, with the reason (required). It never overwrites the number: it works out a difference and records that as a movement. Give `counted`, the number actually there, and with it `expected`, the number the screen showed when the count was made: the difference between the two is applied, so a sale that landed while counting is not undone. Without `expected` the count is compared with what is on hand at this moment. Or give `change`, the difference itself (minus for fewer). Use it when the shelf and the screen disagree and nobody knows why; if the shots were given away or thrown out, record that with stock.recordSample or stock.recordWaste instead. Refused if it would take the batch below zero.",
  access: "write",
  input: z
    .object({
      code: batchCodeSchema,
      /** How many are actually there. */
      counted: z
        .number({ error: "Say how many you counted, as a whole number" })
        .int("Shots are counted in whole numbers")
        .min(0, "A count cannot be less than nothing")
        .max(1_000_000, "That is more shots than one batch holds")
        .optional(),
      /** What the screen said was on hand when the count was made. */
      expected: z
        .number({ error: "Give the number the screen showed" })
        .int("Shots are counted in whole numbers")
        .min(0)
        .max(1_000_000)
        .optional(),
      /** The difference: minus for fewer, plus for more. */
      change: z
        .number({ error: "Give the difference as a whole number" })
        .int("Shots are counted in whole numbers")
        .min(-1_000_000)
        .max(1_000_000)
        .optional(),
      reason: reasonSchema,
      lowStockAt: lowStockAtSchema,
    })
    .refine(
      (value) => (value.counted === undefined) !== (value.change === undefined),
      {
        message: "Give the number counted, or the difference",
        path: ["counted"],
      },
    )
    .refine(
      (value) => value.expected === undefined || value.counted !== undefined,
      {
        message: "The number the screen showed only goes with a count",
        path: ["expected"],
      },
    ),
  async run(
    ctx,
    input,
  ): Promise<HandMovementResult & { readonly change: number }> {
    const batch = await loadBatch(ctx.db, input.code, { lock: true });
    if (!HAND_MOVEMENTS[batch.status].includes("adjust")) {
      refuseHand(batch, "adjust");
    }
    const onHand = await batchOnHand(ctx.db, batch.id);
    // The difference as the person counting saw it: what they counted
    // against what the screen told them then. Anything that has moved since
    // stays moved.
    const change =
      input.counted !== undefined
        ? input.counted - (input.expected ?? onHand)
        : (input.change ?? 0);
    if (change === 0) return { code: batch.code, onHand, change: 0 };
    if (onHand + change < 0) refuseBelowZero(batch, onHand, -change);
    const ready = await readyBefore(ctx, batch);

    await writeMovement(ctx.db, {
      batchId: batch.id,
      kind: "adjust",
      shots: change,
      note: input.reason,
      now: ctx.now,
      actor: ctx.actor,
    });
    await ctx.audit({
      entity: { type: "batch", id: batch.id },
      summary: `Corrected the count of ${batch.code} from ${onHand.toLocaleString("en-NZ")} to ${(onHand + change).toLocaleString("en-NZ")}: ${input.reason}`,
      data: { before: onHand, after: onHand + change, change },
    });
    if (ready !== null) {
      await flagIfLow(ctx, {
        before: ready,
        after: ready + change,
        threshold: input.lowStockAt,
        because: "adjust",
        code: batch.code,
      });
    }
    return { code: batch.code, onHand: onHand + change, change };
  },
});
