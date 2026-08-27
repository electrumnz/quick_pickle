-- =============================================================================
-- HALF SOUR — 02 BRAND
-- The brand kit, and the machine-readable style rules the agents read before
-- they write anything. brand_rules is not documentation: it is the constraint
-- set a copy agent must satisfy, and the reason a caption can be auto-checked.
-- =============================================================================

create type public.brand_asset_kind as enum (
  'logo', 'wordmark', 'colour', 'typeface', 'photo', 'illustration',
  'icon', 'label', 'pattern', 'template', 'audio'
);

create type public.brand_rule_kind as enum (
  'voice', 'visual', 'naming', 'legal', 'channel', 'product', 'compliance', 'pricing'
);

-- 'must' and 'never' are hard gates an agent may not cross without an approval;
-- 'should' is advisory and shows up as a soft warning in the admin.
create type public.brand_rule_severity as enum ('must', 'should', 'never');

-- -----------------------------------------------------------------------------
-- brand_assets
-- -----------------------------------------------------------------------------
create table public.brand_assets (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  kind            public.brand_asset_kind not null,
  description     text,
  storage_bucket  text not null default 'brand',
  storage_path    text,
  public_url      text,
  mime_type       text,
  width_px        integer,
  height_px       integer,
  file_size_bytes bigint,
  hex_value       text,
  font_family     text,
  font_weight     integer,
  usage_notes     text,
  restrictions    text,
  is_public       boolean not null default true,
  is_primary      boolean not null default false,
  version         integer not null default 1,
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint brand_assets_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint brand_assets_dims_positive check (
    (width_px is null or width_px > 0) and (height_px is null or height_px > 0)),
  constraint brand_assets_size_nonneg check (file_size_bytes is null or file_size_bytes >= 0),
  constraint brand_assets_version_positive check (version > 0),
  constraint brand_assets_font_weight_range check (font_weight is null or font_weight between 100 and 1000),
  -- A colour swatch is defined by its hex and nothing else; a file asset needs a file.
  constraint brand_assets_colour_has_hex check ((kind = 'colour') = (hex_value is not null)),
  constraint brand_assets_hex_format check (hex_value is null or hex_value ~ '^#[0-9A-Fa-f]{6}$'),
  constraint brand_assets_typeface_has_family check (kind <> 'typeface' or font_family is not null),
  constraint brand_assets_file_present check (
    kind in ('colour', 'typeface') or storage_path is not null or public_url is not null)
);

create unique index brand_assets_primary_per_kind on public.brand_assets (kind) where is_primary;
create index brand_assets_kind_idx on public.brand_assets (kind, name);
create index brand_assets_public_idx on public.brand_assets (kind) where is_public;
create index brand_assets_tags_idx on public.brand_assets using gin (tags);

comment on table public.brand_assets is
  'Logos, colours, typefaces and shot library. is_public rows are readable by the anonymous storefront.';

-- -----------------------------------------------------------------------------
-- brand_rules
-- The agents pull `select rule from brand_rules where is_active order by priority`
-- into their system prompt. Editing a row changes agent behaviour with no deploy.
-- -----------------------------------------------------------------------------
create table public.brand_rules (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  kind         public.brand_rule_kind not null,
  severity     public.brand_rule_severity not null default 'must',
  title        text not null,
  rule         text not null,
  rationale    text,
  good_example text,
  bad_example  text,
  applies_to   text[] not null default '{}',
  keywords     text[] not null default '{}',
  priority     integer not null default 100,
  is_active    boolean not null default true,
  brand_asset_id uuid references public.brand_assets (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint brand_rules_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint brand_rules_rule_present check (btrim(rule) <> ''),
  constraint brand_rules_priority_range check (priority between 1 and 1000),
  -- A 'never' rule is only enforceable if we can say what tripped it.
  constraint brand_rules_never_has_keywords check (severity <> 'never' or cardinality(keywords) > 0)
);

create index brand_rules_active_idx on public.brand_rules (priority, kind) where is_active;
create index brand_rules_kind_idx on public.brand_rules (kind, severity);
create index brand_rules_asset_idx on public.brand_rules (brand_asset_id);
create index brand_rules_applies_idx on public.brand_rules using gin (applies_to);
create index brand_rules_keywords_idx on public.brand_rules using gin (keywords);

comment on column public.brand_rules.keywords is
  'Trigger words for the deterministic pre-flight check that runs before a caption reaches an approval queue.';

alter table public.brand_assets enable row level security;
alter table public.brand_rules  enable row level security;
