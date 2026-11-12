/**
 * A purchase order's life: sent, received, cancelled.
 *
 * The moves that are allowed are written down once, in status.ts. Marking
 * an order sent is the one outward step in stock, and it only records: no
 * email leaves the back end. Marking it received is what adds to the
 * materials' counts, in the same transaction as the change of state.
 */

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  materials,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  type PurchaseStatus,
} from "@/db/schema";

import { conflict, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import {
  addWorkingDays,
  dateKeySchema,
  formatDateKey,
  todayKey,
} from "./dates";
import { noteSchema, quantitySchema } from "./inputs";
import { shiftMaterial } from "./materials";
import {
  loadPurchase,
  PURCHASE_STATUS_IS,
  purchaseNumber,
  type PurchaseOrderRow,
} from "./purchasing";
import { canMovePurchase } from "./status";

const TO_VERB: Readonly<Record<PurchaseStatus, string>> = {
  draft: "made a draft again",
  sent: "marked as sent",
  received: "marked as received",
  cancelled: "cancelled",
};

function refuseMove(order: PurchaseOrderRow, to: PurchaseStatus): never {
  throw conflict(
    `${order.number} is ${PURCHASE_STATUS_IS[order.status]}, so it cannot be ${TO_VERB[to]}.`,
  );
}

export const markPurchaseSent = defineOp({
  name: "stock.markPurchaseSent",
  title: "Mark a purchase order as sent",
  description:
    "Records that a draft purchase order has gone to the supplier, and the day it went (today unless given). It does NOT send anything: no email leaves the back end yet, so the order still has to be sent to the supplier by hand. If no due date is given and the supplier's lead time is known, the due date is worked out from it in working days. Refused if the order has no lines.",
  access: "write",
  effect: "outward",
  input: z.object({
    number: purchaseNumber,
    /** The day it was sent. Today if left out. */
    orderedOn: dateKeySchema.optional(),
    /** The day it is due. Worked out from the lead time if left out. */
    expectedOn: dateKeySchema.optional(),
  }),
  explain: (input) =>
    `This marks ${input.number} as sent to the supplier. It only records that: no email goes out from here, so the order still has to be sent to them by hand.`,
  async run(
    ctx,
    input,
  ): Promise<{
    number: string;
    status: PurchaseStatus;
    orderedOn: string | null;
    expectedOn: string | null;
  }> {
    const order = await loadPurchase(ctx.db, input.number, { lock: true });
    if (order.status === "sent") {
      return {
        number: order.number,
        status: "sent",
        orderedOn: order.orderedOn,
        expectedOn: order.expectedOn,
      };
    }
    if (!canMovePurchase(order.status, "sent")) refuseMove(order, "sent");

    const lines = await ctx.db
      .select({
        qty: purchaseOrderLines.qty,
        unitCostCents: purchaseOrderLines.unitCostCents,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
    if (lines.length === 0) {
      throw conflict(
        `${order.number} has nothing on it yet. Add what is being ordered first.`,
      );
    }
    const [supplier] = await ctx.db
      .select({ name: suppliers.name, leadTimeDays: suppliers.leadTimeDays })
      .from(suppliers)
      .where(eq(suppliers.id, order.supplierId));

    const today = todayKey(ctx.now);
    const orderedOn = input.orderedOn ?? today;
    if (orderedOn > today) {
      throw new OpError(
        "invalid_input",
        "The day it was sent cannot be a day that has not happened yet.",
        { orderedOn: "That day has not happened yet" },
      );
    }
    const leadTime = supplier?.leadTimeDays ?? null;
    const expectedOn =
      input.expectedOn ??
      order.expectedOn ??
      (leadTime === null ? null : addWorkingDays(orderedOn, leadTime));
    if (expectedOn !== null && expectedOn < orderedOn) {
      throw new OpError(
        "invalid_input",
        "The due date is earlier than the day it was sent.",
        { expectedOn: "Earlier than the day it was sent" },
      );
    }

    await ctx.db
      .update(purchaseOrders)
      .set({ status: "sent", orderedOn, expectedOn, updatedAt: ctx.now })
      .where(eq(purchaseOrders.id, order.id));
    const totalCents = lines.reduce(
      (sum, line) => sum + line.qty * line.unitCostCents,
      0,
    );
    const entity = { type: "purchase_order", id: order.id };
    const name = supplier?.name ?? "the supplier";
    await ctx.audit({
      entity,
      summary: `Marked ${order.number} as sent to ${name}${expectedOn === null ? "" : `, due ${formatDateKey(expectedOn)}`}`,
      data: { orderedOn, expectedOn, totalCents },
    });
    await ctx.emit({
      type: "purchase.sent",
      entity,
      payload: {
        number: order.number,
        supplierId: order.supplierId,
        orderedOn,
        expectedOn,
        totalCents,
      },
    });
    return { number: order.number, status: "sent", orderedOn, expectedOn };
  },
});

export type ReceivedMaterial = {
  readonly id: string;
  readonly name: string;
  /** How many were ordered. */
  readonly ordered: number;
  /** How many arrived in good order and were added to the count. */
  readonly qty: number;
  /** How many are on hand now. */
  readonly onHand: number;
};

export const markPurchaseReceived = defineOp({
  name: "stock.markPurchaseReceived",
  title: "Mark a purchase order as received",
  description:
    "Says the goods on a sent purchase order have arrived, on the day given (today unless given), and adds what arrived to each material's count on hand in the same step. Goods do not always arrive as ordered: with `accepted`, give for any line the quantity that arrived in good order (fewer if some were short or damaged, more if they sent extra); a line left out is taken as arrived in full. What differed from the order is written on its history. Lines with no material add to nothing. Only for an order that has been marked sent, and only once: there is no part-received state yet, so anything still to come on a short delivery needs a new purchase order. Doing it twice adds nothing the second time.",
  access: "write",
  input: z.object({
    number: purchaseNumber,
    /** The day it arrived. Today if left out. */
    receivedOn: dateKeySchema.optional(),
    /** What arrived in good order, for any line where that is not what was ordered. */
    accepted: z
      .array(
        z.object({
          /** The line's id, from stock.getPurchaseOrder. */
          lineId: z.string().trim().min(1),
          qty: quantitySchema,
        }),
      )
      .max(40, "That is more lines than one order holds")
      .optional(),
  }),
  async run(
    ctx,
    input,
  ): Promise<{
    number: string;
    status: PurchaseStatus;
    received: readonly ReceivedMaterial[];
  }> {
    const order = await loadPurchase(ctx.db, input.number, { lock: true });
    if (order.status === "received") {
      return { number: order.number, status: "received", received: [] };
    }
    if (!canMovePurchase(order.status, "received")) {
      refuseMove(order, "received");
    }
    const today = todayKey(ctx.now);
    const receivedOn = input.receivedOn ?? today;
    if (receivedOn > today) {
      throw new OpError(
        "invalid_input",
        "The day it arrived cannot be a day that has not happened yet.",
        { receivedOn: "That day has not happened yet" },
      );
    }

    const lines = await ctx.db
      .select({
        id: purchaseOrderLines.id,
        materialId: purchaseOrderLines.materialId,
        description: purchaseOrderLines.description,
        qty: purchaseOrderLines.qty,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.id))
      // The order the lines are shown in, so what is written down reads the
      // same way round as the page.
      .orderBy(purchaseOrderLines.description, purchaseOrderLines.id);
    const accepted = new Map<string, number>();
    for (const line of input.accepted ?? []) {
      if (!lines.some((row) => row.id === line.lineId)) {
        throw new OpError(
          "invalid_input",
          `That line is not on ${order.number}.`,
          { accepted: "Not a line on this order" },
        );
      }
      accepted.set(line.lineId, line.qty);
    }

    // What arrived, material by material, and anything that was not as ordered.
    const arriving = new Map<string, { ordered: number; qty: number }>();
    const differences: string[] = [];
    for (const line of lines) {
      const qty = accepted.get(line.id) ?? line.qty;
      if (qty !== line.qty) {
        differences.push(
          `${qty.toLocaleString("en-NZ")} of ${line.qty.toLocaleString("en-NZ")} × ${line.description}`,
        );
      }
      if (line.materialId === null) continue;
      const sum = arriving.get(line.materialId) ?? { ordered: 0, qty: 0 };
      arriving.set(line.materialId, {
        ordered: sum.ordered + line.qty,
        qty: sum.qty + qty,
      });
    }

    const received: ReceivedMaterial[] = [];
    if (arriving.size > 0) {
      // Locked in one steady order, so two orders arriving at once take turns.
      const rows = await ctx.db
        .select({ id: materials.id, name: materials.name })
        .from(materials)
        .where(inArray(materials.id, [...arriving.keys()]))
        .orderBy(materials.id)
        .for("update");
      for (const material of rows) {
        const line = arriving.get(material.id) ?? { ordered: 0, qty: 0 };
        // Added to whatever the count is at this moment, never written over it.
        const moved = await shiftMaterial(
          ctx.db,
          material.id,
          line.qty,
          ctx.now,
        );
        if (moved === null) continue;
        if (line.qty > 0) {
          await ctx.audit({
            entity: { type: "material", id: material.id },
            summary: `${material.name}: ${moved.before.toLocaleString("en-NZ")} to ${moved.after.toLocaleString("en-NZ")} on hand, received on ${order.number}${line.qty === line.ordered ? "" : ` (${line.qty.toLocaleString("en-NZ")} of the ${line.ordered.toLocaleString("en-NZ")} ordered)`}`,
            data: {
              before: moved.before,
              after: moved.after,
              qty: line.qty,
              ordered: line.ordered,
            },
          });
        }
        received.push({
          id: material.id,
          name: material.name,
          ordered: line.ordered,
          qty: line.qty,
          onHand: moved.after,
        });
      }
    }

    await ctx.db
      .update(purchaseOrders)
      .set({ status: "received", receivedOn, updatedAt: ctx.now })
      .where(eq(purchaseOrders.id, order.id));
    const [supplier] = await ctx.db
      .select({ name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.id, order.supplierId));
    const entity = { type: "purchase_order", id: order.id };
    await ctx.audit({
      entity,
      summary: `Received ${order.number} from ${supplier?.name ?? "the supplier"}${differences.length === 0 ? "" : `. Not as ordered: ${differences.join(", ")}`}`,
      data: { receivedOn, materials: received, differences },
    });
    await ctx.emit({
      type: "purchase.received",
      entity,
      payload: {
        number: order.number,
        supplierId: order.supplierId,
        receivedOn,
        asOrdered: differences.length === 0,
        materials: received,
      },
    });
    return { number: order.number, status: "received", received };
  },
});

export const cancelPurchaseOrder = defineOp({
  name: "stock.cancelPurchaseOrder",
  title: "Cancel a purchase order",
  description:
    "Calls off a purchase order that is a draft or has been sent, with the reason if there is one. It only records it: if the supplier already has the order, they still have to be told by hand. An order that has been received cannot be cancelled. No count changes.",
  access: "write",
  input: z.object({ number: purchaseNumber, reason: noteSchema.optional() }),
  async run(ctx, input): Promise<{ number: string; status: PurchaseStatus }> {
    const order = await loadPurchase(ctx.db, input.number, { lock: true });
    if (order.status === "cancelled") {
      return { number: order.number, status: "cancelled" };
    }
    if (!canMovePurchase(order.status, "cancelled")) {
      refuseMove(order, "cancelled");
    }
    await ctx.db
      .update(purchaseOrders)
      .set({ status: "cancelled", updatedAt: ctx.now })
      .where(eq(purchaseOrders.id, order.id));
    const entity = { type: "purchase_order", id: order.id };
    await ctx.audit({
      entity,
      summary: `Cancelled ${order.number}${input.reason ? `: ${input.reason}` : ""}`,
      data: { was: order.status },
    });
    await ctx.emit({
      type: "purchase.cancelled",
      entity,
      payload: {
        number: order.number,
        supplierId: order.supplierId,
        wasSent: order.status === "sent",
      },
    });
    return { number: order.number, status: "cancelled" };
  },
});
