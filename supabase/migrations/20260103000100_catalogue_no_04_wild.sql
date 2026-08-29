-- =============================================================================
-- HALF SOUR — 11 CATALOGUE: No 04 WILD
--
-- WHY THIS IS A MIGRATION AND NOT A LINE IN seed.sql
--
-- `supabase/seed.sql` opens with `truncate ... restart identity cascade`. It
-- builds a database, it cannot edit one, and it can never be run against
-- production without deleting the order book. So a SKU that is live in Shopify
-- but missing from a database that already exists has exactly one way in, and
-- this is it: a forward-only, idempotent data migration.
--
-- No 04 WILD has been active in Shopify since it was created — SKU HS-04-500,
-- $26.00 NZD, 500 ml, one variant, in "The Brines" — while the mirror carried
-- only 01, 02, 03 and the set. The storefront's read model LEFT JOINs the range
-- against the catalogue, so the effect was visible rather than hidden: the
-- product page rendered WILD in full from `content/brines.ts`, then marked it
-- `unlisted`, withdrew the buy control and emitted OutOfStock structured data
-- for a bottle the company sells.
--
-- The gids below are the real ones, read off sgu8sy-at.myshopify.com on
-- 29 Aug 2026, so the next webhook upserts onto these rows by shopify_gid
-- instead of inserting a second No 04:
--
--   product          gid://shopify/Product/9389915963642
--   variant          gid://shopify/ProductVariant/50186882384122
--   inventory item   gid://shopify/InventoryItem/52028729295098
--   collection       gid://shopify/Collection/475327070458   (already mirrored)
--
-- GUARDED, in both directions:
--
--   * it does nothing unless the mirror already holds No 01 HOUSE, so a fresh
--     database — the one `supabase/seed.sql` and the conformance fixture build
--     from nothing — is left entirely to its seed and never ends up with two
--     No 04 rows fighting over the `products_handle_key` unique index;
--   * it does nothing if No 04 is already there, so re-running is a no-op.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
--   * No stock. The live variant reports zero on hand and inventory belongs to
--     Shopify; the level rows below exist at 0 / `pending` so the next sync has
--     somewhere to land. Typing a number in here would be inventing stock.
--   * No supplier, and no origin. The Shopify description names a Tairawhiti
--     kawakawa grower who is not yet a relationship — a place-of-origin claim
--     under Fair Trading Act s 13(j), tracked in TODO.md. The description
--     written here keeps the culinary copy and the supply constraint, which are
--     true, and drops the grower, which is not yet. Nothing in this file may be
--     edited to add one back before the relationship exists.
--   * No image. The Shopify product has no media attached, so a mirrored image
--     row would be a mirror of nothing and `hero_image_url` stays null.
-- =============================================================================

-- --- Product -----------------------------------------------------------------
insert into public.products
  (handle, title, subtitle, description, product_type, status, published_at, tags,
   seo_title, seo_description, hero_image_url, position,
   provider, shopify_gid, shopify_updated_at, sync_status, synced_at)
select
  'no-04-wild', 'No 04 WILD', 'Coastal brine. Kawakawa, kelp, lemon peel.',
  'Kawakawa, kelp and lemon peel. Peppery off the leaf, maritime underneath, and the least like anything else on the shelf. Built for seafood: a capful over oysters, the acid in a ceviche, a martini that tastes like the coast rather than the bar. It sits with a gin that has real botanicals in it instead of fighting one. Made in small runs — the leaf is what limits it, not the demand. 500ml.',
  'Brine', 'active', now(), '{wild,kawakawa,kelp,seafood,limited,mixer,native}',
  'No 04 WILD — kawakawa and kelp brine | Half Sour',
  'Kawakawa, kelp and lemon peel brine, built for seafood. Limited by leaf supply. Made in Auckland, 500ml.',
  null, 35,
  'shopify', 'gid://shopify/Product/9389915963642', now(), 'pending', null
 where exists (select 1 from public.products where handle = 'no-01-house')
   and not exists (select 1 from public.products where handle = 'no-04-wild');

-- --- Variant -----------------------------------------------------------------
-- 1015c unit cost is the No 04 line from the strategy document's own cost
-- breakdown (520 + 185 + 60 + 250), not a fresh guess. No barcode: HS-04-500
-- has no GTIN allocated and the live variant carries none.
--
-- track_inventory with policy 'deny', which for this SKU is the point. A bottle
-- whose supply is capped by how much leaf arrived must not be backorderable —
-- 'continue' would let the shop keep selling a run that no longer exists.
insert into public.product_variants
  (product_id, sku, barcode, title, size_ml, pack_count, price_cents, unit_cost_cents,
   currency, weight_grams, track_inventory, inventory_policy, shelf_life_days, position,
   provider, shopify_gid, shopify_inventory_item_gid, shopify_updated_at, sync_status, synced_at)
select
  p.id, 'HS-04-500', null, '500ml', 500, 1, 2600, 1015,
  'NZD', 860, true, 'deny', 365, 10,
  'shopify', 'gid://shopify/ProductVariant/50186882384122',
  'gid://shopify/InventoryItem/52028729295098', now(), 'pending', null
  from public.products p
 where p.handle = 'no-04-wild'
   and not exists (select 1 from public.product_variants v where v.sku = 'HS-04-500');

-- --- Collection membership ---------------------------------------------------
-- "The Brines" is where Shopify has it. Nothing is invented: if the mirror does
-- not carry that collection, this inserts nothing.
insert into public.collection_products (collection_id, product_id, position)
select c.id, p.id, 35
  from public.collections c
  join public.products p on p.handle = 'no-04-wild'
 where c.handle = 'the-brines'
on conflict (collection_id, product_id) do nothing;

-- --- Inventory levels --------------------------------------------------------
-- A row per location that ships, at zero, awaiting the first inventory sync.
-- reorder_point stays 0: a reorder point is a promise that more can be bought,
-- and there is no kawakawa supplier to buy from. A number here would put No 04
-- into the ops agent's morning reorder queue (inventory_levels_reorder_idx,
-- `where reorder_point > 0`) and have it raise a purchase order against nobody.
insert into public.inventory_levels
  (variant_id, location_id, on_hand, committed, incoming, reorder_point, reorder_quantity,
   provider, sync_status)
select v.id, l.id, 0, 0, 0, 0, 0, 'shopify', 'pending'
  from public.product_variants v
  cross join public.inventory_locations l
 where v.sku = 'HS-04-500'
   and l.is_active
   and l.ships_orders
on conflict (variant_id, location_id) do nothing;

-- --- Say what happened -------------------------------------------------------
do $$
declare present boolean;
begin
  select exists (select 1 from public.products where handle = 'no-04-wild')
    into present;
  if present then
    raise notice 'catalogue: No 04 WILD (HS-04-500) is in the mirror. Stock arrives with the next Shopify inventory sync.';
  else
    raise notice 'catalogue: skipped No 04 WILD — this database has no catalogue to add it to yet, so its seed owns it.';
  end if;
end;
$$;
