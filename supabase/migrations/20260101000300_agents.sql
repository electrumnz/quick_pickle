-- =============================================================================
-- HALF SOUR — 03 THE AI COMPANY
-- agents -> agent_runs -> agent_messages / agent_tool_calls, the spend ledger,
-- and the single universal `approvals` object every queue in the business uses.
-- =============================================================================

create type public.agent_status as enum ('active', 'paused', 'retired');

-- How much rope an agent has. `observe` may only read; `propose` must raise an
-- approval for any write; `act_with_limits` may act inside its spend/scope caps
-- and raises an approval above them; `autonomous` acts and reports after.
create type public.agent_autonomy as enum ('observe', 'propose', 'act_with_limits', 'autonomous');

create type public.agent_run_trigger as enum ('schedule', 'manual', 'webhook', 'chained', 'retry', 'approval');

create type public.agent_run_status as enum (
  'queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'
);

create type public.agent_message_role as enum ('system', 'user', 'assistant', 'tool');

create type public.tool_call_status as enum ('pending', 'running', 'succeeded', 'failed', 'rejected', 'skipped');

-- Every queue in the admin is a filter over one table. Adding a queue means
-- adding a value here, never a new table.
create type public.approval_subject as enum (
  'social_post', 'email_outreach', 'email_campaign', 'content_asset',
  'price_change', 'discount', 'product_publish',
  'purchase_order', 'inventory_adjustment',
  'batch_release', 'recipe_change',
  'refund', 'order_cancel', 'review_reply',
  'customer_message', 'settings_change', 'agent_config'
);

create type public.approval_status as enum (
  'pending', 'approved', 'rejected', 'expired', 'cancelled', 'superseded'
);

create type public.approval_risk as enum ('low', 'medium', 'high', 'critical');

-- -----------------------------------------------------------------------------
-- agents
-- -----------------------------------------------------------------------------
create table public.agents (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  job_title      text not null,
  purpose        text not null,
  model          text not null default 'claude-sonnet-4-5',
  system_prompt  text,
  tools          text[] not null default '{}',
  status         public.agent_status not null default 'active',
  autonomy       public.agent_autonomy not null default 'propose',
  requires_approval_for public.approval_subject[] not null default '{}',
  daily_spend_cap_cents integer not null default 500,
  monthly_spend_cap_cents integer not null default 10000,
  single_action_cap_cents integer,
  schedule_cron  text,
  timezone       text not null default 'Pacific/Auckland',
  operator_id    uuid references public.operators (id) on delete set null,
  avatar_url     text,
  colour_hex     text,
  last_run_at    timestamptz,
  runs_count     integer not null default 0,
  is_enabled     boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint agents_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint agents_caps_nonneg check (
    daily_spend_cap_cents >= 0 and monthly_spend_cap_cents >= 0
    and (single_action_cap_cents is null or single_action_cap_cents >= 0)),
  constraint agents_monthly_ge_daily check (monthly_spend_cap_cents >= daily_spend_cap_cents),
  constraint agents_runs_count_nonneg check (runs_count >= 0),
  constraint agents_colour_format check (colour_hex is null or colour_hex ~ '^#[0-9A-Fa-f]{6}$'),
  -- An observe-only agent has nothing to approve; a proposing agent must have
  -- at least one subject it routes through the approvals queue.
  constraint agents_autonomy_approvals check (
    (autonomy = 'observe' and cardinality(requires_approval_for) = 0)
    or (autonomy <> 'observe')),
  constraint agents_propose_needs_subjects check (
    autonomy <> 'propose' or cardinality(requires_approval_for) > 0),
  constraint agents_scheduled_has_cron check (schedule_cron is null or schedule_cron ~ '^[-0-9*/,A-Za-z ]+$')
);

create index agents_status_idx on public.agents (status) where is_enabled;
create index agents_operator_idx on public.agents (operator_id);
create index agents_last_run_idx on public.agents (last_run_at desc nulls last);

comment on table public.agents is
  'The staff. One row per AI role in the company; autonomy + requires_approval_for decide what it may do unattended.';

-- -----------------------------------------------------------------------------
-- agent_runs
-- -----------------------------------------------------------------------------
create table public.agent_runs (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents (id) on delete cascade,
  parent_run_id uuid references public.agent_runs (id) on delete set null,
  trigger       public.agent_run_trigger not null default 'schedule',
  triggered_by_operator_id uuid references public.operators (id) on delete set null,
  status        public.agent_run_status not null default 'queued',
  goal          text not null,
  outcome       text,
  error         text,
  queued_at     timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  duration_ms   integer generated always as (
                  case when started_at is not null and finished_at is not null
                       then (extract(epoch from (finished_at - started_at)) * 1000)::integer
                  end) stored,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_micros   bigint not null default 0,
  tool_call_count integer not null default 0,
  blocking_approval_id uuid,
  context       jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint agent_runs_tokens_nonneg check (input_tokens >= 0 and output_tokens >= 0),
  constraint agent_runs_cost_nonneg check (cost_micros >= 0),
  constraint agent_runs_tool_count_nonneg check (tool_call_count >= 0),
  constraint agent_runs_not_own_parent check (parent_run_id is null or parent_run_id <> id),
  constraint agent_runs_started_after_queued check (started_at is null or started_at >= queued_at),
  constraint agent_runs_finish_needs_start check (finished_at is null or started_at is not null),
  constraint agent_runs_finish_after_start check (finished_at is null or finished_at >= started_at),
  -- A terminal run has an end time; a live run does not. Both directions.
  constraint agent_runs_terminal_has_finish check (
    (status in ('succeeded', 'failed', 'cancelled')) = (finished_at is not null)),
  constraint agent_runs_running_has_start check (status <> 'running' or started_at is not null),
  constraint agent_runs_failed_has_error check (status <> 'failed' or error is not null),
  constraint agent_runs_blocked_has_approval check (
    status <> 'awaiting_approval' or blocking_approval_id is not null)
);

create index agent_runs_agent_idx on public.agent_runs (agent_id, queued_at desc);
create index agent_runs_status_idx on public.agent_runs (status, queued_at desc);
create index agent_runs_parent_idx on public.agent_runs (parent_run_id);
create index agent_runs_operator_idx on public.agent_runs (triggered_by_operator_id);
create index agent_runs_blocking_idx on public.agent_runs (blocking_approval_id);
create index agent_runs_live_idx on public.agent_runs (queued_at desc)
  where status in ('queued', 'running', 'awaiting_approval');

-- -----------------------------------------------------------------------------
-- approvals — ONE object, every queue
--
-- Social posts, reorders, price changes, outreach emails, batch releases and
-- refunds all land here. The admin's "inbox" is
--   select * from approvals where status = 'pending' order by risk desc, requested_at
-- and nothing else. subject_id is an untyped uuid on purpose: a typed FK per
-- subject would mean seventeen nullable columns and seventeen queues.
-- -----------------------------------------------------------------------------
create table public.approvals (
  id             uuid primary key default gen_random_uuid(),
  subject_type   public.approval_subject not null,
  subject_table  text not null,
  subject_id     uuid,
  title          text not null,
  summary        text not null,
  rationale      text,
  payload        jsonb not null default '{}',
  preview        jsonb not null default '{}',
  risk           public.approval_risk not null default 'low',
  amount_cents   integer,
  currency       public.currency_code not null default 'NZD',
  status         public.approval_status not null default 'pending',
  requested_by_agent_id uuid references public.agents (id) on delete set null,
  requested_by_run_id   uuid references public.agent_runs (id) on delete set null,
  requested_at   timestamptz not null default now(),
  expires_at     timestamptz,
  decided_by     uuid references public.operators (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  applied_at     timestamptz,
  applied_result jsonb,
  superseded_by  uuid references public.approvals (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint approvals_subject_table_format check (subject_table ~ '^[a-z][a-z0-9_]*$'),
  constraint approvals_expiry_after_request check (expires_at is null or expires_at > requested_at),
  constraint approvals_not_own_successor check (superseded_by is null or superseded_by <> id),
  -- Pending means undecided. Decided means stamped. Neither can lie.
  constraint approvals_pending_undecided check (
    status <> 'pending' or (decided_at is null and decided_by is null)),
  constraint approvals_decided_stamped check (
    status not in ('approved', 'rejected') or decided_at is not null),
  constraint approvals_decided_after_request check (decided_at is null or decided_at >= requested_at),
  constraint approvals_rejected_has_note check (status <> 'rejected' or decision_note is not null),
  -- Only an approved thing can have been carried out.
  constraint approvals_applied_requires_approved check (
    applied_at is null or (status = 'approved' and applied_at >= decided_at)),
  constraint approvals_superseded_has_successor check (
    (status = 'superseded') = (superseded_by is not null)),
  -- Anything with money attached must say how much and be at least medium risk.
  constraint approvals_money_risk check (
    amount_cents is null or coalesce(abs(amount_cents), 0) < 5000 or risk <> 'low')
);

-- One open ask per thing. Prevents an agent flooding the queue on retry.
create unique index approvals_one_pending_per_subject
  on public.approvals (subject_type, subject_id)
  where status = 'pending' and subject_id is not null;

create index approvals_queue_idx on public.approvals (risk desc, requested_at)
  where status = 'pending';
create index approvals_status_idx on public.approvals (status, requested_at desc);
create index approvals_subject_idx on public.approvals (subject_type, subject_id);
create index approvals_agent_idx on public.approvals (requested_by_agent_id, requested_at desc);
create index approvals_run_idx on public.approvals (requested_by_run_id);
create index approvals_decided_by_idx on public.approvals (decided_by, decided_at desc);
create index approvals_superseded_idx on public.approvals (superseded_by);
create index approvals_expiring_idx on public.approvals (expires_at)
  where status = 'pending' and expires_at is not null;

comment on table public.approvals is
  'The universal human-in-the-loop object. Every agent queue in the admin is a filtered view of this one table.';
comment on column public.approvals.payload is
  'The exact mutation to perform on approval — the applier reads this, never re-derives it. Makes approve idempotent and replayable.';

alter table public.agent_runs
  add constraint agent_runs_blocking_approval_fk
  foreign key (blocking_approval_id) references public.approvals (id) on delete set null;

-- -----------------------------------------------------------------------------
-- agent_messages — the transcript. Append-only.
-- -----------------------------------------------------------------------------
create table public.agent_messages (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.agent_runs (id) on delete cascade,
  seq         integer not null,
  role        public.agent_message_role not null,
  content     text,
  content_json jsonb,
  tool_name   text,
  tokens      integer,
  model       text,
  stop_reason text,
  created_at  timestamptz not null default now(),

  constraint agent_messages_seq_nonneg check (seq >= 0),
  constraint agent_messages_tokens_nonneg check (tokens is null or tokens >= 0),
  constraint agent_messages_has_body check (content is not null or content_json is not null),
  constraint agent_messages_tool_role check ((role = 'tool') = (tool_name is not null)),
  unique (run_id, seq)
);

create index agent_messages_run_idx on public.agent_messages (run_id, seq);
create index agent_messages_created_idx on public.agent_messages (created_at desc);

-- -----------------------------------------------------------------------------
-- agent_tool_calls
-- -----------------------------------------------------------------------------
create table public.agent_tool_calls (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.agent_runs (id) on delete cascade,
  message_id   uuid references public.agent_messages (id) on delete set null,
  seq          integer not null,
  tool_name    text not null,
  arguments    jsonb not null default '{}',
  result       jsonb,
  status       public.tool_call_status not null default 'pending',
  error        text,
  is_mutation  boolean not null default false,
  approval_id  uuid references public.approvals (id) on delete set null,
  started_at   timestamptz,
  finished_at  timestamptz,
  duration_ms  integer generated always as (
                 case when started_at is not null and finished_at is not null
                      then (extract(epoch from (finished_at - started_at)) * 1000)::integer
                 end) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint agent_tool_calls_seq_nonneg check (seq >= 0),
  constraint agent_tool_calls_name_format check (tool_name ~ '^[a-z][a-z0-9_.]*$'),
  constraint agent_tool_calls_finish_needs_start check (finished_at is null or started_at is not null),
  constraint agent_tool_calls_finish_after_start check (finished_at is null or finished_at >= started_at),
  constraint agent_tool_calls_terminal_has_finish check (
    (status in ('succeeded', 'failed', 'rejected', 'skipped')) = (finished_at is not null)),
  constraint agent_tool_calls_failed_has_error check (status <> 'failed' or error is not null),
  constraint agent_tool_calls_rejected_has_approval check (status <> 'rejected' or approval_id is not null),
  unique (run_id, seq)
);

create index agent_tool_calls_run_idx on public.agent_tool_calls (run_id, seq);
create index agent_tool_calls_message_idx on public.agent_tool_calls (message_id);
create index agent_tool_calls_approval_idx on public.agent_tool_calls (approval_id);
create index agent_tool_calls_tool_idx on public.agent_tool_calls (tool_name, created_at desc);
create index agent_tool_calls_failures_idx on public.agent_tool_calls (created_at desc)
  where status = 'failed';

-- -----------------------------------------------------------------------------
-- agent_costs
-- What the staff cost to run. Token spend is sub-cent, so the ledger stores
-- micros (millionths of the currency unit — an integer, never a float) and
-- exposes a rounded cents column for the admin's dashboards.
-- -----------------------------------------------------------------------------
create table public.agent_costs (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references public.agents (id) on delete cascade,
  run_id          uuid references public.agent_runs (id) on delete cascade,
  tool_call_id    uuid references public.agent_tool_calls (id) on delete set null,
  incurred_on     date not null default (now() at time zone 'Pacific/Auckland')::date,
  incurred_at     timestamptz not null default now(),
  provider        text not null default 'anthropic',
  model           text not null,
  kind            text not null default 'inference',
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_micros     bigint not null default 0,
  currency        public.currency_code not null default 'NZD',
  cost_cents      integer generated always as ((cost_micros / 10000)::integer) stored,
  note            text,
  created_at      timestamptz not null default now(),

  constraint agent_costs_tokens_nonneg check (
    input_tokens >= 0 and output_tokens >= 0
    and cache_read_tokens >= 0 and cache_write_tokens >= 0),
  constraint agent_costs_micros_nonneg check (cost_micros >= 0),
  constraint agent_costs_kind_format check (kind in ('inference', 'embedding', 'image', 'search', 'storage', 'third_party'))
);

create index agent_costs_agent_day_idx on public.agent_costs (agent_id, incurred_on desc);
create index agent_costs_run_idx on public.agent_costs (run_id);
create index agent_costs_tool_call_idx on public.agent_costs (tool_call_id);
create index agent_costs_day_idx on public.agent_costs (incurred_on desc);
create index agent_costs_model_idx on public.agent_costs (model, incurred_on desc);

comment on column public.agent_costs.cost_micros is
  'Millionths of one NZD. Integer minor units at higher resolution — token pricing is far below one cent per call.';

alter table public.agents          enable row level security;
alter table public.agent_runs      enable row level security;
alter table public.approvals       enable row level security;
alter table public.agent_messages  enable row level security;
alter table public.agent_tool_calls enable row level security;
alter table public.agent_costs     enable row level security;
