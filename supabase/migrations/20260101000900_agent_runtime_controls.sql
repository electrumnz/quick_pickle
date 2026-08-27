-- =============================================================================
-- HALF SOUR — 09 AGENT RUNTIME CONTROLS
--
-- Purely additive. Creates no table and alters none: it seeds the two rows in
-- `public.settings` that the agent runtime reads as its control plane, so the
-- controls exist from the first deploy rather than being created on first use.
--
--   agents.kill_switch               one switch that stops every agent
--   agents.global_monthly_cap_cents  company-wide ceiling on agent spend
--
-- Both are operator-editable from the admin. The kill switch is deliberately a
-- settings row rather than an env var: throwing it must not need a deploy, and
-- must be possible with one SQL statement if the admin itself is down.
-- =============================================================================

insert into public.settings (key, value, description, category, is_public, is_secret)
values (
  'agents.kill_switch',
  jsonb_build_object('engaged', false, 'reason', null, 'engagedAt', null, 'engagedBy', null),
  'Global agent kill switch. When engaged, no agent may call a model or run a tool. Checked before every model call, before every tool execution, and polled while a call is in flight.',
  'agents',
  false,
  false
)
on conflict (key) do nothing;

insert into public.settings (key, value, description, category, is_public, is_secret)
values (
  'agents.global_monthly_cap_cents',
  to_jsonb(50000),
  'Company-wide ceiling on agent spend for the calendar month, in NZD cents. No individual agent budget can exceed it: the runtime checks this cap after the per-run, per-day and per-agent-month caps and halts the run if the next call would cross it.',
  'agents',
  false,
  false
)
on conflict (key) do nothing;

comment on table public.settings is
  'Key/value company configuration. Also the agent runtime control plane: agents.kill_switch and agents.global_monthly_cap_cents live here so an operator can stop or throttle the whole AI staff without a deploy.';
