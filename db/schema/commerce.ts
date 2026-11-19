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

/**
 * `test` means no money moved. `review` means money arrived that does not
 * match the order (the wrong amount or currency): a person has to look.
 */
export type PaymentStatus =
  | "test"
  | "unpaid"
  | "paid"
  | "part_refunded"
  | "refunded"
  | "failed"
  | "review";

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
    /** What a promo code took off the goods. */
    discountCents: integer().notNull().default(0),
    /** What a promo code took off delivery. `shippingCents` is after it. */
    deliveryDiscountCents: integer().notNull().default(0),
    totalCents: integer().notNull(),
    refundedCents: integer().notNull().default(0),
    currency: text().notNull().default("NZD"),
    promoCode: text(),
    /**
     * Who brought the order in: the partner whose code was used or, failing
     * that, whose link the buyer came through. With it, the cut that partner
     * was on at that moment. Both are copied when the order is placed and a
     * partner's results are added up from them, so changing a deal or moving
     * a code later never rewrites the past.
     * (A partner's id, with no foreign key: this file cannot see that table.)
     */
    partnerId: text(),
    commissionPercent: integer().notNull().default(0),

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
    index("orders_promo_idx").on(t.promoCode),
    index("orders_partner_idx").on(t.partnerId),
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
    /** As it read on the day: the pack and the flavour. */
    name: text().notNull(),
    /**
     * The flavour's key (content/offer.ts), kept so that packing takes the
     * shots from a batch of the same flavour. Every order from before there
     * were two flavours was the first.
     */
    flavour: text().notNull().default("original"),
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
    /**
     * pending: asked for. done: the processor confirmed. failed: it refused,
     * and nothing left. returned: it left, and then came back because it
     * could not reach the customer (a closed card, say). A returned refund
     * is two movements of money, on two days: out on `createdAt` and back on
     * `returnedAt`. The customer has not had it.
     */
    status: text()
      .$type<"pending" | "done" | "failed" | "returned">()
      .notNull(),
    providerReference: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    /** When a refund that had left came back. Null unless it is `returned`. */
    returnedAt: instant("returned_at"),
  },
  (t) => [index("refunds_order_idx").on(t.orderId)],
).enableRLS();

/**
 * A card dispute: the cardholder has asked their bank for the money back.
 * The bank takes it at once, and the shop has until `dueAt` to answer. Win
 * and the money returns; lose, or say nothing, and it is gone.
 *
 * Written only from the payment processor's own record, never by hand: the
 * answering is done in the processor's dashboard, and this is the back end
 * knowing that it has to be.
 */
export const disputes = pgTable(
  "payment_disputes",
  {
    id: text().primaryKey(),
    orderId: text()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** The processor's own id for the dispute: dp_... */
    providerReference: text().notNull(),
    amountCents: integer().notNull(),
    /** The bank's reason, in the processor's word: product_not_received. */
    reason: text().notNull(),
    /** open: not decided yet. won: the money stays. lost: it went back. */
    status: text().$type<"open" | "won" | "lost">().notNull(),
    /** The processor's own word for where it is up to: needs_response. */
    providerStatus: text().notNull(),
    /** When an answer is due by, while one still is. */
    dueAt: instant("due_at"),
    openedAt: instant("opened_at").notNull(),
    closedAt: instant("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payment_disputes_reference_key").on(t.providerReference),
    index("payment_disputes_order_idx").on(t.orderId),
    index("payment_disputes_status_idx").on(t.status),
  ],
).enableRLS();

/**
 * Where an order stands with the courier's booking system (Starshipit), when
 * one is connected. One row an order, made when it is first handed over.
 *
 *   trying     handed over and no clear answer back yet
 *   sent       Starshipit has it, waiting for a label
 *   failed     Starshipit would not take it (`trouble` says why)
 *   shipped    a label was printed there and the order is shipped here
 *   withdrawn  taken back out (unpacked, cancelled, shipped another way)
 *   stranded   it is there and should not be, and could not be taken back
 */
export type HandoffState =
  "trying" | "sent" | "failed" | "shipped" | "withdrawn" | "stranded";

export const courierHandoffs = pgTable(
  "courier_handoffs",
  {
    orderId: text()
      .primaryKey()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Whose system: "starshipit". */
    provider: text().notNull(),
    state: text().$type<HandoffState>().notNull(),
    /** The provider's own id for the order, once it has given one. */
    reference: text(),
    /** Hand-overs that got no clear answer. Looked up before the next. */
    tries: integer().notNull().default(0),
    /** A sentence for a person, while one is needed. */
    trouble: text(),
    sentAt: instant("sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("courier_handoffs_state_idx").on(t.state)],
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
