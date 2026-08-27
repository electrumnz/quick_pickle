-- =============================================================================
-- HALF SOUR — 05 SHOPIFY SYNC PLUMBING
--
-- webhook_events  — every webhook Shopify sends, recorded BEFORE it is acted on
--                   so a bad handler can be fixed and the event replayed.
-- sync_state      — one row per resource type: where the last backfill got to,
--                   what the high-water mark is, and whether it is healthy.
--
-- Nothing downstream depends on these tables. With the mock provider they stay
-- empty and the rest of the commerce schema works exactly the same.
-- =============================================================================

create table public.webhook_events (
  id              bigint generated always as identity primary key,

  -- Shopify's X-Shopify-Webhook-Id. Delivery is at-least-once, so this is the
  -- dedupe key: the receiver INSERTs and treats a unique violation as "already
  -- have it, ack and move on". That single constraint is what makes the whole
  -- ingest idempotent.
  shopify_event_id text not null unique,

  topic           text not null,
  resource_type   public.sync_resource,
  shopify_gid     text,
  shop_domain     text not null default 'sgu8sy-at.myshopify.com',
  api_version     text,
  payload         jsonb not null,
  headers         jsonb not null default '{}',
  hmac_verified   boolean not null default false,

  -- Shopify's own occurred-at. Handlers order by this, never by received_at,
  -- because delivery order is not event order.
  triggered_at    timestamptz,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  process_status  public.webhook_process_status not null default 'received',
  attempts        integer not null default 0,
  error           text,
  replay_of_id    bigint references public.webhook_events (id) on delete set null,

  constraint webhook_events_topic_format check (topic ~ '^[a-z_]+/[a-z_]+$'),
  constraint webhook_events_attempts_nonneg check (attempts >= 0),
  constraint webhook_events_processed_stamped check (
    (process_status in ('processed', 'skipped', 'replayed')) = (processed_at is not null)),
  constraint webhook_events_failed_has_error check (process_status <> 'failed' or error is not null),
  constraint webhook_events_processed_after_received check (
    processed_at is null or processed_at >= received_at),
  constraint webhook_events_attempted_before_processing check (
    process_status = 'received' or attempts > 0),
  constraint webhook_events_not_own_replay check (replay_of_id is null or replay_of_id <> id),
  constraint webhook_events_gid_format check (
    shopify_gid is null or shopify_gid ~ '^gid://shopify/[A-Za-z]+/[A-Za-z0-9_.-]+(\?[A-Za-z0-9_=&%.-]*)?$')
);

-- The work queue: unprocessed events, oldest Shopify-event-time first.
create index webhook_events_pending_idx
  on public.webhook_events (coalesce(triggered_at, received_at))
  where process_status in ('received', 'failed');
create index webhook_events_topic_idx on public.webhook_events (topic, received_at desc);
create index webhook_events_gid_idx on public.webhook_events (shopify_gid, coalesce(triggered_at, received_at) desc)
  where shopify_gid is not null;
create index webhook_events_received_idx on public.webhook_events (received_at desc);
create index webhook_events_resource_idx on public.webhook_events (resource_type, received_at desc);
create index webhook_events_replay_idx on public.webhook_events (replay_of_id);

comment on table public.webhook_events is
  'Raw Shopify webhook inbox. Written before processing; replayable. Dedupe key = shopify_event_id.';

-- -----------------------------------------------------------------------------
-- sync_state
-- One row per (provider, shop, resource). Backfill pages through GraphQL and
-- parks `cursor`; reconciliation uses `high_water_mark` as updated_at_min so a
-- resumed sweep never re-reads the whole catalogue.
-- -----------------------------------------------------------------------------
create table public.sync_state (
  id              uuid primary key default gen_random_uuid(),
  provider        public.commerce_provider not null default 'shopify',
  shop_domain     text not null default 'sgu8sy-at.myshopify.com',
  resource_type   public.sync_resource not null,
  status          public.sync_run_status not null default 'idle',
  cursor          text,
  high_water_mark timestamptz,
  page_size       integer not null default 100,
  started_at      timestamptz,
  last_synced_at  timestamptz,
  last_success_at timestamptz,
  last_error_at   timestamptz,
  error           text,
  consecutive_failures integer not null default 0,
  records_synced  bigint not null default 0,
  records_failed  bigint not null default 0,
  next_run_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint sync_state_page_size_range check (page_size between 1 and 250),
  constraint sync_state_counters_nonneg check (
    records_synced >= 0 and records_failed >= 0 and consecutive_failures >= 0),
  constraint sync_state_failed_has_error check (status <> 'failed' or error is not null),
  constraint sync_state_error_stamped check ((error is not null) = (last_error_at is not null)),
  constraint sync_state_running_has_start check (status not in ('running', 'backfilling') or started_at is not null),
  constraint sync_state_backfill_has_cursor check (status <> 'backfilling' or cursor is not null),
  unique (provider, shop_domain, resource_type)
);

create index sync_state_due_idx on public.sync_state (next_run_at) where status = 'idle';
create index sync_state_unhealthy_idx on public.sync_state (consecutive_failures desc)
  where consecutive_failures > 0;
create index sync_state_resource_idx on public.sync_state (resource_type);

comment on column public.sync_state.high_water_mark is
  'Newest Shopify updated_at successfully ingested. Feeds updated_at_min on the next reconciliation sweep.';

alter table public.webhook_events enable row level security;
alter table public.sync_state     enable row level security;
