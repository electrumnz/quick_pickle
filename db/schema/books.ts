import { pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, instant, updatedAt } from "./_shared";
import { orders, refunds } from "./commerce";

/**
 * The link to the owner's Xero organisation, while there is one. One row,
 * id "xero" (lib/backstage/books/xero.ts).
 *
 * The two keys Xero hands over are kept sealed (lib/xero/seal.ts) with a key
 * made from the Xero app's own secret, which lives on the host and not here:
 * a copy of the database alone opens nothing.
 */
export const xeroLink = pgTable("xero_link", {
  id: text().primaryKey(),
  /** The organisation the books go to, once one is chosen. */
  tenantId: text(),
  tenantName: text(),
  /** Every organisation the owner let in, when there was more than one. */
  tenants: text().notNull().default("[]"),
  accessToken: text().notNull(),
  refreshToken: text().notNull(),
  accessExpiresAt: instant("access_expires_at").notNull(),
  connectedByName: text().notNull(),
  connectedAt: instant("connected_at").notNull(),
  /** Xero stopped taking the keys: somebody has to connect it again. */
  lostAt: instant("lost_at"),
  lostReason: text(),
  /** Where sales and delivery go, by the account's code in Xero. */
  salesAccount: text(),
  deliveryAccount: text(),
  /** The bank account in Xero that payments and refunds go through. */
  bankAccountId: text(),
  bankAccountName: text(),
  /** Xero's tax type for a sale with GST in it ("OUTPUT2"), when registered. */
  taxType: text(),
  /** The one contact every sale is to: no customer's details go to Xero. */
  contactName: text(),
  /** The first New Zealand day whose sales go: "2026-12-01". */
  startDay: text(),
  /** The last round, for the screen: when, and anything worth saying. */
  lastRoundAt: instant("last_round_at"),
  lastRoundSaid: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

/**
 * What has gone to Xero: one row for each sale and each refund, once it is
 * there or a person needs to look at it. `key` is "sale:<order id>" or
 * "refund:<refund id>".
 *
 *   sent     it is in Xero, paid (a sale) or paid out (a refund)
 *   failed   Xero would not take it (`trouble` says why)
 *   skipped  not for Xero, and why (a refund on a sale that never went)
 */
export type PostingState = "sent" | "failed" | "skipped";

export const xeroPostings = pgTable("xero_postings", {
  key: text().primaryKey(),
  kind: text().$type<"sale" | "refund">().notNull(),
  orderId: text()
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  refundId: text().references(() => refunds.id, { onDelete: "cascade" }),
  state: text().$type<PostingState>().notNull(),
  /** The invoice's or credit note's id in Xero. */
  xeroId: text(),
  /** The payment's id in Xero. */
  paymentId: text(),
  trouble: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
