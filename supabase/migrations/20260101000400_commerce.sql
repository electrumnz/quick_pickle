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

-- =============================================================================
-- DISCOUNTS
-- =============================================================================

create table public.discounts (
  id            uuid primary key default gen_random_uuid(),
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,

  code          text not null,
  title         text not null,
  description   text,
  value_type    public.discount_type not null,
  value_bp      integer,
  value_cents   integer,
  currency      public.currency_code not null default 'NZD',
  applies_to    public.discount_scope not null default 'order',
  target_product_id    uuid references public.products (id) on delete cascade,
  target_collection_id uuid references public.collections (id) on delete cascade,
  minimum_subtotal_cents integer,
  minimum_quantity integer,
  customer_type_restriction public.customer_type,
  once_per_customer boolean not null default false,
  usage_limit   integer,
  usage_limit_per_customer integer,
  used_count    integer not null default 0,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  status        public.discount_status not null default 'draft',
  created_by_agent_id uuid references public.agents (id) on delete set null,
  approval_id   uuid references public.approvals (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint discounts_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]*$'),
  -- Exactly one value shape per discount type. A percentage discount cannot
  -- carry a cash amount and free shipping cannot carry either.
  constraint discounts_value_shape check (
    (value_type = 'percentage'   and value_bp is not null and value_cents is null)
 or (value_type = 'fixed_amount' and value_cents is not null and value_bp is null)
 or (value_type = 'free_shipping' and value_bp is null and value_cents is null)),
  constraint discounts_value_bp_range check (value_bp is null or value_bp between 1 and 10000),
  constraint discounts_value_cents_positive check (value_cents is null or value_cents > 0),
  constraint discounts_minimums_positive check (
    (minimum_subtotal_cents is null or minimum_subtotal_cents >= 0)
    and (minimum_quantity is null or minimum_quantity > 0)),
  constraint discounts_limits_positive check (
    (usage_limit is null or usage_limit > 0)
    and (usage_limit_per_customer is null or usage_limit_per_customer > 0)),
  constraint discounts_used_within_limit check (
    used_count >= 0 and (usage_limit is null or used_count <= usage_limit)),
  constraint discounts_window check (ends_at is null or ends_at > starts_at),
  -- The scope column and the target column must agree.
  constraint discounts_product_target check ((applies_to = 'product') = (target_product_id is not null)),
  constraint discounts_collection_target check ((applies_to = 'collection') = (target_collection_id is not null)),
  constraint discounts_free_shipping_scope check (
    value_type <> 'free_shipping' or applies_to = 'shipping')
);

create unique index discounts_code_key on public.discounts (upper(code));
create index discounts_status_idx on public.discounts (status, starts_at desc);
create index discounts_active_window_idx on public.discounts (starts_at, ends_at) where status = 'active';
create index discounts_product_idx on public.discounts (target_product_id);
create index discounts_collection_idx on public.discounts (target_collection_id);
create index discounts_agent_idx on public.discounts (created_by_agent_id);
create index discounts_approval_idx on public.discounts (approval_id);

-- =============================================================================
-- CARTS
--
-- Carts are the one commerce object the anonymous storefront writes. They are
-- bearer-authenticated by `token` (see current_cart_token()), never by user id.
-- =============================================================================

create table public.carts (
  id            uuid primary key default gen_random_uuid(),
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,

  token         text not null unique default
                  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  customer_id   uuid references public.customers (id) on delete set null,
  email         text,
  status        public.cart_status not null default 'active',
  currency      public.currency_code not null default 'NZD',
  subtotal_cents  integer not null default 0,
  discount_cents  integer not null default 0,
  shipping_cents  integer not null default 0,
  tax_cents       integer not null default 0,
  total_cents     integer not null default 0,
  discount_id   uuid references public.discounts (id) on delete set null,
  discount_code text,
  note          text,
  attributes    jsonb not null default '{}',
  checkout_url  text,
  abandoned_at  timestamptz,
  recovery_email_sent_at timestamptz,
  converted_order_id uuid,
  expires_at    timestamptz not null default (now() + interval '30 days'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint carts_token_format check (token ~ '^[0-9a-f]{32,128}$'),
  constraint carts_money_nonneg check (
    subtotal_cents >= 0 and discount_cents >= 0 and shipping_cents >= 0
    and tax_cents >= 0 and total_cents >= 0),
  constraint carts_discount_within_subtotal check (discount_cents <= subtotal_cents),
  constraint carts_email_format check (
    email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint carts_abandoned_stamped check ((status = 'abandoned') = (abandoned_at is not null)),
  constraint carts_converted_has_order check (status <> 'converted' or converted_order_id is not null),
  constraint carts_expiry_after_creation check (expires_at > created_at),
  -- Composite key so a cart line cannot be priced in a currency the cart isn't in.
  unique (id, currency)
);

create index carts_status_idx on public.carts (status, updated_at desc);
create index carts_customer_idx on public.carts (customer_id);
create index carts_discount_idx on public.carts (discount_id);
create index carts_converted_order_idx on public.carts (converted_order_id);
create index carts_abandoned_idx on public.carts (abandoned_at desc)
  where status = 'abandoned' and recovery_email_sent_at is null;
create index carts_expiry_idx on public.carts (expires_at) where status = 'active';

-- -----------------------------------------------------------------------------
create table public.cart_items (
  id            uuid primary key default gen_random_uuid(),
  cart_id       uuid not null,
  currency      public.currency_code not null default 'NZD',
  product_id    uuid not null,
  variant_id    uuid not null,
  quantity      integer not null,
  unit_price_cents integer not null,
  line_total_cents integer generated always as (quantity * unit_price_cents) stored,
  properties    jsonb not null default '{}',
  shopify_gid   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint cart_items_quantity_positive check (quantity > 0),
  constraint cart_items_price_nonneg check (unit_price_cents >= 0),
  unique (cart_id, variant_id),
  -- The line's currency must be the cart's currency.
  foreign key (cart_id, currency) references public.carts (id, currency) on delete cascade,
  -- The line's variant must belong to the line's product.
  foreign key (variant_id, product_id)
    references public.product_variants (id, product_id) on delete cascade
);

create index cart_items_cart_idx on public.cart_items (cart_id, currency);
create index cart_items_variant_idx on public.cart_items (variant_id, product_id);
create index cart_items_product_idx on public.cart_items (product_id);

-- =============================================================================
-- ORDERS
-- =============================================================================

create table public.orders (
  id            uuid primary key default gen_random_uuid(),
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,

  order_number  text not null unique
                  default 'HS-' || lpad(nextval('public.order_number_seq')::text, 5, '0'),
  customer_id   uuid references public.customers (id) on delete set null,
  email         text not null,
  phone         text,
  status        public.order_status not null default 'open',
  financial_status public.order_financial_status not null default 'pending',
  fulfillment_status public.order_fulfillment_status not null default 'unfulfilled',
  channel       public.sales_channel not null default 'online',
  currency      public.currency_code not null default 'NZD',

  subtotal_cents  integer not null default 0,
  discount_cents  integer not null default 0,
  shipping_cents  integer not null default 0,
  tax_cents       integer not null default 0,
  total_cents     integer not null default 0,
  refunded_cents  integer not null default 0,
  tax_rate_bp     integer not null default 1500,
  tax_inclusive   boolean not null default true,

  shipping_address_id uuid references public.addresses (id) on delete set null,
  billing_address_id  uuid references public.addresses (id) on delete set null,
  shipping_method text,
  tracking_carrier text,
  tracking_number text,
  tracking_url  text,
  discount_id   uuid references public.discounts (id) on delete set null,
  discount_code text,
  cart_id       uuid references public.carts (id) on delete set null,
  payment_gateway text,
  note          text,
  customer_note text,
  tags          text[] not null default '{}',

  placed_at     timestamptz not null default now(),
  paid_at       timestamptz,
  fulfilled_at  timestamptz,
  delivered_at  timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint orders_email_format check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint orders_money_nonneg check (
    subtotal_cents >= 0 and discount_cents >= 0 and shipping_cents >= 0
    and tax_cents >= 0 and total_cents >= 0 and refunded_cents >= 0),
  constraint orders_tax_rate_range check (tax_rate_bp between 0 and 10000),
  constraint orders_discount_within_subtotal check (discount_cents <= subtotal_cents),
  constraint orders_refund_within_total check (refunded_cents <= total_cents),
  -- The invoice has to add up. NZ pricing is GST-inclusive, so tax_cents is the
  -- GST component already inside total_cents rather than something added on.
  constraint orders_total_balances check (
    total_cents = subtotal_cents - discount_cents + shipping_cents
                  + (case when tax_inclusive then 0 else tax_cents end)),
  constraint orders_paid_stamped check (
    financial_status not in ('paid', 'partially_refunded', 'refunded') or paid_at is not null),
  constraint orders_refund_status_agrees check (
    (refunded_cents > 0) = (financial_status in ('partially_refunded', 'refunded'))),
  constraint orders_full_refund check (
    financial_status <> 'refunded' or refunded_cents = total_cents),
  constraint orders_fulfilled_stamped check (
    fulfillment_status not in ('fulfilled', 'delivered') or fulfilled_at is not null),
  constraint orders_delivered_stamped check (
    (fulfillment_status = 'delivered') = (delivered_at is not null)),
  constraint orders_delivered_after_fulfilled check (
    delivered_at is null or delivered_at >= fulfilled_at),
  constraint orders_cancelled_stamped check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint orders_cancelled_has_reason check (cancelled_at is null or cancel_reason is not null),
  constraint orders_dates_after_placed check (
    (paid_at is null or paid_at >= placed_at)
    and (fulfilled_at is null or fulfilled_at >= placed_at)
    and (cancelled_at is null or cancelled_at >= placed_at)),
  constraint orders_tracking_pair check ((tracking_number is null) = (tracking_carrier is null)),
  unique (id, currency)
);

create index orders_placed_idx on public.orders (placed_at desc);
create index orders_customer_idx on public.orders (customer_id, placed_at desc);
create index orders_status_idx on public.orders (status, financial_status, placed_at desc);
create index orders_fulfillment_idx on public.orders (fulfillment_status, placed_at)
  where status = 'open';
create index orders_channel_idx on public.orders (channel, placed_at desc);
create index orders_shipping_address_idx on public.orders (shipping_address_id);
create index orders_billing_address_idx on public.orders (billing_address_id);
create index orders_discount_idx on public.orders (discount_id);
create index orders_cart_idx on public.orders (cart_id);
create index orders_email_idx on public.orders (lower(email));
create index orders_total_idx on public.orders (total_cents desc);
create index orders_tags_idx on public.orders using gin (tags);

alter table public.carts
  add constraint carts_converted_order_fk
  foreign key (converted_order_id) references public.orders (id) on delete set null;

-- -----------------------------------------------------------------------------
create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null,
  currency      public.currency_code not null default 'NZD',
  product_id    uuid not null,
  variant_id    uuid not null,
  shopify_gid   text,
  sku           text not null,
  title         text not null,
  variant_title text,
  quantity      integer not null,
  quantity_fulfilled integer not null default 0,
  quantity_refunded  integer not null default 0,
  unit_price_cents integer not null,
  unit_cost_cents  integer,
  discount_cents integer not null default 0,
  tax_cents     integer not null default 0,
  line_total_cents integer not null,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_fulfilled_within check (quantity_fulfilled between 0 and quantity),
  constraint order_items_refunded_within check (quantity_refunded between 0 and quantity),
  constraint order_items_money_nonneg check (
    unit_price_cents >= 0 and discount_cents >= 0 and tax_cents >= 0
    and line_total_cents >= 0 and (unit_cost_cents is null or unit_cost_cents >= 0)),
  constraint order_items_line_balances check (
    line_total_cents = quantity * unit_price_cents - discount_cents),
  -- Line currency must equal order currency.
  foreign key (order_id, currency) references public.orders (id, currency) on delete cascade,
  -- The line's variant must belong to the line's product. Orders are permanent
  -- records, so the catalogue cannot be hard-deleted out from under them.
  foreign key (variant_id, product_id)
    references public.product_variants (id, product_id) on delete restrict,
  -- Composite key so a batch can only be traced to a line of the same product.
  unique (id, product_id),
  unique (id, variant_id)
);

create index order_items_order_idx on public.order_items (order_id, currency, position);
create index order_items_variant_idx on public.order_items (variant_id, product_id);
create index order_items_product_idx on public.order_items (product_id);
create index order_items_sku_idx on public.order_items (sku);

-- -----------------------------------------------------------------------------
create table public.discount_redemptions (
  id            uuid primary key default gen_random_uuid(),
  discount_id   uuid not null references public.discounts (id) on delete cascade,
  order_id      uuid not null references public.orders (id) on delete cascade,
  customer_id   uuid references public.customers (id) on delete set null,
  amount_cents  integer not null,
  redeemed_at   timestamptz not null default now(),

  constraint discount_redemptions_amount_nonneg check (amount_cents >= 0),
  unique (discount_id, order_id)
);

create index discount_redemptions_order_idx on public.discount_redemptions (order_id);
create index discount_redemptions_customer_idx on public.discount_redemptions (customer_id, redeemed_at desc);
create index discount_redemptions_discount_idx on public.discount_redemptions (discount_id, redeemed_at desc);

-- =============================================================================
-- SUBSCRIPTIONS  (Shopify subscription contracts, or local when mock)
-- =============================================================================

create table public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  provider      public.commerce_provider not null default 'shopify',
  shopify_gid   text,
  shopify_updated_at timestamptz,
  sync_status   public.sync_status not null default 'pending',
  synced_at     timestamptz,
  sync_error    text,

  customer_id   uuid not null references public.customers (id) on delete cascade,
  status        public.subscription_status not null default 'active',
  interval_unit public.subscription_interval not null default 'month',
  interval_count integer not null default 1,
  currency      public.currency_code not null default 'NZD',
  discount_bp   integer not null default 0,
  shipping_address_id uuid,
  delivery_price_cents integer not null default 0,
  started_at    timestamptz not null default now(),
  next_billing_at timestamptz,
  last_billed_at  timestamptz,
  paused_at     timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text,
  cycles_completed integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint subscriptions_interval_positive check (interval_count > 0),
  constraint subscriptions_discount_range check (discount_bp between 0 and 10000),
  constraint subscriptions_delivery_nonneg check (delivery_price_cents >= 0),
  constraint subscriptions_cycles_nonneg check (cycles_completed >= 0),
  constraint subscriptions_active_has_next check (status <> 'active' or next_billing_at is not null),
  constraint subscriptions_paused_stamped check ((status = 'paused') = (paused_at is not null)),
  constraint subscriptions_cancelled_stamped check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint subscriptions_cancelled_has_reason check (cancelled_at is null or cancel_reason is not null),
  constraint subscriptions_billed_after_start check (last_billed_at is null or last_billed_at >= started_at),
  -- Ship-to must be one of this customer's own addresses.
  foreign key (shipping_address_id, customer_id)
    references public.addresses (id, customer_id) on delete set null (shipping_address_id),
  unique (id, currency)
);

create index subscriptions_customer_idx on public.subscriptions (customer_id, status);
create index subscriptions_due_idx on public.subscriptions (next_billing_at)
  where status = 'active';
create index subscriptions_status_idx on public.subscriptions (status, started_at desc);
create index subscriptions_address_idx on public.subscriptions (shipping_address_id, customer_id);

-- -----------------------------------------------------------------------------
create table public.subscription_items (
  id            uuid primary key default gen_random_uuid(),
  subscription_id uuid not null,
  currency      public.currency_code not null default 'NZD',
  product_id    uuid not null,
  variant_id    uuid not null,
  quantity      integer not null,
  unit_price_cents integer not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint subscription_items_quantity_positive check (quantity > 0),
  constraint subscription_items_price_nonneg check (unit_price_cents >= 0),
  unique (subscription_id, variant_id),
  foreign key (subscription_id, currency)
    references public.subscriptions (id, currency) on delete cascade,
  foreign key (variant_id, product_id)
    references public.product_variants (id, product_id) on delete restrict
);

create index subscription_items_subscription_idx on public.subscription_items (subscription_id, currency);
create index subscription_items_variant_idx on public.subscription_items (variant_id, product_id);
create index subscription_items_product_idx on public.subscription_items (product_id);

-- =============================================================================
-- INVENTORY LEDGER
-- Every movement of stock, with the reason and (where relevant) the batch or
-- order line that caused it. inventory_levels is the running total; this is the
-- history that explains it.
-- =============================================================================

create table public.inventory_adjustments (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid not null references public.product_variants (id) on delete cascade,
  location_id   uuid not null references public.inventory_locations (id) on delete cascade,
  delta         integer not null,
  reason        public.inventory_reason not null,
  batch_id      uuid,
  order_item_id uuid references public.order_items (id) on delete set null,
  approval_id   uuid references public.approvals (id) on delete set null,
  note          text,
  actor_type    public.actor_type not null default 'operator',
  actor_id      uuid,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  constraint inventory_adjustments_delta_nonzero check (delta <> 0),
  constraint inventory_adjustments_sale_is_negative check (reason <> 'sale' or delta < 0),
  constraint inventory_adjustments_release_is_positive check (reason <> 'batch_release' or delta > 0),
  constraint inventory_adjustments_release_has_batch check (reason <> 'batch_release' or batch_id is not null),
  constraint inventory_adjustments_sale_has_line check (reason <> 'sale' or order_item_id is not null)
);

create index inventory_adjustments_variant_idx on public.inventory_adjustments (variant_id, occurred_at desc);
create index inventory_adjustments_location_idx on public.inventory_adjustments (location_id, occurred_at desc);
create index inventory_adjustments_batch_idx on public.inventory_adjustments (batch_id);
create index inventory_adjustments_order_item_idx on public.inventory_adjustments (order_item_id);
create index inventory_adjustments_approval_idx on public.inventory_adjustments (approval_id);
create index inventory_adjustments_reason_idx on public.inventory_adjustments (reason, occurred_at desc);

-- =============================================================================
-- MIRROR INVARIANTS
--
-- Applied in one loop over the mirrored tables so the rule is written once and
-- cannot drift table to table:
--   1. provider = 'local'  <=>  sync_status = 'local'   (the discriminator)
--   2. a local row carries no Shopify identity at all
--   3. a row cannot claim to be 'synced' without a gid and a synced_at
--   4. gids are well-formed Shopify global IDs
-- Plus the unique index on shopify_gid that makes upsert-by-gid idempotent, and
-- the resync queue index.
-- =============================================================================
do $$
declare
  t text;
  mirrored text[] := array[
    'products', 'product_variants', 'product_images', 'collections',
    'inventory_locations', 'inventory_levels', 'customers', 'addresses',
    'discounts', 'carts', 'orders', 'subscriptions'
  ];
begin
  foreach t in array mirrored loop
    execute format($f$
      alter table public.%1$I
        add constraint %1$s_provider_discriminator
          check ((provider = 'local') = (sync_status = 'local')),
        add constraint %1$s_local_has_no_shopify_identity
          check (provider = 'shopify'
                 or (shopify_gid is null and synced_at is null and shopify_updated_at is null)),
        add constraint %1$s_synced_has_identity
          check (sync_status <> 'synced' or (shopify_gid is not null and synced_at is not null)),
        add constraint %1$s_gid_format
          check (shopify_gid is null
                 or shopify_gid ~ '^gid://shopify/[A-Za-z]+/[A-Za-z0-9_.-]+(\?[A-Za-z0-9_=&%%.-]*)?$')
    $f$, t);

    execute format(
      'create unique index %1$s_shopify_gid_key on public.%1$I (shopify_gid) where shopify_gid is not null', t);
    execute format(
      'create index %1$s_resync_idx on public.%1$I (synced_at nulls first) where sync_status in (''pending'', ''stale'', ''failed'')', t);
  end loop;
end;
$$;

alter table public.products             enable row level security;
alter table public.product_variants     enable row level security;
alter table public.product_images       enable row level security;
alter table public.collections          enable row level security;
alter table public.collection_products  enable row level security;
alter table public.inventory_locations  enable row level security;
alter table public.inventory_levels     enable row level security;
alter table public.customers            enable row level security;
alter table public.addresses            enable row level security;
alter table public.discounts            enable row level security;
alter table public.carts                enable row level security;
alter table public.cart_items           enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.discount_redemptions enable row level security;
alter table public.subscriptions        enable row level security;
alter table public.subscription_items   enable row level security;
alter table public.inventory_adjustments enable row level security;
