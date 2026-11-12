/**
 * Letting Claude in: the apps that have asked, the one-time codes they are
 * handed on the way back from the consent screen, and the connections that
 * came of it.
 *
 * Nothing here holds a secret. A code, an access token and a refresh token
 * are each kept as a SHA-256 hash, the way a session is, so a copy of the
 * database lets nobody in.
 */

import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, instant } from "./_shared";
import { users } from "./core";

/** What a connection may do. Never more than staff: a bot is not an owner. */
export type ConnectionRole = "viewer" | "staff";

/**
 * An app that has registered so it can ask for a connection (OAuth dynamic
 * client registration). Registering proves nothing and lets nothing in: it
 * only writes down where the app may be sent back to, and that is checked
 * against a short list before it is kept.
 */
export const oauthClients = pgTable("oauth_clients", {
  /** The client id: random, handed out when the app registers. */
  id: text().primaryKey(),
  /** What the app calls itself. A claim: shown to a person, never trusted. */
  name: text().notNull(),
  redirectUris: jsonb().$type<readonly string[]>().notNull(),
  createdAt: createdAt(),
  /** When a person last said yes to it. Never: it is cleared away. */
  lastUsedAt: instant("last_used_at"),
}).enableRLS();

/**
 * A code on its way back to the app after a person said yes. It works once,
 * for a minute, and only with the secret the app kept back (PKCE).
 */
export const oauthCodes = pgTable(
  "oauth_codes",
  {
    /** SHA-256 of the code, hex. */
    id: text().primaryKey(),
    clientId: text()
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    /** The person who said yes. */
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text().$type<ConnectionRole>().notNull(),
    redirectUri: text().notNull(),
    /** The S256 challenge the app sent. Its verifier comes with the code. */
    codeChallenge: text().notNull(),
    /** The address the tokens will be good for: this back end's own. */
    resource: text().notNull(),
    expiresAt: instant("expires_at").notNull(),
    usedAt: instant("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("oauth_codes_expires_idx").on(t.expiresAt)],
).enableRLS();

/**
 * A connection: one person's Claude, let in. What it does is written in the
 * activity log under a bot account of its own, named for the person.
 */
export const connections = pgTable(
  "connections",
  {
    id: text().primaryKey(),
    /** The person it works for, and who can cut it off. */
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The bot account its work is written under. */
    botUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text().references(() => oauthClients.id, {
      onDelete: "set null",
    }),
    /** What the app called itself when it was connected. */
    clientName: text().notNull(),
    role: text().$type<ConnectionRole>().notNull(),
    /** The address its tokens are good for. Checked on every request. */
    resource: text().notNull(),
    /** SHA-256 of the access token, hex. */
    accessHash: text().notNull(),
    accessExpiresAt: instant("access_expires_at").notNull(),
    /** SHA-256 of the refresh token, hex. Changes each time it is used. */
    refreshHash: text().notNull(),
    /**
     * The refresh token before this one, for the minute or two in which an
     * app that never heard the answer may fairly ask again. Used after that,
     * it means somebody else has a copy, and the connection is cut off.
     */
    prevRefreshHash: text(),
    rotatedAt: instant("rotated_at"),
    refreshExpiresAt: instant("refresh_expires_at").notNull(),
    createdAt: createdAt(),
    lastUsedAt: instant("last_used_at"),
    revokedAt: instant("revoked_at"),
    /** Why it ended, in a sentence, for the screen. */
    revokedWhy: text(),
  },
  (t) => [
    uniqueIndex("connections_access_key").on(t.accessHash),
    uniqueIndex("connections_refresh_key").on(t.refreshHash),
    index("connections_prev_refresh_idx").on(t.prevRefreshHash),
    index("connections_user_idx").on(t.userId),
  ],
).enableRLS();
