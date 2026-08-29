-- =============================================================================
-- HALF SOUR — 10 MARKETING ASSETS
--
-- The founder's own photos and video: the market stall, the bar that put No 02
-- on its list, a batch coming off the line. `content_assets` already holds what
-- the company PRODUCES for a channel; this table holds what she SHOT, and it
-- carries the four facts an agent needs before it may put a picture in front of
-- anyone:
--
--   1. a description of what is actually in the frame,
--   2. the occasion and the date it happened,
--   3. which products appear, joined to real variant SKUs,
--   4. whether the people in it agreed to be published.
--
-- (4) is the reason this is a table and not a folder. `selectable_for_outbound`
-- is a STORED GENERATED column: it is computed by Postgres from the consent and
-- rights columns and cannot be set by an INSERT, an UPDATE, or an agent. The
-- read tool in lib/assets/tools.ts filters on it, and lib/assets/consent.ts
-- checks the same rule a second time in TypeScript. Two independent gates, one
-- rule, and neither of them is a warning in the interface.
--
-- Nothing here is a publishing path. An agent may find and cite an asset; the
-- caption it writes still goes through `approvals` like every other outbound
-- act, and the approval carries the asset id so the founder sees the picture
-- rather than a filename.
-- =============================================================================

-- A file we hold bytes for. Copy, audio and PDFs stay in `content_assets`.
create type public.marketing_asset_kind as enum ('photo', 'video');

-- Consent is four-valued on purpose. 'unrecorded' is not the same as 'refused',
-- and neither of them is usable — but the founder needs to be able to tell the
-- difference between "I have not asked her yet" and "she said no".
create type public.marketing_asset_consent as enum (
  'no_people', 'granted', 'refused', 'unrecorded'
);

create type public.marketing_asset_rights as enum (
  'own_work', 'permission_given', 'licensed', 'unknown'
);

-- Where the words in `description` came from. A model draft is allowed to exist
-- but is never allowed to look like the founder wrote it.
create type public.marketing_asset_description_source as enum (
  'founder', 'model_draft', 'model_edited'
);

-- -----------------------------------------------------------------------------
-- marketing_assets
-- -----------------------------------------------------------------------------
create table public.marketing_assets (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  kind                public.marketing_asset_kind not null,

  -- What it is, in words. Both required: a library an agent cannot read is a
  -- folder, and a folder is what this replaces.
  title               text not null,
  description         text not null,
  description_source  public.marketing_asset_description_source not null default 'founder',
  description_model   text,

  -- When and where it happened. `occasion_on` is a date rather than a timestamp
  -- because "the Sunday market" is a day, not an instant, and an agent choosing
  -- a summer photo in July needs the day and the month, not the minute.
  occasion            text,
  occasion_on         date,
  -- Read out of the file's own metadata before that metadata was destroyed.
  captured_at         timestamptz,

  -- Consent. See the header.
  people_present      boolean not null default false,
  people_consent      public.marketing_asset_consent not null default 'unrecorded',
  consent_note        text,
  consent_recorded_at timestamptz,
  consent_recorded_by uuid references public.operators (id) on delete set null,

  usage_rights        public.marketing_asset_rights not null default 'own_work',
  credit              text,
  rights_expire_on    date,

  tags                text[] not null default '{}',

  -- The bytes. `storage_key` is opaque to everything except the storage
  -- provider; `checksum_sha256` is over the bytes as stored, after the metadata
  -- scrub, which is what makes re-uploading the same photo a no-op.
  storage_backend     text not null default 'local',
  storage_key         text not null unique,
  poster_storage_key  text,
  mime_type           text not null,
  byte_size           bigint not null,
  checksum_sha256     text not null unique,
  original_filename   text not null,

  width_px            integer,
  height_px           integer,
  duration_ms         integer,

  -- Proof of the scrub, kept as data so the admin can say it out loud.
  metadata_stripped   boolean not null default true,
  had_location_metadata boolean not null default false,

  uploaded_by         uuid references public.operators (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Shape, so an agent can pick something that fits the frame it is filling.
  -- 9:16 is 0.5625, 1:1 is 1.0, 4:5 is 0.8, 16:9 is 1.7778.
  aspect_ratio numeric(8, 4) generated always as (
    case when width_px is null or height_px is null or height_px = 0 then null
         else round(width_px::numeric / height_px::numeric, 4) end
  ) stored,

  -- THE GATE. Generated, so no writer anywhere can set it directly.
  selectable_for_outbound boolean generated always as (
    people_consent in ('no_people', 'granted') and usage_rights <> 'unknown'
  ) stored,

  constraint marketing_assets_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint marketing_assets_title_present check (btrim(title) <> ''),
  constraint marketing_assets_description_present check (btrim(description) <> ''),
  constraint marketing_assets_model_named check (
    description_source = 'founder' or description_model is not null),
  -- 'no_people' is the answer to "are there people in it", not a way to skip the
  -- question: the two columns must agree, in both directions.
  constraint marketing_assets_consent_matches_people check (
    (people_present = false) = (people_consent = 'no_people')),
  -- A decision either way is stamped with when it was made.
  constraint marketing_assets_consent_stamped check (
    people_consent not in ('granted', 'refused') or consent_recorded_at is not null),
  constraint marketing_assets_credit_when_not_ours check (
    usage_rights in ('own_work', 'unknown') or btrim(coalesce(credit, '')) <> ''),
  constraint marketing_assets_backend_known check (storage_backend in ('local', 'supabase')),
  constraint marketing_assets_checksum_format check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint marketing_assets_size_positive check (byte_size > 0),
  constraint marketing_assets_dims_positive check (
    (width_px is null or width_px > 0) and (height_px is null or height_px > 0)),
  constraint marketing_assets_photo_has_dims check (
    kind <> 'photo' or (width_px is not null and height_px is not null)),
  constraint marketing_assets_duration_positive check (duration_ms is null or duration_ms > 0),
  -- A photo we did not scrub is a photo we do not keep.
  constraint marketing_assets_photo_scrubbed check (kind <> 'photo' or metadata_stripped),
  constraint marketing_assets_mime_allowed check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm'))
);

create index marketing_assets_kind_idx on public.marketing_assets (kind, created_at desc);
create index marketing_assets_occasion_idx on public.marketing_assets (occasion_on desc nulls last);
create index marketing_assets_consent_idx on public.marketing_assets (people_consent, created_at desc);
create index marketing_assets_usable_idx on public.marketing_assets (created_at desc)
  where selectable_for_outbound;
create index marketing_assets_tags_idx on public.marketing_assets using gin (tags);
create index marketing_assets_aspect_idx on public.marketing_assets (aspect_ratio);
create index marketing_assets_uploader_idx on public.marketing_assets (uploaded_by);
create index marketing_assets_consent_by_idx on public.marketing_assets (consent_recorded_by);

comment on table public.marketing_assets is
  'Photos and video the founder shot herself. selectable_for_outbound is generated: an agent cannot select an asset whose people-consent is unrecorded or refused.';
comment on column public.marketing_assets.selectable_for_outbound is
  'Generated, not writable. false whenever people_consent is unrecorded or refused, or usage rights are unknown. The agent-facing tool filters on this column.';
comment on column public.marketing_assets.checksum_sha256 is
  'SHA-256 over the bytes AS STORED, i.e. after the metadata scrub. Unique, so the same photo uploaded twice is one row.';
comment on column public.marketing_assets.had_location_metadata is
  'True when the uploaded file carried GPS coordinates. The coordinates themselves are never stored — only the fact that they were found and removed.';
comment on column public.marketing_assets.description_source is
  'founder = her words. model_draft = drafted by a vision model and not yet edited; the admin labels it and the agents are told so.';

-- -----------------------------------------------------------------------------
-- marketing_asset_products — which bottles are actually in the frame
-- Joined to the variant, because the SKU (HS-01-500) is a variant, and an agent
-- writing about No 01 HOUSE needs the picture that has No 01 HOUSE in it.
-- -----------------------------------------------------------------------------
create table public.marketing_asset_products (
  asset_id   uuid not null references public.marketing_assets (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (asset_id, variant_id)
);

create index marketing_asset_products_variant_idx
  on public.marketing_asset_products (variant_id);

comment on table public.marketing_asset_products is
  'Which products appear in an asset. The asset side of the key is the leading column, so "what is in this photo" is an index scan.';

-- -----------------------------------------------------------------------------
-- Access. Same model as every other back-office table: operators and the
-- server-side runtime, and nothing for anon — these are the founder's own
-- photographs and some of them have other people in them.
-- -----------------------------------------------------------------------------
alter table public.marketing_assets          enable row level security;
alter table public.marketing_asset_products  enable row level security;

create policy marketing_assets_operator_all on public.marketing_assets
  for all to authenticated
  using (public.is_operator())
  with check (public.is_operator());

create policy marketing_asset_products_operator_all on public.marketing_asset_products
  for all to authenticated
  using (public.is_operator())
  with check (public.is_operator());

grant all on public.marketing_assets, public.marketing_asset_products
  to authenticated, service_role;
revoke all on public.marketing_assets, public.marketing_asset_products from anon;

create trigger set_updated_at before update on public.marketing_assets
  for each row execute function public.set_updated_at();
