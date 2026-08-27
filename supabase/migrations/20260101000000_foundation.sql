-- =============================================================================
-- HALF SOUR — 00 FOUNDATION
-- Shared helpers, the operator/auth predicate functions, and the cross-cutting
-- domains + enums that every later migration leans on.
--
-- Conventions enforced across the whole schema:
--   * money            -> integer minor units (cents), column suffix `_cents`
--   * sub-cent money   -> bigint `_micros` (millionths of the currency unit)
--   * percentages      -> integer basis points, column suffix `_bp`
--   * quantities       -> numeric(p,s) (NOT money; never priced directly)
--   * time             -> timestamptz, always. No bare `timestamp`.
--   * identity         -> uuid v4 (gen_random_uuid(), core in PG13+)
--   * logs             -> bigint identity, append-only
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Domains
-- -----------------------------------------------------------------------------
create domain public.currency_code as text
  check (value ~ '^[A-Z]{3}$');
comment on domain public.currency_code is
  'ISO-4217 alpha-3. Half Sour trades in NZD; AUD/USD exist for export orders.';

-- -----------------------------------------------------------------------------
-- Cross-cutting enums
-- -----------------------------------------------------------------------------

-- The commerce layer is provider-swappable. In production it is a MIRROR of the
-- live Shopify store (Picklin Jews / sgu8sy-at.myshopify.com, NZD, NZST); under
-- test it is the source of truth with no Shopify credentials in play. The
-- commerce adapter picks, and `provider` records which one a given row came from.
create type public.commerce_provider as enum ('local', 'shopify');

-- Per-row mirror state. A row is `local` when it was never meant to reach
-- Shopify (fixtures, mock provider), `pending` when it exists here but has no
-- Shopify identity yet, `synced` when the mirror is believed current,
-- `stale` when a webhook told us it moved but we have not refetched, and
-- `failed` when the last sync attempt errored.
create type public.sync_status as enum ('local', 'pending', 'synced', 'stale', 'failed');

-- Which Shopify resource a sync cursor or webhook belongs to.
create type public.sync_resource as enum (
  'product', 'product_variant', 'collection', 'inventory_level', 'inventory_item',
  'customer', 'address', 'order', 'order_item', 'draft_order', 'cart',
  'discount', 'price_rule', 'fulfillment', 'refund', 'subscription_contract', 'shop'
);

create type public.sync_run_status as enum ('idle', 'running', 'backfilling', 'failed', 'paused');

create type public.webhook_process_status as enum (
  'received', 'processing', 'processed', 'skipped', 'failed', 'replayed'
);

-- Who did a thing. Used by audit_log and inventory_adjustments.
create type public.actor_type as enum ('operator', 'agent', 'customer', 'system');

create type public.audit_action as enum (
  'create', 'update', 'delete', 'login', 'logout',
  'approve', 'reject', 'publish', 'unpublish',
  'sync', 'export', 'import', 'refund', 'cancel', 'adjust', 'release', 'recall'
);

create type public.operator_role as enum ('owner', 'operator', 'agent_service', 'viewer');

create type public.unit_of_measure as enum ('g', 'kg', 'ml', 'l', 'ea', 'bunch', 'case');

-- -----------------------------------------------------------------------------
-- updated_at
-- One function; the final migration attaches it to every table that carries an
-- `updated_at` column and asserts that none were missed.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at = now(). Attached automatically by the RLS/triggers migration.';

-- -----------------------------------------------------------------------------
-- Storefront cart identity
--
-- The storefront is anonymous. A cart is bearer-authenticated by a 64-hex token
-- the client mints and sends as the `x-cart-token` header on every request.
-- PostgREST exposes request headers as the `request.headers` GUC.
create or replace function public.current_cart_token()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-cart-token', ''),
    nullif(current_setting('request.cart_token', true), '')
  );
$$;

comment on function public.current_cart_token() is
  'Bearer token identifying an anonymous storefront cart, read from the x-cart-token request header.';
