-- =============================================================================
-- HALF SOUR — ASK THE TEAM
--
-- The founder is not technical, and running her company currently means
-- learning nine admin destinations and knowing which one holds the thing she
-- wants. This is the tenth: a chat window where she says what she needs and the
-- team works out who does it.
--
-- WHAT IS AND IS NOT STORED HERE.
--
-- There is already a transcript format in this schema — `agent_runs` plus
-- `agent_messages` — and every run written into it is replayable. Nothing here
-- duplicates it. `chat_turns` holds ONE row per thing SHE said, plus a pointer
-- to the run that thing opened. The agent's words are read back out of
-- `agent_runs.outcome` and its reasoning out of `agent_messages`, exactly as
-- The Team page reads them. A second copy of an agent's reply would be a second
-- thing that can be wrong.
--
-- `chat_turns.note` is the ONE piece of prose written here, and it is never an
-- agent's: it is the routing layer's own sentence for the cases where no run
-- was opened at all (nobody advertises the work) or where a run stopped without
-- answering (no model configured, a cap reached, the kill switch thrown).
--
-- `agent_conversations` is the turn ledger from `lib/agents/boundary/conversation.ts`,
-- given a table. That cap — five turns by default — is the only thing standing
-- between two agents handing work back and forth and doing it until the daily
-- spend cap notices. It was counted in memory, which is correct for a single
-- process and a lie across two, so a conversation that has spent its turns
-- stays spent whichever instance serves the next request.
--
-- ONE CONVERSATION PER ASK, NOT PER SESSION. A chat session is hers and can run
-- for weeks; a conversation is one question and the chain of agents that
-- answered it. Capping the session would cap HER at five messages, which is not
-- what the ceiling is for.
--
-- Re-runnable: every statement below is guarded, because
-- `tests/roster/support/pglite.ts` replays the roster-registration migrations
-- after `supabase/seed.sql` truncates `public.agents`, and this is now one of
-- them — it is the migration that grants the roster the `hand_off` tool.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The turn ledger
-- -----------------------------------------------------------------------------
create table if not exists public.agent_conversations (
  id           text primary key,
  -- Advanced by every run opened inside the conversation, whether or not the
  -- cap allowed it. A refused turn still happened and hiding it would make the
  -- count lie — see `InMemoryConversationLedger.take`.
  turns_taken  integer not null default 0,
  turn_cap     integer not null default 5,
  -- What opened this conversation, for the admin: 'chat', 'schedule', 'webhook'.
  opened_by    text not null default 'chat',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint agent_conversations_id_shape check (id ~ '^[A-Za-z0-9:_-]{1,200}$'),
  constraint agent_conversations_turns_nonneg check (turns_taken >= 0),
  -- Mirrors DEFAULT_CONVERSATION_TURN_CAP and MAX_CONVERSATION_TURN_CAP.
  constraint agent_conversations_cap_range check (turn_cap between 1 and 20)
);

create index if not exists agent_conversations_spent_idx
  on public.agent_conversations (updated_at desc)
  where turns_taken >= turn_cap;

comment on table public.agent_conversations is
  'The conversation turn ledger. One row per chain of runs; turns_taken >= turn_cap is a chain that has been stopped.';

-- -----------------------------------------------------------------------------
-- 2. Sessions and turns
-- -----------------------------------------------------------------------------
do $types$
begin
  if not exists (select 1 from pg_type where typname = 'chat_session_status') then
    create type public.chat_session_status as enum ('open', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'chat_turn_outcome') then
    create type public.chat_turn_outcome as enum (
      -- A run was opened and has not finished. Terminal states follow.
      'working',
      -- An agent finished and said something. The words live on agent_runs.
      'answered',
      -- The run stopped on an approval. `approvals` holds the decision.
      'waiting_on_you',
      -- Nothing was dispatched: no agent on duty advertises this work.
      'nobody_does_that',
      -- A run was opened and stopped without answering. `note` says why.
      'stopped'
    );
  end if;
end
$types$;

create table if not exists public.chat_sessions (
  id            uuid primary key default gen_random_uuid(),
  -- Whose conversation this is. There is one human, but an audit row is
  -- stamped with an operator and so is this: a session with nobody behind it
  -- would be a session nobody can be shown to have had.
  operator_id   uuid not null references public.operators (id) on delete cascade,
  -- Taken from her first message, so the list reads as what she asked about
  -- rather than "Session 3".
  title         text not null,
  status        public.chat_session_status not null default 'open',
  started_at    timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint chat_sessions_title_length check (length(btrim(title)) between 1 and 200),
  constraint chat_sessions_activity_after_start check (last_activity_at >= started_at)
);

create index if not exists chat_sessions_operator_idx
  on public.chat_sessions (operator_id, last_activity_at desc);
create index if not exists chat_sessions_open_idx
  on public.chat_sessions (last_activity_at desc) where status = 'open';

comment on table public.chat_sessions is
  'One conversation the founder can leave and come back to. The transcript is in agent_runs/agent_messages; this is the thread that points at them.';

create table if not exists public.chat_turns (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.chat_sessions (id) on delete cascade,
  seq           integer not null,
  -- Verbatim. She is the operator: her words are trusted input and are not
  -- defanged, framed or rewritten anywhere on this path.
  asked         text not null,
  -- Which job this turned out to be, from `CAPABILITIES`. Null when the router
  -- could not tell, which is one of the two ways `nobody_does_that` happens.
  capability    text,
  -- Which agent picked it up. Resolved from the capability, never named by her.
  agent_id      uuid references public.agents (id) on delete set null,
  -- The real run. Its transcript, cost and gate are the ordinary ones.
  run_id        uuid references public.agent_runs (id) on delete set null,
  conversation_id text references public.agent_conversations (id) on delete set null,
  outcome       public.chat_turn_outcome not null default 'working',
  -- The routing layer's own words, never an agent's. See the header.
  note          text,
  -- Why this went where it went: the words that matched, the agents considered.
  detail        jsonb not null default '{}',
  asked_at      timestamptz not null default now(),
  settled_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (session_id, seq),
  constraint chat_turns_seq_positive check (seq >= 1),
  constraint chat_turns_asked_length check (length(btrim(asked)) between 1 and 4000),
  constraint chat_turns_note_length check (note is null or length(note) <= 4000),
  -- An answer without a run would be a chat that made something up.
  constraint chat_turns_answer_has_run check (
    outcome not in ('answered', 'waiting_on_you') or run_id is not null),
  -- A refusal has to say why, in words she can read.
  constraint chat_turns_refusal_has_note check (
    outcome not in ('nobody_does_that', 'stopped') or note is not null),
  constraint chat_turns_settled_after_asked check (
    settled_at is null or settled_at >= asked_at)
);

create index if not exists chat_turns_session_idx on public.chat_turns (session_id, seq);
create index if not exists chat_turns_run_idx on public.chat_turns (run_id);
create index if not exists chat_turns_waiting_idx
  on public.chat_turns (asked_at desc) where outcome = 'waiting_on_you';

-- agent_id and conversation_id are foreign keys, so they need indexes of their
-- own. supabase/tests/verify.sql refuses any FK that no non-partial index
-- serves, and it runs under `set -euo pipefail` in CI's e2e job — an unindexed
-- key there does not warn, it kills the job before Playwright starts. The
-- partial index above cannot stand in for either: a partial index does not
-- serve the cascade check, which has to look at every row.
create index if not exists chat_turns_agent_idx on public.chat_turns (agent_id);
create index if not exists chat_turns_conversation_idx
  on public.chat_turns (conversation_id);

comment on table public.chat_turns is
  'One thing the founder said, and the run it opened. The agent''s reply is agent_runs.outcome; nothing here copies it.';
comment on column public.chat_turns.note is
  'The routing layer''s own sentence, for a turn no agent answered. Never an agent''s words.';

-- -----------------------------------------------------------------------------
-- 3. RLS, grants, triggers — the same shape every other table here has
-- -----------------------------------------------------------------------------
alter table public.agent_conversations enable row level security;
alter table public.chat_sessions       enable row level security;
alter table public.chat_turns          enable row level security;

do $policies$
begin
  if not exists (select 1 from pg_policy where polname = 'agent_conversations_operator_all') then
    create policy agent_conversations_operator_all on public.agent_conversations
      for all to authenticated using (public.is_operator()) with check (public.is_operator());
  end if;
  if not exists (select 1 from pg_policy where polname = 'chat_sessions_operator_all') then
    create policy chat_sessions_operator_all on public.chat_sessions
      for all to authenticated using (public.is_operator()) with check (public.is_operator());
  end if;
  if not exists (select 1 from pg_policy where polname = 'chat_turns_operator_all') then
    create policy chat_turns_operator_all on public.chat_turns
      for all to authenticated using (public.is_operator()) with check (public.is_operator());
  end if;
end
$policies$;

-- `anon` gets nothing. A chat log is the founder reading her own business out
-- loud; there is no version of this a public role should see.
revoke all on public.agent_conversations from anon;
revoke all on public.chat_sessions from anon;
revoke all on public.chat_turns from anon;
grant all on public.agent_conversations, public.chat_sessions, public.chat_turns
  to authenticated, service_role;

do $triggers$
begin
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at'
                   and tgrelid = 'public.agent_conversations'::regclass) then
    create trigger set_updated_at before update on public.agent_conversations
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at'
                   and tgrelid = 'public.chat_sessions'::regclass) then
    create trigger set_updated_at before update on public.chat_sessions
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at'
                   and tgrelid = 'public.chat_turns'::regclass) then
    create trigger set_updated_at before update on public.chat_turns
      for each row execute function public.set_updated_at();
  end if;
end
$triggers$;

-- -----------------------------------------------------------------------------
-- 4. The roster gains `hand_off`
--
-- `lib/agents/boundary/handoff.ts` has been able to route work by capability
-- since it was written, and nothing has ever called it: no agent held a tool
-- that could. This grants that tool to all eight roles, which is the whole of
-- the change — the routing, the two refusals and the turn cap were already
-- there and are untouched.
--
-- Appended rather than rewritten, so a role whose grant has moved on since this
-- migration was written keeps what it has. `tests/roster/registration.test.ts`
-- holds this file to `lib/agents/roster/definitions.ts` field for field.
-- -----------------------------------------------------------------------------
update public.agents
   set tools = tools || array['hand_off'],
       updated_at = now()
 where slug in ('brine-ops', 'concierge', 'ledger', 'social',
                'marketing', 'trade', 'product', 'analyst')
   and not ('hand_off' = any (tools));

-- -----------------------------------------------------------------------------
-- 5. ASSERTIONS — the schema guarantees, re-run against these three tables
-- -----------------------------------------------------------------------------
do $assert$
declare bad text;
begin
  select string_agg(c.relname || ' (' ||
           case when not c.relrowsecurity then 'RLS off' else 'no policy' end || ')', ', ')
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('agent_conversations', 'chat_sessions', 'chat_turns')
     and (not c.relrowsecurity
          or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if bad is not null then
    raise exception 'Chat RLS assertion failed: %', bad;
  end if;
end
$assert$;
