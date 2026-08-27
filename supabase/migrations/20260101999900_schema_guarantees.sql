-- =============================================================================
-- HALF SOUR — 99 SCHEMA GUARANTEES
--
-- This migration sorts last on purpose. Several agents write migrations into
-- this directory, so the guarantees the schema makes cannot live only in the
-- middle of the run: a table added by a later migration would slip past them.
--
-- It does two things, in this order:
--
--   1. BACKFILL — any table that reached this point without RLS, without a
--      policy, without its updated_at trigger, or with privileges anon should
--      not hold, gets fixed here. The fixes are the conservative ones: RLS on,
--      operator-only access, anon revoked.
--
--   2. ASSERT — then it re-checks everything and RAISES if any of it is still
--      untrue, so a regression fails the migration instead of shipping.
--
-- Re-running is safe: every step is a no-op when the schema is already correct.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a. RLS on every table
-- -----------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    order by c.relname
  loop
    raise notice 'guarantees: enabling RLS on public.% (it was left off)', t.relname;
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1b. A policy on every table. Operator-only, because that is the safe default
--     for anything that arrived here without someone having thought about it.
-- -----------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.relname, c.oid from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    order by c.relname
  loop
    raise notice 'guarantees: adding the operator policy to public.% (it had none)', t.relname;
    execute format(
      'create policy %1$s_operator_all on public.%1$I
         for all to authenticated
         using (public.is_operator())
         with check (public.is_operator())', t.relname);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1c. updated_at triggers
-- -----------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at'
                       and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (select 1 from pg_trigger g
                       where g.tgrelid = c.oid and g.tgname = 'set_updated_at')
    order by c.relname
  loop
    raise notice 'guarantees: attaching set_updated_at to public.%', t.relname;
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t.relname);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1d. anon holds privileges only where a policy deliberately names it.
--     A grant with no matching policy is an accident, not a decision, so it is
--     revoked. A table another migration deliberately opened to anon (it has an
--     anon policy) is left exactly as that migration set it.
-- -----------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select distinct g.table_name
      from information_schema.role_table_grants g
      join pg_class c on c.relname = g.table_name
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where g.grantee = 'anon' and g.table_schema = 'public' and c.relkind = 'r'
       and not exists (
         select 1 from pg_policy p
          where p.polrelid = c.oid
            and 'anon' = any (select rolname from pg_roles where oid = any (p.polroles)))
     order by g.table_name
  loop
    raise notice 'guarantees: revoking anon on public.% (granted, but no anon policy)', t.table_name;
    execute format('revoke all on public.%I from anon', t.table_name);
  end loop;
end;
$$;

-- =============================================================================
-- 2. ASSERTIONS
-- =============================================================================

-- 2a. RLS enabled AND at least one policy, on every table.
do $$
declare bad text;
begin
  select string_agg(c.relname || ' (' ||
           case when not c.relrowsecurity then 'RLS off' else 'no policy' end || ')', ', '
           order by c.relname) into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (not c.relrowsecurity
         or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if bad is not null then
    raise exception 'RLS guarantee failed: %', bad;
  end if;
end;
$$;

-- 2b. Every foreign key served by a non-partial index on its leading columns.
do $$
declare bad text;
begin
  select string_agg(x.conrel || '.' || x.conname, ', ' order by x.conrel, x.conname) into bad
  from (select con.conname, con.conrelid, con.conrelid::regclass::text as conrel, con.conkey
          from pg_constraint con
          join pg_namespace n on n.oid = con.connamespace
         where con.contype = 'f' and n.nspname = 'public') x
  where not exists (
    select 1 from pg_index i
     where i.indrelid = x.conrelid
       and i.indpred is null
       and array_length(x.conkey, 1) <= i.indnkeyatts
       and (select array_agg(k order by ord)
              from unnest(i.indkey::int2[]) with ordinality u(k, ord)
             where ord <= array_length(x.conkey, 1)) @> x.conkey);
  if bad is not null then
    raise exception 'Foreign-key index guarantee failed. Unindexed FKs: %', bad;
  end if;
end;
$$;

-- 2c. Money is integer minor units; time carries a time zone.
do $$
declare bad text;
begin
  select string_agg(format('%s.%s (%s)', c.table_name, c.column_name, c.data_type), ', '
                    order by c.table_name, c.column_name) into bad
  from information_schema.columns c
  join pg_class pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public' and pc.relkind = 'r'
    and ((c.data_type in ('real', 'double precision', 'numeric', 'money')
          and c.column_name ~ '(cents|price|cost|amount|total|subtotal|spend|revenue|budget|micros|fee|tax)')
      or c.data_type in ('timestamp without time zone', 'time without time zone')
      or c.data_type = 'money');
  if bad is not null then
    raise exception 'Type guarantee failed. Money must be integer minor units and time must be timestamptz: %', bad;
  end if;
end;
$$;

-- 2d. Every table carrying updated_at has the trigger.
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at'
                     and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from pg_trigger g
                     where g.tgrelid = c.oid and g.tgname = 'set_updated_at');
  if bad is not null then
    raise exception 'updated_at guarantee failed for: %', bad;
  end if;
end;
$$;

-- 2e. anon reaches nothing in the back office.
do $$
declare bad text;
begin
  select string_agg(distinct table_name || ':' || privilege_type, ', ') into bad
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
    and table_name in ('operators', 'admin_sessions', 'audit_log', 'customers', 'addresses',
                       'social_accounts', 'webhook_events', 'sync_state', 'agents', 'agent_runs',
                       'agent_messages', 'agent_tool_calls', 'approvals', 'agent_costs',
                       'suppliers', 'ingredients', 'ingredient_suppliers', 'recipes',
                       'recipe_ingredients', 'batches', 'batch_ingredients', 'order_item_batches',
                       'purchase_orders', 'purchase_order_items', 'email_sends', 'campaigns',
                       'content_assets', 'brand_rules', 'inventory_adjustments');
  if bad is not null then
    raise exception 'Grant guarantee failed. anon holds privileges it must not: %', bad;
  end if;
end;
$$;

-- 2f. Nothing in the mirror claims to be synced without a Shopify identity.
--     A mirrored table is one carrying BOTH shopify_gid and sync_status; child
--     rows such as order_items and cart_items keep a gid for round-tripping but
--     inherit their sync state from the parent they hang off.
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'shopify_gid'
                     and a.attnum > 0 and not a.attisdropped
  join pg_attribute a2 on a2.attrelid = c.oid and a2.attname = 'sync_status'
                      and a2.attnum > 0 and not a2.attisdropped
  where c.relkind = 'r'
    and not exists (
      select 1 from pg_constraint con
       where con.conrelid = c.oid and con.contype = 'c'
         and con.conname = c.relname || '_synced_has_identity');
  if bad is not null then
    raise exception 'Mirror guarantee failed. Tables with shopify_gid but no synced_has_identity check: %', bad;
  end if;
end;
$$;
