/**
 * Whether the back end is running for real or as a demo.
 *
 *   live  a real database is connected. Sign-in is required, always.
 *   demo  no database: the in-process one, with invented records. The back
 *         end is open and every screen says the data is not real.
 *
 * The rule is tied to the database on purpose. Real records only ever exist
 * behind a real database, and the moment there is one the door shuts. A
 * deployment that loses its DATABASE_URL does not expose anything: it falls
 * back to invented data, not to an unlocked view of the real thing.
 *
 * `BACKSTAGE_AUTH=required` makes the in-process database behave as live,
 * so the sign-in screens can be exercised in tests and development.
 */

import "server-only";

import { databaseUrl } from "@/lib/db/client";

export type BackstageMode = "live" | "demo";

export function backstageMode(
  env: Record<string, string | undefined> = process.env,
): BackstageMode {
  if (databaseUrl(env) !== null) return "live";
  return env.BACKSTAGE_AUTH === "required" ? "live" : "demo";
}
