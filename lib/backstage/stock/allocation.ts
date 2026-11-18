/**
 * Filling orders from batches.
 *
 * When an order is packed its shots have to come from somewhere, and which
 * batch they came from is what a recall turns on. So the batch on record is
 * the one the person packing says is in the box. This file works out what to
 * suggest (first expired, first out), writes the `sold` movements for what
 * was actually packed, and deals with the shots when an order is unpacked or
 * cancelled.
 *
 * Four things it holds to:
 *
 *   One pool a flavour. An order's packs of a flavour all draw on the same
 *   shots, so every check uses the order's total of that flavour across its
 *   lines, never one line at a time. A box of six, a dozen and a box of
 *   twenty-four, all Original, are 42 Original shots, and that is all stock
 *   ever knows about them. A flavour's shots only ever come from a batch of
 *   that flavour (./flavours.ts).
 *
 *   Confirmed at packing. Nothing is taken, and no batch is written down,
 *   when an order is placed or paid for. The shots leave stock when the
 *   order is marked packed, from the batch named then. Where there is more
 *   than one batch it could be, nothing here picks for the packer.
 *
 *   No read-then-write. On hand is the sum of movements. Before anything is
 *   taken, the batch rows are locked inside the caller's transaction, always
 *   in the same order, and only then counted. Two orders packed at the same
 *   moment take turns and the second sees what the first took.
 *
 *   Food, not a general shop. Only a batch that is released and still good
 *   today is sold from. Nothing goes back on the shelf by default.
 *
 * It is written to run inside another operation's transaction. The orders
 * area reaches it through takeOrderStock and putBackOrderStock (in
 * order-moves.ts), so an order's stage and its stock change together or not
 * at all.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import {
  batches,
  orderLines,
  stockMovements,
  type BatchStatus,
} from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

import type { Actor } from "../core/actor";
import { conflict, notFound, OpError } from "../core/errors";
import { formatDateKey, isGoodOn, todayKey } from "./dates";
import {
  byFlavour,
  flavourName,
  flavourShots,
  namesFlavours,
} from "./flavours";
import { countText, shotsText, writeMovement } from "./movements";
import { BATCH_STATUS_IS } from "./status";

/** A released batch with what is on hand in it. */
export type ShelfBatch = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** The flavour in its bottles. */
  readonly flavour: string;
  readonly bestBefore: string | null;
  readonly madeOn: string | null;
  readonly createdAt: Date;
  readonly onHand: number;
  /** Still good today: its best-before day has not passed (isGoodOn). */
  readonly good: boolean;
};

function byFirstExpired(a: ShelfBatch, b: ShelfBatch): number {
  // A released batch always has a best-before date (it cannot be released
  // without one). The fallback only keeps the order steady if one ever
  // turns up without.
  const dated = (key: string | null) => key ?? "9999-12-31";
  return (
    dated(a.bestBefore).localeCompare(dated(b.bestBefore)) ||
    dated(a.madeOn).localeCompare(dated(b.madeOn)) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.code.localeCompare(b.code)
  );
}

/**
 * Every released batch, earliest best-before date first, with its shots on
 * hand and whether it is still good on `today` (a New Zealand date). With
 * `lock`, their rows are held until the transaction ends, so two orders
 * packed at the same moment cannot both take the last shots.
 */
export async function releasedShelf(
  db: DbOrTx,
  options: { readonly today: string; readonly lock?: boolean },
): Promise<ShelfBatch[]> {
  const query = db
    .select({
      id: batches.id,
      code: batches.code,
      name: batches.name,
      flavour: batches.flavour,
      bestBefore: batches.bestBefore,
      madeOn: batches.madeOn,
      createdAt: batches.createdAt,
    })
    .from(batches)
    .where(eq(batches.status, "released"))
    // Always in the same order, so two transactions cannot wait on each other.
    .orderBy(batches.id);
  const rows = await (options.lock === true ? query.for("update") : query);
  if (rows.length === 0) return [];

  const counts = await db
    .select({
      batchId: stockMovements.batchId,
      shots: sql<number>`coalesce(sum(${stockMovements.shots}), 0)::int`,
    })
    .from(stockMovements)
    .where(
      inArray(
        stockMovements.batchId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(stockMovements.batchId);
  const onHand = new Map(counts.map((row) => [row.batchId, row.shots]));

  return rows
    .map((row) => ({
      ...row,
      onHand: onHand.get(row.id) ?? 0,
      good: isGoodOn(row.bestBefore, options.today),
    }))
    .sort(byFirstExpired);
}

/** The batches an order can be filled from: good, with shots on hand. */
export function sellable(shelf: readonly ShelfBatch[]): ShelfBatch[] {
  return shelf.filter((batch) => batch.good && batch.onHand > 0);
}

/** Shots taken from one batch. */
export type Take = {
  readonly batchId: string;
  readonly code: string;
  readonly shots: number;
};

export type TakePlan =
  | { readonly ok: true; readonly takes: readonly Take[] }
  /** No released batch has a single shot on hand. */
  | { readonly ok: false; readonly reason: "nothing-released" }
  /** Released batches have shots, but every one is past its date. */
  | {
      readonly ok: false;
      readonly reason: "past-date";
      readonly onHand: number;
    }
  /** There is good stock, but not enough of it. */
  | { readonly ok: false; readonly reason: "short"; readonly onHand: number };

/**
 * Work out which batches an order's shots should come from when nobody has
 * said: the suggestion put in front of the person packing.
 *
 * First expired, first out: the batch with the earliest best-before date
 * that can cover the whole order by itself. A box comes from one batch
 * whenever one batch can fill it. Only when no single batch can does it
 * split, taking from the earliest first until the order is covered. Batches
 * past their date are never suggested.
 *
 * `shelf` must already be in first-expired order (see releasedShelf).
 */
export function planTakes(
  shelf: readonly ShelfBatch[],
  need: number,
): TakePlan {
  const stocked = sellable(shelf);
  if (stocked.length === 0) {
    const pastDate = shelf
      .filter((batch) => !batch.good && batch.onHand > 0)
      .reduce((sum, batch) => sum + batch.onHand, 0);
    return pastDate > 0
      ? { ok: false, reason: "past-date", onHand: pastDate }
      : { ok: false, reason: "nothing-released" };
  }

  const whole = stocked.find((batch) => batch.onHand >= need);
  if (whole !== undefined) {
    return {
      ok: true,
      takes: [{ batchId: whole.id, code: whole.code, shots: need }],
    };
  }

  const onHand = stocked.reduce((sum, batch) => sum + batch.onHand, 0);
  if (onHand < need) return { ok: false, reason: "short", onHand };

  const takes: Take[] = [];
  let left = need;
  for (const batch of stocked) {
    if (left === 0) break;
    const shots = Math.min(left, batch.onHand);
    takes.push({ batchId: batch.id, code: batch.code, shots });
    left -= shots;
  }
  return { ok: true, takes };
}

/**
 * "24 shots from B002", "30 shots from B001 and 18 from B002". With `to`,
 * the same for shots going back: "24 shots to B002".
 */
export function takesText(
  takes: readonly Take[],
  direction: "from" | "to" = "from",
): string {
  const [first, ...rest] = takes;
  if (first === undefined) return "";
  const parts = [
    `${shotsText(first.shots)} ${direction} ${first.code}`,
    ...rest.map(
      (take) =>
        `${take.shots.toLocaleString("en-NZ")} ${direction} ${take.code}`,
    ),
  ];
  const last = parts.pop() ?? "";
  return parts.length === 0 ? last : `${parts.join(", ")} and ${last}`;
}

/**
 * How many shots of each flavour an order holds: for every line of that
 * flavour, packs times the shots in a pack, added up. A flavour at a time,
 * never a line at a time. Flavours in the catalogue's order.
 */
export async function orderShotsByFlavour(
  db: DbOrTx,
  orderId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      flavour: orderLines.flavour,
      shots: sql<number>`coalesce(sum(${orderLines.qty} * ${orderLines.shots}), 0)::int`,
    })
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId))
    .groupBy(orderLines.flavour);
  return new Map(
    rows
      .filter((row) => row.shots > 0)
      .sort((a, b) => byFlavour(a.flavour, b.flavour))
      .map((row) => [row.flavour, row.shots]),
  );
}

/**
 * How many shots an order holds in all: for every line, packs times the
 * shots in a pack, added up. The whole order, never a line at a time.
 */
export async function orderShots(db: DbOrTx, orderId: string): Promise<number> {
  // The same sum the order's own page and packing slip show: each line keeps
  // the number of shots in its pack as it was on the day it was bought.
  const [row] = await db
    .select({
      shots: sql<number>`coalesce(sum(${orderLines.qty} * ${orderLines.shots}), 0)::int`,
    })
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId));
  return row?.shots ?? 0;
}

/** Shots an order holds from one batch, after anything put back. */
export type OrderHolding = {
  readonly batchId: string;
  readonly code: string;
  readonly name: string;
  readonly flavour: string;
  readonly status: BatchStatus;
  readonly shots: number;
};

/** Which batches an order's shots came from, net of anything put back. */
export async function orderHoldings(
  db: DbOrTx,
  orderId: string,
): Promise<OrderHolding[]> {
  const rows = await db
    .select({
      batchId: stockMovements.batchId,
      code: batches.code,
      name: batches.name,
      flavour: batches.flavour,
      status: batches.status,
      shots: sql<number>`(-sum(${stockMovements.shots}))::int`,
    })
    .from(stockMovements)
    .innerJoin(batches, eq(batches.id, stockMovements.batchId))
    .where(
      and(
        eq(stockMovements.orderId, orderId),
        inArray(stockMovements.kind, ["sold", "returned"]),
      ),
    )
    .groupBy(
      stockMovements.batchId,
      batches.code,
      batches.name,
      batches.flavour,
      batches.status,
    )
    .orderBy(batches.code);
  return rows.filter((row) => row.shots > 0);
}

export type Allocation = {
  /** What this call took out of stock, batch by batch. Empty if nothing. */
  readonly takes: readonly Take[];
  /**
   * Why nothing was taken, when nothing was:
   *   nothing-released  no released batch of the order's flavours has any
   *                     stock, so there is nothing to record against. Not
   *                     an error.
   *   already-recorded  the order already holds all its shots.
   */
  readonly skipped: "nothing-released" | "already-recorded" | null;
  /**
   * Shots ready to sell (released and good) of each flavour this call took
   * from, before and after.
   */
  readonly ready: readonly {
    readonly flavour: string;
    readonly before: number;
    readonly after: number;
  }[];
};

/** Say why a named batch cannot have orders filled from it. */
async function refuseBatch(tx: DbOrTx, batchId: string): Promise<never> {
  const [batch] = await tx
    .select({
      code: batches.code,
      status: batches.status,
      bestBefore: batches.bestBefore,
    })
    .from(batches)
    .where(eq(batches.id, batchId));
  if (batch === undefined) throw notFound("That batch");
  if (batch.status !== "released") {
    throw conflict(
      `${batch.code} is ${BATCH_STATUS_IS[batch.status]}, so orders cannot be filled from it.`,
    );
  }
  throw conflict(
    batch.bestBefore === null
      ? `${batch.code} has no best-before date, so orders cannot be filled from it.`
      : `${batch.code} passed its best-before date on ${formatDateKey(batch.bestBefore)}, so orders cannot be filled from it.`,
  );
}

const choiceText = (batch: ShelfBatch) =>
  `${batch.code} (${batch.onHand.toLocaleString("en-NZ")} on hand${batch.bestBefore === null ? "" : `, best before ${formatDateKey(batch.bestBefore)}`})`;

/**
 * Take an order's shots out of stock, inside the caller's transaction. Each
 * batch taken from gets a `sold` movement carrying the order's id.
 *
 * A flavour at a time: an order's shots of a flavour only ever come from
 * batches of that flavour, and every rule below is applied to each flavour
 * in the order on its own.
 *
 * Which batch:
 *   `from`      exactly these amounts from these batches: a box that mixes
 *               batches. For each flavour they must add up to what the
 *               order needs of it.
 *   `batchIds`  everything of a flavour from this one batch of it, or the
 *               call is refused. One batch for each flavour at most.
 *   neither     only when there is a single batch of the flavour it could
 *               be, which is then used. If there is a choice the call is
 *               refused and names the choices, so the batch on record is
 *               never a guess. (planTakes works out which to suggest; it is
 *               a suggestion and no more.)
 *
 * A named batch must be of a flavour the order still needs. Only a batch
 * that is released and still good today can be taken from.
 *
 * If no released batch of a flavour has any stock at all, nothing is written
 * for that flavour and nothing is refused: until real batches of it are
 * recorded, orders must still be packable. Once there is stock of it, an
 * order that cannot be covered is refused with the number on hand, so the
 * count gets put right while it is fresh.
 *
 * Safe to call twice: shots the order already holds are not taken again.
 */
export async function allocateOrderStock(
  tx: DbOrTx,
  input: {
    readonly orderId: string;
    /** How many shots of each flavour the order holds, across every line. */
    readonly shots: ReadonlyMap<string, number>;
    /** Take everything of a flavour from this batch and no other. */
    readonly batchIds?: readonly string[];
    /** Take exactly these amounts from these batches. */
    readonly from?: readonly {
      readonly batchId: string;
      readonly shots: number;
    }[];
    readonly now: Date;
    readonly actor: Actor;
    /** For the refusal sentences: "QP-7K2M9X". */
    readonly orderNumber?: string;
  },
): Promise<Allocation> {
  // Lock first, count after: whoever waited here sees the other's movements.
  // Every released batch, whatever its flavour, in one go and in one order,
  // so two transactions can never wait on each other.
  const shelf = await releasedShelf(tx, {
    today: todayKey(input.now),
    lock: true,
  });
  const usable = async (batchId: string): Promise<ShelfBatch> => {
    const batch = shelf.find((row) => row.id === batchId && row.good);
    return batch ?? refuseBatch(tx, batchId);
  };
  const who = input.orderNumber ?? "this order";

  // A named batch is checked before anything else, so a wrong name is
  // refused even when the order turns out to need nothing.
  const named = new Map<string, number>();
  if (input.from !== undefined) {
    for (const part of input.from) {
      named.set(part.batchId, (named.get(part.batchId) ?? 0) + part.shots);
    }
  }
  const chosen: ShelfBatch[] = [];
  for (const batchId of input.batchIds ?? []) {
    const batch = await usable(batchId);
    if (chosen.some((other) => other.id === batch.id)) continue;
    if (chosen.some((other) => other.flavour === batch.flavour)) {
      throw new OpError(
        "invalid_input",
        `Name one batch for each flavour: ${chosen.map((other) => other.code).join(" and ")} and ${batch.code} are both ${flavourName(batch.flavour)}.`,
        { batchCodes: "One batch for each flavour" },
      );
    }
    chosen.push(batch);
  }
  const mix: { batch: ShelfBatch; shots: number }[] = [];
  for (const [batchId, shots] of named) {
    mix.push({ batch: await usable(batchId), shots });
  }

  // What the order still needs of each flavour, after what it holds.
  const holdings = await orderHoldings(tx, input.orderId);
  const need = new Map<string, number>();
  for (const [flavour, shots] of input.shots) {
    const held = holdings
      .filter((holding) => holding.flavour === flavour)
      .reduce((sum, holding) => sum + holding.shots, 0);
    if (shots - held > 0) need.set(flavour, shots - held);
  }
  const ready = (flavour: string) =>
    sellable(shelf.filter((batch) => batch.flavour === flavour)).reduce(
      (sum, batch) => sum + batch.onHand,
      0,
    );
  if (need.size === 0) {
    return { takes: [], skipped: "already-recorded", ready: [] };
  }

  // Sentences name the flavour only when there is more than one in play.
  const sayFlavour = namesFlavours([
    ...input.shots.keys(),
    ...chosen.map((batch) => batch.flavour),
    ...mix.map((part) => part.batch.flavour),
  ]);
  const needText = (count: number, flavour: string) =>
    sayFlavour ? flavourShots(count, flavour, true) : countText(count);
  const shotsOf = (count: number, flavour: string) =>
    sayFlavour ? flavourShots(count, flavour, true) : shotsText(count);

  // A batch named for a flavour the order does not need cannot be in its box.
  for (const batch of [...chosen, ...mix.map((part) => part.batch)]) {
    if (need.has(batch.flavour)) continue;
    throw conflict(
      input.shots.has(batch.flavour)
        ? `${who} already holds all its ${flavourName(batch.flavour)} shots, so none can come from ${batch.code}.`
        : `${batch.code} is ${flavourName(batch.flavour)}, and ${who} has none of it.`,
    );
  }

  const takes: Take[] = [];
  const moved: { flavour: string; before: number; after: number }[] = [];
  for (const [flavour, needed] of need) {
    const ofFlavour = shelf.filter((batch) => batch.flavour === flavour);
    const parts = mix.filter((part) => part.batch.flavour === flavour);
    const one = chosen.find((batch) => batch.flavour === flavour);
    let taken: readonly Take[];
    if (parts.length > 0) {
      const total = parts.reduce((sum, part) => sum + part.shots, 0);
      if (total !== needed) {
        throw new OpError(
          "invalid_input",
          `Those add up to ${shotsOf(total, flavour)} and ${who} needs ${needText(needed, flavour)}.`,
          { batches: `They have to add up to ${needText(needed, flavour)}` },
        );
      }
      for (const part of parts) {
        if (part.batch.onHand < part.shots) {
          throw conflict(
            `${part.batch.code} has ${shotsText(part.batch.onHand)} on hand, so ${countText(part.shots)} cannot be taken from it.`,
          );
        }
      }
      taken = parts
        .sort((a, b) => byFirstExpired(a.batch, b.batch))
        .map((part) => ({
          batchId: part.batch.id,
          code: part.batch.code,
          shots: part.shots,
        }));
    } else if (one !== undefined) {
      if (one.onHand < needed) {
        throw conflict(
          `${one.code} has ${shotsText(one.onHand)} on hand and ${who} needs ${needText(needed, flavour)}. Pick another batch, or split it across batches.`,
        );
      }
      taken = [{ batchId: one.id, code: one.code, shots: needed }];
    } else {
      const plan = planTakes(ofFlavour, needed);
      if (!plan.ok) {
        // No stock of this flavour has been recorded: nothing to take it
        // from, and nothing to refuse.
        if (plan.reason === "nothing-released") continue;
        if (plan.reason === "past-date") {
          throw conflict(
            sayFlavour
              ? `The only ${flavourName(flavour)} shots on hand are past their best-before date, so ${who} cannot be packed from them. Release a batch of it that is in date first.`
              : `The only shots on hand are past their best-before date, so ${who} cannot be packed from them. Release a batch that is in date first.`,
          );
        }
        throw conflict(
          sayFlavour
            ? `Only ${flavourShots(plan.onHand, flavour, true)} on hand in released batches, and ${who} needs ${needText(needed, flavour)}. Release another batch of it or correct the count, then try again.`
            : `Only ${shotsText(plan.onHand)} on hand in released batches, and ${who} needs ${countText(needed)}. Release another batch or correct the count, then try again.`,
        );
      }
      // More than one batch it could be: which one is in the box is for the
      // person packing to say, never for this to pick.
      const good = sellable(ofFlavour);
      if (good.length > 1) {
        throw conflict(
          sayFlavour
            ? `More than one batch of ${flavourName(flavour)} is on sale, so say which one is in the box for ${who}: ${good.map(choiceText).join(" or ")}.`
            : `More than one batch is on sale, so say which one is in the box for ${who}: ${good.map(choiceText).join(" or ")}.`,
        );
      }
      taken = plan.takes;
    }
    const before = ready(flavour);
    const sum = taken.reduce((total, take) => total + take.shots, 0);
    moved.push({ flavour, before, after: before - sum });
    takes.push(...taken);
  }

  for (const take of takes) {
    await writeMovement(tx, {
      batchId: take.batchId,
      kind: "sold",
      shots: -take.shots,
      orderId: input.orderId,
      note: input.orderNumber === undefined ? "" : `Order ${input.orderNumber}`,
      now: input.now,
      actor: input.actor,
    });
  }
  return {
    takes,
    skipped: takes.length === 0 ? "nothing-released" : null,
    ready: moved,
  };
}

/**
 * Deal with whatever an order still holds, inside the caller's transaction.
 * For each batch it had shots from, a `returned` movement takes them off the
 * order. Then:
 *
 *   restock true   they are back on the shelf, in the batch they came from.
 *   restock false  they are written off straight away (a `waste` movement),
 *                  so they never count as sellable again. This is the
 *                  default: nothing goes back on the shelf unless a person
 *                  says it has.
 *
 * An order that holds nothing gets nothing written. Safe to call twice.
 */
export async function returnOrderStock(
  tx: DbOrTx,
  input: {
    readonly orderId: string;
    readonly now: Date;
    readonly actor: Actor;
    readonly note?: string;
    readonly restock?: boolean;
  },
): Promise<Take[]> {
  const touched = await tx
    .selectDistinct({ batchId: stockMovements.batchId })
    .from(stockMovements)
    .where(eq(stockMovements.orderId, input.orderId));
  if (touched.length === 0) return [];

  // Lock, then count: a second cancel that waited here finds nothing held.
  await tx
    .select({ id: batches.id })
    .from(batches)
    .where(
      inArray(
        batches.id,
        touched.map((row) => row.batchId),
      ),
    )
    .orderBy(batches.id)
    .for("update");

  const holdings = await orderHoldings(tx, input.orderId);
  for (const holding of holdings) {
    await writeMovement(tx, {
      batchId: holding.batchId,
      kind: "returned",
      shots: holding.shots,
      orderId: input.orderId,
      note: input.note ?? "",
      now: input.now,
      actor: input.actor,
    });
    if (input.restock !== true) {
      await writeMovement(tx, {
        batchId: holding.batchId,
        kind: "waste",
        shots: -holding.shots,
        note: `Not put back on the shelf${input.note ? `. ${input.note}` : ""}`,
        // A millisecond on, so the batch's history always reads in the order
        // it happened: off the order first, then written off.
        now: new Date(input.now.getTime() + 1),
        actor: input.actor,
      });
    }
  }
  return holdings.map((holding) => ({
    batchId: holding.batchId,
    code: holding.code,
    shots: holding.shots,
  }));
}
