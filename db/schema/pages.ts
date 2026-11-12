/**
 * Landing pages: the one page, with different words at the top.
 *
 * A landing page is for one audience or one advert: a club, a creator's
 * followers, a flyer. It has its own address (/for/<slug>) and its own
 * numbers, and the same shop underneath. With none made, everybody sees the
 * standard page.
 *
 * The words a customer reads are typed in the back end, so they are held to
 * the same copy rules as the site itself (legal/COPY-RULES.md) and cannot be
 * published until they pass. A page keeps two sets: the draft being worked
 * on, and what is published. Changing the draft never changes what the
 * public sees; publishing does.
 */

import {
  boolean,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { createdAt, instant, updatedAt } from "./_shared";
import { users } from "./core";
import type { CopyCheck } from "./marketing";

/** The words a landing page changes. Everything else is the shop's own. */
export type PageWords = {
  /** The chip over the headline: "For clubs". */
  readonly eyebrow: string;
  /** The headline, one line of it to a line. */
  readonly headline: string;
  /** The one sentence under it. */
  readonly lead: string;
};

export const pages = pgTable(
  "pages",
  {
    id: text().primaryKey(),
    /** Its address: /for/<slug>. For ever, like a short link's. */
    slug: text().notNull(),
    /** What staff call it. Never shown to a customer. */
    name: text().notNull(),
    /** Who it is for and why. Staff only. */
    note: text().notNull().default(""),
    /** The words being worked on. */
    draft: jsonb().$type<PageWords>().notNull(),
    /** The words the public sees. Null: never published. */
    published: jsonb().$type<PageWords>(),
    publishedAt: instant("published_at"),
    publishedBy: text().references(() => users.id, { onDelete: "set null" }),
    /** Switched on: anyone with the address sees what was published. */
    live: boolean().notNull().default(false),
    /** What the copy check made of the draft when it was last saved. */
    copyCheck: jsonb().$type<CopyCheck>(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pages_slug_key").on(t.slug)],
).enableRLS();
