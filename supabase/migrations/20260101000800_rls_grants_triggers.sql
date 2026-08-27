-- =============================================================================
-- HALF SOUR — 08 RLS, GRANTS, TRIGGERS, AND THE ASSERTIONS THAT KEEP THEM TRUE
--
-- Access model
-- ------------
-- There are exactly three callers:
--
--   anon           the public storefront. Reads the published catalogue; owns a
--                  cart it authenticates with a bearer token; may submit a
--                  review for moderation. Nothing else.
--   authenticated  the founder in the admin (and any agent-service identity
--                  signed in as itself). Gated on public.is_operator(), which
--                  reads the `operators` table — not on merely holding a JWT.
--   service_role   the server-side agent runtime and the Shopify webhook
--                  receiver. Bypasses RLS by design; still needs grants.
--
-- RLS enabled with no policy is a table nobody can read, not a table that is
-- secure. The assertions at the bottom fail the migration if any table ends up
-- in that state, if any foreign key lacks a usable index, if money lands in a
-- float/numeric column, or if a timestamp column loses its time zone.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- =============================================================================
-- 1. OPERATOR ACCESS
-- Written as a loop so no table can be forgotten. The exceptions below are
-- deliberately hand-written because they are NOT plain full access.
-- =============================================================================
do $$
declare
  t record;
  hand_written constant text[] := array['operators', 'audit_log', 'agent_messages'];
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname <> any (hand_written)
     order by c.relname
  loop
    execute format(
      'create policy %1$s_operator_all on public.%1$I
         for all to authenticated
         using (public.is_operator())
         with check (public.is_operator())', t.relname);
  end loop;
end;
$$;

-- --- operators: the founder manages accounts; operators can see the roster ---
create policy operators_read on public.operators
  for select to authenticated
  using (public.is_operator());

create policy operators_owner_manage on public.operators
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- --- audit_log: append-only. Read and insert, never rewrite. ---
create policy audit_log_read on public.audit_log
  for select to authenticated
  using (public.is_operator());

create policy audit_log_append on public.audit_log
  for insert to authenticated
  with check (public.is_operator());

-- --- agent_messages: the transcript is evidence; it is not editable. ---
create policy agent_messages_read on public.agent_messages
  for select to authenticated
  using (public.is_operator());

create policy agent_messages_append on public.agent_messages
  for insert to authenticated
  with check (public.is_operator());

-- =============================================================================
-- 2. PUBLIC STOREFRONT — READ
-- Only what is actually published, and never the trade-only SKUs.
-- =============================================================================

create policy products_public_read on public.products
  for select to anon, authenticated
  using (status = 'active' and deleted_at is null);

create policy product_variants_public_read on public.product_variants
  for select to anon, authenticated
  using (
    deleted_at is null
    and is_trade_only = false
    and exists (
      select 1 from public.products p
       where p.id = product_variants.product_id
         and p.status = 'active'
         and p.deleted_at is null));

create policy product_images_public_read on public.product_images
  for select to anon, authenticated
  using (exists (
    select 1 from public.products p
     where p.id = product_images.product_id
       and p.status = 'active'
       and p.deleted_at is null));

create policy collections_public_read on public.collections
  for select to anon, authenticated
  using (is_published);

create policy collection_products_public_read on public.collection_products
  for select to anon, authenticated
  using (
    exists (select 1 from public.collections c
             where c.id = collection_products.collection_id and c.is_published)
    and exists (select 1 from public.products p
                 where p.id = collection_products.product_id
                   and p.status = 'active' and p.deleted_at is null));

-- Stock badges ("2 left") for publicly visible variants only.
create policy inventory_levels_public_read on public.inventory_levels
  for select to anon, authenticated
  using (exists (
    select 1
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = inventory_levels.variant_id
       and v.deleted_at is null
       and v.is_trade_only = false
       and p.status = 'active'
       and p.deleted_at is null));

create policy reviews_public_read on public.reviews
  for select to anon, authenticated
  using (status = 'published');

create policy brand_assets_public_read on public.brand_assets
  for select to anon, authenticated
  using (is_public);

create policy settings_public_read on public.settings
  for select to anon, authenticated
  using (is_public);

-- =============================================================================
-- 3. PUBLIC STOREFRONT — WRITE
--
-- A cart is bearer-authenticated: the client mints a 64-hex token, sends it as
-- x-cart-token on every request, and can only ever see the one cart whose token
-- it holds. There is no anonymous user id to key off, so the token IS the key.
-- =============================================================================

create policy carts_storefront_select on public.carts
  for select to anon, authenticated
  using (token = public.current_cart_token());

create policy carts_storefront_insert on public.carts
  for insert to anon, authenticated
  with check (
    token = public.current_cart_token()
    and status = 'active'
    and converted_order_id is null);

create policy carts_storefront_update on public.carts
  for update to anon, authenticated
  using (token = public.current_cart_token() and status = 'active')
  with check (
    token = public.current_cart_token()
    and status in ('active', 'abandoned')
    -- A shopper may not convert their own cart or bolt an order onto it;
    -- checkout runs server-side under service_role.
    and converted_order_id is null);

create policy carts_storefront_delete on public.carts
  for delete to anon, authenticated
  using (token = public.current_cart_token() and status in ('active', 'abandoned'));

create policy cart_items_storefront_all on public.cart_items
  for all to anon, authenticated
  using (exists (
    select 1 from public.carts c
     where c.id = cart_items.cart_id
       and c.token = public.current_cart_token()
       and c.status = 'active'))
  with check (exists (
    select 1 from public.carts c
     where c.id = cart_items.cart_id
       and c.token = public.current_cart_token()
       and c.status = 'active'));

-- Order confirmation: the shopper reads back the order their cart became, using
-- the same bearer token. Everything else about orders stays operator-only.
create policy orders_storefront_read on public.orders
  for select to anon, authenticated
  using (
    cart_id is not null
    and exists (select 1 from public.carts c
                 where c.id = orders.cart_id
                   and c.token = public.current_cart_token()));

create policy order_items_storefront_read on public.order_items
  for select to anon, authenticated
  using (exists (
    select 1
      from public.orders o
      join public.carts c on c.id = o.cart_id
     where o.id = order_items.order_id
       and c.token = public.current_cart_token()));

-- Reviews go into moderation. The shopper cannot self-publish, cannot award
-- themselves a verified-purchase badge, and cannot write the brand's reply.
create policy reviews_public_submit on public.reviews
  for insert to anon, authenticated
  with check (
    status = 'pending'
    and published_at is null
    and is_verified_purchase = false
    and reply_body is null
    and replied_at is null
    and replied_by_agent_id is null
    and approval_id is null
    and helpful_count = 0
    and provider = 'local'
    and external_id is null);

-- =============================================================================
-- 4. GRANTS
-- RLS decides which rows. Grants decide which verbs. Both, not either.
-- =============================================================================

revoke all on all tables in schema public from anon, authenticated;

grant all on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Storefront reads
grant select on
  public.products, public.product_variants, public.product_images,
  public.collections, public.collection_products, public.inventory_levels,
  public.reviews, public.brand_assets, public.settings,
  public.orders, public.order_items
to anon;

-- Storefront writes
grant select, insert, update, delete on public.carts, public.cart_items to anon;
grant insert on public.reviews to anon;

-- Append-only tables: RLS says "no policy for UPDATE", the grant says "and no
-- privilege either". Belt and braces, because RLS does not filter TRUNCATE.
revoke insert, update, delete, truncate on public.audit_log from anon;
revoke update, delete, truncate on public.audit_log from authenticated;
revoke update, delete, truncate on public.agent_messages from authenticated;

-- Secrets pointers and raw webhook payloads are never reachable with the
-- publishable key, policy or no policy.
revoke all on public.social_accounts, public.webhook_events, public.sync_state,
              public.admin_sessions, public.operators, public.audit_log
from anon;

-- =============================================================================
-- 5. updated_at TRIGGERS
-- Attached to every table that carries the column. Loop, so a new table cannot
-- silently miss one; the assertion below proves it.
-- =============================================================================
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'updated_at'
       and a.attnum > 0
       and not a.attisdropped
       and not exists (
         select 1 from pg_trigger g
          where g.tgrelid = c.oid and g.tgname = 'set_updated_at')
     order by c.relname
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t.relname);
  end loop;
end;
$$;

-- =============================================================================
-- 6. STOREFRONT RPC
-- Discount codes are validated without exposing the discounts table to anon:
-- the function is SECURITY DEFINER and returns only what a checkout needs.
-- =============================================================================
create or replace function public.validate_discount_code(
  p_code text,
  p_subtotal_cents integer,
  p_currency public.currency_code default 'NZD')
returns table (
  is_valid boolean,
  reason text,
  discount_id uuid,
  code text,
  title text,
  value_type public.discount_type,
  value_bp integer,
  value_cents integer,
  discount_amount_cents integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare d public.discounts%rowtype;
begin
  if p_subtotal_cents is null or p_subtotal_cents < 0 then
    return query select false, 'invalid_subtotal', null::uuid, null::text, null::text,
                        null::public.discount_type, null::integer, null::integer, null::integer;
    return;
  end if;

  select * into d from public.discounts
   where upper(discounts.code) = upper(btrim(p_code))
   limit 1;

  if not found then
    return query select false, 'not_found', null::uuid, null::text, null::text,
                        null::public.discount_type, null::integer, null::integer, null::integer;
    return;
  end if;

  if d.status <> 'active'
     or d.starts_at > now()
     or (d.ends_at is not null and d.ends_at <= now())
     or (d.usage_limit is not null and d.used_count >= d.usage_limit)
     or d.currency <> p_currency
     or (d.minimum_subtotal_cents is not null and p_subtotal_cents < d.minimum_subtotal_cents)
  then
    return query select false, 'not_applicable', null::uuid, null::text, null::text,
                        null::public.discount_type, null::integer, null::integer, null::integer;
    return;
  end if;

  return query select
    true,
    null::text,
    d.id,
    d.code,
    d.title,
    d.value_type,
    d.value_bp,
    d.value_cents,
    case d.value_type
      when 'percentage'    then (p_subtotal_cents::bigint * d.value_bp / 10000)::integer
      when 'fixed_amount'  then least(d.value_cents, p_subtotal_cents)
      else 0
    end;
end;
$$;

revoke all on function public.validate_discount_code(text, integer, public.currency_code) from public;
grant execute on function public.validate_discount_code(text, integer, public.currency_code)
  to anon, authenticated, service_role;

comment on function public.validate_discount_code is
  'Storefront discount check. SECURITY DEFINER so anon never needs SELECT on discounts. Integer maths only — the percentage is basis points, so no float ever touches a price.';

-- =============================================================================
-- 7. ASSERTIONS
-- These run as part of the migration. If any of them fires, the migration fails
-- and the schema does not ship. That is the point.
-- =============================================================================

-- 7a. Every table has RLS on AND at least one policy.
do $$
declare bad text;
begin
  select string_agg(c.relname || ' (' ||
           case when not c.relrowsecurity then 'RLS off' else 'no policy' end || ')', ', ' order by c.relname)
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and (not c.relrowsecurity
          or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if bad is not null then
    raise exception 'RLS assertion failed. Tables unprotected or unpolicied: %', bad;
  end if;
end;
$$;

-- 7b. Every foreign key is served by a non-partial index whose leading columns
--     are exactly the FK columns.
do $$
declare bad text;
begin
  select string_agg(x.conrel || '.' || x.conname, ', ' order by x.conrel, x.conname)
    into bad
    from (
      select con.conname,
             con.conrelid::regclass::text as conrel,
             con.conkey,
             con.conrelid
        from pg_constraint con
        join pg_namespace n on n.oid = con.connamespace
       where con.contype = 'f' and n.nspname = 'public'
    ) x
   where not exists (
     select 1
       from pg_index i
      where i.indrelid = x.conrelid
        and i.indpred is null
        and array_length(x.conkey, 1) <= i.indnkeyatts
        and (
          select array_agg(k order by ord)
            from unnest(i.indkey::int2[]) with ordinality as u(k, ord)
           where ord <= array_length(x.conkey, 1)
        ) @> x.conkey);
  if bad is not null then
    raise exception 'Foreign-key index assertion failed. Unindexed FKs: %', bad;
  end if;
end;
$$;

-- 7c. No money in a float or numeric column, and no timestamp without time zone.
do $$
declare bad text;
begin
  select string_agg(format('%s.%s (%s)', c.table_name, c.column_name, c.data_type), ', '
                    order by c.table_name, c.column_name)
    into bad
    from information_schema.columns c
    join pg_class pc on pc.relname = c.table_name
    join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
   where c.table_schema = 'public'
     and pc.relkind = 'r'
     and (
       (c.data_type in ('real', 'double precision', 'numeric', 'money')
        and (c.column_name ~ '(cents|price|cost|amount|total|subtotal|spend|revenue|budget|micros|fee|tax)'))
       or c.data_type in ('timestamp without time zone', 'time without time zone')
       or c.data_type = 'money'
     );
  if bad is not null then
    raise exception 'Type assertion failed. Money must be integer minor units and time must be timestamptz: %', bad;
  end if;
end;
$$;

-- 7d. Every table carrying updated_at has the trigger.
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at'
                       and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not exists (select 1 from pg_trigger g
                      where g.tgrelid = c.oid and g.tgname = 'set_updated_at');
  if bad is not null then
    raise exception 'updated_at trigger assertion failed for: %', bad;
  end if;
end;
$$;

-- 7e. anon must not hold any privilege on the sensitive tables.
do $$
declare bad text;
begin
  select string_agg(distinct table_name || '.' || privilege_type, ', ')
    into bad
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name in ('operators', 'admin_sessions', 'audit_log', 'customers',
                        'social_accounts', 'webhook_events', 'sync_state',
                        'agents', 'agent_runs', 'agent_messages', 'agent_tool_calls',
                        'approvals', 'agent_costs', 'suppliers', 'ingredients',
                        'recipes', 'batches', 'purchase_orders', 'email_sends');
  if bad is not null then
    raise exception 'Grant assertion failed. anon holds privileges it must not: %', bad;
  end if;
end;
$$;
