-- =============================================================================
-- HALF SOUR — 07 MARKETING
-- Social accounts and posts, the content library, campaigns, email sends and
-- customer reviews. Everything an agent drafts here carries approval_id, and the
-- hard cases (outreach email, anything published) cannot be marked done without
-- one.
-- =============================================================================

create type public.social_platform as enum (
  'instagram', 'tiktok', 'facebook', 'threads', 'x', 'linkedin', 'youtube', 'pinterest'
);

create type public.social_post_status as enum (
  'draft', 'pending_approval', 'scheduled', 'published', 'failed', 'archived'
);

create type public.content_asset_type as enum ('image', 'video', 'audio', 'copy', 'pdf', 'carousel');

create type public.campaign_channel as enum (
  'email', 'social_organic', 'social_paid', 'paid_search', 'influencer',
  'retail', 'event', 'wholesale', 'pr'
);

create type public.campaign_status as enum ('draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled');

create type public.email_send_kind as enum ('transactional', 'lifecycle', 'marketing', 'outreach');

create type public.email_send_status as enum (
  'draft', 'queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'cancelled'
);

create type public.review_status as enum ('pending', 'published', 'rejected', 'spam');

-- =============================================================================
-- SOCIAL ACCOUNTS
-- =============================================================================

create table public.social_accounts (
  id            uuid primary key default gen_random_uuid(),
  platform      public.social_platform not null,
  handle        text not null,
  display_name  text,
  profile_url   text,
  external_account_id text,
  -- Never the token itself: a pointer into Supabase Vault / the secret store.
  credential_ref text,
  is_active     boolean not null default true,
  followers_count integer not null default 0,
  following_count integer not null default 0,
  posts_count   integer not null default 0,
  connected_at  timestamptz,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint social_accounts_handle_format check (handle ~ '^[A-Za-z0-9._-]+$'),
  constraint social_accounts_counts_nonneg check (
    followers_count >= 0 and following_count >= 0 and posts_count >= 0),
  constraint social_accounts_active_is_connected check (
    is_active = false or (connected_at is not null and credential_ref is not null)),
  unique (platform, handle),
  -- Composite key so a post cannot claim a platform its account isn't on.
  unique (id, platform)
);

create index social_accounts_active_idx on public.social_accounts (platform) where is_active;
create index social_accounts_token_expiry_idx on public.social_accounts (token_expires_at)
  where is_active and token_expires_at is not null;

comment on column public.social_accounts.credential_ref is
  'Vault key name. Access tokens are never stored in a public-schema column.';

-- =============================================================================
-- CONTENT LIBRARY
-- =============================================================================

create table public.content_assets (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  asset_type    public.content_asset_type not null,
  storage_bucket text not null default 'content',
  storage_path  text,
  public_url    text,
  mime_type     text,
  width_px      integer,
  height_px     integer,
  duration_seconds integer,
  file_size_bytes bigint,
  alt_text      text,
  caption       text,
  body          text,
  tags          text[] not null default '{}',
  product_id    uuid references public.products (id) on delete set null,
  batch_id      uuid references public.batches (id) on delete set null,
  brand_asset_id uuid references public.brand_assets (id) on delete set null,
  created_by_agent_id uuid references public.agents (id) on delete set null,
  created_by_run_id   uuid references public.agent_runs (id) on delete set null,
  approval_id   uuid references public.approvals (id) on delete set null,
  is_approved   boolean not null default false,
  usage_rights  text,
  credit        text,
  shot_at       timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint content_assets_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint content_assets_dims_positive check (
    (width_px is null or width_px > 0) and (height_px is null or height_px > 0)),
  constraint content_assets_duration_positive check (duration_seconds is null or duration_seconds > 0),
  constraint content_assets_size_nonneg check (file_size_bytes is null or file_size_bytes >= 0),
  constraint content_assets_copy_has_body check (asset_type <> 'copy' or body is not null),
  constraint content_assets_file_has_location check (
    asset_type = 'copy' or storage_path is not null or public_url is not null),
  constraint content_assets_timed_media check (
    asset_type not in ('video', 'audio') or duration_seconds is not null),
  -- Agent-made assets only count as approved once an approval says so.
  constraint content_assets_agent_approval check (
    created_by_agent_id is null or is_approved = false or approval_id is not null)
);

create index content_assets_type_idx on public.content_assets (asset_type, created_at desc);
create index content_assets_product_idx on public.content_assets (product_id);
create index content_assets_batch_idx on public.content_assets (batch_id);
create index content_assets_brand_asset_idx on public.content_assets (brand_asset_id);
create index content_assets_agent_idx on public.content_assets (created_by_agent_id);
create index content_assets_run_idx on public.content_assets (created_by_run_id);
create index content_assets_approval_idx on public.content_assets (approval_id);
create index content_assets_approved_idx on public.content_assets (created_at desc) where is_approved;
create index content_assets_tags_idx on public.content_assets using gin (tags);

alter table public.product_images
  add constraint product_images_content_asset_fk
  foreign key (content_asset_id) references public.content_assets (id) on delete set null;

-- =============================================================================
-- CAMPAIGNS
-- =============================================================================

create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  objective     text not null,
  channel       public.campaign_channel not null,
  status        public.campaign_status not null default 'draft',
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  budget_cents  integer not null default 0,
  spend_cents   integer not null default 0,
  revenue_cents integer not null default 0,
  currency      public.currency_code not null default 'NZD',
  target_audience text,
  discount_id   uuid references public.discounts (id) on delete set null,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  owner_agent_id uuid references public.agents (id) on delete set null,
  approval_id   uuid references public.approvals (id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint campaigns_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint campaigns_money_nonneg check (
    budget_cents >= 0 and spend_cents >= 0 and revenue_cents >= 0),
  constraint campaigns_window check (ends_at is null or ends_at > starts_at),
  constraint campaigns_spend_within_budget check (budget_cents = 0 or spend_cents <= budget_cents),
  constraint campaigns_completed_has_end check (status <> 'completed' or ends_at is not null),
  constraint campaigns_paid_has_budget check (
    channel not in ('social_paid', 'paid_search') or budget_cents > 0)
);

create index campaigns_status_idx on public.campaigns (status, starts_at desc);
create index campaigns_channel_idx on public.campaigns (channel, starts_at desc);
create index campaigns_discount_idx on public.campaigns (discount_id);
create index campaigns_agent_idx on public.campaigns (owner_agent_id);
create index campaigns_approval_idx on public.campaigns (approval_id);
create index campaigns_live_idx on public.campaigns (starts_at, ends_at) where status = 'active';

-- =============================================================================
-- SOCIAL POSTS
-- =============================================================================

create table public.social_posts (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null,
  platform      public.social_platform not null,
  campaign_id   uuid references public.campaigns (id) on delete set null,
  status        public.social_post_status not null default 'draft',
  caption       text not null,
  hashtags      text[] not null default '{}',
  link_url      text,
  first_comment text,
  scheduled_for timestamptz,
  published_at  timestamptz,
  external_post_id text,
  permalink     text,
  impressions   integer not null default 0,
  reach         integer not null default 0,
  likes         integer not null default 0,
  comments_count integer not null default 0,
  shares        integer not null default 0,
  saves         integer not null default 0,
  link_clicks   integer not null default 0,
  metrics_synced_at timestamptz,
  error         text,
  product_id    uuid references public.products (id) on delete set null,
  batch_id      uuid references public.batches (id) on delete set null,
  created_by_agent_id uuid references public.agents (id) on delete set null,
  created_by_run_id   uuid references public.agent_runs (id) on delete set null,
  approval_id   uuid references public.approvals (id) on delete set null,
  brand_check_passed boolean,
  brand_check_notes  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint social_posts_caption_present check (btrim(caption) <> ''),
  constraint social_posts_caption_length check (char_length(caption) <= 2200),
  constraint social_posts_metrics_nonneg check (
    impressions >= 0 and reach >= 0 and likes >= 0 and comments_count >= 0
    and shares >= 0 and saves >= 0 and link_clicks >= 0),
  constraint social_posts_reach_within_impressions check (reach <= impressions),
  constraint social_posts_scheduled_has_time check (status <> 'scheduled' or scheduled_for is not null),
  constraint social_posts_published_stamped check ((status = 'published') = (published_at is not null)),
  constraint social_posts_published_has_external check (
    status <> 'published' or external_post_id is not null),
  constraint social_posts_failed_has_error check (status <> 'failed' or error is not null),
  constraint social_posts_pending_has_approval check (
    status <> 'pending_approval' or approval_id is not null),
  -- Nothing an agent wrote goes live without an approval attached.
  constraint social_posts_agent_publish_approved check (
    created_by_agent_id is null
    or status not in ('scheduled', 'published')
    or approval_id is not null),
  constraint social_posts_metrics_need_publish check (
    metrics_synced_at is null or published_at is not null),
  -- The post's platform must be the account's platform.
  foreign key (account_id, platform)
    references public.social_accounts (id, platform) on delete cascade
);

create index social_posts_account_idx on public.social_posts (account_id, platform);
create index social_posts_status_idx on public.social_posts (status, scheduled_for);
create index social_posts_calendar_idx on public.social_posts (scheduled_for)
  where status in ('scheduled', 'pending_approval');
create index social_posts_published_idx on public.social_posts (published_at desc)
  where status = 'published';
create index social_posts_campaign_idx on public.social_posts (campaign_id);
create index social_posts_product_idx on public.social_posts (product_id);
create index social_posts_batch_idx on public.social_posts (batch_id);
create index social_posts_agent_idx on public.social_posts (created_by_agent_id, created_at desc);
create index social_posts_run_idx on public.social_posts (created_by_run_id);
create index social_posts_approval_idx on public.social_posts (approval_id);
create index social_posts_engagement_idx on public.social_posts (impressions desc)
  where status = 'published';

-- -----------------------------------------------------------------------------
create table public.social_post_assets (
  post_id       uuid not null references public.social_posts (id) on delete cascade,
  asset_id      uuid not null references public.content_assets (id) on delete restrict,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (post_id, asset_id),
  constraint social_post_assets_position_nonneg check (position >= 0)
);

create index social_post_assets_asset_idx on public.social_post_assets (asset_id);
create index social_post_assets_order_idx on public.social_post_assets (post_id, position);

-- =============================================================================
-- EMAIL
-- =============================================================================

create table public.email_sends (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid references public.campaigns (id) on delete set null,
  customer_id   uuid references public.customers (id) on delete set null,
  order_id      uuid references public.orders (id) on delete set null,
  to_email      text not null,
  to_name       text,
  from_email    text not null default 'hello@halfsour.co.nz',
  reply_to      text,
  subject       text not null,
  preheader     text,
  template      text,
  body_text     text,
  kind          public.email_send_kind not null default 'marketing',
  status        public.email_send_status not null default 'draft',
  provider      text not null default 'resend',
  provider_message_id text,
  scheduled_for timestamptz,
  sent_at       timestamptz,
  delivered_at  timestamptz,
  first_opened_at timestamptz,
  last_clicked_at timestamptz,
  bounced_at    timestamptz,
  complained_at timestamptz,
  unsubscribed_at timestamptz,
  open_count    integer not null default 0,
  click_count   integer not null default 0,
  bounce_type   text,
  error         text,
  created_by_agent_id uuid references public.agents (id) on delete set null,
  created_by_run_id   uuid references public.agent_runs (id) on delete set null,
  approval_id   uuid references public.approvals (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint email_sends_to_format check (to_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint email_sends_from_format check (from_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint email_sends_subject_present check (btrim(subject) <> ''),
  constraint email_sends_counts_nonneg check (open_count >= 0 and click_count >= 0),
  constraint email_sends_sent_stamped check (
    status not in ('sent', 'delivered', 'bounced', 'complained') or sent_at is not null),
  constraint email_sends_delivered_stamped check ((status = 'delivered') = (delivered_at is not null)),
  constraint email_sends_bounced_stamped check ((status = 'bounced') = (bounced_at is not null)),
  constraint email_sends_failed_has_error check (status <> 'failed' or error is not null),
  constraint email_sends_engagement_needs_send check (
    (first_opened_at is null or sent_at is not null)
    and (last_clicked_at is null or sent_at is not null)),
  constraint email_sends_opens_agree check ((open_count > 0) = (first_opened_at is not null)),
  constraint email_sends_clicks_agree check ((click_count > 0) = (last_clicked_at is not null)),
  -- Cold outreach is the highest-risk thing an agent can send. It never leaves
  -- the building without an approval on the row.
  constraint email_sends_outreach_is_approved check (
    kind <> 'outreach' or status in ('draft', 'cancelled') or approval_id is not null),
  constraint email_sends_marketing_is_approved check (
    kind <> 'marketing' or created_by_agent_id is null
    or status in ('draft', 'cancelled') or approval_id is not null),
  constraint email_sends_transactional_has_context check (
    kind <> 'transactional' or order_id is not null or customer_id is not null)
);

create index email_sends_campaign_idx on public.email_sends (campaign_id, sent_at desc);
create index email_sends_customer_idx on public.email_sends (customer_id, sent_at desc);
create index email_sends_order_idx on public.email_sends (order_id);
create index email_sends_status_idx on public.email_sends (status, scheduled_for);
create index email_sends_to_idx on public.email_sends (lower(to_email), sent_at desc);
create index email_sends_kind_idx on public.email_sends (kind, sent_at desc);
create index email_sends_agent_idx on public.email_sends (created_by_agent_id);
create index email_sends_run_idx on public.email_sends (created_by_run_id);
create index email_sends_approval_idx on public.email_sends (approval_id);
create index email_sends_queue_idx on public.email_sends (scheduled_for)
  where status in ('draft', 'queued');

-- =============================================================================
-- REVIEWS
-- =============================================================================

create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  provider      public.commerce_provider not null default 'local',
  external_id   text,
  synced_at     timestamptz,
  product_id    uuid not null,
  variant_id    uuid,
  customer_id   uuid references public.customers (id) on delete set null,
  order_id      uuid references public.orders (id) on delete set null,
  author_name   text not null,
  author_email  text,
  author_location text,
  rating        smallint not null,
  title         text,
  body          text not null,
  status        public.review_status not null default 'pending',
  is_verified_purchase boolean not null default false,
  helpful_count integer not null default 0,
  reply_body    text,
  replied_at    timestamptz,
  replied_by_agent_id uuid references public.agents (id) on delete set null,
  approval_id   uuid references public.approvals (id) on delete set null,
  published_at  timestamptz,
  rejected_reason text,
  source        text not null default 'storefront',
  ip_address    inet,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint reviews_rating_range check (rating between 1 and 5),
  constraint reviews_body_present check (btrim(body) <> ''),
  constraint reviews_body_length check (char_length(body) between 4 and 5000),
  constraint reviews_helpful_nonneg check (helpful_count >= 0),
  constraint reviews_email_format check (
    author_email is null or author_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint reviews_published_stamped check ((status = 'published') = (published_at is not null)),
  constraint reviews_rejected_has_reason check (status <> 'rejected' or rejected_reason is not null),
  constraint reviews_reply_stamped check ((reply_body is null) = (replied_at is null)),
  constraint reviews_verified_has_order check (is_verified_purchase = false or order_id is not null),
  -- An agent-written reply is a published statement from the brand: approval required.
  constraint reviews_agent_reply_approved check (
    replied_by_agent_id is null or approval_id is not null),
  constraint reviews_provider_identity check ((provider = 'local') = (external_id is null)),
  -- The reviewed variant must belong to the reviewed product.
  foreign key (product_id) references public.products (id) on delete cascade,
  foreign key (variant_id, product_id)
    references public.product_variants (id, product_id) on delete set null (variant_id)
);

create unique index reviews_external_key on public.reviews (provider, external_id)
  where external_id is not null;
create index reviews_product_idx on public.reviews (product_id, status, created_at desc);
create index reviews_variant_idx on public.reviews (variant_id, product_id);
create index reviews_published_idx on public.reviews (product_id, published_at desc)
  where status = 'published';
create index reviews_moderation_idx on public.reviews (created_at)
  where status = 'pending';
create index reviews_customer_idx on public.reviews (customer_id);
create index reviews_order_idx on public.reviews (order_id);
create index reviews_agent_idx on public.reviews (replied_by_agent_id);
create index reviews_approval_idx on public.reviews (approval_id);
create index reviews_rating_idx on public.reviews (product_id, rating) where status = 'published';

alter table public.social_accounts    enable row level security;
alter table public.content_assets     enable row level security;
alter table public.campaigns          enable row level security;
alter table public.social_posts       enable row level security;
alter table public.social_post_assets enable row level security;
alter table public.email_sends        enable row level security;
alter table public.reviews            enable row level security;
