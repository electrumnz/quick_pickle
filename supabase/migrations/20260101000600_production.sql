-- =============================================================================
-- HALF SOUR — 06 PRODUCTION
--
-- Suppliers -> ingredients -> versioned recipes -> batches -> the order lines
-- that shipped from each batch.
--
-- The last link is the point of this whole file. New Zealand's Food Act 2014
-- requires a food business to trace product one step forward and one step back,
-- and to withdraw a defined lot on demand. So batch->order_item is not a
-- convenience join; it is the recall query:
--
--   select o.order_number, o.email, oib.quantity
--     from order_item_batches oib
--     join order_items oi on oi.id = oib.order_item_id
--     join orders o on o.id = oi.order_id
--    where oib.batch_id = :recalled_batch;
--
-- and upstream, batch_ingredients.supplier_lot_code answers "whose dill was it".
-- =============================================================================

create type public.supplier_status as enum ('active', 'inactive', 'on_hold', 'blacklisted');
create type public.ingredient_category as enum (
  'produce', 'spice', 'herb', 'acid', 'salt', 'sweetener', 'water',
  'culture', 'additive', 'packaging', 'label'
);
create type public.storage_requirement as enum ('ambient', 'dry', 'chilled', 'frozen');
create type public.recipe_status as enum ('draft', 'active', 'retired');
create type public.batch_status as enum (
  'planned', 'brewing', 'fermenting', 'conditioning', 'bottling',
  'qa_hold', 'released', 'sold_out', 'recalled', 'discarded'
);
create type public.purchase_order_status as enum (
  'draft', 'pending_approval', 'ordered', 'partially_received', 'received', 'cancelled'
);

create sequence public.purchase_order_number_seq start with 101 increment by 1;

-- =============================================================================
-- SUPPLIERS AND INGREDIENTS
-- =============================================================================

create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  contact_name  text,
  email         text,
  phone         text,
  website       text,
  address_line  text,
  suburb        text,
  city          text,
  region        text,
  postcode      text,
  country_code  text not null default 'NZ',
  status        public.supplier_status not null default 'active',
  payment_terms text,
  lead_time_days integer,
  minimum_order_cents integer,
  currency      public.currency_code not null default 'NZD',
  nzbn          text,
  gst_number    text,
  is_organic_certified boolean not null default false,
  food_safety_programme text,
  food_safety_expires_on date,
  rating        smallint,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint suppliers_code_format check (code ~ '^[A-Z][A-Z0-9_-]*$'),
  constraint suppliers_country_format check (country_code ~ '^[A-Z]{2}$'),
  constraint suppliers_email_format check (
    email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint suppliers_nzbn_format check (nzbn is null or nzbn ~ '^[0-9]{13}$'),
  constraint suppliers_lead_time_nonneg check (lead_time_days is null or lead_time_days >= 0),
  constraint suppliers_minimum_nonneg check (minimum_order_cents is null or minimum_order_cents >= 0),
  constraint suppliers_rating_range check (rating is null or rating between 1 and 5),
  -- A named food-safety programme has to have an expiry we can chase.
  constraint suppliers_fsp_dated check (
    food_safety_programme is null or food_safety_expires_on is not null)
);

create index suppliers_status_idx on public.suppliers (status, name);
create index suppliers_fsp_expiry_idx on public.suppliers (food_safety_expires_on)
  where food_safety_expires_on is not null;

-- -----------------------------------------------------------------------------
create table public.ingredients (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  category      public.ingredient_category not null,
  unit          public.unit_of_measure not null default 'kg',
  description   text,
  allergens     text[] not null default '{}',
  is_organic    boolean not null default false,
  is_gluten_free boolean not null default true,
  storage       public.storage_requirement not null default 'ambient',
  shelf_life_days integer,
  standard_cost_cents integer not null default 0,
  stock_on_hand numeric(12,3) not null default 0,
  reorder_point numeric(12,3) not null default 0,
  reorder_quantity numeric(12,3) not null default 0,
  preferred_supplier_id uuid references public.suppliers (id) on delete set null,
  spec_sheet_url text,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint ingredients_code_format check (code ~ '^[A-Z][A-Z0-9_-]*$'),
  constraint ingredients_cost_nonneg check (standard_cost_cents >= 0),
  constraint ingredients_quantities_nonneg check (
    stock_on_hand >= 0 and reorder_point >= 0 and reorder_quantity >= 0),
  constraint ingredients_shelf_life_positive check (shelf_life_days is null or shelf_life_days > 0),
  constraint ingredients_perishable_has_shelf_life check (
    storage = 'ambient' or shelf_life_days is not null)
);

create index ingredients_category_idx on public.ingredients (category, name) where is_active;
create index ingredients_supplier_idx on public.ingredients (preferred_supplier_id);
create index ingredients_reorder_idx on public.ingredients (stock_on_hand)
  where is_active and reorder_point > 0;
create index ingredients_allergens_idx on public.ingredients using gin (allergens);

comment on column public.ingredients.stock_on_hand is
  'A quantity in `unit`, not money — numeric is correct here. Money in this schema is always integer cents.';

-- -----------------------------------------------------------------------------
create table public.ingredient_suppliers (
  id            uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  supplier_id   uuid not null references public.suppliers (id) on delete cascade,
  supplier_sku  text,
  unit          public.unit_of_measure not null,
  pack_size     numeric(12,3) not null,
  pack_cost_cents integer not null,
  currency      public.currency_code not null default 'NZD',
  lead_time_days integer,
  minimum_quantity numeric(12,3),
  is_preferred  boolean not null default false,
  last_quoted_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint ingredient_suppliers_pack_positive check (pack_size > 0),
  constraint ingredient_suppliers_cost_nonneg check (pack_cost_cents >= 0),
  constraint ingredient_suppliers_lead_nonneg check (lead_time_days is null or lead_time_days >= 0),
  constraint ingredient_suppliers_min_positive check (minimum_quantity is null or minimum_quantity > 0),
  unique (ingredient_id, supplier_id)
);

create unique index ingredient_suppliers_one_preferred
  on public.ingredient_suppliers (ingredient_id) where is_preferred;
create index ingredient_suppliers_supplier_idx on public.ingredient_suppliers (supplier_id);
create index ingredient_suppliers_cost_idx on public.ingredient_suppliers (ingredient_id, pack_cost_cents);

-- =============================================================================
-- RECIPES  (versioned; a recipe is never edited in place once it has produced)
-- =============================================================================

create table public.recipes (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null,
  version       integer not null,
  name          text not null,
  description   text,
  product_id    uuid references public.products (id) on delete set null,
  status        public.recipe_status not null default 'draft',
  batch_size_litres numeric(10,2) not null,
  expected_yield_units integer,
  target_ph     numeric(3,2),
  target_salinity_pct numeric(4,2),
  target_brix   numeric(4,1),
  ferment_days  integer,
  steep_hours   integer,
  method        text,
  equipment     text[] not null default '{}',
  allergen_statement text,
  estimated_cost_cents integer,
  change_note   text,
  supersedes_recipe_id uuid references public.recipes (id) on delete set null,
  approved_by   uuid references public.operators (id) on delete set null,
  approved_at   timestamptz,
  approval_id   uuid references public.approvals (id) on delete set null,
  is_current    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint recipes_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint recipes_version_positive check (version > 0),
  constraint recipes_batch_size_positive check (batch_size_litres > 0),
  constraint recipes_yield_positive check (expected_yield_units is null or expected_yield_units > 0),
  constraint recipes_ph_range check (target_ph is null or target_ph between 0 and 14),
  constraint recipes_salinity_range check (target_salinity_pct is null or target_salinity_pct between 0 and 100),
  constraint recipes_ferment_nonneg check (ferment_days is null or ferment_days >= 0),
  constraint recipes_steep_nonneg check (steep_hours is null or steep_hours >= 0),
  constraint recipes_cost_nonneg check (estimated_cost_cents is null or estimated_cost_cents >= 0),
  constraint recipes_not_own_predecessor check (supersedes_recipe_id is null or supersedes_recipe_id <> id),
  -- Only an approved recipe may be run; only an active recipe may be current.
  constraint recipes_active_is_approved check (status <> 'active' or approved_at is not null),
  constraint recipes_approval_stamped check ((approved_at is null) = (approved_by is null)),
  constraint recipes_current_is_active check (is_current = false or status = 'active'),
  constraint recipes_v2plus_has_note check (version = 1 or change_note is not null),
  unique (slug, version),
  unique (id, product_id)
);

-- Exactly one current version per recipe line.
create unique index recipes_one_current_per_slug on public.recipes (slug) where is_current;
create index recipes_product_idx on public.recipes (product_id, version desc);
create index recipes_status_idx on public.recipes (status, slug, version desc);
create index recipes_supersedes_idx on public.recipes (supersedes_recipe_id);
create index recipes_approved_by_idx on public.recipes (approved_by);
create index recipes_approval_idx on public.recipes (approval_id);

comment on table public.recipes is
  'Immutable once active: a change is a new row with version + 1 and supersedes_recipe_id pointing back. Batches reference the exact version they were made from, so a recipe change can never rewrite the history of what was already bottled.';

-- -----------------------------------------------------------------------------
create table public.recipe_ingredients (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references public.recipes (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  quantity      numeric(12,3) not null,
  unit          public.unit_of_measure not null,
  percentage_of_batch numeric(5,2),
  step_order    integer not null default 0,
  preparation   text,
  is_optional   boolean not null default false,
  substitute_ingredient_id uuid references public.ingredients (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint recipe_ingredients_quantity_positive check (quantity > 0),
  constraint recipe_ingredients_percentage_range check (
    percentage_of_batch is null or percentage_of_batch between 0 and 100),
  constraint recipe_ingredients_step_nonneg check (step_order >= 0),
  constraint recipe_ingredients_substitute_differs check (
    substitute_ingredient_id is null or substitute_ingredient_id <> ingredient_id),
  unique (recipe_id, ingredient_id)
);

create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id, step_order);
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients (ingredient_id);
create index recipe_ingredients_substitute_idx on public.recipe_ingredients (substitute_ingredient_id);

-- =============================================================================
-- BATCHES
-- =============================================================================

create table public.batches (
  id            uuid primary key default gen_random_uuid(),
  batch_code    text not null unique,
  recipe_id     uuid not null references public.recipes (id) on delete restrict,
  product_id    uuid not null,
  variant_id    uuid,
  location_id   uuid references public.inventory_locations (id) on delete set null,
  status        public.batch_status not null default 'planned',

  planned_for   timestamptz,
  produced_at   timestamptz,
  bottled_at    timestamptz,
  released_at   timestamptz,
  expires_at    timestamptz,

  yield_litres  numeric(10,2) not null default 0,
  units_produced integer not null default 0,
  units_rejected integer not null default 0,
  units_remaining integer not null default 0,

  ingredient_cost_cents integer not null default 0,
  labour_cost_cents     integer not null default 0,
  packaging_cost_cents  integer not null default 0,
  overhead_cost_cents   integer not null default 0,
  total_cost_cents integer generated always as (
    ingredient_cost_cents + labour_cost_cents + packaging_cost_cents + overhead_cost_cents) stored,
  unit_cost_cents integer generated always as (
    case when units_produced > 0
         then ((ingredient_cost_cents + labour_cost_cents + packaging_cost_cents + overhead_cost_cents)
               / units_produced)::integer
    end) stored,

  ph_reading    numeric(3,2),
  salinity_pct  numeric(4,2),
  brix          numeric(4,1),
  qa_passed     boolean,
  qa_notes      text,
  qa_checked_by uuid references public.operators (id) on delete set null,
  qa_checked_at timestamptz,
  approval_id   uuid references public.approvals (id) on delete set null,
  recall_reason text,
  recalled_at   timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- HS-<PRODUCT>-<YYMMDD>-<RUN>, e.g. HS-DILL-260714-B
  constraint batches_code_format check (batch_code ~ '^HS-[A-Z0-9]{2,10}-[0-9]{6}-[A-Z]$'),
  constraint batches_yield_nonneg check (yield_litres >= 0),
  constraint batches_units_nonneg check (
    units_produced >= 0 and units_rejected >= 0 and units_remaining >= 0),
  constraint batches_rejected_within_produced check (units_rejected <= units_produced),
  constraint batches_remaining_within_produced check (units_remaining <= units_produced - units_rejected),
  constraint batches_costs_nonneg check (
    ingredient_cost_cents >= 0 and labour_cost_cents >= 0
    and packaging_cost_cents >= 0 and overhead_cost_cents >= 0),
  constraint batches_ph_range check (ph_reading is null or ph_reading between 0 and 14),
  constraint batches_salinity_range check (salinity_pct is null or salinity_pct between 0 and 100),

  -- Time only runs forwards.
  constraint batches_produced_after_planned check (
    produced_at is null or planned_for is null or produced_at >= planned_for),
  constraint batches_bottled_after_produced check (
    bottled_at is null or produced_at is null or bottled_at >= produced_at),
  constraint batches_released_after_bottled check (
    released_at is null or (bottled_at is not null and released_at >= bottled_at)),
  -- A batch cannot expire before it was made.
  constraint batches_expiry_after_production check (
    expires_at is null or produced_at is null or expires_at > produced_at),
  constraint batches_qa_stamped check (
    (qa_passed is null) = (qa_checked_at is null)),
  constraint batches_qa_checked_by check (qa_checked_at is null or qa_checked_by is not null),

  -- Nothing ships without a pass, a release date and a use-by.
  constraint batches_release_requires_qa check (
    status <> 'released' or (qa_passed is true and released_at is not null and expires_at is not null)),
  constraint batches_produced_states check (
    status not in ('bottling', 'qa_hold', 'released', 'sold_out', 'recalled') or produced_at is not null),
  constraint batches_recall_stamped check ((status = 'recalled') = (recalled_at is not null)),
  constraint batches_recall_has_reason check (recalled_at is null or recall_reason is not null),
  constraint batches_sold_out_is_empty check (status <> 'sold_out' or units_remaining = 0),

  -- Composite keys used by the traceability and inventory links below.
  unique (id, product_id),
  -- If the batch names a bottling SKU, that SKU must be on this product.
  foreign key (product_id) references public.products (id) on delete restrict,
  foreign key (variant_id, product_id)
    references public.product_variants (id, product_id) on delete restrict
);

create index batches_product_idx on public.batches (product_id, produced_at desc);
create index batches_variant_idx on public.batches (variant_id, product_id);
create index batches_recipe_idx on public.batches (recipe_id);
create index batches_location_idx on public.batches (location_id);
create index batches_status_idx on public.batches (status, produced_at desc);
create index batches_expiry_idx on public.batches (expires_at)
  where status in ('released', 'qa_hold');
create index batches_qa_by_idx on public.batches (qa_checked_by);
create index batches_approval_idx on public.batches (approval_id);
create index batches_available_idx on public.batches (product_id, expires_at)
  where status = 'released' and units_remaining > 0;

alter table public.inventory_adjustments
  add constraint inventory_adjustments_batch_fk
  foreign key (batch_id) references public.batches (id) on delete set null;

-- -----------------------------------------------------------------------------
-- batch_ingredients — one step BACK. Which supplier lot went into this batch.
-- -----------------------------------------------------------------------------
create table public.batch_ingredients (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.batches (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  supplier_id   uuid references public.suppliers (id) on delete set null,
  purchase_order_item_id uuid,
  quantity      numeric(12,3) not null,
  unit          public.unit_of_measure not null,
  unit_cost_cents integer not null default 0,
  total_cost_cents integer not null default 0,
  supplier_lot_code text,
  received_at   timestamptz,
  expires_at    timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint batch_ingredients_quantity_positive check (quantity > 0),
  constraint batch_ingredients_costs_nonneg check (unit_cost_cents >= 0 and total_cost_cents >= 0),
  constraint batch_ingredients_expiry_after_receipt check (
    expires_at is null or received_at is null or expires_at > received_at)
);

create unique index batch_ingredients_lot_key
  on public.batch_ingredients (batch_id, ingredient_id, coalesce(supplier_lot_code, ''));
create index batch_ingredients_batch_idx on public.batch_ingredients (batch_id);
create index batch_ingredients_ingredient_idx on public.batch_ingredients (ingredient_id, received_at desc);
create index batch_ingredients_supplier_idx on public.batch_ingredients (supplier_id);
create index batch_ingredients_po_item_idx on public.batch_ingredients (purchase_order_item_id);
-- The upstream recall query: "which batches contain lot X".
create index batch_ingredients_lot_idx on public.batch_ingredients (supplier_lot_code)
  where supplier_lot_code is not null;

-- -----------------------------------------------------------------------------
-- order_item_batches — one step FORWARD. Which customer got this batch.
--
-- `product_id` is carried on this row purely so it can be pinned by BOTH
-- composite foreign keys at once. That makes it structurally impossible to
-- trace a Fire Brine batch onto a Classic Dill order line: the product must
-- match on both sides or the row will not insert.
-- -----------------------------------------------------------------------------
create table public.order_item_batches (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null,
  batch_id      uuid not null,
  product_id    uuid not null,
  quantity      integer not null,
  shipped_at    timestamptz,
  note          text,
  created_at    timestamptz not null default now(),

  constraint order_item_batches_quantity_positive check (quantity > 0),
  unique (order_item_id, batch_id),
  foreign key (order_item_id, product_id)
    references public.order_items (id, product_id) on delete cascade,
  foreign key (batch_id, product_id)
    references public.batches (id, product_id) on delete restrict
);

create index order_item_batches_order_item_idx on public.order_item_batches (order_item_id, product_id);
-- The recall query runs on this one.
create index order_item_batches_batch_idx on public.order_item_batches (batch_id, product_id);
create index order_item_batches_product_idx on public.order_item_batches (product_id);
create index order_item_batches_shipped_idx on public.order_item_batches (shipped_at desc);

comment on table public.order_item_batches is
  'Food Act 2014 traceability: the shipped link from a production batch to the exact order lines it filled. Both foreign keys pin product_id, so a mis-traced shipment cannot be written.';

-- =============================================================================
-- PURCHASE ORDERS  (what "approve the reorder" actually creates)
-- =============================================================================

create table public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  po_number     text not null unique
                  default 'PO-' || lpad(nextval('public.purchase_order_number_seq')::text, 4, '0'),
  supplier_id   uuid not null references public.suppliers (id) on delete restrict,
  status        public.purchase_order_status not null default 'draft',
  currency      public.currency_code not null default 'NZD',
  subtotal_cents integer not null default 0,
  freight_cents integer not null default 0,
  tax_cents     integer not null default 0,
  total_cents   integer not null default 0,
  reference     text,
  notes         text,
  ordered_at    timestamptz,
  expected_at   timestamptz,
  received_at   timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text,
  created_by_agent_id uuid references public.agents (id) on delete set null,
  approval_id   uuid references public.approvals (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint purchase_orders_money_nonneg check (
    subtotal_cents >= 0 and freight_cents >= 0 and tax_cents >= 0 and total_cents >= 0),
  constraint purchase_orders_total_balances check (
    total_cents = subtotal_cents + freight_cents + tax_cents),
  constraint purchase_orders_expected_after_ordered check (
    expected_at is null or ordered_at is null or expected_at >= ordered_at),
  constraint purchase_orders_received_after_ordered check (
    received_at is null or (ordered_at is not null and received_at >= ordered_at)),
  constraint purchase_orders_ordered_stamped check (
    status not in ('ordered', 'partially_received', 'received') or ordered_at is not null),
  constraint purchase_orders_received_stamped check (
    status not in ('partially_received', 'received') or received_at is not null),
  constraint purchase_orders_cancelled_stamped check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint purchase_orders_cancelled_has_reason check (cancelled_at is null or cancel_reason is not null),
  -- An agent-raised PO waiting on the founder must point at its approval.
  constraint purchase_orders_pending_has_approval check (
    status <> 'pending_approval' or approval_id is not null),
  constraint purchase_orders_agent_orders_are_approved check (
    created_by_agent_id is null or status in ('draft', 'cancelled') or approval_id is not null),
  unique (id, currency)
);

create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id, ordered_at desc);
create index purchase_orders_status_idx on public.purchase_orders (status, expected_at);
create index purchase_orders_agent_idx on public.purchase_orders (created_by_agent_id);
create index purchase_orders_approval_idx on public.purchase_orders (approval_id);
create index purchase_orders_incoming_idx on public.purchase_orders (expected_at)
  where status in ('ordered', 'partially_received');

-- -----------------------------------------------------------------------------
create table public.purchase_order_items (
  id            uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null,
  currency      public.currency_code not null default 'NZD',
  ingredient_id uuid references public.ingredients (id) on delete restrict,
  description   text not null,
  quantity      numeric(12,3) not null,
  quantity_received numeric(12,3) not null default 0,
  unit          public.unit_of_measure not null,
  unit_cost_cents integer not null,
  line_total_cents integer not null,
  supplier_lot_code text,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint purchase_order_items_quantity_positive check (quantity > 0),
  constraint purchase_order_items_received_within check (
    quantity_received >= 0 and quantity_received <= quantity),
  constraint purchase_order_items_money_nonneg check (unit_cost_cents >= 0 and line_total_cents >= 0),
  foreign key (purchase_order_id, currency)
    references public.purchase_orders (id, currency) on delete cascade
);

create index purchase_order_items_po_idx on public.purchase_order_items (purchase_order_id, currency);
create index purchase_order_items_ingredient_idx on public.purchase_order_items (ingredient_id);

alter table public.batch_ingredients
  add constraint batch_ingredients_po_item_fk
  foreign key (purchase_order_item_id) references public.purchase_order_items (id) on delete set null;

alter table public.suppliers            enable row level security;
alter table public.ingredients          enable row level security;
alter table public.ingredient_suppliers enable row level security;
alter table public.recipes              enable row level security;
alter table public.recipe_ingredients   enable row level security;
alter table public.batches              enable row level security;
alter table public.batch_ingredients    enable row level security;
alter table public.order_item_batches   enable row level security;
alter table public.purchase_orders      enable row level security;
alter table public.purchase_order_items enable row level security;
