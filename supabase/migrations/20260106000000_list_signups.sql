-- =============================================================================
-- HALF SOUR — 12 LIST SIGNUPS
--
-- The one row the storefront writes.
--
-- Everything else the public site does is a read: the catalogue, the recipes,
-- the trade price list. This table is the exception, and it exists because the
-- avatar audit found the one thing the store could not do — hear from somebody
-- between orders. Two bottles a year is the whole direct plan, so the second
-- order is not a bonus, it is half the revenue, and the only route to it is a
-- list. Until now the route onto that list was a `mailto:` link, which is a
-- route nobody takes at 9pm on a Thursday with a phone in one hand.
--
-- Two kinds of row, one table:
--
--   'list'   a customer asking to be told when a batch lands.
--   'trade'  a venue asking for the two sample bottles and the spec card.
--
-- They are the same shape — an address, an optional room, a note — and they are
-- both a person putting their hand up. Splitting them into two tables would
-- duplicate the consent columns, and the consent columns are the ones that
-- matter: `unsubscribed_at` is what makes the promise in every email ("a way
-- off it") checkable rather than a sentence.
--
-- WHAT IS NOT HERE, ON PURPOSE:
--   * No name. The sign-up asks for one field and stores one field.
--   * No IP address or user agent. Neither is needed to send an email, and the
--     Privacy Act 2020 information privacy principle 1 is that you do not
--     collect what you do not need. See legal/privacy-policy.md.
--   * No marketing_consent boolean. Asking to join a list IS the consent, and a
--     second flag that can disagree with the row's existence is a way to send
--     mail to somebody who never asked.
--
-- This migration sorts after 20260101999900_schema_guarantees.sql, so — like the
-- strategy and avatar migrations before it — it carries its own RLS, its own
-- policy, its own grants and its own updated_at trigger, and then re-runs the
-- guarantees against itself.
-- =============================================================================

create type public.list_signup_kind as enum (
  'list',  -- a customer: tell me when a batch lands
  'trade'  -- a venue: send two samples and a spec card
);

create table public.list_signups (
  id             uuid primary key default gen_random_uuid(),
  kind           public.list_signup_kind not null default 'list',
  email          text not null,
  -- The name of the room, for a trade request. Null for a customer sign-up.
  venue          text,
  -- Whatever the person typed, if the form ever grows a box for it. Bounded.
  note           text,
  -- The path the form was posted from, so it is possible to tell which page
  -- earns sign-ups without putting an analytics script in front of a customer.
  source_path    text,
  -- Set when a double opt-in is confirmed. Null means unconfirmed, which is the
  -- state every row starts in and the state a sender must check before sending.
  confirmed_at   timestamptz,
  -- Set the moment somebody asks to come off. A row is never deleted on
  -- unsubscribe: deleting it loses the record that they asked, and the next
  -- import would put them straight back on.
  unsubscribed_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Deliberately loose. An address that a regex rejects and a mail server
  -- accepts is a customer this company never hears from again; the only shapes
  -- refused here are the ones that cannot be an address at all.
  constraint list_signups_email_shape check (
    email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and length(email) between 6 and 254),
  constraint list_signups_venue_length check (venue is null or length(venue) between 1 and 200),
  constraint list_signups_note_length check (note is null or length(note) <= 2000),
  constraint list_signups_source_path check (
    source_path is null or (source_path like '/%' and length(source_path) <= 200)),
  -- A venue name belongs to a trade request. A customer sign-up that carries
  -- one has been filed under the wrong kind and will be mailed the wrong thing.
  constraint list_signups_venue_is_trade check (venue is null or kind = 'trade'),
  constraint list_signups_unsubscribed_after_created check (
    unsubscribed_at is null or unsubscribed_at >= created_at),
  constraint list_signups_confirmed_after_created check (
    confirmed_at is null or confirmed_at >= created_at)
);

-- One row per address per kind. A person who presses the button twice is not
-- two subscribers, and the second press must not be an error they see.
create unique index list_signups_email_kind_idx
  on public.list_signups (lower(email), kind);

-- Who is actually mailable today: confirmed, and not opted out.
create index list_signups_sendable_idx
  on public.list_signups (kind, created_at desc)
  where unsubscribed_at is null;

comment on table public.list_signups is
  'People who asked to hear from us: customers on the batch list, venues asking for samples. Written by the storefront sign-up forms in components/site/list-actions.ts.';
comment on column public.list_signups.unsubscribed_at is
  'Set, never deleted. The row is the record that they asked to come off, and it is what stops a later import putting them back on.';
comment on column public.list_signups.confirmed_at is
  'Double opt-in. Null means unconfirmed; a sender must check this before sending anything but the confirmation itself.';

-- =============================================================================
-- RLS, GRANTS, TRIGGER
--
-- `anon` gets nothing — not even insert. The sign-up form posts to a Server
-- Action that runs on the server with the operator connection, so the public
-- role never needs a privilege here, and an email list that `anon` can select
-- is an email list that has already leaked.
-- =============================================================================
alter table public.list_signups enable row level security;

create policy list_signups_operator_all on public.list_signups
  for all to authenticated
  using (public.is_operator())
  with check (public.is_operator());

revoke all on public.list_signups from anon;
grant all on public.list_signups to authenticated, service_role;

create trigger set_updated_at before update on public.list_signups
  for each row execute function public.set_updated_at();

-- =============================================================================
-- ASSERTIONS — the guarantees pass, re-run against this table
-- =============================================================================

do $$
declare bad text;
begin
  select string_agg(c.relname || ' (' ||
           case when not c.relrowsecurity then 'RLS off' else 'no policy' end || ')', ', ')
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'list_signups'
     and (not c.relrowsecurity
          or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if bad is not null then
    raise exception 'List signup RLS assertion failed: %', bad;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger g
     where g.tgrelid = 'public.list_signups'::regclass
       and g.tgname = 'set_updated_at'
  ) then
    raise exception 'List signup updated_at trigger assertion failed';
  end if;
end;
$$;

do $$
declare bad text;
begin
  select string_agg(distinct privilege_type, ', ')
    into bad
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name = 'list_signups';
  if bad is not null then
    raise exception 'List signup grant assertion failed. anon holds: %', bad;
  end if;
end;
$$;
