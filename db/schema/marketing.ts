/**
 * Telling people: campaigns to the Pickle Crew, promo codes, the social
 * planner, tracked links, reviews, and the clubs and stockists we deal with.
 *
 * Every word here that a customer will read goes through the copy scanner
 * (legal/COPY-RULES.md) before it can be approved, the same as the site's.
 */

import { sql } from "drizzle-orm";
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
import { customers, orders } from "./commerce";
import { users } from "./core";

/** What the scanner made of a piece of copy when it was last saved. */
export type CopyCheck = {
  readonly at: string;
  readonly ok: boolean;
  readonly findings: readonly {
    readonly rule: string;
    readonly severity: "banned" | "restricted";
    readonly match: string;
    readonly why: string;
  }[];
};

export type CampaignStatus =
  | "draft"
  | "approved" // a person has said it can go
  | "sending"
  | "sent"
  | "cancelled";

/** An email to the Pickle Crew. Marketing: consent and unsubscribe apply. */
export const campaigns = pgTable("campaigns", {
  id: text().primaryKey(),
  name: text().notNull(),
  subject: text().notNull().default(""),
  /** The line shown after the subject in an inbox. */
  preheader: text().notNull().default(""),
  /** Markdown. */
  body: text().notNull().default(""),
  status: text().$type<CampaignStatus>().notNull().default("draft"),
  /** Who gets it: everyone subscribed, or only those who have or have not ordered. */
  audience: text()
    .$type<"crew" | "crew-buyers" | "crew-not-yet-buyers">()
    .notNull()
    .default("crew"),
  copyCheck: jsonb().$type<CopyCheck>(),
  approvedBy: text().references(() => users.id, { onDelete: "set null" }),
  approvedAt: instant("approved_at"),
  sendAt: instant("send_at"),
  sentAt: instant("sent_at"),
  createdBy: text().references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

/** One row per person per campaign: who was sent what, and how it went. */
export const campaignSends = pgTable(
  "campaign_sends",
  {
    id: text().primaryKey(),
    campaignId: text()
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    email: text().notNull(),
    status: text()
      .$type<"queued" | "sent" | "failed" | "bounced" | "complained">()
      .notNull()
      .default("queued"),
    providerId: text(),
    sentAt: instant("sent_at"),
    error: text(),
  },
  (t) => [
    uniqueIndex("campaign_sends_key").on(t.campaignId, t.email),
    index("campaign_sends_provider_idx").on(t.providerId),
  ],
).enableRLS();

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: text().primaryKey(),
    /** Upper-cased. What the customer types. */
    code: text().notNull(),
    /** percent: `value` is whole percent. amount: cents off. delivery: free standard delivery. */
    kind: text().$type<"percent" | "amount" | "delivery">().notNull(),
    value: integer().notNull().default(0),
    minSubtotalCents: integer().notNull().default(0),
    startsAt: instant("starts_at"),
    endsAt: instant("ends_at"),
    /** Null: no limit. */
    maxUses: integer(),
    uses: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    note: text().notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("promo_codes_code_key").on(t.code)],
).enableRLS();

export type SocialStatus = "idea" | "draft" | "approved" | "posted" | "dropped";

/** One planned post or reel. Posting itself is done by hand, then marked. */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: text().primaryKey(),
    network: text()
      .$type<"instagram" | "tiktok" | "facebook" | "other">()
      .notNull()
      .default("instagram"),
    format: text().$type<"post" | "reel" | "story">().notNull().default("post"),
    /** A working title for the planner. Never published. */
    title: text().notNull(),
    caption: text().notNull().default(""),
    status: text().$type<SocialStatus>().notNull().default("idea"),
    /** When it is meant to go out. */
    plannedFor: instant("planned_for"),
    postedAt: instant("posted_at"),
    /** Where it lives once posted. */
    postUrl: text(),
    /** Files from the library that go with it. */
    fileIds: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text().notNull().default(""),
    copyCheck: jsonb().$type<CopyCheck>(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("social_posts_plan_idx").on(t.plannedFor)],
).enableRLS();

/**
 * A short link of ours (/go/<slug>) that counts how often it is followed and
 * says where the visitor came from. For a bio, a post, a flyer's QR code.
 */
export const links = pgTable(
  "links",
  {
    id: text().primaryKey(),
    slug: text().notNull(),
    /** Where it goes. A path on this site, or a full web address. */
    target: text().notNull(),
    label: text().notNull().default(""),
    /** utm_source, utm_medium, utm_campaign added on the way through. */
    utm: jsonb().$type<Record<string, string>>().notNull().default({}),
    /** Shown on the public link page (/links), in this order. Null: hidden. */
    showOrder: integer(),
    clicks: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("links_slug_key").on(t.slug)],
).enableRLS();

export const reviews = pgTable(
  "reviews",
  {
    id: text().primaryKey(),
    orderId: text().references(() => orders.id, { onDelete: "set null" }),
    customerId: text().references(() => customers.id, { onDelete: "set null" }),
    /** One to five. */
    rating: integer().notNull(),
    body: text().notNull().default(""),
    /** How they asked to be named: "Sam, Ōtaki". */
    displayName: text().notNull().default(""),
    /**
     * pending: waiting to be read. published: on the site. rejected: not
     * shown. A review that says what the product did to someone's body cannot
     * be published, however kind: publishing it would make it our claim.
     */
    status: text()
      .$type<"pending" | "published" | "rejected">()
      .notNull()
      .default("pending"),
    rejectedReason: text(),
    copyCheck: jsonb().$type<CopyCheck>(),
    createdAt: createdAt(),
    decidedAt: instant("decided_at"),
    decidedBy: text().references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("reviews_status_idx").on(t.status, t.createdAt)],
).enableRLS();

/** Clubs, stockists, events, ambassadors, press: anyone we deal with as a group. */
export const partners = pgTable("partners", {
  id: text().primaryKey(),
  name: text().notNull(),
  kind: text()
    .$type<"club" | "stockist" | "event" | "ambassador" | "press" | "other">()
    .notNull()
    .default("club"),
  /** lead: not yet spoken to. talking. active: doing something together. paused. no. */
  status: text()
    .$type<"lead" | "talking" | "active" | "paused" | "no">()
    .notNull()
    .default("lead"),
  contactName: text().notNull().default(""),
  email: text(),
  phone: text(),
  region: text(),
  /**
   * Have they agreed, in writing, to being named in public? Nobody is named
   * on the site or in a post without it.
   */
  permissionOnFile: boolean().notNull().default(false),
  permissionNote: text().notNull().default(""),
  nextStep: text().notNull().default(""),
  nextStepOn: date({ mode: "string" }),
  notes: text().notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
