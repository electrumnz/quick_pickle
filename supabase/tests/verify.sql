-- =============================================================================
-- HALF SOUR — schema verification
--
-- Run against a database that has the migrations and the seed applied:
--     supabase/tests/run_local.sh
-- or  psql -d <db> -f supabase/tests/verify.sql
--
-- Sections 1-5 are the acceptance checks and RAISE on failure, so this script
-- exits non-zero if the schema regresses. Sections 6-8 are evidence: they show
-- the security model and the traceability chain actually behaving.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off
\timing off

\echo ''
\echo '== 1. RLS: every table protected AND policied ================================'
select
  count(*) filter (where c.relrowsecurity)                              as rls_enabled,
  count(*) filter (where not c.relrowsecurity)                          as rls_MISSING,
  count(*) filter (where p.n is null or p.n = 0)                        as policies_MISSING,
  count(*)                                                              as tables_total,
  sum(coalesce(p.n, 0))                                                 as policies_total
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join lateral (select count(*) n from pg_policy pol where pol.polrelid = c.oid) p on true
where c.relkind = 'r';

do $$
declare bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (not c.relrowsecurity
         or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if bad is not null then raise exception 'FAIL: unprotected or unpolicied tables: %', bad; end if;
  raise notice 'PASS: every public table has RLS enabled and at least one policy.';
end $$;

\echo ''
\echo '-- policies by role and command ---------------------------------------------'
select
  case when 'anon' = any(roles) then 'anon (public storefront)'
       when 'authenticated' = any(roles) then 'authenticated (operator)'
       else array_to_string(roles, ',') end as grantee,
  cmd, count(*) as policies
from pg_policies where schemaname = 'public'
group by 1, 2 order by 1, 2;

\echo ''
\echo '== 2. Foreign keys: every FK served by a non-partial index ==================='
do $$
declare bad text; total int;
begin
  select count(*) into total from pg_constraint con
  join pg_namespace n on n.oid = con.connamespace
  where con.contype = 'f' and n.nspname = 'public';

  select string_agg(x.conrel || '.' || x.conname, ', ' order by x.conrel) into bad
  from (select con.conname, con.conrelid, con.conrelid::regclass::text conrel, con.conkey
          from pg_constraint con
          join pg_namespace n on n.oid = con.connamespace
         where con.contype = 'f' and n.nspname = 'public') x
  where not exists (
    select 1 from pg_index i
     where i.indrelid = x.conrelid and i.indpred is null
       and array_length(x.conkey, 1) <= i.indnkeyatts
       and (select array_agg(k order by ord)
              from unnest(i.indkey::int2[]) with ordinality u(k, ord)
             where ord <= array_length(x.conkey, 1)) @> x.conkey);

  if bad is not null then raise exception 'FAIL: unindexed foreign keys: %', bad; end if;
  raise notice 'PASS: all % foreign keys are covered by an index.', total;
end $$;

\echo ''
\echo '== 3. Types: money is integer minor units, time is timestamptz =============='
select data_type, count(*) as columns
from information_schema.columns c
join pg_class pc on pc.relname = c.table_name
join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
where c.table_schema = 'public' and pc.relkind = 'r'
  and (c.column_name ~ '(cents|micros)' or c.data_type like 'timestamp%')
group by 1 order by 1;

do $$
declare bad text;
begin
  select string_agg(format('%s.%s (%s)', c.table_name, c.column_name, c.data_type), ', ') into bad
  from information_schema.columns c
  join pg_class pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public' and pc.relkind = 'r'
    and ((c.data_type in ('real','double precision','numeric','money')
          and c.column_name ~ '(cents|price|cost|amount|total|subtotal|spend|revenue|budget|micros|fee|tax)')
      or c.data_type in ('timestamp without time zone','time without time zone')
      or c.data_type = 'money');
  if bad is not null then raise exception 'FAIL: bad money or time columns: %', bad; end if;
  raise notice 'PASS: no float/numeric money, no naive timestamps.';
end $$;

\echo ''
\echo '== 4. updated_at triggers ==================================================='
do $$
declare bad text; n int;
begin
  select count(*) into n from pg_trigger g
  join pg_class c on c.oid = g.tgrelid
  join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
  where g.tgname = 'set_updated_at';

  select string_agg(c.relname, ', ') into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at'
                     and a.attnum > 0 and not a.attisdropped
  where c.relkind = 'r'
    and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'set_updated_at');
  if bad is not null then raise exception 'FAIL: missing updated_at trigger: %', bad; end if;
  raise notice 'PASS: % tables carry the updated_at trigger.', n;
end $$;

\echo ''
\echo '== 5. Grants: anon cannot touch the back office ============================='
select table_name, string_agg(privilege_type, ',' order by privilege_type) as anon_privileges
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
group by table_name order by table_name;

do $$
declare bad text;
begin
  select string_agg(distinct table_name || ':' || privilege_type, ', ') into bad
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
    and table_name in ('operators','admin_sessions','audit_log','customers','social_accounts',
                       'webhook_events','sync_state','agents','agent_runs','agent_messages',
                       'agent_tool_calls','approvals','agent_costs','suppliers','ingredients',
                       'recipes','batches','purchase_orders','email_sends','addresses');
  if bad is not null then raise exception 'FAIL: anon holds privileges it must not: %', bad; end if;
  raise notice 'PASS: anon holds no privilege on any back-office table.';
end $$;

\echo ''
\echo '== 6. RLS in practice: what each caller can actually see ===================='
\echo '-- as the anonymous storefront, with no cart token --------------------------'
begin;
set local role anon;
select 'products'          as table, count(*) from public.products
union all select 'variants',          count(*) from public.product_variants
union all select 'collections',       count(*) from public.collections
union all select 'reviews (published)', count(*) from public.reviews
union all select 'carts (no token)',  count(*) from public.carts
union all select 'orders (no token)', count(*) from public.orders;
rollback;

\echo '-- as the anonymous storefront, holding one cart token ----------------------'
begin;
set local role anon;
set local request.cart_token = '7f3a91c04b28de65a1f7093c58bd2e4470a6c3159de824bf06a1c73e5d92f8b1';
select 'carts visible' as what, count(*) from public.carts
union all select 'cart_items visible', count(*) from public.cart_items;
rollback;

\echo '-- as an authenticated user who is NOT in the operators table ---------------'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select 'orders'   as table, count(*) from public.orders
union all select 'customers',  count(*) from public.customers
union all select 'approvals',  count(*) from public.approvals
union all select 'products (public policy)', count(*) from public.products;
rollback;

\echo '-- as the founder (an operators row linked to this auth uid) ----------------'
begin;
insert into auth.users (id, email) values ('11111111-2222-3333-4444-555555555555', 'nadia@halfsour.co.nz')
  on conflict (id) do nothing;
update public.operators set user_id = '11111111-2222-3333-4444-555555555555' where email = 'nadia@halfsour.co.nz';
set local role authenticated;
set local request.jwt.claim.sub = '11111111-2222-3333-4444-555555555555';
select 'orders'   as table, count(*) from public.orders
union all select 'customers',  count(*) from public.customers
union all select 'approvals',  count(*) from public.approvals
union all select 'batches',    count(*) from public.batches;
rollback;

\echo ''
\echo '== 7. Invalid states are unrepresentable ===================================='
\echo '-- an order line for a variant that is not on that line''s product ----------'
do $$
declare wrong_variant uuid; oi_product uuid; ok boolean := false;
begin
  select oi.product_id into oi_product from public.order_items oi limit 1;
  select v.id into wrong_variant from public.product_variants v where v.product_id <> oi_product limit 1;
  begin
    update public.order_items set variant_id = wrong_variant
     where id = (select id from public.order_items limit 1);
  exception when foreign_key_violation then
    ok := true;
  end;
  if not ok then raise exception 'FAIL: an order line accepted a variant from another product'; end if;
  raise notice 'PASS: order_items rejected a variant belonging to a different product (composite FK).';
end $$;

\echo '-- a batch that expires before it was made ---------------------------------'
do $$
declare ok boolean := false;
begin
  begin
    update public.batches set expires_at = produced_at - interval '1 day'
     where produced_at is not null and expires_at is not null
       and id = (select id from public.batches where expires_at is not null limit 1);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: a batch was allowed to expire before it was produced'; end if;
  raise notice 'PASS: batches rejected an expiry earlier than production.';
end $$;

\echo '-- tracing a batch onto an order line for a different product ---------------'
do $$
declare oi uuid; oi_prod uuid; other_batch uuid; ok boolean := false;
begin
  select id, product_id into oi, oi_prod from public.order_items limit 1;
  select id into other_batch from public.batches where product_id <> oi_prod limit 1;
  begin
    insert into public.order_item_batches (order_item_id, batch_id, product_id, quantity)
    values (oi, other_batch, oi_prod, 1);
  exception when foreign_key_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: a batch was traced onto an order line for another product'; end if;
  raise notice 'PASS: order_item_batches rejected a cross-product trace.';
end $$;

\echo '-- an order whose totals do not add up -------------------------------------'
do $$
declare ok boolean := false;
begin
  begin
    update public.orders set total_cents = total_cents + 100 where id = (select id from public.orders limit 1);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: an order accepted a total that does not balance'; end if;
  raise notice 'PASS: orders rejected a total that does not equal subtotal - discount + shipping.';
end $$;

\echo '-- an approval marked pending but already decided ---------------------------'
do $$
declare ok boolean := false;
begin
  begin
    update public.approvals set decided_at = now() where status = 'pending';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: an approval was both pending and decided'; end if;
  raise notice 'PASS: approvals rejected a pending row carrying a decision.';
end $$;

\echo ''
\echo '== 8. The business, as the admin would see it ==============================='
\echo '-- money integrity: every order balances, every line sums -------------------'
select
  (select count(*) from public.orders
    where total_cents <> subtotal_cents - discount_cents + shipping_cents) as unbalanced_orders,
  (select count(*) from (
     select o.id from public.orders o join public.order_items oi on oi.order_id = o.id
      group by o.id, o.subtotal_cents, o.discount_cents
     having sum(oi.line_total_cents) <> o.subtotal_cents - o.discount_cents) x) as unbalanced_lines,
  (select count(*) from public.customers c
    where c.total_spent_cents <> coalesce((
      select sum(o.total_cents - o.refunded_cents) from public.orders o
       where o.customer_id = c.id
         and o.financial_status in ('paid','partially_refunded')), 0)) as drifted_ltv;

\echo '-- the order book, by month ------------------------------------------------'
select to_char(date_trunc('month', placed_at), 'Mon YYYY') as month,
       count(*) as orders,
       to_char(sum(total_cents) / 100.0, 'FM999G999D00') as gross_nzd,
       to_char(round(avg(total_cents)) / 100.0, 'FM999D00') as aov_nzd
  from public.orders
 group by date_trunc('month', placed_at)
 order by date_trunc('month', placed_at);

\echo '-- the approvals queue -----------------------------------------------------'
select a.risk, a.subject_type, a.title,
       coalesce(to_char(a.amount_cents / 100.0, 'FM999G999D00'), '—') as nzd,
       ag.name as raised_by
  from public.approvals a
  left join public.agents ag on ag.id = a.requested_by_agent_id
 where a.status = 'pending'
 order by a.risk desc, a.requested_at;

\echo '-- FOOD SAFETY: recall the oldest No 03 SMOKE batch -------------------------'
select b.batch_code,
       to_char(b.expires_at, 'YYYY-MM-DD') as best_before,
       count(distinct o.id) as orders_affected,
       sum(oib.quantity) as bottles_shipped,
       count(distinct o.email) as customers_to_contact
  from public.batches b
  join public.order_item_batches oib on oib.batch_id = b.id
  join public.order_items oi on oi.id = oib.order_item_id
  join public.orders o on o.id = oi.order_id
 where b.product_id = (select id from public.products where handle = 'no-03-smoke')
 group by b.id, b.batch_code, b.expires_at
 order by b.expires_at;

\echo '-- and one step BACK: which supplier lots went into that batch --------------'
select b.batch_code, i.name as ingredient, s.name as supplier,
       bi.supplier_lot_code, bi.quantity || ' ' || bi.unit as quantity
  from public.batches b
  join public.batch_ingredients bi on bi.batch_id = b.id
  join public.ingredients i on i.id = bi.ingredient_id
  left join public.suppliers s on s.id = bi.supplier_id
 where b.product_id = (select id from public.products where handle = 'no-03-smoke')
   and b.status = 'released'
 order by b.expires_at, i.name
 limit 8;

\echo '-- what needs attention right now ------------------------------------------'
select 'ingredient below reorder point' as flag, i.name as subject,
       i.stock_on_hand || ' ' || i.unit || ' of ' || i.reorder_point || ' ' || i.unit as detail
  from public.ingredients i where i.is_active and i.reorder_point > 0 and i.stock_on_hand < i.reorder_point
union all
select 'batch near best-before', b.batch_code,
       b.units_remaining || ' units, ' || (b.expires_at::date - current_date) || ' days left'
  from public.batches b where b.status = 'released' and b.units_remaining > 0
   and b.expires_at < now() + interval '60 days'
union all
select 'supplier certificate expiring', s.name,
       (s.food_safety_expires_on - current_date) || ' days left'
  from public.suppliers s where s.food_safety_expires_on < current_date + 90
union all
select 'unpaid trade invoice', o.order_number,
       to_char(o.total_cents / 100.0, 'FM999G999D00') || ' NZD, ' ||
       (current_date - o.placed_at::date) || ' days old'
  from public.orders o where o.financial_status = 'pending'
union all
select 'sync unhealthy', ss.resource_type::text,
       ss.consecutive_failures || ' consecutive failures'
  from public.sync_state ss where ss.consecutive_failures > 0
union all
select 'webhook parked', we.topic, we.attempts || ' attempts, awaiting replay'
  from public.webhook_events we where we.process_status = 'failed';

\echo ''
\echo '== ALL CHECKS PASSED ========================================================'
