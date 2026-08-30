-- ---------------------------------------------------------------------------
-- The roster moves onto real models, through the Vercel AI Gateway.
--
-- Until now every model call the eight roles made was mocked: the runtime was
-- exercised against a scripted planner and `public.agents.model` named a model
-- nothing ever called. `lib/agents/model/roster-models.ts` now names one model
-- per role and the runtime resolves it through the gateway, so this table has
-- to say the same thing — the admin's Team page reads THIS row, and
-- `tests/roster/registration.test.ts` fails if the row and the declaration
-- disagree.
--
-- Why these two ids and not one:
--
--   minimax/minimax-m3-free    1M context, tool calling, vision. The roles whose
--                              output is prose somebody outside the company
--                              reads (Dot, Vinnie, Ari, Vic), and Pip, whose job
--                              is synthesis rather than counting.
--   minimax/minimax-m2.7-free  196k context, tool calling, built for agentic
--                              work. The roles that compute over small tables
--                              (Marlow, Teller, Cass).
--
-- Both bill at zero on the AI Gateway via GMI Cloud through Sunday 6 September
-- 2026, and the `-free` ids stop serving after that. The code carries that date
-- as one constant, refuses to call a free-tier id past it, and says so in the
-- admin. `lib/agents/cost/pricing.ts` deliberately charges both at the list
-- price of their paid twins, so the four spend caps keep meaning something
-- while the tokens are free.
--
-- Idempotent, and scoped to the eight roster slugs: an operator who has already
-- set `model` by hand on some other agent is left alone.
-- ---------------------------------------------------------------------------

update public.agents
   set model = 'minimax/minimax-m3-free',
       updated_at = now()
 where slug in ('concierge', 'social', 'marketing', 'trade', 'product')
   and model is distinct from 'minimax/minimax-m3-free';

update public.agents
   set model = 'minimax/minimax-m2.7-free',
       updated_at = now()
 where slug in ('brine-ops', 'ledger', 'analyst')
   and model is distinct from 'minimax/minimax-m2.7-free';

-- --- Say what happened -------------------------------------------------------
do $$
declare moved integer;
begin
  select count(*) into moved
    from public.agents
   where slug in ('brine-ops', 'concierge', 'ledger', 'social',
                  'marketing', 'trade', 'product', 'analyst')
     and model like 'minimax/%';
  raise notice 'agents: % of 8 roster roles are on a MiniMax model via the AI Gateway.', moved;
end;
$$;
