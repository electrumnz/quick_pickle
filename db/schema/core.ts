/**
 * The spine of the back end: who can sign in, what was done and by whom, what
 * happened that something else might react to, and the settings.
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

/** owner: everything. staff: runs the shop. viewer: looks, changes nothing. */
export type Role = "owner" | "staff" | "viewer";

/**
 * Staff. People, and bots that sign in as themselves (a bot never borrows a
 * person's account, so the activity log always says who really did a thing).
 */
export const users = pgTable(
  "users",
  {
    id: text().primaryKey(),
    /** Lower-cased on the way in. */
    email: text().notNull(),
    name: text().notNull(),
    role: text().$type<Role>().notNull().default("staff"),
    kind: text().$type<"person" | "bot">().notNull().default("person"),
    /** argon2id, PHC format. Null until the person sets one. */
    passwordHash: text(),
    disabledAt: instant("disabled_at"),
    lastSeenAt: instant("last_seen_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
).enableRLS();

/** A signed-in browser. The cookie holds a token; this holds only its hash. */
export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the cookie token, hex. A database dump signs nobody in. */
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: instant("last_seen_at").notNull().defaultNow(),
    expiresAt: instant("expires_at").notNull(),
    revokedAt: instant("revoked_at"),
    ip: text(),
    userAgent: text(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
).enableRLS();

/**
 * One-time links: set your password (an invitation) or reset it. The link
 * carries a token; this holds only its hash, and it works once.
 */
export const userTokens = pgTable(
  "user_tokens",
  {
    /** SHA-256 of the token in the link, hex. */
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text().$type<"set-password">().notNull(),
    expiresAt: instant("expires_at").notNull(),
    usedAt: instant("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("user_tokens_user_idx").on(t.userId)],
).enableRLS();

/** Failed sign-ins, per email and per address, so guessing gets slow. */
export const authThrottle = pgTable("auth_throttle", {
  /** "email:someone@example.co.nz" or "ip:203.0.113.9". */
  key: text().primaryKey(),
  failures: integer().notNull().default(0),
  windowStartedAt: instant("window_started_at").notNull().defaultNow(),
  lockedUntil: instant("locked_until"),
  lockCount: integer().notNull().default(0),
}).enableRLS();

export type ActorType = "human" | "bot" | "system";
export type Via =
  "ui" | "mcp" | "automation" | "cron" | "webhook" | "storefront" | "script";

/**
 * The activity log. Every change made through the back end leaves one line
 * here: who, how, what, and enough detail to see what changed. It is appended
 * to and never edited.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text().primaryKey(),
    at: instant("at").notNull().defaultNow(),
    actorType: text().$type<ActorType>().notNull(),
    /** Null for the system (an automation, a webhook, the storefront). */
    actorId: text().references(() => users.id, { onDelete: "set null" }),
    /** The name as it was at the time, so the line reads right for ever. */
    actorName: text().notNull(),
    via: text().$type<Via>().notNull(),
    /** The operation that ran, e.g. "orders.markShipped". */
    operation: text().notNull(),
    entityType: text(),
    entityId: text(),
    /** One plain sentence: "Marked QP-7K2M9X as shipped". */
    summary: text().notNull(),
    /** What went in and what changed. Never a password, token or card. */
    data: jsonb().$type<Record<string, unknown>>(),
    requestId: text(),
  },
  (t) => [
    index("audit_at_idx").on(t.at),
    index("audit_entity_idx").on(t.entityType, t.entityId, t.at),
    index("audit_actor_idx").on(t.actorId, t.at),
  ],
).enableRLS();

/**
 * Things that happened, written in the same transaction as the change that
 * caused them, for automations to react to afterwards. This is the outbox:
 * nothing is sent, charged or published from inside a database transaction.
 */
export const events = pgTable(
  "events",
  {
    id: text().primaryKey(),
    at: instant("at").notNull().defaultNow(),
    /** e.g. "order.paid", "mail.received", "stock.low". */
    type: text().notNull(),
    entityType: text(),
    entityId: text(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Set once every automation that cares has run (or been skipped). */
    processedAt: instant("processed_at"),
    attempts: integer().notNull().default(0),
    lastError: text(),
    /**
     * Not to be picked up before this. While something is working on the
     * event it is a short lease, so two workers do not both take it; after a
     * failure it is the wait before the next try.
     */
    notBefore: instant("not_before"),
  },
  (t) => [
    index("events_pending_idx")
      .on(t.at)
      .where(sql`${t.processedAt} is null`),
    index("events_type_idx").on(t.type, t.at),
  ],
).enableRLS();

/** One row per setting. Values are JSON so a setting can be a list or a shape. */
export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updatedAt: updatedAt(),
  updatedBy: text().references(() => users.id, { onDelete: "set null" }),
}).enableRLS();

/** Marks rows the demo seed put in, so they can be told from real ones. */
export const demoMarker = pgTable("demo_marker", {
  id: integer().primaryKey().default(1),
  seededAt: instant("seeded_at").notNull().defaultNow(),
  isDemo: boolean().notNull().default(true),
}).enableRLS();
