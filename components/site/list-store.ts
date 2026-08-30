import "server-only";

import { createPgExecutor, type SqlExecutor } from "@/lib/commerce";

import type { SignupKind } from "./list";

/**
 * Writing a sign-up down.
 *
 * The only write the public storefront makes. It goes through the same
 * `SqlExecutor` seam the rest of the build uses rather than the Supabase JS
 * client, for the reason set out at the top of `lib/commerce/sql/executor.ts`:
 * one Postgres connection, real statements, and a schema whose constraints are
 * doing the validating rather than a hopeful client.
 *
 * One pool per server process, kept across hot reloads, exactly as
 * `components/admin/data/db.ts` does it.
 */

type ListSqlGlobal = { __halfSourListSql?: SqlExecutor };

function listSql(): SqlExecutor {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (url === undefined || url === "") {
    throw new Error("SUPABASE_DB_URL is not set, so the list cannot be read.");
  }
  const store = globalThis as unknown as ListSqlGlobal;
  store.__halfSourListSql ??= createPgExecutor(url);
  return store.__halfSourListSql;
}

export interface SignupInput {
  readonly kind: SignupKind;
  readonly email: string;
  readonly venue: string | null;
  readonly sourcePath: string;
}

/**
 * Record one sign-up.
 *
 * Pressing the button twice is not two subscribers and must not look like an
 * error, so a repeat is an upsert on the address. A repeat also clears
 * `unsubscribed_at`: somebody who came off the list and then typed their
 * address into the form has asked again, and the row is the record of that.
 */
export async function recordSignup(input: SignupInput): Promise<void> {
  await listSql().query(
    `insert into public.list_signups (kind, email, venue, source_path)
     values ($1, $2, $3, $4)
     on conflict (lower(email), kind) do update
        set venue = coalesce(excluded.venue, list_signups.venue),
            source_path = excluded.source_path,
            unsubscribed_at = null,
            updated_at = now()`,
    [input.kind, input.email, input.venue, input.sourcePath],
  );
}
