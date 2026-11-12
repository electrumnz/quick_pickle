/**
 * What there is to sell, where it came from, and what it is made with.
 *
 * Stock is counted in shots, by batch. Nothing is ever edited to change a
 * count: every change is a movement (made, sold, wasted, given away as a
 * sample, corrected), and what is on hand is the sum. That is what makes a
 * recall answerable: "which orders had shots from batch B002" is one query.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { createdAt, instant, updatedAt } from "./_shared";
import { orders } from "./commerce";
import { users } from "./core";

/**
 *   planned   on the calendar, not made yet
 *   made      made, not yet cleared to sell
 *   released  cleared: orders can be filled from it
 *   closed    all gone, or written off
 *   recalled  pulled back. Never sold from again.
 */
export type BatchStatus =
  "planned" | "made" | "released" | "closed" | "recalled";

export const batches = pgTable(
  "batches",
  {
    id: text().primaryKey(),
    /** What is printed on the bottle: "B001". */
    code: text().notNull(),
    name: text().notNull(),
    status: text().$type<BatchStatus>().notNull().default("planned"),
    /** New Zealand calendar dates. */
    madeOn: date({ mode: "string" }),
    bestBefore: date({ mode: "string" }),
    /** How many shots the batch was planned or counted at. */
    shotsPlanned: integer(),
    /** Everything the batch cost to make, if known. */
    costCents: integer(),
    /**
     * The production record, as the maker fills it in: who made it, the
     * checks taken, the lot numbers of what went in. Free-form on purpose;
     * what has to be recorded is set by the food control plan, not by code.
     */
    record: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    notes: text().notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("batches_code_key").on(t.code)],
).enableRLS();

export type MovementKind =
  | "made" // into stock from production
  | "sold" // out, on an order
  | "returned" // back in from an order
  | "sample" // out, given away
  | "waste" // out, damaged or expired
  | "adjust"; // a correction after a count, either way

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: text().primaryKey(),
    at: instant("at").notNull().defaultNow(),
    batchId: text()
      .notNull()
      .references(() => batches.id, { onDelete: "restrict" }),
    kind: text().$type<MovementKind>().notNull(),
    /** Positive in, negative out. */
    shots: integer().notNull(),
    orderId: text().references(() => orders.id, { onDelete: "set null" }),
    note: text().notNull().default(""),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("stock_batch_idx").on(t.batchId, t.at),
    index("stock_order_idx").on(t.orderId),
  ],
).enableRLS();

export const suppliers = pgTable("suppliers", {
  id: text().primaryKey(),
  name: text().notNull(),
  /** What they supply, in a few words: "bottles and caps". */
  supplies: text().notNull().default(""),
  contactName: text().notNull().default(""),
  email: text(),
  phone: text(),
  website: text(),
  /** Working days from order to delivery, if known. */
  leadTimeDays: integer(),
  notes: text().notNull().default(""),
  active: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

/** Things bought in to make and send the product: bottles, caps, labels, cartons. */
export const materials = pgTable("materials", {
  id: text().primaryKey(),
  name: text().notNull(),
  /** How it is counted: "each", "roll", "litre". */
  unit: text().notNull().default("each"),
  supplierId: text().references(() => suppliers.id, { onDelete: "set null" }),
  onHand: integer().notNull().default(0),
  /** Reorder when on hand falls to this. Null: no alert. */
  reorderAt: integer(),
  /** What one unit costs, if known. */
  unitCostCents: integer(),
  notes: text().notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

export type PurchaseStatus = "draft" | "sent" | "received" | "cancelled";

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: text().primaryKey(),
    /** "PO-0001". */
    number: text().notNull(),
    supplierId: text()
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    status: text().$type<PurchaseStatus>().notNull().default("draft"),
    orderedOn: date({ mode: "string" }),
    expectedOn: date({ mode: "string" }),
    receivedOn: date({ mode: "string" }),
    notes: text().notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("purchase_orders_number_key").on(t.number)],
).enableRLS();

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: text().primaryKey(),
    purchaseOrderId: text()
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    materialId: text().references(() => materials.id, { onDelete: "set null" }),
    description: text().notNull(),
    qty: integer().notNull(),
    unitCostCents: integer().notNull().default(0),
  },
  (t) => [index("po_lines_po_idx").on(t.purchaseOrderId)],
).enableRLS();
