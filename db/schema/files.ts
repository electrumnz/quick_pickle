/**
 * Files: the media library (product shots, video, brand art), and anything
 * else the back end keeps (an email's untouched original, its attachments).
 * The bytes live in storage (lib/backstage/files/storage.ts); this is the
 * index.
 */

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { createdAt } from "./_shared";
import { users } from "./core";

export const files = pgTable(
  "files",
  {
    id: text().primaryKey(),
    /** Where the bytes are, in storage. */
    key: text().notNull(),
    filename: text().notNull(),
    contentType: text().notNull(),
    size: integer().notNull().default(0),
    sha256: text(),
    /**
     *   media       the library: pictures and video for the site and social
     *   mail-raw    an email exactly as it arrived
     *   attachment  something that came with an email
     *   document    anything else kept on file
     */
    kind: text()
      .$type<"media" | "mail-raw" | "attachment" | "document">()
      .notNull()
      .default("media"),
    /** For a picture: what it shows, for someone who cannot see it. */
    alt: text().notNull().default(""),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Who made it and what we may do with it. */
    rights: text().notNull().default(""),
    width: integer(),
    height: integer(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("files_key_key").on(t.key),
    index("files_kind_idx").on(t.kind, t.createdAt),
  ],
).enableRLS();
