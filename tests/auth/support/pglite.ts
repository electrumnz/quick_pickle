import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

import { SqlAuthStore } from "@/lib/auth/store/sql-auth-store";
import type { SqlClient, SqlResult, SqlRow } from "@/lib/auth/store/sql-client";
import type { AuthStore } from "@/lib/auth/store/types";

/**
 * A real Postgres for the test suite.
 *
 * PGlite is Postgres itself compiled to WebAssembly, so the migrations that
 * ship are applied verbatim and the statements in `SqlAuthStore` run against
 * genuine constraints, genuine enums, genuine `inet` columns and a genuine
 * `plpgsql` function. Nothing about the throttle, the session lifecycle or the
 * audit trail is asserted against a stand-in.
 *
 * The only thing stubbed is Supabase's `auth` schema, which is provided by the
 * hosted platform rather than by these migrations: `auth.users` for the foreign
 * key on `operators`, and `auth.uid()` for the RLS predicates. The admin gate
 * touches neither — it authenticates against `ADMIN_PASSWORD_HASH`, not against
 * Supabase auth — so the stub is a compile-time fixture, not a behaviour.
 */

const MIGRATIONS = [
  "20260101000000_foundation.sql",
  "20260101000100_platform.sql",
  "20260101000600_auth.sql",
];

const SUPABASE_AUTH_STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text
  );
  create or replace function auth.uid() returns uuid
    language sql stable as $fn$ select null::uuid $fn$;
`;

function migrationPath(name: string): string {
  return fileURLToPath(
    new URL(`../../../supabase/migrations/${name}`, import.meta.url),
  );
}

class PGliteSqlClient implements SqlClient {
  constructor(private readonly db: PGlite) {}

  async query<Row extends SqlRow = SqlRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<SqlResult<Row>> {
    const result = await this.db.query<Row>(
      text,
      params === undefined ? undefined : [...params],
    );
    return { rows: result.rows };
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

export type TestDatabase = {
  readonly db: PGlite;
  readonly store: AuthStore;
  /** Convenience for assertions that read tables the store does not expose. */
  rows<Row extends SqlRow = SqlRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
  close(): Promise<void>;
};

/** Boot an in-process Postgres with the real schema applied. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_AUTH_STUB);
  for (const name of MIGRATIONS) {
    await db.exec(readFileSync(migrationPath(name), "utf8"));
  }
  const store = new SqlAuthStore(new PGliteSqlClient(db));
  return {
    db,
    store,
    async rows<Row extends SqlRow = SqlRow>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<Row[]> {
      const result = await db.query<Row>(
        sql,
        params === undefined ? undefined : [...params],
      );
      return result.rows;
    },
    async close(): Promise<void> {
      await db.close();
    },
  };
}
