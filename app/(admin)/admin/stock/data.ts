import "server-only";

import {
  adminSql,
  decimal,
  int,
  text,
  textOrNull,
} from "@/components/admin/data/db";

/**
 * What the batch forms need that the reading queries do not carry.
 *
 * Opening a batch is a choice between recipes, and only a current, active
 * recipe attached to a product can be chosen — a retired one would put a batch
 * on the shelf made to a formula this company has stopped using.
 */

export type OpenableRecipe = {
  readonly id: string;
  readonly name: string;
  readonly productTitle: string;
  readonly batchSizeLitres: number;
  readonly expectedYieldUnits: number | null;
  readonly fermentDays: number | null;
};

export async function openableRecipes(): Promise<readonly OpenableRecipe[]> {
  const result = await adminSql().query(
    `select r.id, r.name, r.batch_size_litres, r.expected_yield_units,
            r.ferment_days, p.title as product_title
       from public.recipes r
       join public.products p on p.id = r.product_id
      where r.status = 'active' and r.is_current
      order by p.title`,
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    name: text(row, "name"),
    productTitle: text(row, "product_title"),
    batchSizeLitres: decimal(row, "batch_size_litres"),
    expectedYieldUnits:
      row["expected_yield_units"] === null
        ? null
        : int(row, "expected_yield_units"),
    fermentDays: row["ferment_days"] === null ? null : int(row, "ferment_days"),
  }));
}

export type StockPlace = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
};

/** Where bottles and brine physically are. */
export async function stockPlaces(): Promise<readonly StockPlace[]> {
  const result = await adminSql().query(
    `select id, code, name from public.inventory_locations
      where is_active order by name`,
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    code: text(row, "code"),
    name: text(row, "name"),
  }));
}

export type SellableVariant = {
  readonly id: string;
  readonly sku: string;
  readonly title: string;
};

/** SKU to variant id, which is what an inventory adjustment is keyed by. */
export async function sellableVariants(): Promise<readonly SellableVariant[]> {
  const result = await adminSql().query(
    `select v.id, v.sku, p.title
       from public.product_variants v
       join public.products p on p.id = v.product_id
      where v.deleted_at is null and v.track_inventory
      order by p.title`,
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    sku: text(row, "sku"),
    title: textOrNull(row, "title") ?? text(row, "sku"),
  }));
}
