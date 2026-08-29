/**
 * A real Postgres with the real schema, in process.
 *
 * PGlite applies every migration in `supabase/migrations` verbatim, so these
 * tests run against the actual generated column, the actual check constraints
 * and the actual enums — which is the whole point when the thing being tested is
 * a gate that lives half in SQL.
 */

import { mkdtemp, rm } from "node:fs/promises";
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

export async function createAssetWorld(): Promise<AssetTestWorld> {
  const database = await createSchemaDatabase();
  const sql = database.sql;

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
