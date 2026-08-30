-- =============================================================================
-- HALF SOUR — THE NINTH ROLE: SECURITY AND IT
--
-- Every role registered until now does commercial work. Nobody was responsible
-- for noticing that the admin still has no password on it, that a Shopify token
-- has been left unset, that somebody is hammering the sign-in page, or that a
-- change was made in here by an actor nobody can account for. Those are the
-- things a founder who is not technical cannot be expected to spot, and they
-- are the ones that end a business rather than costing it a week.
--
-- Registers `security` (Ward) from `lib/agents/roster/definitions.ts`, exactly
-- as `20260103000000_agent_roster.sql` registers the other eight and with the
-- same projection of an `AgentDefinition` onto these columns.
-- `tests/roster/registration.test.ts` applies this file to a real Postgres and
-- fails if any column below has drifted from the definition.
--
-- Three properties of this role that are in the data rather than in the prose:
--
--   autonomy = 'propose'      It watches and tells her. It cannot change a
--                             security setting, revoke a session or touch a
--                             key, and there is no tool in its grant that
--                             could. An agent with authority over the security
--                             settings is a worse risk than most of what it is
--                             there to guard against.
--   tools                     Four reads and one internal note. Every read is
--                             incapable of returning a credential's value:
--                             `lib/agents/roster/security-posture.ts` answers
--                             "is this configured" with a name and a boolean,
--                             and the queries behind the other three never
--                             select `settings.value` or
--                             `admin_sessions.session_token_hash` at all.
--   model                     minimax/minimax-m2.7-free, the same free-window
--                             id `20260108000000_roster_gateway_models.sql`
--                             gave the roles that check rather than compose.
--                             Set here directly because that migration ran
--                             before this row existed.
--
-- Re-running is safe: the insert is an upsert keyed on `slug` and leaves the
-- columns an operator can change from the admin — status, is_enabled, spend
-- caps, run history, colour — alone on conflict.
-- =============================================================================

insert into public.agents
  (slug, name, job_title, purpose, model, system_prompt, tools, status, autonomy,
   requires_approval_for, daily_spend_cap_cents, monthly_spend_cap_cents,
   single_action_cap_cents, schedule_cron, timezone)
values (
  'security', 'Ward', 'Security and IT',
  'Watches who can get into this admin, what has been tried against it, and which credentials are configured — and tells the founder in words she can act on.',
  'minimax/minimax-m2.7-free',
  $prompt$You watch the safety of HALF SOUR's own systems: who can get into this admin,
what has been tried against it, which credentials the deployment is holding, and
what has changed in here.

You are writing for the founder, who runs this company alone and is not
technical. She cannot act on "weak credential detected". She can act on "your
admin password is still the one from the demonstration, and anyone who has seen
this site knows it". Write the second kind of sentence every time.

Working rules:
- Report only what your tools actually returned about THIS deployment. Never a
  generic checklist, never a risk you have not seen evidence of, never a number
  you did not read. An invented finding is worse than no finding, because it
  spends the one thing this job runs on, which is her believing you.
- Lead with the thing that would end the company, then the thing that would cost
  a week, then everything else. If nothing is wrong, say so in one line and stop.
- Every finding says what it means and what she should do about it, in that
  order, in plain words. Name the setting or the variable she has to change.
- You never see a password, a key or a token, and you never ask for one. You can
  see whether something is CONFIGURED and what it is called. If you ever find
  yourself about to write a credential's value, you have made a mistake: stop
  and say which tool returned it.
- You change nothing. Not a session, not a setting, not a key, not a lockout.
  Everything you would like changed is written down for her to decide, because
  an agent with authority over the security settings is a worse risk than most
  of what it is watching for.
- A quiet week is a real answer. Do not manufacture concern to look useful.$prompt$,
  '{read_sign_in_activity,read_admin_sessions,read_secrets_configured,read_change_trail,save_internal_note,hand_off}',
  'active', 'propose',
  '{content_asset,settings_change}',
  400, 8000, null, '0 7 * * *', 'Pacific/Auckland'
)
on conflict (slug) do update set
  name = excluded.name, job_title = excluded.job_title,
  purpose = excluded.purpose, model = excluded.model,
  system_prompt = excluded.system_prompt, tools = excluded.tools,
  autonomy = excluded.autonomy,
  requires_approval_for = excluded.requires_approval_for,
  daily_spend_cap_cents = excluded.daily_spend_cap_cents,
  monthly_spend_cap_cents = excluded.monthly_spend_cap_cents,
  single_action_cap_cents = excluded.single_action_cap_cents,
  schedule_cron = excluded.schedule_cron, updated_at = now();

-- Belongs to the runtime's service operator, exactly as the other eight do, so
-- an audit row raised by this agent resolves to something. Skipped silently when
-- the operator does not exist yet: the migrations run before the seed, and the
-- seed sets it for every agent immediately afterwards.
update public.agents a
   set operator_id = o.id
  from public.operators o
 where o.email = 'agents@halfsour.co.nz'
   and a.slug = 'security' and a.operator_id is null;

-- -----------------------------------------------------------------------------
-- Assertions
--
-- The same shape `20260103000000_agent_roster.sql` uses: a role that registered
-- without a tool grant, without a prompt, or on an autonomy that would let it
-- act unattended is worse than one that failed to register at all.
-- -----------------------------------------------------------------------------
do $$
declare
  registered int;
  autonomy   text;
  granted    text[];
begin
  select count(*) into registered from public.agents where slug = 'security';
  if registered <> 1 then
    raise exception 'security role: expected exactly 1 row, found %', registered;
  end if;

  select a.autonomy::text, a.tools into autonomy, granted
    from public.agents a where a.slug = 'security';

  if autonomy <> 'propose' then
    raise exception
      'security role: autonomy is "%" and must be "propose" — this role watches and asks, it does not act',
      autonomy;
  end if;

  if cardinality(granted) = 0 then
    raise exception 'security role: registered with no tools';
  end if;

  -- Everything it holds is a read or an internal note. A tool that could change
  -- a setting, revoke a session or reach outside the company has no business in
  -- this grant, and finding one here should stop the migration rather than
  -- become somebody's later surprise.
  if exists (
    select 1 from unnest(granted) as t(name)
     where t.name not in ('read_sign_in_activity', 'read_admin_sessions',
                          'read_secrets_configured', 'read_change_trail',
                          'save_internal_note', 'hand_off')
  ) then
    raise exception
      'security role: granted a tool outside its declared read-only set (%)',
      array_to_string(granted, ', ');
  end if;
end;
$$;
