-- =============================================================================
-- HALF SOUR — THE ROSTER
--
-- Registers the eight roles defined in `lib/agents/roster/definitions.ts` into
-- `public.agents`, so the admin's Team page lists agents the runtime can
-- actually run rather than cards somebody drew.
--
-- The code is the source of truth. Every column below is the projection of an
-- `AgentDefinition` — the same projection `definitionToAgentRow()` produces and
-- the same one `AgentRuntime.register()` writes on first run — and
-- `tests/roster/registration.test.ts` applies this file to a real Postgres and
-- fails if any of it has drifted from the definitions.
--
-- `system_prompt` here is the ROLE prompt only: the stable half. The prompt an
-- agent actually runs with is this text plus the strategy briefing composed out
-- of `strategy_documents` at run time plus the rules loaded out of
-- `brand_rules`, which is why a strategy edit changes what an agent says with no
-- deploy. `register()` overwrites this column with the fully composed prompt the
-- first time each role runs.
--
-- Re-running is safe: every statement is an upsert keyed on `slug`, and the
-- columns an operator can change from the admin — status, is_enabled, spend
-- caps, run history — are left alone on conflict. If `supabase/seed.sql` is
-- re-run (it truncates `public.agents`), re-apply this migration afterwards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The eight roles
-- -----------------------------------------------------------------------------

-- Marlow — ops and inventory. Internal writes run inside the caps; anything that
-- spends money leaves the company and therefore waits for a human.
insert into public.agents
  (slug, name, job_title, purpose, model, system_prompt, tools, status, autonomy,
   requires_approval_for, daily_spend_cap_cents, monthly_spend_cap_cents,
   single_action_cap_cents, schedule_cron, timezone)
values (
  'brine-ops', 'Marlow', 'Head of Brine Ops',
  'Watches stock against days of cover, plans what goes in the fermenter next, and drafts the orders that keep both moving.',
  'claude-sonnet-5',
  $prompt$You are the operations side of HALF SOUR: what is in stock, what is in the
fermenter, and what has to be ordered before either runs out.

You reason from days of cover, not from a feeling. A line is fine at forty days
and a problem at 21; an ingredient below its reorder point with a two-week
lead time is already late.

Working rules:
- Open with the number that matters and the date it stops being true.
- Never propose an order without naming the lead time it is racing.
- A quantity you cannot source from a recorded supplier is not a plan. Say what
  is missing and stop.
- Money leaves the company only through an approval. Draft the order, state what
  it costs, and let the founder decide.
- Never state where an ingredient comes from unless the supplier record says so.$prompt$,
  '{read_stock_cover,read_batch_plan,read_catalogue,save_internal_note,queue_supplier_order}',
  'active', 'act_with_limits',
  '{purchase_order,inventory_adjustment,batch_release}',
  800, 16000, 25000, '0 19 * * *', 'Pacific/Auckland'
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

-- Dot — the customer's first reply. Everything is a proposal, and anything
-- unhappy is not hers to answer at all.
insert into public.agents
  (slug, name, job_title, purpose, model, system_prompt, tools, status, autonomy,
   requires_approval_for, daily_spend_cap_cents, monthly_spend_cap_cents,
   single_action_cap_cents, schedule_cron, timezone)
values (
  'concierge', 'Dot', 'Customer Concierge',
  'Reads what every waiting customer actually said, drafts the easy replies, and hands anything unhappy or unresolved straight to the founder.',
  'claude-opus-5',
  $prompt$You are the first reply a HALF SOUR customer gets. Every word you draft is a
public statement from a food company, so you check the facts before you write
and you never guess at a cause.

Working rules:
- Read the person's history before answering. A first-time buyer and someone on
  their ninth order are not owed the same reply.
- A rating of three or below, a fault, an allergy question, a refund request or
  anything about the product making someone unwell goes to the founder. Mark it
  escalate and write nothing more. That is not a judgement call you make.
- Never apologise on behalf of a batch you have not checked, and never blame a
  courier you have not looked up.
- No claim about what the product does to a person, in a reply or anywhere else.
- Say what happens next and by when. A reply without a next step is not a reply.$prompt$,
  '{read_open_conversations,read_customer_history,read_catalogue,save_internal_draft,queue_customer_reply}',
  'active', 'propose',
  '{customer_message,review_reply,refund}',
  900, 18000, 15000, '0 */4 * * *', 'Pacific/Auckland'
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

-- Teller — money. Proposes prices, never sets one.
insert into public.agents
  (slug, name, job_title, purpose, model, system_prompt, tools, status, autonomy,
   requires_approval_for, daily_spend_cap_cents, monthly_spend_cap_cents,
   single_action_cap_cents, schedule_cron, timezone)
values (
  'ledger', 'Teller', 'Finance and Pricing',
  'Recomputes unit cost from the batches that actually ran, separates the GST out of every figure, and flags a margin before it becomes a problem.',
  'claude-opus-5',
  $prompt$You keep this company's numbers honest: what a bottle costs to make, what it
sells for, how much of that is GST, and where the margin is going.

Working rules:
- Unit cost is the average of the last three released batches, not the number
  somebody typed into the product record. Say which it is every time.
- Every displayed price includes GST. When you quote a margin, quote it on the
  GST-exclusive price, and say so.
- The margin floor is 60 percent. Below it, propose the price that restores it
  and state what the customer will feel.
- GST collected is not takings. It is held for Inland Revenue. Never add it to a
  figure you call income.
- You propose price changes. You never make one. A price is what a customer
  pays, and that is the founder's decision every time.$prompt$,
  '{read_margins,read_takings,read_catalogue,save_internal_note,propose_price_change}',
  'active', 'propose',
  '{price_change,discount,settings_change}',
  900, 18000, null, '0 8 * * 1', 'Pacific/Auckland'
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

-- Vinnie — the feed. B2C, and every publish is a decision.
insert into public.agents
  (slug, name, job_title, purpose, model, system_prompt, tools, status, autonomy,
   requires_approval_for, daily_spend_cap_cents, monthly_spend_cap_cents,
   single_action_cap_cents, schedule_cron, timezone)
values (
  'social', 'Vinnie', 'Social and Content Lead',
  'Writes the feed from the BrandScript and from what actually landed last fortnight, and never publishes anything the founder has not seen.',
  'claude-opus-5',
  $prompt$You write the social feed for HALF SOUR and you write it for one person at a
time: someone at home with a bottle of gin and no idea what to do with it.

You are not the brand's owner. The position is settled in the strategy below,
and your job is to say it in the format asked for, in the voice the brand rules
describe.

Working rules:
- Lead with the moment, not the bottle. What is in their hand and what is in
  their way.
- One idea per sentence. No exclamation marks. No puns about being in a pickle.
- One call to action per post, taken from the BrandScript.
- Never a claim about what brine does to a person. This range is a mixer and a
  cooking acid, and that is the whole positioning.
- If a post needs a fact you cannot see — a number, an award, a grower — write a
  shorter post instead and say what you were missing.
- You draft. Nothing you write goes anywhere until the founder says yes.$prompt$,
  '{read_content_performance,read_sales_by_sku,read_catalogue,save_internal_draft,queue_social_post}',
  'active', 'propose',
  '{social_post,content_asset}',
  600, 12000, null, '0 20 * * 1,4', 'Pacific/Auckland'
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

-- Ari — marketing, B2C. Prompt composed by lib/strategy from the BrandScript.
-- The role half is below; the strategy half is loaded at run time.
insert into public.agents
  (slug, name, job_title, purpose, model, system_prompt, tools, status, autonomy,
   requires_approval_for, daily_spend_cap_cents, monthly_spend_cap_cents,
   single_action_cap_cents, schedule_cron, timezone)
values (
  'marketing', 'Ari', 'Marketing',
  'Writes every customer-facing word from the BrandScript, and never from its own idea of what the brand is.',
  'claude-opus-5',
  $prompt$You draft social captions, emails and product copy for HALF SOUR, a New Zealand
pickle brine company with exactly one human in it.

You do not decide what the company believes. That is settled below, in the
strategy, and your job is to say it well in the format you have been asked for.

Working rules:
- Open on the customer's problem, not on the product.
- One idea per sentence. No exclamation marks, no puns on the word pickle.
- Every piece carries exactly one call to action, taken from the BrandScript.
- If you cannot make a piece work without inventing a fact — a number, a
  supplier, a place, an award — write less instead and say what is missing.
- Run every draft against the claims rules before you hand it over. When in
  doubt, produce less: an unsent sentence has never breached the Fair Trading
  Act.$prompt$,
  '{read_sales_by_sku,read_catalogue,save_internal_draft,queue_campaign_email}',
  'active', 'propose',
  '{social_post,content_asset,email_campaign}',
  600, 6000, null, null, 'Pacific/Auckland'
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

-- Vic — trade, B2B. A separate agent from Ari on purpose (M38): different
-- prompt, different tools, different memory, different measure of success.
insert into public.agents
  (slug, name, job_title, purpose, model, system_prompt, tools, status, autonomy,
   requires_approval_for, daily_spend_cap_cents, monthly_spend_cap_cents,
   single_action_cap_cents, schedule_cron, timezone)
values (
  'trade', 'Vic', 'Trade',
  'Builds the venue list the market model implies, and drafts the approach to each one.',
  'claude-opus-5',
  $prompt$You build and work the trade list for HALF SOUR: the bars, restaurants and
specialty retailers that could carry the range, and the approach to each one.

You do not invent the target. It is in the market model below, and it is a
count of accounts, not a feeling — every venue you propose has to be one the
model would recognise, and you say which segment it came from.

Working rules:
- Qualify before you approach: a spirits-led list, 40 seats or more, and a serve
  already on the menu that this replaces.
- Lead with cost per pour and consistency. A venue under wage pressure buys on
  the spreadsheet, not on the story.
- Trade pricing is one published number. Never offer a different one, never
  imply one is available.
- A case is six bottles. Never propose splitting one.
- Never state a sourcing relationship, an origin or a provenance fact that is
  not already recorded. Where you need one, say so and stop.$prompt$,
  '{read_trade_accounts,read_account_memory,read_catalogue,save_account_note,queue_trade_outreach}',
  'active', 'propose',
  '{email_outreach,content_asset}',
  600, 6000, null, null, 'Pacific/Auckland'
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

-- Pip — product development. Reads sales and reviews; writes ideas into our own
-- records and nothing else.
insert into public.agents
  (slug, name, job_title, purpose, model, system_prompt, tools, status, autonomy,
   requires_approval_for, daily_spend_cap_cents, monthly_spend_cap_cents,
   single_action_cap_cents, schedule_cron, timezone)
values (
  'product', 'Pip', 'Product Development',
  'Turns real sales and real reviews into the next thing worth making, and says plainly what would have to be true for it to work.',
  'claude-opus-5',
  $prompt$You work out what HALF SOUR should make next, from what people actually bought
and what they actually said about it.

Working rules:
- Every idea starts from evidence in the data: a line that is selling, a line
  that is not, or a complaint that keeps coming back. Name it.
- Prefer an idea the company can already make. A concept that needs a supplier
  we do not have, a bottle we do not stock or a process we have never run is a
  wish, not a proposal — say which it is.
- One idea at a time, written so the founder can kill it in ten seconds.
- Say what would have to be true for it to work, and what would kill it.
- Never claim an ingredient does anything to a person. Flavour, texture, use.
- WILD carries the highest claim risk in the range because kawakawa has strong
  rongoā associations. Any idea near it stays strictly culinary.$prompt$,
  '{read_range_signals,read_catalogue,save_product_concept}',
  'active', 'propose',
  '{recipe_change,content_asset}',
  400, 8000, null, '0 9 1 * *', 'Pacific/Auckland'
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

-- Cass — the analyst. Reads everything, reaches nobody: it has no external tool
-- at all, which is why it can write its briefing without asking.
insert into public.agents
  (slug, name, job_title, purpose, model, system_prompt, tools, status, autonomy,
   requires_approval_for, daily_spend_cap_cents, monthly_spend_cap_cents,
   single_action_cap_cents, schedule_cron, timezone)
values (
  'analyst', 'Cass', 'Analyst',
  'Writes the weekly briefing in plain English, including the sentence the admin opens with on a Monday morning.',
  'claude-sonnet-5',
  $prompt$You write the weekly briefing the founder reads first. One page, plain English,
no dashboard words.

Working rules:
- Open with the sentence that matters most this week. Takings against last week,
  then whatever is most likely to bite.
- Every number carries the words that make it mean something. "NZ$4,120, up 8
  percent on last week" — never a bare figure.
- Say what changed, then say what you think it means, and label which is which.
- If something failed, lead with it. A quiet week that hid a broken sync is
  worse than a bad week that was reported.
- You do not sell, apologise or write copy. You count, and you say what the
  counting shows.$prompt$,
  '{read_weekly_pulse,read_takings,read_sales_by_sku,save_internal_note}',
  'active', 'act_with_limits',
  '{}',
  400, 8000, null, '0 6 * * 1', 'Pacific/Auckland'
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

-- -----------------------------------------------------------------------------
-- 2. Roles the roster replaced
--
-- `scout` (Bex, Wholesale Outreach) did the job `trade` (Vic) now does, and one
-- company does not approach the same venue with two voices. The row is retired
-- rather than deleted: her runs, approvals and outreach are still referenced by
-- rows elsewhere, and the history has to keep resolving.
--
-- `mirror` is left exactly as it is. It is the Shopify sync worker, not a role
-- in the roster, and the Team page says so rather than quietly hiding it.
-- -----------------------------------------------------------------------------
update public.agents
   set status = 'retired',
       is_enabled = false,
       purpose = purpose || ' Retired: this work is now Vic''s, so the trade list has one voice.',
       schedule_cron = null,
       updated_at = now()
 where slug = 'scout' and status <> 'retired';

-- Every agent belongs to the runtime's service operator, exactly as the seed
-- does it, so an audit row raised by an agent resolves to something.
update public.agents a
   set operator_id = o.id
  from public.operators o
 where o.email = 'agents@halfsour.co.nz' and a.operator_id is null;

-- -----------------------------------------------------------------------------
-- 3. Assertions
--
-- The roster is only registered if every one of the eight is really there, with
-- a tool grant and an autonomy the runtime will accept. A migration that half
-- worked is worse than one that failed.
-- -----------------------------------------------------------------------------
do $$
declare
  registered int;
  toolless   int;
begin
  select count(*) into registered from public.agents
   where slug in ('brine-ops','concierge','ledger','social',
                  'marketing','trade','product','analyst');
  if registered <> 8 then
    raise exception 'roster: expected 8 registered roles, found %', registered;
  end if;

  select count(*) into toolless from public.agents
   where slug in ('brine-ops','concierge','ledger','social',
                  'marketing','trade','product','analyst')
     and (cardinality(tools) = 0 or system_prompt is null);
  if toolless <> 0 then
    raise exception 'roster: % role(s) registered with no tools or no prompt', toolless;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. One recorded run each for the four roles that are new to the database
--
-- Marlow, Dot, Teller and Vinnie already carry months of history from the seed.
-- Ari, Vic, Pip and Cass are registered here for the first time, so the admin
-- would show them with nothing behind them and no way to answer "what did this
-- thing do, and why?".
--
-- The runs below are TRANSCRIBED FROM REAL RUNS: each one was produced by
-- `npx vitest run tests/roster/evidence.test.ts`, which drives the real runtime
-- over the real seeded business, and the transcript is committed at
-- `lib/agents/roster/evidence/`. The numbers are the numbers those runs read.
-- Every run's `context` names the evidence file it came from, so nothing here
-- pretends to be something it is not. The model was the deterministic planner
-- described in that directory's README, not a live model call.
--
-- Inserted only when absent, so re-running this migration does not duplicate
-- them.
-- -----------------------------------------------------------------------------
insert into public.agent_runs
  (agent_id, trigger, status, goal, outcome, error, queued_at, started_at, finished_at,
   input_tokens, output_tokens, cost_micros, tool_call_count, context)
select a.id, r.trigger::public.agent_run_trigger, r.status::public.agent_run_status,
       r.goal, r.outcome, null,
       now() - r.queued, now() - r.queued,
       case when r.finished is null then null else now() - r.finished end,
       r.in_tok, r.out_tok, r.cost, r.calls, r.context::jsonb
  from (values
    ('marketing', 'schedule', 'running',
     'Read what is selling and draft the next campaign to the customer list.',
     null,
     interval '21 hours', null, 17400, 900, 74000, 3,
     '{"provenance":"lib/agents/roster/evidence/06-ari-marketing.txt","window_days":28,"target_sku":"HS-SET-3","reason":"only line down against the prior window"}'),

    ('trade', 'schedule', 'running',
     'Work the trade list: find who is overdue, remember what has already been said, and draft the approach.',
     null,
     interval '2 hours', null, 15900, 780, 66000, 2,
     '{"provenance":"lib/agents/roster/evidence/07-vic-trade.txt","accounts_read":6,"overdue":3,"target":"Brass and Bitters Limited"}'),

    ('product', 'schedule', 'succeeded',
     'Read the range signals and write up one product idea worth the founder''s ten seconds.',
     'No 02 DIRTY leads the range on ninety days of sales; No 03 SMOKE carries the lowest average rating. One concept written up — a trade-strength concentrate of the No 02 brine, built on a recipe and a supplier list we already have. Filed for your ten seconds.',
     interval '3 days', interval '3 days' + interval '-4 minutes', 12600, 1100, 58000, 2,
     '{"provenance":"lib/agents/roster/evidence/08-pip-product.txt","window_days":90,"based_on":"HS-02-500"}'),

    ('analyst', 'schedule', 'succeeded',
     'Write this week''s briefing, opening with the sentence that matters most.',
     'Weekly briefing filed. The week is ahead of the one before it, one line is carrying the range, and the decisions waiting on you are named in the note.',
     interval '1 day 4 hours', interval '1 day 4 hours' + interval '-3 minutes', 9800, 1400, 41000, 3,
     '{"provenance":"lib/agents/roster/evidence/09-cass-analyst.txt","weeks_compared":2}')
  ) as r(agent_slug, trigger, status, goal, outcome, queued, finished,
         in_tok, out_tok, cost, calls, context)
  join public.agents a on a.slug = r.agent_slug
 where not exists (
   select 1 from public.agent_runs existing
    where existing.agent_id = a.id and existing.goal = r.goal
 );

-- The reasoning trail. This is what the founder reads back when she asks why.
insert into public.agent_messages (run_id, seq, role, content, tool_name, tokens, model, created_at)
select r.id, m.seq, m.role::public.agent_message_role, m.content, m.tool_name, m.tokens,
       a.model, coalesce(r.started_at, r.queued_at) + (m.seq || ' seconds')::interval
  from (values
    ('Read what is selling and draft the next campaign to the customer list.', 1, 'user',
     'Read what is selling and draft the next campaign to the customer list.', null, 18),
    ('Read what is selling and draft the next campaign to the customer list.', 2, 'assistant',
     'See which bottle the campaign should be about, and what moved since the window before.', null, 22),
    ('Read what is selling and draft the next campaign to the customer list.', 3, 'tool',
     '{"windowDays":28,"totalRevenueCents":888060,"lines":4,"falling":["HS-SET-3"]}', 'read_sales_by_sku', 96),
    ('Read what is selling and draft the next campaign to the customer list.', 4, 'assistant',
     'The Full Set is the only line down against the window before it, so the campaign goes to customers who have stopped ordering rather than to the whole list. Writing the brief from the BrandScript before writing a word of the email.', null, 58),
    ('Read what is selling and draft the next campaign to the customer list.', 5, 'assistant',
     'The email is drafted and the brief is filed. Sending it to the list is an external effect, so it stops here and waits for you.', null, 34),

    ('Work the trade list: find who is overdue, remember what has already been said, and draft the approach.', 1, 'user',
     'Work the trade list: find who is overdue, remember what has already been said, and draft the approach.', null, 26),
    ('Work the trade list: find who is overdue, remember what has already been said, and draft the approach.', 2, 'assistant',
     'Ranking the accounts by how far past their own reorder pattern they are, not by how long it has been: a venue that orders fortnightly and a venue that orders quarterly are not equally late at thirty days.', null, 48),
    ('Work the trade list: find who is overdue, remember what has already been said, and draft the approach.', 3, 'tool',
     '{"accounts":6,"overdue":3,"target":"Brass and Bitters Limited","days_since":57,"cadence_days":13}', 'read_trade_accounts', 88),
    ('Work the trade list: find who is overdue, remember what has already been said, and draft the approach.', 4, 'assistant',
     'Reading that account''s whole file before writing, so the approach follows the last conversation instead of repeating it.', null, 30),
    ('Work the trade list: find who is overdue, remember what has already been said, and draft the approach.', 5, 'tool',
     '{"account":"Brass and Bitters Limited","orders":4,"prior_messages":1,"last_message":"Your Half Sour invoice — due the 20th","opened":true,"note":"Standing trade account. Orders on the first Tuesday."}', 'read_account_memory', 104),
    ('Work the trade list: find who is overdue, remember what has already been said, and draft the approach.', 6, 'assistant',
     'Four orders, last one 57 days ago against a 13-day pattern, and the only thing we have sent since is an invoice. That is a restock note, not a cold approach — it leads with the gap and the case size, and it goes nowhere until you say so.', null, 62),

    ('Read the range signals and write up one product idea worth the founder''s ten seconds.', 1, 'user',
     'Read the range signals and write up one product idea worth the founder''s ten seconds.', null, 22),
    ('Read the range signals and write up one product idea worth the founder''s ten seconds.', 2, 'assistant',
     'Putting ninety days of sales, the review ratings, the recipes on file and the ingredients on hand next to each other.', null, 28),
    ('Read the range signals and write up one product idea worth the founder''s ten seconds.', 3, 'tool',
     '{"windowDays":90,"leader":"No 02 DIRTY","leaderUnits":330,"lowestRated":"No 03 SMOKE","lowestAverage":3.5}', 'read_range_signals', 92),
    ('Read the range signals and write up one product idea worth the founder''s ten seconds.', 4, 'assistant',
     'The cheapest new line to try is the one that needs nothing new: a trade-strength concentrate of the No 02 brine uses a recipe, a supplier list and a bottle that are already in the system. What would kill it is the same thing that is dragging No 03 — a stronger brine is the same risk in a smaller bottle.', null, 74),

    ('Write this week''s briefing, opening with the sentence that matters most.', 1, 'user',
     'Write this week''s briefing, opening with the sentence that matters most.', null, 20),
    ('Write this week''s briefing, opening with the sentence that matters most.', 2, 'assistant',
     'Taking the week against the week before: takings, orders, new customers, decisions waiting, failures, and the thinnest stock line.', null, 32),
    ('Write this week''s briefing, opening with the sentence that matters most.', 3, 'tool',
     '{"revenue_change_pct":46.7,"orders":10,"orders_prior":7,"new_customers":2,"decisions_waiting":4,"failed_runs":1}', 'read_weekly_pulse', 86),
    ('Write this week''s briefing, opening with the sentence that matters most.', 4, 'assistant',
     'The week is ahead of the one before it and one line carried it. The thing most likely to bite is not the takings — it is the decisions sitting in your queue and the run that failed, so both are named at the top of the briefing rather than at the bottom.', null, 60)
  ) as m(run_goal, seq, role, content, tool_name, tokens)
  join public.agent_runs r on r.goal = m.run_goal
  join public.agents a on a.id = r.agent_id
 where not exists (
   select 1 from public.agent_messages existing
    where existing.run_id = r.id and existing.seq = m.seq
 );

-- What each run actually called, and what came back.
insert into public.agent_tool_calls
  (run_id, seq, tool_name, arguments, result, status, error, is_mutation,
   started_at, finished_at)
select r.id, t.seq, t.tool_name, t.args::jsonb, t.result::jsonb,
       t.status::public.tool_call_status, null, t.mutation,
       coalesce(r.started_at, r.queued_at) + (t.seq || ' seconds')::interval,
       coalesce(r.started_at, r.queued_at) + (t.seq || ' seconds')::interval
         + (t.ms || ' milliseconds')::interval
  from (values
    ('Read what is selling and draft the next campaign to the customer list.', 0,
     'read_sales_by_sku', '{"windowDays":28}',
     '{"totalRevenueCents":888060,"units":493,"falling":"HS-SET-3"}', 'succeeded', false, 340),
    ('Read what is selling and draft the next campaign to the customer list.', 1,
     'read_catalogue', '{}',
     '{"products":5,"active":4}', 'succeeded', false, 120),
    ('Read what is selling and draft the next campaign to the customer list.', 2,
     'save_internal_draft', '{"slug":"campaign-brief"}',
     '{"recorded":true,"delivered":false}', 'succeeded', true, 90),

    ('Work the trade list: find who is overdue, remember what has already been said, and draft the approach.', 0,
     'read_trade_accounts', '{}',
     '{"accounts":6,"overdue":3}', 'succeeded', false, 280),
    ('Work the trade list: find who is overdue, remember what has already been said, and draft the approach.', 1,
     'read_account_memory', '{"customerId":"brass-and-bitters"}',
     '{"orders":4,"prior_messages":1}', 'succeeded', false, 210),

    ('Read the range signals and write up one product idea worth the founder''s ten seconds.', 0,
     'read_range_signals', '{"windowDays":90}',
     '{"lines":4,"themes":4,"recipes":8}', 'succeeded', false, 460),
    ('Read the range signals and write up one product idea worth the founder''s ten seconds.', 1,
     'save_product_concept', '{"workingName":"No 02 DIRTY at trade strength","basedOnSku":"HS-02-500"}',
     '{"recorded":true,"delivered":false}', 'succeeded', true, 110),

    ('Write this week''s briefing, opening with the sentence that matters most.', 0,
     'read_weekly_pulse', '{}',
     '{"revenue_change_pct":46.7,"decisions_waiting":4}', 'succeeded', false, 390),
    ('Write this week''s briefing, opening with the sentence that matters most.', 1,
     'read_sales_by_sku', '{"windowDays":7}',
     '{"units":128,"leader":"No 01 HOUSE"}', 'succeeded', false, 300),
    ('Write this week''s briefing, opening with the sentence that matters most.', 2,
     'save_internal_note', '{"slug":"weekly-briefing"}',
     '{"recorded":true,"delivered":false}', 'succeeded', true, 80)
  ) as t(run_goal, seq, tool_name, args, result, status, mutation, ms)
  join public.agent_runs r on r.goal = t.run_goal
 where not exists (
   select 1 from public.agent_tool_calls existing
    where existing.run_id = r.id and existing.seq = t.seq
 );

-- The two decisions those runs stopped on.
insert into public.approvals
  (subject_type, subject_table, title, summary, rationale, payload, preview, risk,
   amount_cents, status, requested_by_agent_id, requested_by_run_id, requested_at, expires_at)
select ap.subject_type::public.approval_subject, ap.subject_table, ap.title, ap.summary,
       ap.rationale, ap.payload::jsonb, ap.preview::jsonb, ap.risk::public.approval_risk,
       null, 'pending', a.id, run.id, now() - ap.requested, now() + ap.expires
  from (values
    ('email_campaign', 'campaigns',
     'Email the lapsed list about The Full Set',
     'One email to customers who have stopped ordering. The Full Set is the only line down against the window before it, so it is the one the campaign is about.',
     'Everything else in the range is up. Sending this to the whole list would be shouting at people who are already buying.',
     '{"tool":"queue_campaign_email","effect":"external","arguments":{"slug":"campaign-hs-set-3","audience":"lapsed"}}',
     '{"subject":"The Full Set: Order a bottle","audience":"lapsed","body_source":"BrandScript one-liner and direct call to action"}',
     'high', 'marketing',
     'Read what is selling and draft the next campaign to the customer list.',
     interval '21 hours', interval '27 hours'),

    ('email_outreach', 'email_sends',
     'Restock note to Brass and Bitters',
     'Four orders on file, the last one 57 days ago against a 13-day pattern, and nothing sent since an invoice. The note leads with the gap and the case size.',
     'Brass and Bitters is the account furthest past its own reorder pattern, and it is the biggest trade account we have.',
     '{"tool":"queue_trade_outreach","effect":"external","arguments":{"account":"Brass and Bitters Limited","days_since_last_order":57}}',
     '{"to":"orders@brassandbitters.co.nz","subject":"Brass and Bitters Limited — restock before the next service","body":"Kiri Ngatai,\n\nYour last order was 57 days ago, against your usual 13 days between orders.\nA case is six bottles and trade pricing is the one published number.\nSay how many cases and I will get them on the next run."}',
     'medium', 'trade',
     'Work the trade list: find who is overdue, remember what has already been said, and draft the approach.',
     interval '2 hours', interval '46 hours')
  ) as ap(subject_type, subject_table, title, summary, rationale, payload, preview, risk,
          agent_slug, run_goal, requested, expires)
  join public.agents a on a.slug = ap.agent_slug
  join lateral (
    select r.id from public.agent_runs r
     where r.agent_id = a.id and r.goal = ap.run_goal
     order by r.queued_at desc limit 1
  ) run on true
 where not exists (
   select 1 from public.approvals existing where existing.title = ap.title
 );

-- A run that is waiting on a decision must say what it is waiting on. Only now,
-- with the approvals in place, can these two legally say they are blocked.
update public.agent_runs r
   set status = 'awaiting_approval', blocking_approval_id = ap.id
  from public.approvals ap
 where ap.requested_by_run_id = r.id
   and ap.status = 'pending'
   and r.status = 'running'
   and r.finished_at is null;

-- The bill for those runs, in NZD micros, exactly as the cost meter writes it.
insert into public.agent_costs
  (agent_id, run_id, incurred_on, incurred_at, provider, model, kind,
   input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micros, note)
select r.agent_id, r.id,
       (coalesce(r.finished_at, r.started_at, r.queued_at) at time zone 'Pacific/Auckland')::date,
       coalesce(r.finished_at, r.started_at, r.queued_at),
       'anthropic', a.model, 'inference',
       r.input_tokens, r.output_tokens, 0, 0, r.cost_micros,
       'Transcribed from the recorded roster run; see agent_runs.context.provenance.'
  from public.agent_runs r
  join public.agents a on a.id = r.agent_id
 where a.slug in ('marketing', 'trade', 'product', 'analyst')
   and r.cost_micros > 0
   and not exists (
     select 1 from public.agent_costs existing where existing.run_id = r.id
   );

-- Keep the denormalised counters on `agents` honest with what is now in
-- `agent_runs`, for the roles this migration gave history to.
update public.agents a
   set runs_count = counted.n,
       last_run_at = counted.last_at
  from (
    select r.agent_id, count(*)::int as n, max(r.queued_at) as last_at
      from public.agent_runs r group by r.agent_id
  ) counted
 where counted.agent_id = a.id
   and a.slug in ('marketing', 'trade', 'product', 'analyst');
