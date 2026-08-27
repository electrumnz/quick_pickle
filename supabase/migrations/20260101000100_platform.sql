-- =============================================================================
-- HALF SOUR — 01 PLATFORM
-- Who is allowed in (operators, admin_sessions), how the company is configured
-- (settings), and what happened (audit_log).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- operators
-- The humans (and the service identities agents run as) allowed into the admin.
-- Half Sour is one founder, so this table is tiny by design — but authorisation
-- being a row rather than a hardcoded email is what lets `is_operator()` exist.
-- -----------------------------------------------------------------------------
create table public.operators (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users (id) on delete set null,
  email         text not null,
  full_name     text not null,
  role          public.operator_role not null default 'operator',
  is_active     boolean not null default true,
  phone         text,
  avatar_url    text,
  timezone      text not null default 'Pacific/Auckland',
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint operators_email_format check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint operators_name_present check (btrim(full_name) <> '')
);

create unique index operators_email_key on public.operators (lower(email));
create index operators_role_idx on public.operators (role) where is_active;

comment on table public.operators is
  'Admin identities. user_id links to Supabase auth once the person signs in; is_operator() reads this table and nothing else.';
comment on column public.operators.user_id is
  'Null until first sign-in. link_operator_on_signup() fills it by matching the email.';

-- -----------------------------------------------------------------------------
-- Access predicates
--
-- Half Sour is a single-operator business. Authentication comes from Supabase
-- auth; authorisation comes from the `operators` table (created in the platform
-- migration). These helpers are SECURITY DEFINER so that a policy on `operators`
-- itself can call them without recursing into that table's own RLS.
-- -----------------------------------------------------------------------------
create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select o.is_active and o.role in ('owner', 'operator', 'agent_service')
       from public.operators o
      where o.user_id = auth.uid()
      limit 1),
    false);
$$;

comment on function public.is_operator() is
  'True when the current JWT belongs to an active operator. The single gate used by every admin RLS policy.';

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select o.is_active and o.role = 'owner'
       from public.operators o
      where o.user_id = auth.uid()
      limit 1),
    false);
$$;

comment on function public.is_owner() is
  'True only for the founder. Gates operator-account management and destructive platform settings.';

-- First sign-in with a seeded operator email claims that operator row. This is
-- what makes "seed the founder, then sign up" work without a manual UPDATE.
create or replace function public.link_operator_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.operators
     set user_id = new.id,
         updated_at = now()
   where user_id is null
     and lower(email) = lower(new.email);
  return new;
end;
$$;

create trigger link_operator_on_signup
  after insert on auth.users
  for each row execute function public.link_operator_on_signup();

-- -----------------------------------------------------------------------------
-- admin_sessions
-- Sessions are recorded rather than merely held in a cookie: the founder wants
-- to see "what was signed in, from where, when" and revoke it.
-- -----------------------------------------------------------------------------
create table public.admin_sessions (
  id              uuid primary key default gen_random_uuid(),
  operator_id     uuid not null references public.operators (id) on delete cascade,
  session_token_hash text not null unique,
  started_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  revoked_reason  text,
  ip_address      inet,
  user_agent      text,
  device_label    text,
  is_agent_session boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint admin_sessions_expiry_after_start check (expires_at > started_at),
  constraint admin_sessions_activity_in_window check (last_active_at >= started_at),
  constraint admin_sessions_revoked_after_start check (revoked_at is null or revoked_at >= started_at),
  constraint admin_sessions_revoked_has_reason check (revoked_at is null or revoked_reason is not null)
);

create index admin_sessions_operator_idx on public.admin_sessions (operator_id, started_at desc);
create index admin_sessions_active_idx on public.admin_sessions (expires_at desc)
  where revoked_at is null;

comment on column public.admin_sessions.session_token_hash is
  'SHA-256 of the session token. The token itself is never stored.';

-- -----------------------------------------------------------------------------
-- settings
-- Key/value company configuration. `is_public` rows are readable by the
-- anonymous storefront (free-shipping threshold, GST rate, contact email);
-- everything else is operator-only.
-- -----------------------------------------------------------------------------
create table public.settings (
  key          text primary key,
  value        jsonb not null,
  description  text not null,
  category     text not null default 'general',
  is_public    boolean not null default false,
  is_secret    boolean not null default false,
  updated_by   uuid references public.operators (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint settings_key_format check (key ~ '^[a-z][a-z0-9_.]*$'),
  constraint settings_secret_not_public check (not (is_public and is_secret))
);

create index settings_category_idx on public.settings (category, key);
create index settings_updated_by_idx on public.settings (updated_by);
create index settings_public_idx on public.settings (key) where is_public;

-- -----------------------------------------------------------------------------
-- audit_log
-- Append-only. Every write the admin or an agent makes lands here.
--
-- actor_id and agent_run_id are deliberately NOT foreign keys: audit rows must
-- outlive the operator accounts and agent runs they describe. Everything else in
-- this schema uses real FKs; this table is the documented exception.
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_type    public.actor_type not null,
  actor_id      uuid,
  actor_label   text not null,
  action        public.audit_action not null,
  entity_type   text not null,
  entity_id     uuid,
  entity_label  text,
  summary       text not null,
  before_data   jsonb,
  after_data    jsonb,
  agent_run_id  uuid,
  approval_id   uuid,
  ip_address    inet,
  user_agent    text,
  request_id    text,

  constraint audit_log_entity_type_format check (entity_type ~ '^[a-z][a-z0-9_]*$'),
  constraint audit_log_agent_has_run check (actor_type <> 'agent' or agent_run_id is not null)
);

create index audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_type, actor_id, occurred_at desc);
create index audit_log_action_idx on public.audit_log (action, occurred_at desc);
create index audit_log_run_idx on public.audit_log (agent_run_id) where agent_run_id is not null;

comment on table public.audit_log is
  'Append-only activity trail. UPDATE/DELETE are revoked at the grant level, not merely unpolicied.';

alter table public.operators      enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.settings       enable row level security;
alter table public.audit_log      enable row level security;
