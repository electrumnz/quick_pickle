/**
 * Purchase orders: what has been asked of a supplier, and whether it has
 * arrived.
 *
 * A purchase order starts as a draft, is marked sent once the supplier has
 * it, and is marked received when the goods turn up, which adds each line's
 * quantity to its material's count on hand. Nothing here emails a supplier:
 * marking an order sent records that it was sent, and the sending is still
 * done by a person.
 *
 * This file is reading purchase orders, starting one and filling it in.
 * Moving one along (sent, received, cancelled) is in purchase-states.ts.
 */

import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  materials,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  type PurchaseStatus,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import { conflict, notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { dateKeySchema, daysBetween, formatDateKey, todayKey } from "./dates";
import { centsSchema, longTextSchema } from "./inputs";
import {
  NEXT_PURCHASE_STATUS,
  OPEN_PURCHASE_STATUSES,
  PURCHASE_STATUSES,
} from "./status";

/**
 * On the form that marks an order received, each line has a number box for
 * how many arrived in good order, named this plus the line's id.
 */
export const ACCEPTED_FIELD = "accepted-";

/** A purchase order's number, as an operation takes it: "PO-0001". */
export const purchaseNumber = z
  .string({ error: "Give the purchase order number, like PO-0001" })
  .trim()
  .toUpperCase()
  .regex(/^PO-\d{4,9}$/, "Purchase order numbers look like PO-0001");

const lineQty = z
  .number({ error: "Say how many, as a whole number" })
  .int("Use a whole number")
  .min(1, "Order at least one")
  .max(1_000_000, "That is more than one line holds");

/** One thing on a purchase order: a material, or anything in words. */
const lineInput = z
  .object({
    /** A material from the list. Its name and usual cost fill in the rest. */
    materialId: z.string().trim().min(1).optional(),
    /** What it is, in words. Needed when there is no material. */
    description: z.string().trim().max(200).optional(),
    qty: lineQty,
    /** What one costs, in cents. The material's usual cost if left out. */
    unitCostCents: centsSchema.optional(),
  })
  .refine(
    (line) => line.materialId !== undefined || (line.description ?? "") !== "",
    { message: "Pick a material or say what it is", path: ["description"] },
  );

type LineInput = z.output<typeof lineInput>;

/** How a purchase order's state reads mid-sentence: "PO-0001 is …". */
export const PURCHASE_STATUS_IS: Readonly<Record<PurchaseStatus, string>> = {
  draft: "still a draft",
  sent: "sent",
  received: "already received",
  cancelled: "cancelled",
};

export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;

/**
 * Find a purchase order by its number. With `lock`, hold its row until the
 * transaction ends, so marking one received twice at the same moment adds
 * to the materials once.
 */
export async function loadPurchase(
  db: DbOrTx,
  number: string,
  options: { readonly lock?: boolean } = {},
): Promise<PurchaseOrderRow> {
  const query = db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.number, number));
  const [order] = await (options.lock === true ? query.for("update") : query);
  if (order === undefined) throw notFound(`Purchase order ${number}`);
  return order;
}

export type PurchaseRow = {
  readonly id: string;
  /** "PO-0001". */
  readonly number: string;
  readonly status: PurchaseStatus;
  readonly supplierId: string;
  readonly supplierName: string;
  /** The day it was sent to the supplier. */
  readonly orderedOn: string | null;
  /** The day it is due. */
  readonly expectedOn: string | null;
  readonly receivedOn: string | null;
  /** How many lines are on it. */
  readonly lines: number;
  /** Quantity times unit cost, added up, in cents. */
  readonly totalCents: number;
  /** True when it is sent, has a due date, and that date has passed. */
  readonly overdue: boolean;
  readonly createdAt: Date;
};

/*
 * Sub-queries that look back at the outer row name it in full
 * ("purchase_orders"."id"). The sum is cast up before multiplying and comes
 * back as a float so a large order cannot overflow a 32-bit integer; cents
 * are whole numbers well inside what a float holds exactly.
 */
const lineCountSql = sql<number>`(
  select count(*)::int from purchase_order_lines l
  where l.purchase_order_id = "purchase_orders"."id"
)`;
const totalSql = sql<number>`coalesce((
  select sum(l.qty::bigint * l.unit_cost_cents)::float8
  from purchase_order_lines l
  where l.purchase_order_id = "purchase_orders"."id"
), 0)`;

const purchaseColumns = {
  id: purchaseOrders.id,
  number: purchaseOrders.number,
  status: purchaseOrders.status,
  supplierId: purchaseOrders.supplierId,
  supplierName: suppliers.name,
  orderedOn: purchaseOrders.orderedOn,
  expectedOn: purchaseOrders.expectedOn,
  receivedOn: purchaseOrders.receivedOn,
  lines: lineCountSql,
  totalCents: totalSql,
  createdAt: purchaseOrders.createdAt,
};

function isOverdue(
  row: { readonly status: PurchaseStatus; readonly expectedOn: string | null },
  today: string,
): boolean {
  return (
    row.status === "sent" && row.expectedOn !== null && row.expectedOn < today
  );
}

export const listPurchaseOrders = defineOp({
  name: "stock.listPurchaseOrders",
  title: "List purchase orders",
  description:
    "Purchase orders, newest first, with the supplier, the dates, how many lines and the total. `status` narrows to draft, sent, received or cancelled, or `open` for drafts and sent orders together. `overdue` is true for one that is sent and past its due date. `supplierId` narrows to one supplier, `materialId` to orders with that material on them.",
  access: "read",
  input: z.object({
    status: z.enum([...PURCHASE_STATUSES, "open", "all"]).default("all"),
    supplierId: z.string().trim().min(1).optional(),
    materialId: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async run(ctx, input): Promise<PurchaseRow[]> {
    const where: SQL[] = [];
    if (input.status === "open") {
      where.push(inArray(purchaseOrders.status, [...OPEN_PURCHASE_STATUSES]));
    } else if (input.status !== "all") {
      where.push(eq(purchaseOrders.status, input.status));
    }
    if (input.supplierId !== undefined) {
      where.push(eq(purchaseOrders.supplierId, input.supplierId));
    }
    if (input.materialId !== undefined) {
      where.push(sql`exists (
        select 1 from purchase_order_lines l
        where l.purchase_order_id = "purchase_orders"."id"
          and l.material_id = ${input.materialId}
      )`);
    }
    const rows = await ctx.db
      .select(purchaseColumns)
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.number))
      .limit(input.limit);
    const today = todayKey(ctx.now);
    return rows.map((row) => ({ ...row, overdue: isOverdue(row, today) }));
  },
});

export type PurchaseLine = {
  readonly id: string;
  /** The material it adds to when received. Null for a free line. */
  readonly materialId: string | null;
  /** How the material is counted, when there is one. */
  readonly unit: string | null;
  readonly description: string;
  readonly qty: number;
  readonly unitCostCents: number;
  readonly lineCents: number;
};

export type PurchaseDetail = PurchaseRow & {
  readonly notes: string;
  /** Days past the due date, for one that is overdue. */
  readonly daysLate: number | null;
  readonly supplier: {
    readonly id: string;
    readonly name: string;
    readonly contactName: string;
    readonly email: string | null;
    readonly phone: string | null;
    readonly leadTimeDays: number | null;
    readonly active: boolean;
  };
  readonly items: readonly PurchaseLine[];
  /** The states it can move to from here. */
  readonly next: readonly PurchaseStatus[];
  readonly updatedAt: Date;
};

export const getPurchaseOrder = defineOp({
  name: "stock.getPurchaseOrder",
  title: "Open one purchase order",
  description:
    "Everything on one purchase order, by its number (PO-0001): the supplier and who to talk to, each line with its quantity, unit cost and line total, the overall total, the dates, the notes and what it can move to next.",
  access: "read",
  input: z.object({ number: purchaseNumber }),
  async run(ctx, input): Promise<PurchaseDetail> {
    const [row] = await ctx.db
      .select({
        ...purchaseColumns,
        notes: purchaseOrders.notes,
        updatedAt: purchaseOrders.updatedAt,
        contactName: suppliers.contactName,
        email: suppliers.email,
        phone: suppliers.phone,
        leadTimeDays: suppliers.leadTimeDays,
        active: suppliers.active,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(eq(purchaseOrders.number, input.number));
    if (row === undefined) throw notFound(`Purchase order ${input.number}`);

    const items = await ctx.db
      .select({
        id: purchaseOrderLines.id,
        materialId: purchaseOrderLines.materialId,
        unit: materials.unit,
        description: purchaseOrderLines.description,
        qty: purchaseOrderLines.qty,
        unitCostCents: purchaseOrderLines.unitCostCents,
      })
      .from(purchaseOrderLines)
      .leftJoin(materials, eq(materials.id, purchaseOrderLines.materialId))
      .where(eq(purchaseOrderLines.purchaseOrderId, row.id))
      // Lines have no clock of their own; ids are only a steady tie-break.
      .orderBy(purchaseOrderLines.description, purchaseOrderLines.id);

    const today = todayKey(ctx.now);
    const overdue = isOverdue(row, today);
    const { contactName, email, phone, leadTimeDays, active, ...order } = row;
    return {
      ...order,
      overdue,
      daysLate:
        overdue && row.expectedOn !== null
          ? daysBetween(row.expectedOn, today)
          : null,
      supplier: {
        id: row.supplierId,
        name: row.supplierName,
        contactName,
        email,
        phone,
        leadTimeDays,
        active,
      },
      items: items.map((line) => ({
        ...line,
        lineCents: line.qty * line.unitCostCents,
      })),
      next: NEXT_PURCHASE_STATUS[row.status],
    };
  },
});

/** Any constant will do; it only has to be the same one everywhere. */
const NUMBER_LOCK_KEY = 7_746_292;

/**
 * The next number in the run PO-0001, PO-0002. Two people starting a
 * purchase order at the same moment take turns here: the lock is held until
 * the transaction ends, so the second one reads the first one's number.
 */
async function nextPurchaseNumber(db: DbOrTx): Promise<string> {
  await db.execute(sql`select pg_advisory_xact_lock(${NUMBER_LOCK_KEY})`);
  const [row] = await db
    .select({
      highest: sql<number>`coalesce(max(substring(${purchaseOrders.number} from '^PO-([0-9]+)$')::int), 0)`,
    })
    .from(purchaseOrders);
  return `PO-${String((row?.highest ?? 0) + 1).padStart(4, "0")}`;
}

type ResolvedLine = {
  readonly materialId: string | null;
  readonly description: string;
  readonly qty: number;
  readonly unitCostCents: number;
};

/** Fill a line in from its material, where it has one. */
async function resolveLine(db: DbOrTx, line: LineInput): Promise<ResolvedLine> {
  if (line.materialId === undefined) {
    return {
      materialId: null,
      description: line.description ?? "",
      qty: line.qty,
      unitCostCents: line.unitCostCents ?? 0,
    };
  }
  const [material] = await db
    .select({
      id: materials.id,
      name: materials.name,
      unitCostCents: materials.unitCostCents,
    })
    .from(materials)
    .where(eq(materials.id, line.materialId));
  if (material === undefined) throw notFound("That material");
  return {
    materialId: material.id,
    description: line.description || material.name,
    qty: line.qty,
    unitCostCents: line.unitCostCents ?? material.unitCostCents ?? 0,
  };
}

async function insertLine(
  db: DbOrTx,
  purchaseOrderId: string,
  line: ResolvedLine,
): Promise<string> {
  const id = newId("pol");
  await db.insert(purchaseOrderLines).values({
    id,
    purchaseOrderId,
    materialId: line.materialId,
    description: line.description,
    qty: line.qty,
    unitCostCents: line.unitCostCents,
  });
  return id;
}

const lineText = (line: ResolvedLine) =>
  `${line.qty.toLocaleString("en-NZ")} × ${line.description}`;

export const createPurchaseOrder = defineOp({
  name: "stock.createPurchaseOrder",
  title: "Start a purchase order",
  description:
    "Starts a draft purchase order for a supplier and gives it the next number (PO-0001, PO-0002 and so on). Lines can be given now or added afterwards with stock.addPurchaseLine: each is a material from the list or a description in words, a quantity and a unit cost in cents. A draft is only a note to yourself. Nothing is sent to the supplier and no count changes until it is marked sent and then received.",
  access: "write",
  input: z.object({
    supplierId: z
      .string({ error: "Pick a supplier" })
      .trim()
      .min(1, "Pick a supplier"),
    /** The day it is due, if known. */
    expectedOn: dateKeySchema.optional(),
    notes: longTextSchema.optional(),
    lines: z
      .array(lineInput)
      .max(40, "That is more lines than one order holds")
      .default([]),
  }),
  async run(ctx, input): Promise<{ id: string; number: string }> {
    const [supplier] = await ctx.db
      .select({ name: suppliers.name, active: suppliers.active })
      .from(suppliers)
      .where(eq(suppliers.id, input.supplierId));
    if (supplier === undefined) throw notFound("That supplier");
    if (!supplier.active) {
      throw conflict(
        `${supplier.name} is marked as not in use. Start using them again before ordering from them.`,
      );
    }

    const lines: ResolvedLine[] = [];
    for (const line of input.lines) lines.push(await resolveLine(ctx.db, line));

    const number = await nextPurchaseNumber(ctx.db);
    const id = newId("pur");
    await ctx.db.insert(purchaseOrders).values({
      id,
      number,
      supplierId: input.supplierId,
      status: "draft",
      expectedOn: input.expectedOn ?? null,
      notes: input.notes ?? "",
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    for (const line of lines) await insertLine(ctx.db, id, line);

    await ctx.audit({
      entity: { type: "purchase_order", id },
      summary: `Started ${number} for ${supplier.name}${lines.length === 0 ? "" : `: ${lines.map(lineText).join(", ")}`}`,
      data: { number, supplierId: input.supplierId, lines: lines.length },
    });
    return { id, number };
  },
});

function refuseLineChange(order: PurchaseOrderRow): never {
  throw conflict(
    `${order.number} is ${PURCHASE_STATUS_IS[order.status]}, so what is on it cannot be changed.`,
  );
}

export const addPurchaseLine = defineOp({
  name: "stock.addPurchaseLine",
  title: "Add a line to a purchase order",
  description:
    "Adds one thing to a draft purchase order: a material from the list (its name and usual unit cost are filled in unless given) or a description in words, with a quantity and a unit cost in cents. Only a line tied to a material adds to a count when the order is received. Refused once the order has been sent.",
  access: "write",
  input: z.object({ number: purchaseNumber, line: lineInput }),
  async run(ctx, input): Promise<{ number: string; lineId: string }> {
    const order = await loadPurchase(ctx.db, input.number, { lock: true });
    if (order.status !== "draft") refuseLineChange(order);
    const line = await resolveLine(ctx.db, input.line);
    const lineId = await insertLine(ctx.db, order.id, line);
    await ctx.db
      .update(purchaseOrders)
      .set({ updatedAt: ctx.now })
      .where(eq(purchaseOrders.id, order.id));
    await ctx.audit({
      entity: { type: "purchase_order", id: order.id },
      summary: `Added ${lineText(line)} to ${order.number}`,
      data: { lineId, materialId: line.materialId },
    });
    return { number: order.number, lineId };
  },
});

export const removePurchaseLine = defineOp({
  name: "stock.removePurchaseLine",
  title: "Take a line off a purchase order",
  description:
    "Removes one line from a draft purchase order, by the line's id (from stock.getPurchaseOrder). Refused once the order has been sent.",
  access: "write",
  input: z.object({
    number: purchaseNumber,
    lineId: z.string().trim().min(1),
  }),
  async run(ctx, input): Promise<{ number: string }> {
    const order = await loadPurchase(ctx.db, input.number, { lock: true });
    if (order.status !== "draft") refuseLineChange(order);
    const [line] = await ctx.db
      .select()
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.id, input.lineId),
          eq(purchaseOrderLines.purchaseOrderId, order.id),
        ),
      );
    // Already gone: taking it off twice is not an error.
    if (line === undefined) {
      ctx.nothingChanged();
      return { number: order.number };
    }
    await ctx.db
      .delete(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, line.id));
    await ctx.db
      .update(purchaseOrders)
      .set({ updatedAt: ctx.now })
      .where(eq(purchaseOrders.id, order.id));
    await ctx.audit({
      entity: { type: "purchase_order", id: order.id },
      summary: `Took ${lineText(line)} off ${order.number}`,
    });
    return { number: order.number };
  },
});

export const updatePurchaseOrder = defineOp({
  name: "stock.updatePurchaseOrder",
  title: "Change a purchase order's due date or notes",
  description:
    "Changes the day a purchase order is due, or its notes, while it is a draft or sent (a supplier's date often moves). Give null to clear the due date. It does not change the lines or move the order along.",
  access: "write",
  input: z.object({
    number: purchaseNumber,
    expectedOn: dateKeySchema.nullable().optional(),
    notes: longTextSchema.optional(),
  }),
  async run(ctx, input): Promise<{ number: string }> {
    const order = await loadPurchase(ctx.db, input.number, { lock: true });
    const expectedOn =
      input.expectedOn === undefined ? order.expectedOn : input.expectedOn;
    const notes = input.notes ?? order.notes;
    const changed: string[] = [];
    if (expectedOn !== order.expectedOn) {
      changed.push(
        expectedOn === null
          ? "no due date"
          : `due ${formatDateKey(expectedOn)}`,
      );
    }
    if (notes !== order.notes) changed.push("notes");
    if (changed.length === 0) {
      ctx.nothingChanged();
      return { number: order.number };
    }
    if (order.status !== "draft" && order.status !== "sent") {
      throw conflict(
        `${order.number} is ${PURCHASE_STATUS_IS[order.status]}, so it cannot be changed.`,
      );
    }
    if (
      expectedOn !== null &&
      order.orderedOn !== null &&
      expectedOn < order.orderedOn
    ) {
      throw new OpError(
        "invalid_input",
        "The due date is earlier than the day it was sent.",
        { expectedOn: "Earlier than the day it was sent" },
      );
    }
    await ctx.db
      .update(purchaseOrders)
      .set({ expectedOn, notes, updatedAt: ctx.now })
      .where(eq(purchaseOrders.id, order.id));
    await ctx.audit({
      entity: { type: "purchase_order", id: order.id },
      summary: `Changed ${order.number}: ${changed.join(", ")}`,
      data: { before: order.expectedOn, after: expectedOn },
    });
    return { number: order.number };
  },
});
