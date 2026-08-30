-- =============================================================================
-- ORDER REFUNDS — index the one foreign key that shipped without one.
--
-- `20260106010000_order_refunds.sql` indexed three of its four foreign keys —
-- `order_id`, `approval_id` and a partial index for the unsettled queue — and
-- missed `decided_by`. `supabase/tests/verify.sql` §2 caught it, and CI runs
-- that script as its "Create and seed the database" step under
-- `set -euo pipefail`, so the miss took the whole e2e job down before a browser
-- opened. The check is right to insist and is not being relaxed: every other
-- foreign key in this schema is served by a non-partial index.
--
-- Two reasons this particular index is worth having on its own merits, quite
-- apart from the check.
--
-- **Deletes.** `operators.id` is referenced `on delete set null`. Postgres does
-- not use the referencing table's constraint to find the rows it must null out;
-- it scans. Without this index, removing an operator sequentially scans every
-- refund ever recorded, holding a lock on the table the money screen reads.
--
-- **The question the screen actually asks.** "What has this person decided to
-- give back?" is a lookup by `decided_by`, and it is the lookup an append-only
-- record of who-decided-what exists to answer.
--
-- Forward-only and idempotent: `if not exists`, so re-running this file on a
-- database that already has the index is a no-op rather than an error.
-- =============================================================================

create index if not exists order_refunds_decided_by_idx
  on public.order_refunds (decided_by);

comment on index public.order_refunds_decided_by_idx is
  'Covers order_refunds.decided_by -> operators.id. Required by supabase/tests/verify.sql §2, and by the cascade that nulls this column when an operator row is deleted.';

-- -----------------------------------------------------------------------------
-- Assertion. The same shape as verify.sql §2, scoped to this table, so that a
-- migration reporting success cannot be a migration that left the gap open.
-- -----------------------------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(x.conname, ', ' order by x.conname) into bad
  from (select con.conname, con.conrelid, con.conkey
          from pg_constraint con
          join pg_namespace n on n.oid = con.connamespace
         where con.contype = 'f'
           and n.nspname = 'public'
           and con.conrelid = 'public.order_refunds'::regclass) x
  where not exists (
    select 1 from pg_index i
     where i.indrelid = x.conrelid and i.indpred is null
       and array_length(x.conkey, 1) <= i.indnkeyatts
       and (select array_agg(k order by ord)
              from unnest(i.indkey::int2[]) with ordinality u(k, ord)
             where ord <= array_length(x.conkey, 1)) @> x.conkey);

  if bad is not null then
    raise exception 'order_refunds still has unindexed foreign keys: %', bad;
  end if;
  raise notice 'PASS: every order_refunds foreign key is covered by an index.';
end;
$$;
