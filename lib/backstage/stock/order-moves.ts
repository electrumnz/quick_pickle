/**
 * What the orders area calls when an order is packed, shipped, unpacked or
 * cancelled.
 *
 * allocation.ts does the counting and the movements. This file is the thin
 * layer the order operations use: it looks the order's shots up, turns batch
 * codes into batches, raises the low-stock flag, and hands back words for the
 * order's own line in the activity log. Both run inside the calling
 * operation's transaction, so an order's stage and its stock change together
 * or not at all.
 */

import type { OpContext } from "../core/op";
import {
  allocateOrderStock,
  orderShots,
  returnOrderStock,
  takesText,
  type Take,
} from "./allocation";
import { flagIfLow, loadBatch } from "./movements";
import { LOW_STOCK_SHOTS } from "./status";

/** The little an order operation has to know about its order. */
export type OrderForStock = {
  readonly id: string;
  readonly number: string;
  readonly isTest: boolean;
};

export type OrderStockNote = {
  /** What moved, batch by batch. Empty when nothing did. */
  readonly moves: readonly Take[];
  /**
   * For the caller's own line in the activity log. Taking: "24 shots from
   * B002". Putting back: a whole clause, "Returned 24 shots to B002". Empty
   * when nothing moved.
   */
  readonly words: string;
  /**
   * Why nothing moved, when nothing did:
   *   test-order        nobody paid for it and it is never sent
   *   nothing-released  no released batch has any stock to record against
   *   already-recorded  the order already holds all its shots
   *   nothing-held      (putting back) the order had no batch recorded
   */
  readonly skipped:
    | "test-order"
    | "nothing-released"
    | "already-recorded"
    | "nothing-held"
    | null;
};

function nothingMoved(skipped: OrderStockNote["skipped"]): OrderStockNote {
  return { moves: [], words: "", skipped };
}

/** Which batch an order was packed from, as an operation is told it. */
export type PackedFrom = {
  /** The code of the one batch everything came from. */
  readonly batchCode?: string;
  /** Or, for a box that mixes batches, how many shots from each. */
  readonly batches?: readonly {
    readonly code: string;
    readonly shots: number;
  }[];
};

/**
 * For the operations that pack or ship an order: take its shots out of
 * stock. Called inside their transaction, so the order's stage and its stock
 * change together or not at all.
 *
 * The batch is the one the caller names. If none is named and there is only
 * one batch it could be, that one is used; if there is a choice the call is
 * refused and lists them, because the recall list has to rest on the batch
 * that was really in the box, not on a guess.
 *
 * A test order takes nothing: nobody paid for it and it is never sent. With
 * no released stock at all nothing is recorded and the order still packs.
 * Raises `stock.low` if this is the order that takes ready stock under
 * `lowStockAt`.
 */
export async function takeOrderStock(
  ctx: OpContext,
  order: OrderForStock,
  options: PackedFrom & { readonly lowStockAt?: number } = {},
): Promise<OrderStockNote> {
  if (order.isTest) return nothingMoved("test-order");
  const shots = await orderShots(ctx.db, order.id);

  const batchId =
    options.batchCode === undefined
      ? undefined
      : (await loadBatch(ctx.db, options.batchCode)).id;
  const from: { batchId: string; shots: number }[] = [];
  for (const part of options.batches ?? []) {
    from.push({
      batchId: (await loadBatch(ctx.db, part.code)).id,
      shots: part.shots,
    });
  }

  const allocation = await allocateOrderStock(ctx.db, {
    orderId: order.id,
    shots,
    batchId,
    from: from.length === 0 ? undefined : from,
    now: ctx.now,
    actor: ctx.actor,
    orderNumber: order.number,
  });
  if (allocation.takes.length === 0) return nothingMoved(allocation.skipped);

  await flagIfLow(ctx, {
    before: allocation.readyBefore,
    after: allocation.readyAfter,
    threshold: options.lowStockAt ?? LOW_STOCK_SHOTS,
    because: "order",
    order: order.number,
  });
  return {
    moves: allocation.takes,
    words: takesText(allocation.takes),
    skipped: null,
  };
}

/**
 * For the operations that unpack or cancel an order: take its shots off the
 * order. With `restock` they go back on the shelf in the batches they came
 * from; without, they are written off, because nothing goes back on the
 * shelf unless a person says it has. An order that never had a batch
 * recorded has nothing to deal with.
 */
export async function putBackOrderStock(
  ctx: OpContext,
  order: OrderForStock,
  why: string,
  options: { readonly restock: boolean },
): Promise<OrderStockNote> {
  const moves = await returnOrderStock(ctx.db, {
    orderId: order.id,
    now: ctx.now,
    actor: ctx.actor,
    note: `Order ${order.number}: ${why}`,
    restock: options.restock,
  });
  if (moves.length === 0) return nothingMoved("nothing-held");
  return {
    moves,
    words: options.restock
      ? `Returned ${takesText(moves, "to")}`
      : `Wrote off ${takesText(moves)}, not put back on the shelf`,
    skipped: null,
  };
}
