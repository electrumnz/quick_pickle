/**
 * Orders and stock, as operations: which batch an order was filled from,
 * what packing it would take, and putting a batch on record for an order
 * that went out without one.
 *
 * The taking itself happens when an order is packed (orders.markPacked),
 * through allocation.ts. These are the reads around that, and the one write
 * for after the fact.
 */

import { desc, sql } from "drizzle-orm";
import { z } from "zod";

import { orders, type BatchStatus, type OrderStatus } from "@/db/schema";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";

import { conflict } from "../core/errors";
import { defineOp } from "../core/op";
import { loadOrder } from "../orders/load";
import {
  orderHoldings,
  orderShotsByFlavour,
  planTakes,
  releasedShelf,
  sellable,
  takesText,
  type ShelfBatch,
} from "./allocation";
import { daysBetween, todayKey } from "./dates";
import { flavourName, flavourShots, namesFlavours } from "./flavours";
import {
  batchCodeSchema,
  lowStockAtSchema,
  packedBatchCodesSchema,
  packedBatchesSchema,
} from "./inputs";
import { countText, shotsText, stockIsCounted } from "./movements";
import { takeOrderStock } from "./order-moves";
import { noBatchRecordedSql } from "./recall-list";

const orderNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ORDER_NUMBER_PATTERN, "Order numbers look like QP-7K2M9X");

/** An order has left the packing queue with its box made up. */
const PACKED_STATUSES: readonly OrderStatus[] = [
  "packed",
  "shipped",
  "delivered",
];

/** A batch an order's shots of one flavour could come from. */
export type OrderStockChoice = {
  readonly code: string;
  readonly name: string;
  readonly flavour: string;
  readonly bestBefore: string | null;
  readonly daysToBestBefore: number | null;
  readonly onHand: number;
  /** True when this batch could fill what the order still needs of its flavour by itself. */
  readonly enough: boolean;
};

/**
 * One flavour of an order, as stock sees it. Each flavour is its own pool,
 * so everything about choosing a batch is said a flavour at a time.
 */
export type OrderStockPart = {
  readonly flavour: string;
  /** "Mango Chilli Lime". */
  readonly flavourName: string;
  /** Shots of this flavour in the order. */
  readonly shots: number;
  /** Shots of it still to be given a batch. */
  readonly need: number;
  readonly choices: readonly OrderStockChoice[];
  readonly plan:
    readonly { readonly code: string; readonly shots: number }[] | null;
  readonly mustChoose: boolean;
  readonly onHandIfShort: number | null;
  readonly blocked: boolean;
  /** Where this flavour stands, in one sentence. */
  readonly summary: string;
};

export type OrderStock = {
  readonly number: string;
  /**
   * False until a batch has been recorded as made. Stock is not being
   * counted yet, so the order's own page says nothing about it: an order
   * packs as it always did, and nobody is asked about batches they have
   * never set up.
   */
  readonly tracking: boolean;
  /** Shots in the order: for every line, packs times the shots in a pack. */
  readonly shots: number;
  readonly isTest: boolean;
  /** The batches it holds shots from, after anything put back. */
  readonly filled: readonly {
    readonly code: string;
    readonly name: string;
    readonly flavour: string;
    readonly status: BatchStatus;
    readonly shots: number;
  }[];
  /**
   * Shots with no batch recorded, for an order that has been packed or sent.
   * Nothing for an order not yet packed, a cancelled one or a test order.
   */
  readonly missing: number;
  /**
   * Shots that still have to be given a batch: the whole order before it is
   * packed, whatever is missing afterwards. Across every flavour; each
   * flavour's own is in `parts`.
   */
  readonly need: number;
  /**
   * The batches it could be filled from: released, within their best-before
   * date, with shots on hand, of a flavour the order needs. Earliest
   * best-before date first, a flavour at a time.
   */
  readonly choices: readonly OrderStockChoice[];
  /**
   * The suggestion: which batches to take from, first expired first out. A
   * suggestion only. What goes on record is what the person packing says is
   * in the box. Null when there is nothing to suggest for a flavour that
   * needs something: nothing is released, or there is not enough.
   */
  readonly plan:
    readonly { readonly code: string; readonly shots: number }[] | null;
  /**
   * True when more than one batch of a flavour could be in the box, so the
   * batch has to be named when the order is marked packed.
   */
  readonly mustChoose: boolean;
  /** Set when there is good stock but too little: how many shots there are. */
  readonly onHandIfShort: number | null;
  /**
   * True when packing would be refused as things stand: there is stock of a
   * flavour but too little of it, or only stock past its date. (No stock of
   * a flavour at all is not a block: it packs and no batch is recorded.)
   */
  readonly blocked: boolean;
  /** Where the order stands with stock, in a sentence or one a flavour. */
  readonly summary: string;
  /**
   * The order a flavour at a time, in the catalogue's order. One part for an
   * order of one flavour, and then the fields above are that part's.
   */
  readonly parts: readonly OrderStockPart[];
  /** True when there is more than one flavour in play, so sentences name them. */
  readonly namesFlavours: boolean;
};

export const orderStock = defineOp({
  name: "stock.orderStock",
  title: "See which batch an order is filled from",
  description:
    "For one order, by its number (QP-7K2M9X): which batches its shots came from, whether any of it has no batch recorded, which batches it could be filled from (released, within their best-before date, with shots on hand, of the same flavour), and `plan`, the suggestion of which to use first (the earliest best-before batch that can cover it, split across batches only when no one batch can). Each flavour is its own pool: `parts` says all of this a flavour at a time. `mustChoose` is true when there is more than one batch of a flavour it could be, in which case packing has to name the batch. `summary` says where the order stands in a sentence. `tracking` is false until a first batch has been recorded as made: stock is not being counted yet, and none of this needs saying to anybody. Read-only. To change it, pack the order (orders.markPacked, with `batchCode`, `batchCodes` (one for each flavour) or `batches`) or, for an order already packed or sent, use stock.recordOrderBatch.",
  access: "read",
  input: z.object({ number: orderNumber }),
  async run(ctx, input): Promise<OrderStock> {
    const order = await loadOrder(ctx.db, input.number);
    const byFlavour = await orderShotsByFlavour(ctx.db, order.id);
    const shots = [...byFlavour.values()].reduce((sum, n) => sum + n, 0);
    const holdings = await orderHoldings(ctx.db, order.id);
    const held = holdings.reduce((sum, holding) => sum + holding.shots, 0);
    const filled = holdings.map(
      ({ code, name, flavour, status, shots: n }) => ({
        code,
        name,
        flavour,
        status,
        shots: n,
      }),
    );

    const packed = PACKED_STATUSES.includes(order.status);
    const open = order.status === "pending" || order.status === "paid";
    const counts = !order.isTest && (packed || open);
    const today = todayKey(ctx.now);
    const shelf = await releasedShelf(ctx.db, { today });
    const sayFlavour = namesFlavours([
      ...byFlavour.keys(),
      ...holdings.map((holding) => holding.flavour),
    ]);
    const choiceOf = (batch: ShelfBatch, need: number): OrderStockChoice => ({
      code: batch.code,
      name: batch.name,
      flavour: batch.flavour,
      bestBefore: batch.bestBefore,
      daysToBestBefore:
        batch.bestBefore === null ? null : daysBetween(today, batch.bestBefore),
      onHand: batch.onHand,
      enough: batch.onHand >= need,
    });

    const parts: OrderStockPart[] = [...byFlavour].map(([flavour, total]) => {
      const heldOf = holdings
        .filter((holding) => holding.flavour === flavour)
        .reduce((sum, holding) => sum + holding.shots, 0);
      const need = counts ? Math.max(0, total - heldOf) : 0;
      const ofFlavour = shelf.filter((batch) => batch.flavour === flavour);
      const good = sellable(ofFlavour);
      const planned = need > 0 ? planTakes(ofFlavour, need) : null;
      const mustChoose = need > 0 && good.length > 1;
      const name = flavourName(flavour);
      const needText = sayFlavour
        ? flavourShots(need, flavour, true)
        : countText(need);
      let summary: string;
      if (planned === null) {
        summary = "";
      } else if (planned.ok) {
        summary = !mustChoose
          ? `Packing takes ${takesText(planned.takes)}.`
          : planned.takes.length === 1
            ? `Take ${takesText(planned.takes)} if you can: of the batches${sayFlavour ? ` of ${name}` : ""} that can fill it, that one has the earliest best-before date. Say which batch is in the box when it is packed.`
            : `No one batch${sayFlavour ? ` of ${name}` : ""} can fill it. Take ${takesText(planned.takes)}, and say so when it is packed.`;
      } else if (planned.reason === "nothing-released") {
        summary = sayFlavour
          ? `No batch of ${name} has stock released for sale, so no batch will be recorded for its shots when this is packed.`
          : "No batch has stock released for sale, so no batch will be recorded when this is packed.";
      } else if (planned.reason === "past-date") {
        summary = sayFlavour
          ? `The only ${name} shots on hand are past their best-before date, so this cannot be packed from them. Release a batch of it that is in date first.`
          : "The only shots on hand are past their best-before date, so this cannot be packed from them. Release a batch that is in date first.";
      } else {
        summary = `Only ${sayFlavour ? flavourShots(planned.onHand, flavour, true) : shotsText(planned.onHand)} on hand in released batches, and this order needs ${needText}. Release another batch${sayFlavour ? " of it" : ""} or correct the count before packing it.`;
      }
      return {
        flavour,
        flavourName: name,
        shots: total,
        need,
        choices: good.map((batch) => choiceOf(batch, need)),
        plan:
          planned !== null && planned.ok
            ? planned.takes.map(({ code, shots: n }) => ({ code, shots: n }))
            : null,
        mustChoose,
        onHandIfShort:
          planned !== null && !planned.ok && planned.reason === "short"
            ? planned.onHand
            : null,
        blocked:
          planned !== null &&
          !planned.ok &&
          planned.reason !== "nothing-released",
        summary,
      };
    });
    const needing = parts.filter((part) => part.need > 0);
    const need = needing.reduce((sum, part) => sum + part.need, 0);

    const from = takesText(
      holdings.map(({ batchId, code, shots: n }) => ({
        batchId,
        code,
        shots: n,
      })),
    );
    let summary: string;
    if (order.isTest) {
      summary = "A test order. No stock is taken for it.";
    } else if (order.status === "cancelled") {
      summary = "Cancelled. It holds no stock.";
    } else if (packed) {
      summary =
        held === 0
          ? "No batch recorded for this order."
          : held < shots
            ? `Filled with ${from}. No batch is recorded for the other ${countText(shots - held)}.`
            : `Filled with ${from}.`;
    } else if (needing.length === 0) {
      summary = held > 0 ? `Filled with ${from}.` : "It has no shots to pack.";
    } else if (needing.length === 1) {
      summary = needing[0]?.summary ?? "";
    } else {
      summary = needing
        .map((part) => `${part.flavourName}: ${part.summary}`)
        .join(" ");
    }

    // A flavour with nothing released suggests nothing; the order's plan is
    // whatever the flavours that can be planned suggest.
    const planned = needing.flatMap((part) => part.plan ?? []);
    const short = needing.find((part) => part.onHandIfShort !== null);
    return {
      number: order.number,
      tracking: await stockIsCounted(ctx.db),
      shots,
      isTest: order.isTest,
      filled,
      missing: packed && !order.isTest ? Math.max(0, shots - held) : 0,
      need,
      choices: needing.flatMap((part) => part.choices),
      plan:
        needing.length === 0 || needing.every((part) => part.plan === null)
          ? null
          : planned,
      mustChoose: needing.some((part) => part.mustChoose),
      onHandIfShort: short?.onHandIfShort ?? null,
      blocked: needing.some((part) => part.blocked),
      summary,
      parts,
      namesFlavours: sayFlavour,
    };
  },
});

export const recordOrderBatch = defineOp({
  name: "stock.recordOrderBatch",
  title: "Record the batch an order was filled from",
  description:
    "For an order that was packed or sent with no batch recorded: takes its shots out of stock now and ties them to the batch that was in the box, so the order shows up on that batch's recall list. Name the batch with `batchCode`, or for a box that mixed batches give `batches` (a code and a number of shots for each). If neither is given and only one batch is on sale that one is used; if there is a choice it is refused and lists them, because this has to be the batch really packed, not a guess. Only for an order that is packed, shipped or delivered, and not a test order. An order not yet packed gets its batch when it is packed. Refused if the batch does not have the stock. Doing it twice takes nothing the second time.",
  access: "write",
  input: z
    .object({
      number: orderNumber,
      batchCode: batchCodeSchema.optional(),
      batches: packedBatchesSchema.optional(),
      batchCodes: packedBatchCodesSchema.optional(),
      lowStockAt: lowStockAtSchema,
    })
    .refine(
      (value) => value.batchCode === undefined || value.batches === undefined,
      { message: "Name one batch, or the mix, not both", path: ["batches"] },
    ),
  async run(
    ctx,
    input,
  ): Promise<{
    number: string;
    filled: readonly { code: string; shots: number }[];
  }> {
    // Held to the end, like every change to an order: unpacking it at the
    // same moment waits for this, and this for that.
    const order = await loadOrder(ctx.db, input.number, { forChange: true });
    if (order.isTest) {
      throw conflict(
        `${order.number} is a test order, so no stock is taken for it.`,
      );
    }
    if (order.status === "cancelled") {
      throw conflict(`${order.number} was cancelled, so it holds no stock.`);
    }
    if (!PACKED_STATUSES.includes(order.status)) {
      throw conflict(
        `${order.number} has not been packed yet. Its batch is recorded when it is packed.`,
      );
    }

    const note = await takeOrderStock(ctx, order, {
      batchCode: input.batchCode,
      batchCodes: input.batchCodes,
      batches: input.batches,
      lowStockAt: input.lowStockAt,
    });
    if (note.skipped === "nothing-released") {
      throw conflict(
        "No released batch has any stock on hand, so there is nothing to record this order against.",
      );
    }
    if (note.moves.length === 0) {
      // Its batch was already on record: a second press, or a second caller.
      ctx.nothingChanged();
    } else {
      await ctx.audit({
        entity: { type: "order", id: order.id },
        summary: `Recorded that ${order.number} was filled with ${note.words}`,
        data: { moves: note.moves },
      });
    }
    return {
      number: order.number,
      filled: note.moves.map(({ code, shots }) => ({ code, shots })),
    };
  },
});

export type UnrecordedOrder = {
  readonly number: string;
  readonly status: OrderStatus;
  readonly name: string;
  readonly placedAt: Date;
  readonly shots: number;
};

export const listOrdersWithoutBatch = defineOp({
  name: "stock.listOrdersWithoutBatch",
  title: "List orders with no batch recorded",
  description:
    "Orders that have been packed or sent with no batch written against them, newest first. They are on no batch's recall list. Test orders are left out, since no stock is taken for them. Use stock.recordOrderBatch to put each one right.",
  access: "read",
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  async run(ctx, input): Promise<UnrecordedOrder[]> {
    const rows = await ctx.db
      .select({
        number: orders.number,
        status: orders.status,
        firstName: orders.firstName,
        lastName: orders.lastName,
        placedAt: orders.placedAt,
        shots: sql<number>`coalesce((
          select sum(l.qty * l.shots)::int from order_lines l
          where l.order_id = "orders"."id"
        ), 0)`,
      })
      .from(orders)
      .where(noBatchRecordedSql)
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(input.limit);
    return rows.map(({ firstName, lastName, ...row }) => ({
      ...row,
      name: `${firstName} ${lastName}`.trim(),
    }));
  },
});
