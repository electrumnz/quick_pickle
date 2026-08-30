-- =============================================================================
-- HALF SOUR — one live manual run per agent
--
-- The Team page grew a "Run now" button. It starts a real run of one role, in
-- the request that pressed it, and the run takes seconds and several model
-- calls. So the obvious accident is two: the founder presses twice, or opens a
-- second tab, or a browser replays the POST — and the company pays twice for
-- one job and reads two half-transcripts of it.
--
-- Checking `select ... where status in ('queued','running')` in the server
-- action first is worth doing, because it produces a sentence a person can
-- read. It is not the guard. Between that read and the insert there is a
-- window, and a guard with a window is a guard that fails on exactly the day it
-- matters.
--
-- This is the guard. Postgres refuses the second row.
--
-- SCOPED TO `trigger = 'manual'`, deliberately. A scheduled run, a chained
-- handoff, a retry and an approval resume are all started by machinery that
-- already knows what it is doing, and several of them legitimately overlap —
-- a handoff opens a child run while the parent is still live. The founder
-- pressing a button twice is the case with no legitimate reading, and it is the
-- only case this index closes.
--
-- `awaiting_approval` is NOT in the set, and that is the subtle half. A parked
-- run is not executing anything: it is a decision sitting in her queue, and
-- resuming it is the Inngest workflow's `waitForEvent`, which this deployment
-- does not have wired. So a manual run that parks would block that agent's
-- button for ever if it counted as live. It does not. The worst that a second
-- press can then do is put a second proposal in a queue she is already reading,
-- which is a nuisance; a permanently dead button is a broken product.
--
-- Safe to apply over existing data: every manual run in `supabase/seed.sql` is
-- terminal. If a real deployment somehow holds two live manual runs for one
-- agent, this migration fails loudly rather than silently discarding one, which
-- is the correct way round for a table that is the company's memory.
-- =============================================================================

create unique index if not exists agent_runs_one_live_manual_run
  on public.agent_runs (agent_id)
  where trigger = 'manual'
    and status in ('queued', 'running');

comment on index public.agent_runs_one_live_manual_run is
  'One live "Run now" per agent. The database refuses a double submit; the admin only explains it.';
