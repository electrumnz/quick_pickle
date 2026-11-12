/**
 * Our own numbers, with no cookies and nobody identified.
 *
 * The shop sends four kinds of event: a page was viewed, something went in
 * the jar, the checkout was opened, an order was placed. Each carries a
 * random id made fresh for that visit and kept only in the page's memory, so
 * the steps of one visit can be counted as a funnel without knowing who it
 * was or recognising them tomorrow. No address, no device fingerprint.
 */

import { bigserial, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { instant } from "./_shared";

export const pageEvents = pgTable(
  "page_events",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    at: instant("at").notNull().defaultNow(),
    kind: text().$type<"view" | "add" | "checkout" | "order">().notNull(),
    path: text().notNull().default("/"),
    /** Random, per visit, never stored on the visitor's device. */
    visit: text().notNull(),
    /** utm_source and friends, when the link carried them. */
    source: jsonb().$type<Record<string, string>>().notNull().default({}),
    /** The site they came from, host only. */
    referrer: text(),
    device: text().$type<"phone" | "desk">(),
  },
  (t) => [
    index("page_events_at_idx").on(t.at),
    index("page_events_visit_idx").on(t.visit),
  ],
).enableRLS();
