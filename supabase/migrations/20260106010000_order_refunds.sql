-- =============================================================================
-- ORDER REFUNDS — the founder's record of money she has decided to give back.
--
-- Why this table exists, given `orders.refunded_cents` already exists.
--
-- Those are two different facts. `orders.refunded_cents` is what the commerce
-- system says has been refunded, and on Shopify it moves only when a real
-- refund has been put through a real payment gateway. This table is the
-- decision: who decided, when, how much, why, and against which order. The two
-- agree the day a gateway is wired, and until then the difference between them
-- is exactly the honest answer to "have I actually paid her back yet?".
--
-- This deployment has no live outbound channel of any kind — no courier
-- booking, no email, no gateway — so `settled_at` is null on every row this
-- admin writes, and the screen says so in words. Recording a refund here is a
-- real, permanent write to Half Sour's own database. Moving the money is a
-- separate act by a person, and when it happens it is stamped here.
--
-- Money is integer minor units, as everywhere in this schema. There is no
-- float anywhere on this path.
-- =============================================================================

create type public.refund_reason as enum (
  'damaged', 'never_arrived', 'wrong_thing', 'changed_mind',
  'goodwill', 'duplicate', 'other'
);

create table public.order_refunds (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  amount_cents  integer not null,
  currency      public.currency_code not null default 'NZD',
  reason        public.refund_reason not null,
  note          text,

  -- Who decided, and on what authority. `approval_id` is set when an agent
  -- asked for this and she said yes; null when she decided it herself.
  decided_by    uuid references public.operators (id) on delete set null,
  decided_at    timestamptz not null default now(),
  approval_id   uuid references public.approvals (id) on delete set null,

  -- The world-facing half. Null until a person actually moves the money.
  settled_at    timestamptz,
  settled_reference text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint order_refunds_amount_positive check (amount_cents > 0),
  constraint order_refunds_note_present check (note is null or btrim(note) <> ''),
  -- Settled means settled: a date without a reference is a claim nobody can check.
  constraint order_refunds_settled_pair check (
    (settled_at is null) = (settled_reference is null)),
  constraint order_refunds_settled_after_decision check (
    settled_at is null or settled_at >= decided_at)
);

create index order_refunds_order_idx on public.order_refunds (order_id, decided_at desc);
create index order_refunds_decided_idx on public.order_refunds (decided_at desc);
create index order_refunds_approval_idx on public.order_refunds (approval_id);
create index order_refunds_unsettled_idx on public.order_refunds (decided_at)
  where settled_at is null;

comment on table public.order_refunds is
  'Refunds the founder has decided on. Recorded, not delivered: no payment gateway is wired to this deployment, so settled_at is null until a person moves the money.';
comment on column public.order_refunds.amount_cents is
  'Integer minor units, NZD. Never a float — this is a price path.';
comment on column public.order_refunds.settled_at is
  'When the money actually left the bank. Null means recorded only.';

-- -----------------------------------------------------------------------------
-- Access. The same model as every other back-office table: operators and the
-- server-side runtime, nothing for anon.
-- -----------------------------------------------------------------------------
alter table public.order_refunds enable row level security;

create policy order_refunds_operator_all on public.order_refunds
  for all to authenticated
  using (public.is_operator())
  with check (public.is_operator());

grant all on public.order_refunds to authenticated, service_role;
revoke all on public.order_refunds from anon;

create trigger set_updated_at before update on public.order_refunds
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Assertions. A migration that reports success on a table nobody can use is
-- how a screen ends up quietly writing to nowhere.
-- -----------------------------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(c.relname || ' (' ||
           case when not c.relrowsecurity then 'RLS off' else 'no policy' end || ')', ', ')
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'order_refunds'
     and (not c.relrowsecurity
          or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if bad is not null then
    raise exception 'order_refunds RLS assertion failed: %', bad;
  end if;

  select string_agg(distinct privilege_type, ', ')
    into bad
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name = 'order_refunds';
  if bad is not null then
    raise exception 'order_refunds grant assertion failed. anon holds: %', bad;
  end if;
end;
$$;
