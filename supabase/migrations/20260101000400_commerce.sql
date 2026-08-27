-- =============================================================================
-- HALF SOUR — 04 COMMERCE (Shopify mirror)
--
-- The live store is Shopify ("Picklin Jews", sgu8sy-at.myshopify.com, NZD,
-- Pacific/Auckland). These tables are primarily a MIRROR of it: every mirrored
-- table carries `provider`, `shopify_gid`, `shopify_updated_at`, `sync_status`
-- and `synced_at`, and is designed for idempotent upsert-by-shopify_gid.
--
-- Webhooks arrive at-least-once and out of order, so the mirror never trusts
-- arrival order. The adapter's upsert is:
--
--   insert into products (shopify_gid, ..., shopify_updated_at)
--   values (...)
--   on conflict (shopify_gid) do update set ...
--   where excluded.shopify_updated_at >= products.shopify_updated_at;
--
-- i.e. last-writer-wins on Shopify's own updated_at, not on ours. A duplicate
-- delivery is a no-op; a late delivery loses to the newer state it would undo.
--
-- The mirror is not a hard dependency: every table is fully usable standalone
-- with provider = 'local' (the mock commerce provider the test suite runs
-- against has no Shopify credentials). shopify_gid is therefore NULLABLE
-- everywhere; `provider` is the discriminator.
--
-- Shopify returns money as decimal strings ("18.00"). Converting those to
-- integer cents is the ADAPTER's job. Nothing in this schema stores a decimal
-- price — money is integer minor units, full stop.
-- =============================================================================

create type public.product_status as enum ('draft', 'active', 'archived');
create type public.inventory_policy as enum ('deny', 'continue');
create type public.location_kind as enum ('kitchen', 'coolstore', 'warehouse', 'retail', 'third_party', 'market_stall');
create type public.inventory_reason as enum (
  'batch_release', 'sale', 'return', 'damage', 'sample', 'stocktake',
  'transfer', 'expiry', 'recall', 'correction', 'shopify_sync'
);
create type public.customer_type as enum ('retail', 'trade', 'wholesale', 'staff', 'press');
create type public.address_type as enum ('shipping', 'billing');
create type public.cart_status as enum ('active', 'abandoned', 'converted', 'expired');
create type public.discount_type as enum ('percentage', 'fixed_amount', 'free_shipping');
create type public.discount_scope as enum ('order', 'product', 'collection', 'shipping');
create type public.discount_status as enum ('draft', 'scheduled', 'active', 'expired', 'disabled');
create type public.sales_channel as enum ('online', 'wholesale', 'market', 'phone', 'retail', 'subscription');
create type public.order_status as enum ('open', 'archived', 'cancelled');
create type public.order_financial_status as enum (
  'pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'voided'
);
create type public.order_fulfillment_status as enum (
  'unfulfilled', 'partially_fulfilled', 'fulfilled', 'delivered', 'returned', 'cancelled'
);
create type public.subscription_status as enum ('active', 'paused', 'cancelled', 'past_due', 'expired');
create type public.subscription_interval as enum ('week', 'fortnight', 'month', 'quarter');

create sequence public.order_number_seq start with 1001 increment by 1;

-- =============================================================================
-- CATALOGUE
-- =============================================================================

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,

  handle        text not null,
  title         text not null,
  subtitle      text,
  description   text,
  product_type  text,
  vendor        text not null default 'Half Sour',
  status        public.product_status not null default 'draft',
  published_at  timestamptz,
  tags          text[] not null default '{}',
  seo_title     text,
  seo_description text,
  requires_shipping boolean not null default true,
  is_taxable    boolean not null default true,
  hero_image_url text,
  position      integer not null default 0,
  search_vector tsvector generated always as (
                  to_tsvector('english'::regconfig,
                    coalesce(title, '') || ' ' || coalesce(subtitle, '') || ' ' ||
                    coalesce(description, '') || ' ' || coalesce(product_type, ''))) stored,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint products_handle_format check (handle ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint products_title_present check (btrim(title) <> ''),
  constraint products_active_is_published check (status <> 'active' or published_at is not null)
);

create unique index products_handle_key on public.products (handle) where deleted_at is null;
create index products_status_idx on public.products (status, position) where deleted_at is null;
create index products_type_idx on public.products (product_type) where deleted_at is null;
create index products_search_idx on public.products using gin (search_vector);
create index products_tags_idx on public.products using gin (tags);
create index products_updated_idx on public.products (updated_at desc);

comment on column public.products.search_vector is
  'Generated tsvector for admin search. Immutable regconfig literal so it is storable.';

-- -----------------------------------------------------------------------------
create table public.product_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,
  shopify_inventory_item_gid text,

  sku           text not null,
  barcode       text,
  title         text not null,
  size_ml       integer,
  pack_count    integer not null default 1,
  price_cents   integer not null,
  compare_at_price_cents integer,
  unit_cost_cents integer,
  currency      public.currency_code not null default 'NZD',
  weight_grams  integer,
  track_inventory boolean not null default true,
  inventory_policy public.inventory_policy not null default 'deny',
  is_trade_only boolean not null default false,
  shelf_life_days integer,
  position      integer not null default 0,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint product_variants_price_nonneg check (price_cents >= 0),
  constraint product_variants_compare_gte_price check (
    compare_at_price_cents is null or compare_at_price_cents >= price_cents),
  constraint product_variants_cost_nonneg check (unit_cost_cents is null or unit_cost_cents >= 0),
  constraint product_variants_size_positive check (size_ml is null or size_ml > 0),
  constraint product_variants_pack_positive check (pack_count > 0),
  constraint product_variants_weight_nonneg check (weight_grams is null or weight_grams >= 0),
  constraint product_variants_shelf_life_positive check (shelf_life_days is null or shelf_life_days > 0),
  constraint product_variants_sku_format check (sku ~ '^[A-Z0-9][A-Z0-9-]*$'),
  -- Composite key so downstream tables can pin (variant, product) together and
  -- make "an order line for a variant that isn't on that product" unwritable.
  unique (id, product_id)
);

create unique index product_variants_sku_key on public.product_variants (sku) where deleted_at is null;
create index product_variants_product_idx on public.product_variants (product_id, position);
create index product_variants_price_idx on public.product_variants (price_cents);
create index product_variants_trade_idx on public.product_variants (is_trade_only) where deleted_at is null;
create unique index product_variants_inventory_item_key
  on public.product_variants (shopify_inventory_item_gid)
  where shopify_inventory_item_gid is not null;

-- -----------------------------------------------------------------------------
create table public.product_images (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null,
  variant_id    uuid,
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,

  url           text not null,
  alt_text      text,
  position      integer not null default 0,
  width_px      integer,
  height_px     integer,
  content_asset_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint product_images_dims_positive check (
    (width_px is null or width_px > 0) and (height_px is null or height_px > 0)),
  -- The image's variant, if any, must belong to the image's product.
  foreign key (product_id) references public.products (id) on delete cascade,
  foreign key (variant_id, product_id)
    references public.product_variants (id, product_id) on delete cascade
);

create index product_images_product_idx on public.product_images (product_id, position);
create index product_images_variant_idx on public.product_images (variant_id, product_id);
create index product_images_asset_idx on public.product_images (content_asset_id);

-- -----------------------------------------------------------------------------
create table public.collections (
  id            uuid primary key default gen_random_uuid(),
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,

  handle        text not null unique,
  title         text not null,
  description   text,
  image_url     text,
  is_published  boolean not null default false,
  published_at  timestamptz,
  position      integer not null default 0,
  is_smart      boolean not null default false,
  rules         jsonb,
  seo_title     text,
  seo_description text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint collections_handle_format check (handle ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint collections_published_stamped check (is_published = (published_at is not null)),
  constraint collections_smart_has_rules check (is_smart = (rules is not null))
);

create index collections_published_idx on public.collections (position) where is_published;

-- -----------------------------------------------------------------------------
create table public.collection_products (
  collection_id uuid not null references public.collections (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (collection_id, product_id)
);

create index collection_products_product_idx on public.collection_products (product_id);
create index collection_products_order_idx on public.collection_products (collection_id, position);

-- =============================================================================
-- INVENTORY
-- =============================================================================

create table public.inventory_locations (
  id            uuid primary key default gen_random_uuid(),
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,

  code          text not null unique,
  name          text not null,
  kind          public.location_kind not null default 'warehouse',
  address_line  text,
  suburb        text,
  city          text,
  region        text,
  postcode      text,
  country_code  text not null default 'NZ',
  is_active     boolean not null default true,
  is_default    boolean not null default false,
  ships_orders  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint inventory_locations_code_format check (code ~ '^[A-Z][A-Z0-9_-]*$'),
  constraint inventory_locations_country_format check (country_code ~ '^[A-Z]{2}$')
);

create unique index inventory_locations_one_default on public.inventory_locations (is_default) where is_default;
create index inventory_locations_active_idx on public.inventory_locations (kind) where is_active;

-- -----------------------------------------------------------------------------
create table public.inventory_levels (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid not null references public.product_variants (id) on delete cascade,
  location_id   uuid not null references public.inventory_locations (id) on delete cascade,
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,

  on_hand       integer not null default 0,
  committed     integer not null default 0,
  incoming      integer not null default 0,
  available     integer generated always as (on_hand - committed) stored,
  reorder_point integer not null default 0,
  reorder_quantity integer not null default 0,
  last_counted_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint inventory_levels_committed_nonneg check (committed >= 0),
  constraint inventory_levels_incoming_nonneg check (incoming >= 0),
  constraint inventory_levels_reorder_nonneg check (reorder_point >= 0 and reorder_quantity >= 0),
  unique (variant_id, location_id)
);

create index inventory_levels_location_idx on public.inventory_levels (location_id);
create index inventory_levels_variant_idx on public.inventory_levels (variant_id);
-- The reorder queue the ops agent reads every morning.
create index inventory_levels_reorder_idx on public.inventory_levels (location_id, available)
  where reorder_point > 0;

-- =============================================================================
-- CUSTOMERS
-- =============================================================================

create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,

  email         text not null,
  first_name    text,
  last_name     text,
  full_name     text generated always as (
                  nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')) stored,
  phone         text,
  customer_type public.customer_type not null default 'retail',
  company_name  text,
  nzbn          text,
  gst_number    text,
  accepts_marketing boolean not null default false,
  marketing_opt_in_at timestamptz,
  default_address_id uuid,
  tags          text[] not null default '{}',
  note          text,
  orders_count  integer not null default 0,
  total_spent_cents integer not null default 0,
  currency      public.currency_code not null default 'NZD',
  first_ordered_at timestamptz,
  last_ordered_at  timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint customers_email_format check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint customers_nzbn_format check (nzbn is null or nzbn ~ '^[0-9]{13}$'),
  constraint customers_totals_nonneg check (orders_count >= 0 and total_spent_cents >= 0),
  constraint customers_trade_has_company check (
    customer_type not in ('trade', 'wholesale') or company_name is not null),
  constraint customers_marketing_stamped check (
    accepts_marketing = false or marketing_opt_in_at is not null),
  constraint customers_order_dates check (
    first_ordered_at is null or last_ordered_at is null or last_ordered_at >= first_ordered_at),
  constraint customers_ordered_implies_count check (
    (orders_count > 0) = (first_ordered_at is not null))
);

create unique index customers_email_key on public.customers (lower(email)) where deleted_at is null;
create index customers_type_idx on public.customers (customer_type) where deleted_at is null;
create index customers_spend_idx on public.customers (total_spent_cents desc) where deleted_at is null;
create index customers_last_order_idx on public.customers (last_ordered_at desc nulls last);
create index customers_marketing_idx on public.customers (email) where accepts_marketing;
create index customers_tags_idx on public.customers using gin (tags);
create index customers_default_address_idx on public.customers (default_address_id, id);

-- -----------------------------------------------------------------------------
create table public.addresses (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers (id) on delete cascade,
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,

  label         text,
  address_type  public.address_type not null default 'shipping',
  first_name    text,
  last_name     text,
  company       text,
  line1         text not null,
  line2         text,
  suburb        text,
  city          text not null,
  region        text,
  postcode      text,
  country_code  text not null default 'NZ',
  phone         text,
  delivery_instructions text,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint addresses_country_format check (country_code ~ '^[A-Z]{2}$'),
  constraint addresses_nz_postcode check (
    country_code <> 'NZ' or postcode is null or postcode ~ '^[0-9]{4}$'),
  constraint addresses_line1_present check (btrim(line1) <> ''),
  -- Composite key so a customer's default address must be one of theirs.
  unique (id, customer_id)
);

create unique index addresses_one_default_per_type on public.addresses (customer_id, address_type)
  where is_default;
create index addresses_customer_idx on public.addresses (customer_id, address_type);
create index addresses_city_idx on public.addresses (country_code, city);

-- A customer's default address must be one of THEIR addresses. The composite FK
-- makes pointing at someone else's address unrepresentable. ON DELETE SET NULL
-- names the column explicitly (PG15+) so deleting an address clears the pointer
-- rather than attempting to null the customer's own primary key.
alter table public.customers
  add constraint customers_default_address_fk
  foreign key (default_address_id, id)
  references public.addresses (id, customer_id)
  on delete set null (default_address_id);
