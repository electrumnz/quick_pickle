/**
 * A `SqlExecutor` backed by PGlite, running the project's real migrations.
 *
 * This exists so the conformance suite tests the mock provider against the
 * actual schema — every check constraint, every foreign key, every generated
 * column — rather than against a hand-written fake that would happily accept an
 * order whose totals do not add up. It needs no Docker, no network and no
 * Supabase project, which is what makes it usable in CI.
 *
 * Test-only. `@electric-sql/pglite` is a devDependency and nothing under `app/`
 * imports this module.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

import type { SqlExecutor, SqlResult, SqlRow } from "../sql/executor";

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

class PgliteExecutor implements SqlExecutor {
  private depth = 0;

  constructor(private readonly db: PGlite) {}

  async query<R extends SqlRow = SqlRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<SqlResult<R>> {
    const result = await this.db.query<R>(text, [...params]);
    return { rows: result.rows, rowCount: result.rows.length };
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    if (this.depth === 0) {
      await this.db.exec("begin");
      this.depth = 1;
      try {
        const value = await fn(this);
        await this.db.exec("commit");
        return value;
      } catch (error) {
        await this.db.exec("rollback");
        throw error;
      } finally {
        this.depth = 0;
      }
    }
    const name = `sp_${String(this.depth)}`;
    this.depth += 1;
    await this.db.exec(`savepoint ${name}`);
    try {
      const value = await fn(this);
      await this.db.exec(`release savepoint ${name}`);
      return value;
    } catch (error) {
      await this.db.exec(`rollback to savepoint ${name}`);
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

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

  return { sql: new PgliteExecutor(db), appliedMigrations: files };
}
