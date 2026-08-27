-- =============================================================================
-- HALF SOUR — 06 ADMIN AUTH
-- The brute-force throttle behind the single-password admin gate, plus the
-- atomic helpers the Node auth layer calls.
--
-- Everything else admin auth needs already exists in 01_platform:
--   operators       — the identity a session hangs off
--   admin_sessions  — server-side, revocable session rows
--   audit_log       — the append-only record of every login attempt
--
-- This migration adds ONLY what was missing: durable rate-limit state. It is
-- deliberately a table rather than in-process memory, because the admin runs on
-- serverless functions where module scope dies with the container: an attacker
-- who could force cold starts would otherwise reset the counter at will.
--
-- The counters are mutated exclusively through the SECURITY DEFINER functions
-- below so that "read state, decide, write state" cannot interleave between two
-- concurrent login attempts — the whole decision happens inside one statement.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- admin_auth_throttle
--
-- One row per (scope, subject):
--   ('ip',     '203.0.113.9')  — per-client budget
--   ('global', '*')            — whole-door budget, which is what actually stops
--                                a distributed attack rotating source addresses
--
-- `subject` is text rather than inet because the global row has no address, and
-- because a future scope (e.g. an ASN or a Cloudflare ray) will not be one either.
-- -----------------------------------------------------------------------------
create table public.admin_auth_throttle (
  scope                 text        not null,
  subject               text        not null,
  consecutive_failures  integer     not null default 0,
  total_failures        bigint      not null default 0,
  total_attempts        bigint      not null default 0,
  window_started_at     timestamptz,
  first_failure_at      timestamptz,
  last_failure_at       timestamptz,
  last_success_at       timestamptz,
  locked_until          timestamptz,
  lock_count            integer     not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  primary key (scope, subject),

  constraint admin_auth_throttle_scope_known
    check (scope in ('ip', 'global')),
  constraint admin_auth_throttle_subject_present
    check (btrim(subject) <> ''),
  constraint admin_auth_throttle_counters_non_negative
    check (consecutive_failures >= 0 and total_failures >= 0
           and total_attempts >= 0 and lock_count >= 0),
  constraint admin_auth_throttle_failure_window_ordered
    check (last_failure_at is null or first_failure_at is null
           or last_failure_at >= first_failure_at)
);

create index admin_auth_throttle_locked_idx
  on public.admin_auth_throttle (locked_until desc)
  where locked_until is not null;

comment on table public.admin_auth_throttle is
  'Durable per-IP and global brute-force counters for the admin password gate. Survives serverless cold starts by construction.';
comment on column public.admin_auth_throttle.consecutive_failures is
  'Failures since the last success, reset when the failure window lapses. Drives both the escalating delay and the hard lockout.';
comment on column public.admin_auth_throttle.lock_count is
  'How many times this subject has been locked out. Each lockout lasts base * 2^lock_count, capped, so a persistent attacker is pushed towards hours.';
comment on column public.admin_auth_throttle.locked_until is
  'While in the future, every attempt for this subject is refused before the password is even hashed.';

alter table public.admin_auth_throttle enable row level security;

-- -----------------------------------------------------------------------------
-- admin_auth_register_attempt
--
-- One statement that reads, decides and writes. `p_failed` false records a
-- successful attempt and clears the subject's debt; true increments the counters
-- and, at the threshold, arms an escalating lockout.
--
-- `p_now` is passed in rather than read from now() so that the policy is
-- exercisable against a controlled clock in tests. It is never attacker-derived:
-- the only callers are server-side and pass their own monotonic wall clock.
-- -----------------------------------------------------------------------------
create or replace function public.admin_auth_register_attempt(
  p_scope             text,
  p_subject           text,
  p_failed            boolean,
  p_now               timestamptz,
  p_window_seconds    double precision,
  p_lock_threshold    integer,
  p_base_lock_seconds double precision,
  p_max_lock_seconds  double precision
)
returns public.admin_auth_throttle
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      public.admin_auth_throttle;
  v_reset    boolean;
  v_next     integer;
  v_arm_lock boolean;
begin
  -- Take the row lock first so two concurrent attempts serialise here rather
  -- than both reading a stale counter.
  select * into v_row
    from public.admin_auth_throttle
   where scope = p_scope and subject = p_subject
     for update;

  if not found then
    insert into public.admin_auth_throttle (scope, subject, created_at, updated_at)
    values (p_scope, p_subject, p_now, p_now)
    on conflict (scope, subject) do nothing;

    select * into v_row
      from public.admin_auth_throttle
     where scope = p_scope and subject = p_subject
       for update;
  end if;

  if not p_failed then
    update public.admin_auth_throttle
       set consecutive_failures = 0,
           total_attempts       = v_row.total_attempts + 1,
           window_started_at    = null,
           first_failure_at     = null,
           last_success_at      = p_now,
           locked_until         = null,
           lock_count           = 0,
           updated_at           = p_now
     where scope = p_scope and subject = p_subject
     returning * into v_row;
    return v_row;
  end if;

  v_reset := v_row.last_failure_at is null
             or v_row.last_failure_at
                < p_now - make_interval(secs => p_window_seconds);

  v_next := case when v_reset then 1 else v_row.consecutive_failures + 1 end;

  -- Only arm a NEW lockout when one is not already running: an attacker who
  -- keeps hammering a locked door must not be able to reset lock_count, and
  -- must not extend their own lockout into an accidental denial of service
  -- for the founder beyond the escalation the policy already prescribes.
  v_arm_lock := v_next >= p_lock_threshold
                and (v_row.locked_until is null or v_row.locked_until <= p_now);

  update public.admin_auth_throttle
     set consecutive_failures = v_next,
         total_failures       = v_row.total_failures + 1,
         total_attempts       = v_row.total_attempts + 1,
         window_started_at    = case when v_reset then p_now
                                     else coalesce(v_row.window_started_at, p_now) end,
         first_failure_at     = case when v_reset then p_now
                                     else coalesce(v_row.first_failure_at, p_now) end,
         last_failure_at      = p_now,
         locked_until         = case
                                  when v_arm_lock then
                                    p_now + make_interval(secs => least(
                                      p_max_lock_seconds,
                                      p_base_lock_seconds
                                        * power(2::double precision,
                                                least(v_row.lock_count, 12))))
                                  else v_row.locked_until
                                end,
         lock_count           = case when v_arm_lock then v_row.lock_count + 1
                                     else v_row.lock_count end,
         updated_at           = p_now
   where scope = p_scope and subject = p_subject
   returning * into v_row;

  return v_row;
end;
$$;

comment on function public.admin_auth_register_attempt(
  text, text, boolean, timestamptz, double precision, integer,
  double precision, double precision) is
  'Atomically record one admin login attempt and return the resulting throttle state. Arms an escalating lockout at the threshold.';

-- -----------------------------------------------------------------------------
-- admin_auth_purge
-- Housekeeping: drop throttle rows that have been quiet and unlocked for longer
-- than the retention window, and expire sessions past their end. audit_log is
-- never touched — it is the permanent record.
-- -----------------------------------------------------------------------------
create or replace function public.admin_auth_purge(
  p_now                timestamptz,
  p_retention_seconds  double precision
)
returns table (throttle_rows_deleted bigint, sessions_expired bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_throttle bigint;
  v_sessions bigint;
begin
  delete from public.admin_auth_throttle
   where (locked_until is null or locked_until <= p_now)
     and greatest(coalesce(last_failure_at, created_at),
                  coalesce(last_success_at, created_at))
         < p_now - make_interval(secs => p_retention_seconds);
  get diagnostics v_throttle = row_count;

  update public.admin_sessions
     set revoked_at     = p_now,
         revoked_reason = 'expired',
         updated_at     = p_now
   where revoked_at is null
     and expires_at <= p_now;
  get diagnostics v_sessions = row_count;

  return query select v_throttle, v_sessions;
end;
$$;

comment on function public.admin_auth_purge(timestamptz, double precision) is
  'Housekeeping for the admin auth tables. Never deletes audit_log rows.';
