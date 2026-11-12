/**
 * The thinking: plans, how-to sheets, the budget's inputs, the compliance
 * register, the open questions and the to-do list.
 */

import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { createdAt, instant, updatedAt } from "./_shared";
import { users } from "./core";

export type DocumentKind =
  | "plan" // business plan, marketing plan
  | "how-to" // a procedure: production day, packing, a complaint, a recall
  | "policy"
  | "note";

/** A written document, in Markdown, with its history kept. */
export const documents = pgTable(
  "documents",
  {
    id: text().primaryKey(),
    slug: text().notNull(),
    title: text().notNull(),
    kind: text().$type<DocumentKind>().notNull().default("note"),
    /** One line on what it is for, shown in the list. */
    summary: text().notNull().default(""),
    body: text().notNull().default(""),
    /** Lower first. */
    sort: integer().notNull().default(100),
    updatedBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("documents_slug_key").on(t.slug)],
).enableRLS();

/** Every saved version of a document, so nothing written is ever lost. */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: text().primaryKey(),
    documentId: text()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    title: text().notNull(),
    body: text().notNull(),
    /** What changed, in the writer's words. */
    note: text().notNull().default(""),
    savedBy: text().references(() => users.id, { onDelete: "set null" }),
    savedByName: text().notNull().default(""),
    savedAt: instant("saved_at").notNull().defaultNow(),
  },
  (t) => [index("document_versions_doc_idx").on(t.documentId, t.savedAt)],
).enableRLS();

/**
 * Something only a person can decide or supply, and what waits on it.
 * Seeded from the site's own stand-ins and from the brand pack's questions
 * for Ashleigh, merged into one list.
 */
export const questions = pgTable(
  "questions",
  {
    id: text().primaryKey(),
    /** A grouping: "Product facts", "Legal and claims". */
    topic: text().notNull(),
    question: text().notNull(),
    /** Why it matters and what it unblocks. */
    why: text().notNull().default(""),
    /** Who can answer it. */
    askOf: text().notNull().default("Ashleigh"),
    status: text()
      .$type<"open" | "answered" | "parked">()
      .notNull()
      .default("open"),
    answer: text().notNull().default(""),
    answeredAt: instant("answered_at"),
    answeredBy: text().references(() => users.id, { onDelete: "set null" }),
    /** Where it came from: "site", "brand pack Q7". */
    source: text().notNull().default(""),
    /** True when the site cannot launch until it is answered. */
    blocksLaunch: boolean().notNull().default(false),
    sort: integer().notNull().default(100),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("questions_status_idx").on(t.status, t.sort)],
).enableRLS();

/** A thing to do. Anyone's, with or without a date. */
export const tasks = pgTable(
  "tasks",
  {
    id: text().primaryKey(),
    title: text().notNull(),
    notes: text().notNull().default(""),
    status: text().$type<"todo" | "doing" | "done">().notNull().default("todo"),
    /** A New Zealand calendar date. */
    dueOn: date({ mode: "string" }),
    assigneeId: text().references(() => users.id, { onDelete: "set null" }),
    /** Which part of the business: "orders", "production", "marketing". */
    area: text().notNull().default(""),
    /** What it is about, if anything: an order, a batch. */
    entityType: text(),
    entityId: text(),
    doneAt: instant("done_at"),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_open_idx").on(t.status, t.dueOn)],
).enableRLS();

/**
 * The compliance register: what a small New Zealand food business selling
 * online has to have in place, and whether it is. The list is a prompt, not
 * legal advice; each line says where the rule comes from so it can be checked.
 */
export const complianceItems = pgTable("compliance_items", {
  id: text().primaryKey(),
  area: text()
    .$type<
      "food" | "label" | "selling" | "privacy" | "email" | "company" | "tax"
    >()
    .notNull(),
  title: text().notNull(),
  /** What is needed, in plain words. */
  detail: text().notNull().default(""),
  /** The act, standard or regulator it comes from. */
  basis: text().notNull().default(""),
  status: text()
    .$type<"to-do" | "in-place" | "not-needed" | "check">()
    .notNull()
    .default("to-do"),
  /** What shows it is in place: a registration number, a file, a date. */
  evidence: text().notNull().default(""),
  /** When to look at it again. */
  reviewOn: date({ mode: "string" }),
  sort: integer().notNull().default(100),
  updatedBy: text().references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

/**
 * What things cost, for the budget. One line per cost: the juice in a shot,
 * a bottle, a label, a carton, a courier bag, the card fee, a month of
 * hosting. Every amount starts as a stand-in and says so until someone
 * confirms it from a real quote or invoice.
 */
export const costItems = pgTable("cost_items", {
  id: text().primaryKey(),
  name: text().notNull(),
  /**
   * What the amount is per:
   *   shot    each bottle
   *   pack    each pack sold (its box, its insert)
   *   order   each order sent (the courier bag, the label)
   *   month   a fixed monthly cost
   *   sale    a share of the sale price, in hundredths of a percent
   */
  basis: text().$type<"shot" | "pack" | "order" | "month" | "sale">().notNull(),
  /** Cents, or hundredths of a percent when the basis is `sale`. */
  amount: integer().notNull().default(0),
  /** False until it comes from a real quote or invoice. */
  confirmed: boolean().notNull().default(false),
  notes: text().notNull().default(""),
  sort: integer().notNull().default(100),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
