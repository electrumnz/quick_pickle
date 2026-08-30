/**
 * A `SqlExecutor` backed by PGlite, running the project's real migrations.
 *
 * This exists so the conformance suite tests the mock provider against the
 * actual schema — every check constraint, every foreign key, every generated
 * column — rather than against a hand-written fake that would happily accept an
 * order whose totals do not add up. It needs no Docker, no network and no
 * Supabase project, which is what makes it usable in CI.
 *
 * Test-only: nothing under `app/` imports this module. `@electric-sql/pglite`
 * is a runtime dependency rather than a devDependency because demo mode ships
 * it — see `lib/demo/README.md`.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

import type { SqlExecutor } from "../sql/executor";
import { createPgliteExecutor } from "../sql/pglite";

/**
 * Supabase-provided objects the migrations reference but that PGlite does not
 * ship. `check_function_bodies` is turned off because the foundation migration
 * defines SQL functions over tables that later migrations create — which is how
 * Supabase's own migration runner applies them.
 */
const BOOTSTRAP = `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end
$$;
set check_function_bodies = off;
`;

export type PgliteDatabase = {
  readonly sql: SqlExecutor;
  readonly appliedMigrations: readonly string[];
};

/**
 * Boot an in-process Postgres with the full HALF SOUR schema applied.
 *
 * @param migrationsDir - defaults to `<cwd>/supabase/migrations`
 */
export async function createSchemaDatabase(
  migrationsDir = path.join(process.cwd(), "supabase", "migrations"),
): Promise<PgliteDatabase> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(
        `Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // The executor itself lives in `../sql/pglite`, alongside the node-postgres
  // one, because demo mode serves a deployment through the same code — see
  // `lib/demo/database.ts`. There is one PGlite executor, not a test copy and a
  // production copy that can drift.
  return { sql: createPgliteExecutor(db), appliedMigrations: files };
}
