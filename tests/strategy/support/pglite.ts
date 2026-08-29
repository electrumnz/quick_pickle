import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

import type { StrategySqlClient, StrategySqlRow } from "@/lib/strategy";

/**
 * A real Postgres for the strategy tests.
 *
 * PGlite is Postgres compiled to WebAssembly, so the migration that ships is
 * applied verbatim and every check constraint, enum and partial unique index in
 * it is the real one. The seeded rows the tests read back are the rows the
 * migration actually writes — not a fixture that agrees with it.
 *
 * Only three migrations are applied: `foundation` for `set_updated_at`,
 * `platform` for `is_operator` and the operator tables the policies reference,
 * and the strategy migration itself. The strategy tables depend on nothing else.
 */

const MIGRATIONS = [
  "20260101000000_foundation.sql",
  "20260101000100_platform.sql",
  "20260102000000_strategy.sql",
];

const SUPABASE_AUTH_STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text
  );
  create or replace function auth.uid() returns uuid
    language sql stable as $fn$ select null::uuid $fn$;
  do $roles$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit;
    end if;
  end;
  $roles$;
`;

function migrationPath(name: string): string {
  return fileURLToPath(
    new URL(`../../../supabase/migrations/${name}`, import.meta.url),
  );
}

export interface StrategyTestDatabase {
  readonly db: PGlite;
  readonly sql: StrategySqlClient;
  rows(text: string, params?: readonly unknown[]): Promise<StrategySqlRow[]>;
  close(): Promise<void>;
}

export async function createStrategyDatabase(): Promise<StrategyTestDatabase> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_AUTH_STUB);
  for (const name of MIGRATIONS) {
    await db.exec(readFileSync(migrationPath(name), "utf8"));
  }

  const sql: StrategySqlClient = {
    async query<R extends StrategySqlRow = StrategySqlRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: R[] }> {
      const result = await db.query<R>(
        text,
        params === undefined ? undefined : [...params],
      );
      return { rows: result.rows };
    },
  };

  return {
    db,
    sql,
    async rows(text: string, params?: readonly unknown[]) {
      const result = await sql.query(text, params);
      return result.rows;
    },
    async close() {
      await db.close();
    },
  };
}
