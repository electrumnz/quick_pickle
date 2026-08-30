/**
 * A real Postgres with the real schema, in process.
 *
 * PGlite applies every migration in `supabase/migrations` verbatim, so these
 * tests run against the actual generated column, the actual check constraints
 * and the actual enums — which is the whole point when the thing being tested is
 * a gate that lives half in SQL.
 */

import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSchemaDatabase } from "@/lib/commerce/testing/pglite";
import type { SqlExecutor } from "@/lib/commerce/sql/executor";
import { LocalStorageProvider } from "@/lib/assets/storage/local";
import { SqlAssetStore } from "@/lib/assets/store/sql";
import type { AssetProduct } from "@/lib/assets/types";

export interface AssetTestWorld {
  readonly sql: SqlExecutor;
  readonly store: SqlAssetStore;
  readonly storage: LocalStorageProvider;
  readonly directory: string;
  readonly variants: readonly AssetProduct[];
  readonly operatorId: string;
  close(): Promise<void>;
}

const RANGE: readonly (readonly [string, string, string, number])[] = [
  ["no-01-house", "No 01 HOUSE", "HS-01-500", 1800],
  ["no-02-dirty", "No 02 DIRTY", "HS-02-500", 2000],
  ["no-03-smoke", "No 03 SMOKE", "HS-03-500", 2200],
];

/** This unit's migration. The schema it needs is complete at this file. */
const OWN_MIGRATION = "20260104013000_marketing_assets.sql";
const GUARANTEES = "20260101999900_schema_guarantees.sql";

/**
 * Apply the migrations up to and including this unit's own.
 *
 * Several agents are writing migrations into the same directory at the same
 * time, and one of them being mid-edit is not a reason for this unit's tests to
 * fail — nor is it something this unit may fix, since the file belongs to
 * someone else. Everything up to this unit's migration is applied in order, so
 * the schema under test is the real one, in the real sequence.
 *
 * The guarantees migration sorts before this one, so it is then applied a
 * SECOND time, deliberately. It is written to be re-runnable, and re-running it
 * is what asserts that the tables added here have RLS with a policy, an index
 * on every foreign key, an updated_at trigger and nothing granted to anon.
 */
async function migrationsThroughThisUnit(): Promise<string> {
  const source = path.join(process.cwd(), "supabase", "migrations");
  const directory = await mkdtemp(path.join(tmpdir(), "half-sour-migrations-"));
  const files = (await readdir(source))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => name <= OWN_MIGRATION);
  for (const name of files) {
    await copyFile(path.join(source, name), path.join(directory, name));
  }
  return directory;
}

export async function createAssetWorld(): Promise<AssetTestWorld> {
  const migrations = await migrationsThroughThisUnit();
  const database = await createSchemaDatabase(migrations);
  const sql = database.sql;
  await rm(migrations, { recursive: true, force: true });

  await sql.execScript(
    await readFile(
      path.join(process.cwd(), "supabase", "migrations", GUARANTEES),
      "utf8",
    ),
  );

  for (const [handle, title, sku, priceCents] of RANGE) {
    const product = await sql.query<{ id: string }>(
      `insert into public.products (handle, title, status, published_at)
       values ($1, $2, 'active', now()) returning id`,
      [handle, title],
    );
    await sql.query(
      `insert into public.product_variants (product_id, sku, title, price_cents, size_ml)
       values ($1::uuid, $2, '500ml', $3, 500)`,
      [product.rows[0]?.id ?? "", sku, priceCents],
    );
  }

  const operator = await sql.query<{ id: string }>(
    `insert into public.operators (email, full_name, role)
     values ('nadia@halfsour.co.nz', 'Nadia Feldman', 'owner') returning id`,
  );

  const directory = await mkdtemp(path.join(tmpdir(), "half-sour-assets-"));
  const store = new SqlAssetStore(sql);

  return {
    sql,
    store,
    storage: new LocalStorageProvider(directory),
    directory,
    variants: await store.variants(),
    operatorId: operator.rows[0]?.id ?? "",
    async close() {
      await sql.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
