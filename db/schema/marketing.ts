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
    /**
     * Whose code it is: the club or creator it was made for. Null: our own.
     * An order placed with it is credited to them, and keeps its own note of
     * that, so moving a code to somebody else never rewrites what came before.
     */
    partnerId: text().references(() => partners.id, { onDelete: "set null" }),
    /** One use for each customer, told apart by email address. */
    oncePerCustomer: boolean().notNull().default(false),
    /**
     * A special: it comes off by itself at the checkout, with nothing to
     * type, and the shop says so on the page while it is on. Everything
     * else about it (what it gives, its dates, its limit, counting a use)
     * is a code's. `code` is then only the word it goes by on an order.
     */
    automatic: boolean().notNull().default(false),
    /**
     * What a special is called where customers can read it: "Launch week".
     * Optional, and checked against the copy rules when it is switched on.
     * What it gives and when it ends are never typed: the shop writes
     * those from the terms, so they cannot be wrong.
     */
    publicName: text().notNull().default(""),
    /**
     * The one code handed to somebody when they join the Pickle Crew. At
     * most one code has this set, and the index below holds that.
     */
    crewWelcome: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("promo_codes_code_key").on(t.code),
    index("promo_codes_partner_idx").on(t.partnerId),
    uniqueIndex("promo_codes_one_crew_welcome")
      .on(t.crewWelcome)
      .where(sql`${t.crewWelcome}`),
  ],
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
    /** Whose link it is, when it was made for a club or creator. */
    partnerId: text().references(() => partners.id, { onDelete: "set null" }),
    /**
     * A code the link carries. Following the link puts the code in the
     * visitor's checkout for them, so nobody has to remember or type it.
     */
    promoCodeId: text().references(() => promoCodes.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("links_slug_key").on(t.slug),
    index("links_partner_idx").on(t.partnerId),
  ],
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
  /**
   * Their cut of each sale they bring in (an order placed with one of their
   * codes, or through one of their links): a whole percentage of what the
   * buyer paid for the goods, after any code's saving and not counting
   * delivery. Zero: none. An order copies it at the moment it is placed.
   */
  commissionPercent: integer().notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

/**
 * What working with a partner has cost: one line for each thing paid or
 * given. With the sales their codes bring in, this is what the return on a
 * partnership is worked out from.
 *
 *   fee         a flat payment: for a post, a reel, a stall, a season
 *   product     product given away, at what it is worth
 *   commission  a payout of the cut their code has earned
 *   other       anything else: postage, printing, a prize
 *
 * A reckoning for the owner, not the books. The books are Xero's.
 */
export const partnerCosts = pgTable(
  "partner_costs",
  {
    id: text().primaryKey(),
    partnerId: text()
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    kind: text().$type<"fee" | "product" | "commission" | "other">().notNull(),
    amountCents: integer().notNull(),
    /** The New Zealand day it was paid or sent. */
    paidOn: date({ mode: "string" }).notNull(),
    note: text().notNull().default(""),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("partner_costs_partner_idx").on(t.partnerId, t.paidOn)],
).enableRLS();
