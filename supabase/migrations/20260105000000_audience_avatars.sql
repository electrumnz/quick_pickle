-- =============================================================================
-- HALF SOUR — 11 AUDIENCE AVATARS
--
-- The two customers, stored the way the three frameworks are stored: as rows an
-- agent reads before it writes anything, not as a document a person reads once.
--
-- 20260102000000_strategy.sql already holds the BrandScript, which says what
-- each customer WANTS. This table holds who they are the rest of the week — the
-- job they are hiring a bottle for, what they do instead today, what triggers an
-- order, what stops one, what they compare the price against, and what would
-- make them buy a second time. Repeat is the whole business at 10,560 bottles a
-- year, so the last of those is not a nice-to-have field.
--
--   strategy_avatars   one row per customer. The whole avatar is held as jsonb
--                      for the same reason the BrandScript is: the shape IS the
--                      framework, and flattening it into columns would lose the
--                      part that makes it usable — an avatar is only worth
--                      having if a decision can be made from it whole.
--
-- Why a table rather than a fourth `strategy_documents` row: adding a value to
-- `public.strategy_framework` and then inserting with it inside the same
-- migration is a Postgres foot-gun (a new enum label cannot be used in the
-- transaction that added it), and the two narrow columns here — `audience` and
-- `label` — are worth having as columns, because `applies_to` scoping has to be
-- able to route the venue buyer to the trade agent and the home host to the
-- marketing agent without parsing json.
--
-- `body` duplicates `audience` and `label`. That is deliberate and it is
-- checked: a row whose column says b2b and whose document says b2c would put
-- the wrong person into an agent's prompt and nothing else would notice.
--
-- This migration sorts after 20260101999900_schema_guarantees.sql, so — exactly
-- as the strategy migration does — it carries its own RLS, its own policy, its
-- own grants, its own updated_at trigger, and then re-runs the guarantees
-- against itself.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enum
-- -----------------------------------------------------------------------------
-- There are two customers and there have only ever been two. A third value here
-- would be a third company, and the BrandScript would have to grow a third
-- script to match it.
create type public.strategy_audience as enum (
  'b2c',  -- the Friday host: buys one bottle for her own kitchen
  'b2b'   -- the bar manager: buys cases for a venue at a published trade price
);

-- -----------------------------------------------------------------------------
-- strategy_avatars
-- -----------------------------------------------------------------------------
create table public.strategy_avatars (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  audience    public.strategy_audience not null,
  -- The BrandScript character this deepens, repeated verbatim. If the two ever
  -- disagree the avatars have become a second, competing set of customers.
  label       text not null,
  version     text not null default '1.0.0',
  applies_to  text[] not null default '{}',
  position    integer not null default 100,
  body        jsonb not null,
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint strategy_avatars_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint strategy_avatars_version_format check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint strategy_avatars_position_range check (position between 1 and 1000),
  constraint strategy_avatars_body_is_object check (jsonb_typeof(body) = 'object'),
  -- The column and the document must be the same person.
  constraint strategy_avatars_body_matches_audience check (body->>'id' = audience::text),
  constraint strategy_avatars_body_matches_label check (body->>'label' = label),
  -- An avatar with no repeat story is the one field this business cannot do
  -- without: at two production days a week, growth is the second order.
  constraint strategy_avatars_has_repeat check (
    jsonb_typeof(body->'repeat') = 'object'
    and (body->'repeat'->>'bottlesPerYear') is not null),
  -- And an avatar the market model cannot count is an avatar the plan cannot
  -- pay for. `counted.countedBy` names the market inputs that count them.
  constraint strategy_avatars_is_counted check (
    jsonb_typeof(body->'counted'->'countedBy') = 'array'
    and jsonb_array_length(body->'counted'->'countedBy') > 0)
);

-- Exactly one live avatar per customer. Two live B2C avatars is two customers,
-- and the marketing agent would be handed both.
create unique index strategy_avatars_one_active_per_audience
  on public.strategy_avatars (audience) where is_active;
create index strategy_avatars_active_idx on public.strategy_avatars (position, slug) where is_active;
create index strategy_avatars_applies_idx on public.strategy_avatars using gin (applies_to);

comment on table public.strategy_avatars is
  'The two customers in enough detail to decide from. Read into agent system prompts by lib/strategy/context.ts; the storefront is tested against them by lib/strategy/audit.ts.';
comment on column public.strategy_avatars.applies_to is
  'Agent scopes, exactly as strategy_documents.applies_to. The marketing agent gets the home host; the trade agent gets the venue buyer.';
comment on column public.strategy_avatars.body is
  'One CustomerAvatar from content/strategy/avatars.ts. Decoded — never cast — by lib/strategy/schema.ts.';

-- =============================================================================
-- SEED — generated from content/strategy/avatars.ts.
-- See lib/strategy/emit-avatar-seed.ts and tests/strategy/avatars.test.ts.
-- =============================================================================
-- @@AVATAR-SEED-START@@
-- @@AVATAR-SEED-END@@

-- =============================================================================
-- RLS, GRANTS AND TRIGGERS
--
-- Internal, like the rest of the strategy. `anon` — the public storefront —
-- gets nothing: an avatar is a description of a customer written for our own
-- use, and the venue targeting in it is not something a competitor should be
-- able to read out of the site's own API.
-- =============================================================================
alter table public.strategy_avatars enable row level security;

create policy strategy_avatars_operator_all on public.strategy_avatars
  for all to authenticated
  using (public.is_operator())
  with check (public.is_operator());

revoke all on public.strategy_avatars from anon;
grant all on public.strategy_avatars to authenticated, service_role;

create trigger set_updated_at before update on public.strategy_avatars
  for each row execute function public.set_updated_at();

-- =============================================================================
-- ASSERTIONS — the guarantees pass, re-run against this table
-- =============================================================================

-- RLS on, and a policy on it.
do $$
declare bad text;
begin
  select string_agg(c.relname || ' (' ||
           case when not c.relrowsecurity then 'RLS off' else 'no policy' end || ')', ', ')
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'strategy_avatars'
     and (not c.relrowsecurity
          or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if bad is not null then
    raise exception 'Avatar RLS assertion failed: %', bad;
  end if;
end;
$$;

-- The updated_at trigger is present.
do $$
begin
  if not exists (
    select 1 from pg_trigger g
     where g.tgrelid = 'public.strategy_avatars'::regclass
       and g.tgname = 'set_updated_at'
  ) then
    raise exception 'Avatar updated_at trigger assertion failed';
  end if;
end;
$$;

-- anon holds nothing.
do $$
declare bad text;
begin
  select string_agg(distinct privilege_type, ', ')
    into bad
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name = 'strategy_avatars';
  if bad is not null then
    raise exception 'Avatar grant assertion failed. anon holds: %', bad;
  end if;
end;
$$;

-- The seed landed, and it landed complete. A migration that creates an empty
-- table and reports success is how an agent ends up writing to nobody.
do $$
declare
  live integer;
  audiences integer;
begin
  select count(*) into live from public.strategy_avatars where is_active;
  select count(distinct audience) into audiences
    from public.strategy_avatars where is_active;
  if live <> 2 or audiences <> 2 then
    raise exception 'Expected one live avatar for each of the two audiences, found % row(s) across % audience(s)',
      live, audiences;
  end if;
end;
$$;
