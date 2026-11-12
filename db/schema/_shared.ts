import { timestamp } from "drizzle-orm/pg-core";

/**
 * Every moment in the database is a `timestamptz`: one instant, stored in UTC.
 * The back end shows it in New Zealand time (lib/time.ts). Never store a local
 * clock reading; a UTC server and two daylight-saving changes a year turn
 * that into a twelve or thirteen hour error.
 */
export const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const createdAt = () => instant("created_at").notNull().defaultNow();
export const updatedAt = () => instant("updated_at").notNull().defaultNow();

/**
 * Every table ends with `.enableRLS()`, and tests/db/migrate.test.ts fails if
 * one does not.
 *
 * The database is Supabase, and Supabase publishes every table in the
 * `public` schema through its Data API, readable with a key that is designed
 * to be public, unless row level security is switched on. Switched on with no
 * policies, a table answers nobody through that door. The app is not affected:
 * it connects as the tables' owner, and an owner is not subject to RLS.
 */
export const RLS_NOTE = "every table calls .enableRLS()";
