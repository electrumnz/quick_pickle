/**
 * Applies the migrations embedded in the build (db/migrations.generated.ts).
 *
 * One small runner for every place the app has a database: Postgres in
 * production, and the in-process database a test, a laptop or a preview
 * without a database runs on. Each migration runs in its own transaction and
 * is recorded in `qp_migrations`, so running this twice does nothing the
 * second time, and two servers starting at once do not trip over each other
 * (the second waits on the lock, then finds the work done).
 */

import { sql } from "drizzle-orm";

import { MIGRATIONS, type Migration } from "@/db/migrations.generated";

import type { Db } from "./types";

/** Any constant will do; it only has to be the same one everywhere. */
const LOCK_KEY = 7_746_291;

export type MigrationResult = {
  readonly applied: readonly string[];
  readonly alreadyApplied: number;
};

export async function applyMigrations(
  db: Db,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationResult> {
  await db.execute(sql`
    create table if not exists qp_migrations (
      tag text primary key,
      hash text not null,
      applied_at timestamptz not null default now()
    )
  `);
  // Closed to Supabase's Data API, like every other table (db/schema/_shared).
  await db.execute(sql`alter table qp_migrations enable row level security`);

  const applied: string[] = [];
  let alreadyApplied = 0;

  for (const migration of migrations) {
    const ran = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
      const existing = await tx.execute<{ hash: string }>(
        sql`select hash from qp_migrations where tag = ${migration.tag}`,
      );
      const row = existing.rows[0];
      if (row !== undefined) {
        if (row.hash !== migration.hash) {
          throw new Error(
            `Migration ${migration.tag} was changed after it was applied (database has ${row.hash}, build has ${migration.hash}). A migration that has run is never edited: add a new one.`,
          );
        }
        return false;
      }
      for (const statement of migration.statements) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(
        sql`insert into qp_migrations (tag, hash) values (${migration.tag}, ${migration.hash})`,
      );
      return true;
    });
    if (ran) applied.push(migration.tag);
    else alreadyApplied += 1;
  }

  return { applied, alreadyApplied };
}
