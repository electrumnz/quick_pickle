/**
 * The shop's own records: customers, orders, what was in them, money given
 * back, and the Pickle Crew list.
 *
 * Money is integer cents, always. An order copies the name and price of what
 * was bought at the moment it was bought, so changing a price tomorrow never
 * rewrites what somebody paid yesterday.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { createdAt, instant, updatedAt } from "./_shared";
import { users } from "./core";

export const customers = pgTable(
  "customers",
  {
    id: text().primaryKey(),
    /** Lower-cased. One customer per address. */
    email: text().notNull(),
    firstName: text().notNull().default(""),
    lastName: text().notNull().default(""),
    phone: text(),
    /** Free words staff add: "club captain", "wholesale lead". */
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Staff notes. Never shown to the customer. */
    notes: text().notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("customers_email_key").on(t.email)],
).enableRLS();

/**
 * Where an order is up to.
 *
 *   pending    placed, payment not confirmed yet
 *   paid       paid (or a test order): waiting to be packed
 *   packed     boxed, waiting for the courier
 *   shipped    with the courier
 *   delivered  the courier says it arrived
 *   cancelled  called off before it shipped
 */
export type OrderStatus =
  "pending" | "paid" | "packed" | "shipped" | "delivered" | "cancelled";

/** `test` means no money moved. */
export type PaymentStatus =
  "test" | "unpaid" | "paid" | "part_refunded" | "refunded" | "failed";

export const orders = pgTable(
  "orders",
  {
    id: text().primaryKey(),
    /** The number the customer sees: QP-7K2M9X. */
    number: text().notNull(),
    customerId: text().references(() => customers.id, {
      onDelete: "set null",
    }),
    status: text().$type<OrderStatus>().notNull().default("pending"),
    mode: text().$type<"preorder" | "live">().notNull(),
    /** A test order is real in every way except that nobody paid. */
    isTest: boolean().notNull().default(false),
    placedAt: instant("placed_at").notNull().defaultNow(),

    email: text().notNull(),
    phone: text(),
    firstName: text().notNull(),
    lastName: text().notNull(),

    line1: text().notNull(),
    line2: text(),
    suburb: text(),
    city: text().notNull(),
    region: text().notNull(),
    postcode: text().notNull(),
    country: text().notNull().default("NZ"),
    rural: boolean().notNull().default(false),
    deliveryNotes: text(),

    subtotalCents: integer().notNull(),
    shippingCents: integer().notNull(),
    discountCents: integer().notNull().default(0),
    totalCents: integer().notNull(),
    refundedCents: integer().notNull().default(0),
    currency: text().notNull().default("NZD"),
    promoCode: text(),

    paymentProvider: text().notNull(),
    paymentStatus: text().$type<PaymentStatus>().notNull(),
    /** The processor's own id for the payment. */
    paymentReference: text(),
    paidAt: instant("paid_at"),

    packedAt: instant("packed_at"),
    shippedAt: instant("shipped_at"),
    deliveredAt: instant("delivered_at"),
    cancelledAt: instant("cancelled_at"),
    cancelReason: text(),
    carrier: text(),
    trackingNumber: text(),
    trackingUrl: text(),

    /** Ticked "add me to the Pickle Crew" at the checkout. */
    joinedCrew: boolean().notNull().default(false),
    /** Where the visit came from, when the page was told (utm_source etc). */
    source: jsonb().$type<Record<string, string>>(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_number_key").on(t.number),
    index("orders_status_idx").on(t.status, t.placedAt),
    index("orders_customer_idx").on(t.customerId, t.placedAt),
    index("orders_email_idx").on(t.email),
    index("orders_payment_ref_idx").on(t.paymentReference),
  ],
).enableRLS();

export const orderLines = pgTable(
  "order_lines",
  {
    id: text().primaryKey(),
    orderId: text()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    sku: text().notNull(),
    /** As it read on the day. */
    name: text().notNull(),
    /** Shots in one pack of this line. */
    shots: integer().notNull(),
    qty: integer().notNull(),
    unitCents: integer().notNull(),
    lineCents: integer().notNull(),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId)],
).enableRLS();

export const refunds = pgTable(
  "refunds",
  {
    id: text().primaryKey(),
    orderId: text()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    amountCents: integer().notNull(),
    reason: text().notNull(),
    /** pending: asked for. done: the processor confirmed. failed: it refused. */
    status: text().$type<"pending" | "done" | "failed">().notNull(),
    providerReference: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("refunds_order_idx").on(t.orderId)],
).enableRLS();

/**
 * The Pickle Crew: people who asked for our emails.
 *
 * The Unsolicited Electronic Messages Act 2007 puts the burden on the sender
 * to prove consent, so each row keeps how and when it was given and the exact
 * words the person agreed to. Unsubscribing is honoured at once and the row
 * is kept (as unsubscribed), so the address is never emailed again by mistake.
 */
export const crewMembers = pgTable(
  "crew_members",
  {
    id: text().primaryKey(),
    email: text().notNull(),
    status: text()
      .$type<"subscribed" | "unsubscribed" | "bounced" | "complained">()
      .notNull()
      .default("subscribed"),
    source: text()
      .$type<"crew-form" | "checkout" | "manual" | "import">()
      .notNull(),
    /** The sentence beside the box or button they pressed. */
    consentText: text().notNull(),
    consentAt: instant("consent_at").notNull().defaultNow(),
    unsubscribedAt: instant("unsubscribed_at"),
    /** Goes in every email's unsubscribe link. Random, not guessable. */
    unsubscribeToken: text().notNull(),
    customerId: text().references(() => customers.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("crew_email_key").on(t.email),
    uniqueIndex("crew_unsub_token_key").on(t.unsubscribeToken),
  ],
).enableRLS();
