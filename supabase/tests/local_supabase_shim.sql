-- =============================================================================
-- LOCAL TEST SHIM — NOT A MIGRATION, NOT DEPLOYED.
--
-- Recreates just enough of a Supabase project (the auth schema, auth.uid(),
-- and the anon / authenticated / service_role roles) for the migrations in
-- supabase/migrations to be applied and exercised against a bare Postgres.
-- On a real Supabase project all of this already exists.
-- =============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id                uuid primary key default gen_random_uuid(),
  email             text unique,
  raw_app_meta_data jsonb not null default '{}',
  created_at        timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
