-- =============================================================================
-- HALF SOUR — 10 STRATEGY
--
-- The business strategy, stored the way brand rules are stored: as rows an
-- agent reads before it does anything, not as documents a person reads once.
--
-- `brand_rules` already proved the pattern — "editing a row changes agent
-- behaviour with no deploy". This migration extends it from *how* the company
-- writes to *what the company is*:
--
--   strategy_documents    the three frameworks. Two of them (the Flight Plan
--                         and the BrandScript) are held whole as jsonb, because
--                         their shape is the framework and flattening SB7 into
--                         columns would lose the thing that makes it SB7.
--                         `applies_to` works exactly like `brand_rules`: an
--                         agent is handed the documents whose scopes overlap
--                         its own, or the ones with no scopes at all.
--
--   strategy_assumptions  every named, editable input to the market model. The
--                         market document holds only words; every NUMBER lives
--                         here, and the arithmetic lives in
--                         content/strategy/market.ts. So there is exactly one
--                         place a market figure can come from, the admin's
--                         Market screen and an agent's system prompt cannot
--                         disagree, and changing one row moves the whole model.
--
-- Values are stored as bigint MILLIONTHS (`value_micro`). Ratios, counts and
-- money all fit exactly, nothing in a price path is ever a float, and it is the
-- same discipline `agent_costs` uses for NZD micros.
--
-- This migration sorts AFTER 20260101999900_schema_guarantees.sql, which is the
-- backfill-and-assert pass. A table added after that pass is not covered by it,
-- so this file does its own RLS, its own policies, its own grants, its own
-- updated_at triggers — and then re-runs the four assertions itself, against
-- these two tables specifically. Anything less would be a hole in the guarantee
-- the schema makes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.strategy_framework as enum (
  'flight_plan',    -- Donald Miller, How to Grow Your Small Business
  'brandscript',    -- StoryBrand SB7
  'market_sizing'   -- TAM / SAM / SOM
);

-- How much weight a figure carries. An estimate that is LABELLED can be argued
-- with; an estimate that is not is indistinguishable from a fact, which is the
-- failure mode this column exists to prevent.
create type public.strategy_confidence as enum ('sourced', 'derived', 'estimate');

-- 'ratio' is checked to 0..1 below, because a ratio outside that range is a
-- units mistake that would multiply a market layer by a hundred rather than
-- failing. 'multiplier' is the unconstrained sibling: an FX rate, a realisation
-- factor — a number that is legitimately allowed above 1.
create type public.strategy_unit as enum (
  'count', 'cents', 'ratio', 'multiplier', 'per_year', 'years'
);

-- -----------------------------------------------------------------------------
-- strategy_documents
--
-- Agents pull
--   select body from strategy_documents
--    where is_active and (cardinality(applies_to) = 0 or applies_to && $1)
--    order by priority
-- into their system prompt, through lib/strategy/store.ts. Editing a row
-- changes what every agent says on its next run, with no deploy.
-- -----------------------------------------------------------------------------
create table public.strategy_documents (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  framework   public.strategy_framework not null,
  title       text not null,
  -- The one plain sentence that says what this framework is FOR. The founder is
  -- not an MBA; a framework with no purpose line is a framework she skips.
  purpose     text not null,
  version     text not null default '1.0.0',
  applies_to  text[] not null default '{}',
  priority    integer not null default 100,
  body        jsonb not null,
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint strategy_documents_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint strategy_documents_purpose_present check (btrim(purpose) <> ''),
  constraint strategy_documents_priority_range check (priority between 1 and 1000),
  constraint strategy_documents_version_format check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  -- A framework stored as a string, an array or a number is not a framework.
  constraint strategy_documents_body_is_object check (jsonb_typeof(body) = 'object')
);

-- Exactly one live document per framework. Two live BrandScripts is two
-- companies, and the agent would be handed both.
create unique index strategy_documents_one_active_per_framework
  on public.strategy_documents (framework) where is_active;
create index strategy_documents_active_idx on public.strategy_documents (priority, framework) where is_active;
create index strategy_documents_applies_idx on public.strategy_documents using gin (applies_to);

comment on table public.strategy_documents is
  'The Flight Plan, the BrandScript and the market narrative. Read into agent system prompts by lib/strategy; seeded from content/strategy.';
comment on column public.strategy_documents.applies_to is
  'Agent scopes, exactly as brand_rules.applies_to. Empty means every agent gets it.';
comment on column public.strategy_documents.purpose is
  'One plain sentence: what this framework is FOR. Shown above the framework in the admin.';

-- -----------------------------------------------------------------------------
-- strategy_assumptions
--
-- The market model's argument surface. Every figure in the TAM is either one of
-- these rows or arithmetic over them, and the arithmetic is in code where it can
-- be tested. Edit a row and every layer moves — in the admin and in the agent's
-- context — with no other change anywhere.
-- -----------------------------------------------------------------------------
create table public.strategy_assumptions (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  label       text not null,
  -- Millionths. 0.35 -> 350000; $21.00 (2,100 cents) -> 2100000000.
  value_micro bigint not null,
  unit        public.strategy_unit not null,
  confidence  public.strategy_confidence not null,
  -- Matches an id in content/strategy/sources.ts. Free text rather than a
  -- foreign key because the citation list is reference material, not business
  -- state, and a fourth table nobody edits is a fourth table nobody edits.
  source_id   text,
  rationale   text not null,
  min_micro   bigint not null,
  max_micro   bigint not null,
  step_micro  bigint not null,
  position    integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint strategy_assumptions_slug_format check (slug ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]*$'),
  constraint strategy_assumptions_rationale_present check (btrim(rationale) <> ''),
  constraint strategy_assumptions_bounds_ordered check (min_micro <= max_micro),
  constraint strategy_assumptions_value_in_bounds check (value_micro between min_micro and max_micro),
  constraint strategy_assumptions_step_positive check (step_micro > 0),
  -- A ratio outside 0..1 is a units mistake, and it would silently multiply a
  -- market layer by a hundred rather than failing.
  constraint strategy_assumptions_ratio_range check (
    unit <> 'ratio' or (value_micro >= 0 and value_micro <= 1000000)),
  -- 'sourced' and 'derived' mean somebody can go and check. That needs a source.
  constraint strategy_assumptions_sourced_has_source check (
    confidence = 'estimate' or (source_id is not null and btrim(source_id) <> ''))
);

create index strategy_assumptions_active_idx on public.strategy_assumptions (position, slug) where is_active;
create index strategy_assumptions_confidence_idx on public.strategy_assumptions (confidence);

comment on table public.strategy_assumptions is
  'Named, editable inputs to the TAM/SAM/SOM model. Arithmetic lives in content/strategy/market.ts; this table holds only what it is arithmetic OVER.';
comment on column public.strategy_assumptions.value_micro is
  'Millionths, so ratios and money are both exact and neither is a float.';
comment on column public.strategy_assumptions.confidence is
  'estimate = a judgement call, said out loud. sourced/derived require source_id.';

-- =============================================================================
-- SEED — generated from content/strategy. See content/strategy/emit-seed.ts.
-- =============================================================================
-- @@STRATEGY-SEED-START@@
-- Generated from content/strategy by content/strategy/emit-seed.ts.
-- Do not hand-edit: run
--   UPDATE_STRATEGY_SEED=1 npx vitest run tests/strategy/seed-parity.test.ts
-- after changing the strategy in code.

insert into public.strategy_documents
  (slug, framework, title, purpose, version, applies_to, priority, is_active, body)
values
  ($hs$flight-plan$hs$, $hs$flight_plan$hs$::public.strategy_framework,
   $hs$Small Business Flight Plan$hs$,
   $hs$A one-page map of the six parts of the business, so that when something feels wrong you can tell which part is starved — instead of working harder on the part that already works.$hs$,
   $hs$1.0.0$hs$, '{}'::text[], 10, true,
   $hs${
  "version": "1.0.0",
  "purpose": "A one-page map of the six parts of the business, so that when something feels wrong you can tell which part is starved — instead of working harder on the part that already works.",
  "cockpit": {
    "part": "cockpit",
    "aircraft": "Cockpit",
    "discipline": "Leadership",
    "purpose": "Where the plane is going, and the handful of rules that settle an argument when you are tired and nobody else is there to ask.",
    "failureMode": "Without it every decision is made from scratch, so the business drifts toward whatever was loudest that week — and in a company of one, that is usually the inbox.",
    "mission": {
      "goal": "Put HALF SOUR behind 83 New Zealand bar lists and in 2,000 New Zealand kitchens",
      "by": "31 August 2028",
      "because": [
        "A drink made at home deserves the same ingredient a bar would reach for, and nobody in this country is making it.",
        "A one-person company can own a category that a large one will not bother to enter, and brine is small enough to stay ours.",
        "Every bottle is made, filled and posted by the person whose name is on the company, and that stops being true the moment we grow faster than she can make."
      ],
      "statement": "We will put HALF SOUR behind 83 New Zealand bar lists and in 2,000 New Zealand kitchens by 31 August 2028, because a drink made at home deserves the same ingredient a bar would reach for, because a one-person company can own a category a large one will not bother to enter, and because every bottle is still made by the person whose name is on it."
    },
    "guidingPrinciples": [
      {
        "principle": "Culinary, never clinical.",
        "settles": "Every copy question. If a sentence would sit comfortably in a cookbook it ships; if it would sit comfortably in a pharmacy it does not, whatever it would do for the numbers."
      },
      {
        "principle": "The bar list before the billboard.",
        "settles": "Where the next spare hour goes. One venue account is 24 bottles a year and it advertises itself on a printed list; an hour of posting is neither."
      },
      {
        "principle": "Make it true, then say it.",
        "settles": "Provenance and supplier stories. No sourcing claim is published before the relationship behind it exists — the plan is written around that constraint rather than against it."
      },
      {
        "principle": "Protect Sunday.",
        "settles": "Capacity arguments. The ceiling is two production days a week. Growth past it comes from price or a co-packer, never from a seventh day — and the market model is built on that number, so breaking the rule breaks the plan."
      },
      {
        "principle": "One decision, written down.",
        "settles": "What the AI team may do alone. Anything a customer could see waits for a human, and the reason is recorded next to the decision, so the same argument is not had twice."
      }
    ],
    "keyCharacteristics": [
      {
        "characteristic": "Exact",
        "looksLike": "Measures, not splashes. Batch numbers, not approximations. A price list with one number on it."
      },
      {
        "characteristic": "Generous with the recipe",
        "looksLike": "The whole method is given away, including the fix for when it goes wrong. The bottle is the thing being sold, not the knowledge."
      },
      {
        "characteristic": "Bored by hype",
        "looksLike": "No exclamation marks, no pickle puns, no claim that needs a footnote. Restraint is the differentiator in a category built on novelty."
      }
    ]
  },
  "rightEngine": {
    "part": "right-engine",
    "aircraft": "Right engine",
    "discipline": "Marketing",
    "purpose": "How a stranger finds out this exists and is given something worth having before they are asked for money.",
    "failureMode": "Starve it and the business survives on the people who already know, which in a one-person company is about forty people and their patience.",
    "oneLiner": "Most home martinis are let down by whatever is left in the olive jar. HALF SOUR makes brine built for the glass — so the drink you pour on a Tuesday is the drink you poured on Saturday.",
    "leadGenerator": {
      "name": "The Brine Book",
      "promise": "Twelve drinks and four dishes, each with a measure, a time, and what to do when it goes wrong.",
      "format": "A PDF behind an email address, and the same content on /recipes with nothing asked for at all. The page is the marketing; the PDF is the reason to leave an address."
    },
    "nurtureSequence": [
      {
        "email": 1,
        "subject": "The measure on the bottle",
        "job": "Deliver the thing they asked for, and nothing else. No sell."
      },
      {
        "email": 2,
        "subject": "Why your martini goes cloudy",
        "job": "Teach one specific fix. Establish authority by being useful about a problem they already have."
      },
      {
        "email": 3,
        "subject": "What a brine is for in a pan",
        "job": "Widen the use case past drinks, which doubles the number of weeks a bottle gets opened."
      },
      {
        "email": 4,
        "subject": "The four bottles, and which one is yours",
        "job": "First soft direct call. Names the plan's step one — pick the brine for the drink you actually make."
      }
    ],
    "salesSequence": [
      {
        "email": 1,
        "subject": "The problem, said plainly",
        "job": "Open on the external problem from the BrandScript, in the customer's words."
      },
      {
        "email": 2,
        "subject": "One person made this",
        "job": "Empathy and authority — the guide, not the hero."
      },
      {
        "email": 3,
        "subject": "Three steps, then you are done",
        "job": "The process plan, verbatim."
      },
      {
        "email": 4,
        "subject": "What you are avoiding",
        "job": "The stakes. Failure, lightly — one line, no drama."
      },
      {
        "email": 5,
        "subject": "Order a bottle",
        "job": "The direct call, on its own, with nothing else in the email."
      }
    ],
    "channels": [
      {
        "channel": "Instagram",
        "cadence": "Three posts a week, one of them a recipe card",
        "job": "Show the pour and the plate. It is a visual category and this is where the Friday host already is.",
        "derivedFrom": "brandScript.audiences.b2c.plan.process"
      },
      {
        "channel": "The recipe library",
        "cadence": "One new recipe a fortnight",
        "job": "The transitional call to action and the only durable search asset the business owns.",
        "derivedFrom": "brandScript.audiences.b2c.calls.transitional"
      },
      {
        "channel": "Email",
        "cadence": "Fortnightly, plus the two sequences",
        "job": "The list is the only audience nobody else can switch off.",
        "derivedFrom": "brandScript.derived.oneLiner"
      },
      {
        "channel": "The trade spec card",
        "cadence": "Reprinted when the trade price changes, and never otherwise",
        "job": "One page: the measure, the cost per serve, the case price. It is the marketing that closes venues.",
        "derivedFrom": "brandScript.derived.tradeOneLiner"
      },
      {
        "channel": "Market stalls",
        "cadence": "Fortnightly, Saturday",
        "job": "The only channel where a stranger tastes it before deciding. Highest conversion, lowest reach, and it costs a whole day.",
        "derivedFrom": "brandScript.audiences.b2c.problem.internal"
      }
    ]
  },
  "leftEngine": {
    "part": "left-engine",
    "aircraft": "Left engine",
    "discipline": "Sales",
    "purpose": "The named steps that turn interest into money, written down so that a slow month can be diagnosed instead of worried about.",
    "failureMode": "Without a process, selling becomes a mood. In a business with two very different buyers, it also becomes two moods that get confused with each other.",
    "processes": [
      {
        "id": "b2c",
        "name": "Direct to a person",
        "mechanism": "Shopify checkout, courier-delivered. Everything is self-service; there is no conversation to have and no time to have it in.",
        "cadence": "The market model's year 2 target is 4,356 direct bottles, which at 2.4 bottles an order is about 151 orders a month — roughly five a day, all packed on Tuesday.",
        "stages": [
          {
            "stage": 1,
            "name": "Found us",
            "qualifyingQuestion": "Did they arrive on a page that says what this is for, rather than what it is?",
            "action": "Recipe page or a post. The one-liner is above the fold on every entry point.",
            "measure": "Sessions on a recipe page"
          },
          {
            "stage": 2,
            "name": "Took the recipe",
            "qualifyingQuestion": "Did they take the low-risk yes?",
            "action": "The Brine Book, for an email address.",
            "measure": "Email addresses added"
          },
          {
            "stage": 3,
            "name": "First bottle",
            "qualifyingQuestion": "Did they buy one bottle for the drink they actually make?",
            "action": "The direct call, on a product page that names the serve before the ingredients.",
            "measure": "First orders, and which SKU opened the account"
          },
          {
            "stage": 4,
            "name": "Second order",
            "qualifyingQuestion": "Did they come back inside twelve weeks without a discount?",
            "action": "Post-purchase email at week six with the recipe for the bottle they bought.",
            "measure": "Repeat rate at 12 weeks"
          }
        ]
      },
      {
        "id": "b2b",
        "name": "Trade, through draft orders",
        "mechanism": "A Shopify draft order at trade pricing, sent for approval before it becomes an invoice. That is deliberate: the venue sees the price, the terms and the case quantity on the record before anyone commits, which is exactly what the BrandScript's agreement plan promises.",
        "cadence": "The market model's year 2 target is 83 live accounts, which at a one-in-five close rate is 4 approaches a week for two years. That is Thursday, and it is why Thursday is protected.",
        "stages": [
          {
            "stage": 1,
            "name": "Identified",
            "qualifyingQuestion": "Spirits-led list, 40 seats or more, and a serve already on the menu that this replaces?",
            "action": "Added to the trade list with the reason written next to it. The B2B agent builds this list from the market model's venue segment.",
            "measure": "Qualified venues on the list"
          },
          {
            "stage": 2,
            "name": "Sampled",
            "qualifyingQuestion": "Did two bottles and a spec card reach the person who signs off the list?",
            "action": "Delivered by hand where the drive is under 30 minutes; couriered otherwise.",
            "measure": "Samples placed, and with whom by name"
          },
          {
            "stage": 3,
            "name": "Poured against the jar",
            "qualifyingQuestion": "Did the bar team taste them side by side, at a line-up?",
            "action": "Ten minutes before service. If it does not happen inside two weeks, the sample is dead and the venue goes back to the list.",
            "measure": "Line-ups attended"
          },
          {
            "stage": 4,
            "name": "First case",
            "qualifyingQuestion": "Did a draft order for six bottles get approved at the published trade price?",
            "action": "Draft order raised in Shopify, terms attached, invoice on approval.",
            "measure": "First cases, and days from sample to case"
          },
          {
            "stage": 5,
            "name": "On cadence",
            "qualifyingQuestion": "Do we know how long a case lasts them, and are we in touch a week before it runs out?",
            "action": "Reorder date set from their covers. The check-in happens whether or not they answer.",
            "measure": "Accounts reordering on schedule, and accounts gone quiet"
          }
        ]
      }
    ]
  },
  "wings": {
    "part": "wings",
    "aircraft": "Wings",
    "discipline": "Products and their margins",
    "purpose": "What each bottle is for, what it costs to make, and what is left over — which is the number that decides whether the other five parts are worth running.",
    "failureMode": "Weak wings and the whole plane works hard to stay up. A range that all sells and none of which pays is the hardest failure to see, because the top line looks fine.",
    "wings": [
      {
        "sku": "HS-01-500",
        "name": "No 01 HOUSE",
        "job": "The everyday one. The bottle that gets opened for cooking as well as drinking, which is what makes it the volume line.",
        "shelfPriceCents": 1800,
        "costBreakdownCents": [
          {
            "item": "Cucumber, dill, peppercorn, garlic, bay, salt",
            "cents": 240
          },
          {
            "item": "500ml bottle, cap, label",
            "cents": 185
          },
          {
            "item": "Carton and outer, amortised",
            "cents": 60
          },
          {
            "item": "Direct labour at $28/hr",
            "cents": 210
          }
        ],
        "confidence": "estimate",
        "note": "Lowest cost, lowest price, highest volume. This is the bottle the business is priced around."
      },
      {
        "sku": "HS-02-500",
        "name": "No 02 DIRTY",
        "job": "One drink. Filtered clear so it will not cloud a stirred one, which is the specific failure it was built to fix.",
        "shelfPriceCents": 2000,
        "costBreakdownCents": [
          {
            "item": "Cornichon, green olive, lemon peel, coriander seed",
            "cents": 310
          },
          {
            "item": "500ml bottle, cap, label",
            "cents": 185
          },
          {
            "item": "Carton and outer, amortised",
            "cents": 60
          },
          {
            "item": "Direct labour, including the filtration step",
            "cents": 210
          }
        ],
        "confidence": "estimate",
        "note": "The entry SKU for both audiences, because the martini is the drink people already know they are getting wrong. Every trade conversation starts here."
      },
      {
        "sku": "HS-03-500",
        "name": "No 03 SMOKE",
        "job": "Heat and smoke. The bottle that wins the taste test at a market stall and loses the reorder if the customer only drinks one style.",
        "shelfPriceCents": 2200,
        "costBreakdownCents": [
          {
            "item": "Chipotle, manzano, cumin, bay",
            "cents": 355
          },
          {
            "item": "500ml bottle, cap, label",
            "cents": 185
          },
          {
            "item": "Carton and outer, amortised",
            "cents": 60
          },
          {
            "item": "Direct labour, including the smoking step",
            "cents": 250
          }
        ],
        "confidence": "estimate",
        "note": "The smoking step is the longest part of any run and it is the reason a mixed production day yields fewer bottles than a single-line one."
      },
      {
        "sku": "HS-04-500",
        "name": "No 04 WILD",
        "job": "Seafood. The bottle that says the range has a top end, and the one that cannot be scaled.",
        "shelfPriceCents": 2600,
        "costBreakdownCents": [
          {
            "item": "Cucumber, native botanicals, lemon peel, salt",
            "cents": 520
          },
          {
            "item": "500ml bottle, cap, label",
            "cents": 185
          },
          {
            "item": "Carton and outer, amortised",
            "cents": 60
          },
          {
            "item": "Direct labour, including the hand-sort",
            "cents": 250
          }
        ],
        "confidence": "estimate",
        "note": "Supply-limited by leaf availability, not by demand, and it has no label artwork yet. It should be sold as scarce because it is, not as a marketing device."
      },
      {
        "sku": "HS-SET-3",
        "name": "The First Three",
        "job": "Acquisition. Three bottles in one parcel is the only direct order shape whose courier cost is not eating the margin.",
        "shelfPriceCents": 5400,
        "costBreakdownCents": [
          {
            "item": "No 01 + No 02 + No 03 at cost",
            "cents": 2310
          },
          {
            "item": "Gift carton and mailer",
            "cents": 220
          }
        ],
        "confidence": "estimate",
        "note": "Worst gross margin in the range and the strongest direct contribution per parcel, because the courier is charged once. See the finding below."
      }
    ],
    "findings": [
      "At a 40% trade discount the margin on No 01 is about a quarter of the trade price. That does not pay for the hour it takes to sample, deliver and invoice a venue. Either the discount comes down to about 30%, or a case is six bottles and never fewer — the market model assumes the second.",
      "The First Three has the weakest gross margin in the range and the strongest contribution per parcel, because courier and packaging are charged once for three bottles rather than once for two. It is the direct order shape to push, in spite of the percentage.",
      "A single-bottle direct order is close to break-even after courier, packaging and payment fees. Either the shipping is charged, or the smallest direct offer is three bottles.",
      "No 04 is the highest margin per bottle and cannot be scaled, so it should never be discounted and never be a lead offer. It is a range-topper, and its job is to make No 02 look reasonable."
    ]
  },
  "body": {
    "part": "body",
    "aircraft": "Body",
    "discipline": "Overhead and operations",
    "purpose": "The weight the business carries whether or not it sells anything this week — which in a company of one is mostly her calendar.",
    "failureMode": "Overload it and the plane will not climb. The tell is not a cash-flow problem; it is a week where nothing was made because everything else had to be done.",
    "week": [
      {
        "day": "Monday",
        "work": "Production day 1. Cure, strain, fill, cap, label, batch-code, clean down.",
        "hours": 9
      },
      {
        "day": "Tuesday",
        "work": "Orders and post. Pick, pack, courier drop, customer email, restock the shop.",
        "hours": 5
      },
      {
        "day": "Wednesday",
        "work": "Production day 2. Same again, usually a different line.",
        "hours": 9
      },
      {
        "day": "Thursday",
        "work": "Trade. Four venue approaches, sample drops, line-ups, draft orders, invoices.",
        "hours": 6
      },
      {
        "day": "Friday",
        "work": "Content and books. Shoot, write, schedule, reconcile, file, review what the AI team drafted.",
        "hours": 5
      },
      {
        "day": "Saturday",
        "work": "Market stall, fortnightly. Setup, six hours of tasting and selling, pack down.",
        "hours": 7
      },
      {
        "day": "Sunday",
        "work": "Off. This is a line item, not a gap. The plan is built on it.",
        "hours": 0
      }
    ],
    "fixedOverhead": [
      {
        "item": "Commercial kitchen hire, two days a week",
        "centsPerMonth": 65000,
        "confidence": "estimate"
      },
      {
        "item": "Product and public liability insurance",
        "centsPerMonth": 9500,
        "confidence": "estimate"
      },
      {
        "item": "Food Control Plan registration and verification, amortised",
        "centsPerMonth": 5500,
        "confidence": "estimate"
      },
      {
        "item": "Shopify and apps",
        "centsPerMonth": 8500,
        "confidence": "estimate"
      },
      {
        "item": "Domain, email and hosting",
        "centsPerMonth": 2500,
        "confidence": "estimate"
      },
      {
        "item": "Accounting software and the accountant",
        "centsPerMonth": 18000,
        "confidence": "estimate"
      },
      {
        "item": "Phone and internet, business share",
        "centsPerMonth": 6000,
        "confidence": "estimate"
      },
      {
        "item": "Vercel, Supabase and the AI team's model spend",
        "centsPerMonth": 7000,
        "confidence": "estimate"
      },
      {
        "item": "Cool store and dry storage",
        "centsPerMonth": 15000,
        "confidence": "estimate"
      }
    ],
    "perOrderCosts": [
      {
        "item": "Courier, urban, one parcel",
        "cents": 850,
        "note": "The same whether the parcel holds one bottle or three. This single fact is why The First Three exists."
      },
      {
        "item": "Mailer, void fill and label",
        "cents": 220,
        "note": "Glass in a courier network needs real packaging, and the cheap version costs more in breakages."
      },
      {
        "item": "Payment processing",
        "cents": 91,
        "note": "About 2.9% plus 30c on a $21 order. Scales with the order value, so it is worse per bottle on singles."
      }
    ],
    "constraints": [
      "Two production days a week is the hard ceiling. At 120 bottles a day and 44 working weeks that is 10,560 bottles a year, and no amount of marketing moves it.",
      "One person is also the packer. Every hour of direct order growth takes an hour from trade or from production, and trade is worth 24 bottles a year per hour spent.",
      "The kitchen is hired, so a production day cannot be moved at short notice and a missed Monday cannot be made up on Sunday.",
      "No 04 is limited by leaf supply, which is a constraint on the range and not on the week."
    ]
  },
  "fuelTanks": {
    "part": "fuel-tanks",
    "aircraft": "Fuel tanks",
    "discipline": "Cash flow",
    "purpose": "Where the money sits between coming in and going out, so that a good month cannot be spent twice and a bad one does not stop the plane.",
    "failureMode": "One account for everything. It always looks like there is money, right up until GST is due and there is not.",
    "accounts": [
      {
        "account": "1. Operating",
        "holds": "Every dollar the business takes, on the way in. Nothing is paid from anywhere else.",
        "rule": "Everything lands here first. When the balance is above the buffer below, the excess is swept on the same day each month — not when it feels comfortable."
      },
      {
        "account": "2. Personal",
        "holds": "Her wage.",
        "rule": "A fixed amount on a fixed date, whether it was a good month or a bad one. A wage that moves with takings is not a wage, it is a mood."
      },
      {
        "account": "3. Tax",
        "holds": "GST collected, and income tax set aside.",
        "rule": "15% of every GST-inclusive sale moves here the week it lands, before input credits are netted off. Those credits become the buffer instead of a surprise."
      },
      {
        "account": "4. Business profit",
        "holds": "What is left after the wage and the tax.",
        "rule": "Swept quarterly. It is not spending money — it is the account that proves the business works, and it pays for the co-packer conversation when it comes."
      },
      {
        "account": "5. Investment capital",
        "holds": "Money earmarked for one named thing.",
        "rule": "Nothing goes in without the thing being named first: the WILD label artwork, the second brining vessel, the trade show stand. A pot with no name gets spent on whatever breaks."
      }
    ],
    "operatingBufferMonths": 3,
    "gst": {
      "ratePercent": 15,
      "registrationThresholdCents": 6000000,
      "filingBasis": "Two-monthly, payments basis",
      "note": "Year 1 modelled net revenue is above the $60,000 threshold, so registration becomes compulsory during year 1 rather than at the end of it. Registration is required within 21 days of expecting to cross it — the trigger is the expectation, not the crossing. Displayed retail prices stay GST-inclusive; trade prices are quoted GST-exclusive and must carry '+ GST' on the same line."
    },
    "rules": [
      "Hold three months of operating cost in the operating account before sweeping anything, and step it to six months once year 2 closes. Six is the target; three is what is reachable first, and a target that is not reachable gets ignored.",
      "Sweep on a date, not on a feeling. The same day every month, whatever the balance looks like.",
      "The tax account is not a line of credit. If a purchase needs money that is sitting in it, the answer is no.",
      "Stock is cash in glass. A production run of a line that is not selling is the fastest way for a profitable month to end with an empty bank account.",
      "Once residual income tax passes $5,000 in a year, provisional tax starts the following year and the payment dates move. Ask the accountant before the first year closes, not after."
    ]
  },
  "nextActions": [
    {
      "id": "open-the-five-accounts",
      "action": "Open the five bank accounts and set the monthly sweep on a fixed date.",
      "because": "It is the cheapest of every action in this plan and the one that stops a good month being spent twice. It also has to be in place before GST registration, not after.",
      "by": "2026-09-12",
      "doneWhen": "Five accounts exist, the sweep is a calendar entry, and the first sweep has happened."
    },
    {
      "id": "settle-trade-terms",
      "action": "Publish one trade price list with a six-bottle case minimum on it.",
      "because": "The wings arithmetic shows a 40% discount on single bottles does not pay for the hour it takes to service the account. The B2B sales process, the market model's trade arm and the BrandScript's agreement plan all assume this document exists.",
      "by": "Before the first trade order is raised",
      "doneWhen": "The list is a PDF, the same number is in Shopify's trade price rules, and the spec card quotes it."
    },
    {
      "id": "cost-a-real-run",
      "action": "Cost one real production run against invoices and replace the estimates in the wings section.",
      "because": "Every cost line in this plan is an estimate. The margins drive the trade discount decision, the direct order shape and the whole market model, and none of them is safe until one run has been costed properly.",
      "by": "After the next production run",
      "doneWhen": "Each cost line reads confidence: derived, with the run it was costed from."
    },
    {
      "id": "protect-thursday",
      "action": "Put four venue approaches in the calendar for every Thursday, as recurring appointments.",
      "because": "83 accounts at a one-in-five close rate is exactly four approaches a week for two years. It is the only line in this plan that fails silently — nothing breaks on the week it is skipped, and the target is gone by month eighteen.",
      "by": "2026-09-05",
      "doneWhen": "The recurring block exists and the trade list has four named venues in it every Thursday morning."
    }
  ]
}$hs$::jsonb),

  ($hs$brandscript$hs$, $hs$brandscript$hs$::public.strategy_framework,
   $hs$StoryBrand BrandScript$hs$,
   $hs$The seven things a customer needs to hear, in the order they need to hear them — so every caption, email and label tells the same story, and so the marketing agent writes from your position instead of inventing one.$hs$,
   $hs$1.0.0$hs$, array[$hs$social$hs$, $hs$email$hs$, $hs$storefront$hs$, $hs$packaging$hs$, $hs$wholesale$hs$, $hs$paid$hs$, $hs$support$hs$]::text[], 20, true,
   $hs${
  "version": "1.0.0",
  "purpose": "The seven things a customer needs to hear, in the order they need to hear them — so every caption, email and label tells the same story, and so the marketing agent writes from your position instead of inventing one.",
  "audiences": {
    "b2c": {
      "character": {
        "id": "b2c",
        "label": "The Friday host",
        "who": "Someone in their thirties or forties who cooks properly, owns a jigger, and has three bottles of gin they can tell apart. They are not a bartender and do not want to be. They make drinks for four people about twice a month.",
        "wants": "A drink at home that tastes like the one they would happily pay $24 for at a bar.",
        "evidence": "The drinks they make are already close. What they buy to improve them is never equipment — it is one ingredient at a time: better vermouth, better ice, better bitters. Brine is the next one on that list and nobody has sold it to them yet."
      },
      "problem": {
        "external": "The brine in a jar of olives is cloudy, salty in the wrong way, different every jar, and runs out halfway through the second round.",
        "internal": "They feel like an amateur in their own kitchen. The drink is nearly right and they cannot say what is missing, which is worse than it being obviously wrong.",
        "philosophical": "If you are going to make the drink, the ingredients should be as considered as the ones a bar would use. Care at home should not be a lesser grade of care.",
        "villain": "The half-empty olive jar in the fridge door."
      },
      "guide": {
        "empathy": "We have made the same drink with the same jar and been quietly disappointed by it. That is the reason this company exists, and it is a small reason, which is the point.",
        "authority": [
          "Four brines, each built for one job, rather than one brine asked to do four.",
          "No 02 is filtered clear so it will not cloud a stirred drink — a specific fix for a specific failure.",
          "Every recipe in the library carries a measure, a time, and what to do when it goes wrong.",
          "The company is one person. She answers the email, and she made the bottle."
        ]
      },
      "plan": {
        "process": [
          {
            "step": 1,
            "title": "Pick the brine for the drink you actually make",
            "detail": "Not the range — one bottle. No 01 if you cook with it, No 02 if you stir one on a Friday, No 03 if you like heat and smoke, No 04 for seafood."
          },
          {
            "step": 2,
            "title": "Follow the measure on the bottle",
            "detail": "There is one on every label, and it is the measure we tested. Start there before you start adjusting."
          },
          {
            "step": 3,
            "title": "Pour it for someone else",
            "detail": "The whole point of getting the drink right is handing it to a person who did not expect it to be that good."
          }
        ],
        "agreement": [
          "We will never tell you what this does to your body. It is a food, and we make no claims of that kind — the label tells you what is in it and the recipes tell you what to do with it.",
          "Every recipe says what to do when it goes wrong, not only when it goes right.",
          "The measure printed on the bottle is the one we actually tested.",
          "If something arrives damaged, tell us — your rights are set out in our terms of sale and our shipping page, and we will not talk you out of them."
        ]
      },
      "calls": {
        "direct": {
          "label": "Order a bottle",
          "href": "/products/no-02-dirty",
          "live": false,
          "note": "One bottle, not the range. No 02 DIRTY is the entry point because the martini is the drink people already know they are getting wrong. The product route is not deployed yet — see the next actions."
        },
        "transitional": {
          "label": "Take the recipe",
          "href": "/recipes",
          "live": false,
          "note": "The recipe library, given away with nothing asked in return. It is the low-risk way to say yes, and it is the only thing on the site that earns an email address honestly."
        }
      },
      "stakes": {
        "failure": [
          "Another Friday where the drink is nearly right.",
          "A fridge door of half-jars kept for their liquid.",
          "Guests who say it is lovely and mean it is fine."
        ],
        "success": [
          "The drink lands the same way every time you make it.",
          "People ask what you put in it.",
          "You stop apologising for the round before you have handed it over."
        ],
        "transformation": {
          "from": "Someone who makes drinks at home and hopes.",
          "to": "The person whose round everyone waits for."
        }
      }
    },
    "b2b": {
      "character": {
        "id": "b2b",
        "label": "The bar manager",
        "who": "Runs a 40-to-90-seat venue with a spirits-led list. Signs off what goes on the list and is measured on consistency and on pour cost. Has six suppliers already and does not want a seventh unless it removes a problem.",
        "wants": "A dirty martini their whole team pours the same way, at a cost they can put in a spreadsheet and defend.",
        "evidence": "Every venue conversation ends in the same two questions: what does it cost per pour, and will my Tuesday staff make it the same as my Saturday staff. Neither question is about flavour, and both are answerable."
      },
      "problem": {
        "external": "The dirty martini is the least consistent thing the bar pours: olive brine varies jar to jar, the pour is unmeasured, and its cost per serve is invisible.",
        "internal": "The bar manager is judged on consistency and on margin, and this one drink lets them down on both while looking like a rounding error.",
        "philosophical": "A bar should know what is in every glass it sells and what that glass costs. Anything else is guessing with someone else's money.",
        "villain": "The unmeasured pour from a jar nobody ordered."
      },
      "guide": {
        "empathy": "We know that another supplier is a liability until it proves otherwise, and that the last thing a bar needs is another 500ml bottle taking up rail space for a drink nobody orders.",
        "authority": [
          "One published trade price, not a negotiation, so the pour cost is knowable before the first case.",
          "Every batch is numbered, and we will tell you which one you have.",
          "Filtered clear, so it will not cloud a stirred drink under a bar light.",
          "The brine is built for the serve rather than adapted to it, which is why the measure is the same every time."
        ]
      },
      "plan": {
        "process": [
          {
            "step": 1,
            "title": "Take two sample bottles and a spec card",
            "detail": "Delivered at our cost, with the measure, the pour cost per serve, and the case price on one card."
          },
          {
            "step": 2,
            "title": "Pour it against your jar, side by side, with your team",
            "detail": "Ten minutes at a pre-service line-up. If your team cannot taste the difference, we would rather find that out now than in month three."
          },
          {
            "step": 3,
            "title": "Order a case at trade price",
            "detail": "Six bottles. We raise it as a draft order so the invoice, the terms and the price are on the record before you approve it."
          },
          {
            "step": 4,
            "title": "Set the reorder cadence to your covers",
            "detail": "We work out how long a case lasts you and check in one week before it runs out, not one week after."
          }
        ],
        "agreement": [
          "Trade pricing is one published number, the same for every venue of your size. You will not find out later that someone got a better one.",
          "A case is six bottles and we do not split cases. That is what makes the price work for both of us.",
          "Every batch is numbered and traceable, so if a bottle is off you get an answer and not an apology.",
          "We will tell you when supply is short before you find out from an empty shelf. No 04 is limited by leaf supply and always will be."
        ]
      },
      "calls": {
        "direct": {
          "label": "Open a trade account",
          "href": "/wholesale",
          "live": false,
          "note": "Ends in a Shopify draft order at trade pricing, which is the mechanism the whole B2B process is built around. The route is not deployed yet."
        },
        "transitional": {
          "label": "Ask for two samples",
          "href": "/wholesale#samples",
          "live": false,
          "note": "The transitional call for trade. Costs the venue nothing and costs us two bottles and an hour, which the market model prices at a one-in-five close rate."
        }
      },
      "stakes": {
        "failure": [
          "A drink that goes back to the pass.",
          "A pour cost nobody on the team can name.",
          "A list that reads the same as the bar two doors down."
        ],
        "success": [
          "One line on the list that is only yours.",
          "A cost per serve you can put in the spreadsheet and defend to an owner.",
          "A bar team that makes it the same way on a Tuesday and a Saturday."
        ],
        "transformation": {
          "from": "A bar manager who tolerates one drink they cannot control.",
          "to": "A bar manager whose list has no weak line on it."
        }
      }
    }
  },
  "derived": {
    "oneLiner": "Most home martinis are let down by whatever is left in the olive jar. HALF SOUR makes brine built for the glass — so the drink you pour on a Tuesday is the drink you poured on Saturday.",
    "controllingIdea": "Brine is a bar ingredient, and the person pouring it is the hero of every sentence we write.",
    "elevatorPitch": "You know the moment when you have made the martini, and it is fine, and you cannot say what is missing? It is the brine — a splash of whatever was left in the olive jar, different every time. We make four: No 01 HOUSE for everyday, No 02 DIRTY for the martini, No 03 SMOKE for mezcal and pork, No 04 WILD for anything that came out of the sea. Pick the one for the drink you actually make, follow the measure on the bottle, and pour it for someone else. People start asking what you put in it.",
    "tradeOneLiner": "The dirty martini is the least consistent thing most bars pour. HALF SOUR is one published trade price, six bottles to a case, and a cost per serve you can defend."
  },
  "nextActions": [
    {
      "id": "ship-the-transitional-cta",
      "action": "Build /recipes and put the transitional call to action behind it.",
      "because": "Both scripts have a direct call and a transitional call, and neither transitional route is deployed. Without the low-risk yes there is only the high-risk one, and a first-time visitor to a brine company is not going to take it.",
      "by": "2026-09-30",
      "doneWhen": "/recipes resolves, and the b2c transitional call in this file reads live: true."
    },
    {
      "id": "one-liner-everywhere",
      "action": "Put the one-liner, unchanged, in the site header, the Instagram bio, the email footer and the trade spec card.",
      "because": "A one-liner that appears in one place is a slogan. A one-liner repeated across every surface is what makes a stranger able to describe the company to someone else, which is the only distribution a one-person business can afford.",
      "by": "2026-09-15",
      "doneWhen": "The exact string appears on all four surfaces and the marketing agent is refusing to paraphrase it."
    },
    {
      "id": "earn-the-origin-line",
      "action": "Get the Food Control Plan address on file so the making-and-bottling line can be used as an authority marker.",
      "because": "Where the brine is made is the strongest authority marker available to this brand and it is deliberately absent from the guide's authority list, because a place-of-origin claim is an offence under Fair Trading Act s 13(j) if it is not literally true of the goods on sale.",
      "by": "Before the first published origin claim",
      "doneWhen": "The address is recorded, and the claim is added here with a copy-audit-approved: PROV-01 marker naming what is made where."
    },
    {
      "id": "test-the-internal-problem",
      "action": "Ask ten people who already make drinks at home to describe what is wrong with their martini, and write down the words they use.",
      "because": "The internal problem — feeling like an amateur in your own kitchen — is the line the whole script sells on, and it is currently a hypothesis. If they say something else, this file changes and every caption changes with it.",
      "by": "2026-10-15",
      "doneWhen": "Ten answers are recorded, and the b2c internal problem either survives them or is rewritten."
    }
  ]
}$hs$::jsonb),

  ($hs$market-sizing$hs$, $hs$market_sizing$hs$::public.strategy_framework,
   $hs$Market sizing — TAM, SAM, SOM$hs$,
   $hs$How much money is on the table, how much of it you can actually reach, and how much of that you can win in two years — with every assumption written down so you can argue with it.$hs$,
   $hs$1.0.0$hs$, array[$hs$wholesale$hs$, $hs$pricing$hs$, $hs$planning$hs$]::text[], 30, true,
   $hs${
  "purpose": "How much money is on the table, how much of it you can actually reach, and how much of that you can win in two years — with every assumption written down so you can argue with it.",
  "basis": "Annual spend on the category, in New Zealand dollars, excluding GST, at the price the buyer in each channel pays: shelf price for a household, trade price for a venue or a retail door.",
  "headwinds": [
    "NZ hospitality sales grew 1.0% year on year in Q1 2025, and the restaurant-and-café segment 0.3%. Neither the venue base nor bottles-per-venue is grown anywhere in this model. [RA-2025]",
    "2,564 hospitality businesses shut in the twelve months to mid-2025 against 2,158 the year before, and liquidations rose from 199 to 297. That count spans a wider hospitality base than the 11,436 venues sized here, so it cannot be read as a churn rate — but it is why the trade target is stated as accounts LIVE at month 24, not accounts ever signed. [RA-CLOSURES-2025]",
    "Wage costs run at about 40% of hospitality revenue. A venue under that pressure buys on cost per pour, not on a story, which is why the trade one-liner leads with the pour and not the provenance. [RA-CLOSURES-2025]",
    "The category's own tailwind — pickle-flavoured mixer unit sales up 140%, pickle spirits up 10% — is cited and used in no calculation. A percentage lift on an unpublished base is a direction, not a market size. [PJ-MIXER-2025]",
    "Two of the venue-side inputs (bars and clubs at 2,400; doors at 900) are unverified estimates. If both are half what is assumed, the SAM falls by about a quarter and the trade target becomes materially harder, not impossible."
  ],
  "nextActions": [
    {
      "id": "verify-venue-count",
      "action": "Count on-licences off the ARLA register and replace the 2,400 estimate for bars, pubs and clubs.",
      "because": "It is the largest unverified input on the venue side, and the trade target is stated to two significant figures against it. The Ministry of Justice publishes the register quarterly.",
      "by": "2026-10-31",
      "doneWhen": "The nzBarsAndClubs assumption reads confidence: sourced, with a source row and a retrieval date."
    },
    {
      "id": "measure-a-production-day",
      "action": "Time one full production day end to end and write down the bottle count.",
      "because": "bottlesPerProductionDay = 120 is an estimate that has never been measured, and the entire SOM is a multiple of it. A day that yields 80 makes the year 2 revenue $79,000, not $118,600.",
      "by": "The next production day",
      "doneWhen": "The assumption reads confidence: derived, with the date of the day it was measured on."
    },
    {
      "id": "settle-the-trade-discount",
      "action": "Decide the trade discount and the case minimum before the first trade invoice goes out.",
      "because": "At a 40% trade discount off net shelf the margin on No 01 is 26%, which does not pay for the hour it takes to deliver and invoice. Either the discount comes down to about 30% or a case is six bottles and no less.",
      "by": "Before the first trade order is raised",
      "doneWhen": "One published trade price list exists, with the case minimum on it, and the tradeDiscountRate assumption matches it."
    },
    {
      "id": "gst-registration",
      "action": "Register for GST and set up two-monthly filing.",
      "because": "Year 1 modelled net revenue is above the $60,000 threshold, so registration becomes compulsory during year 1 rather than at the end of it, and 15% of every sale stops being hers the day it does.",
      "by": "Within 21 days of expecting turnover to pass $60,000 in any 12 months",
      "doneWhen": "An IRD GST number is issued and the first return is filed."
    }
  ]
}$hs$::jsonb);

insert into public.strategy_assumptions
  (slug, label, value_micro, unit, confidence, source_id, rationale,
   min_micro, max_micro, step_micro, position, is_active)
values
  ($hs$nzHouseholds$hs$, $hs$New Zealand households$hs$,
   2057500000000, $hs$count$hs$::public.strategy_unit, $hs$sourced$hs$::public.strategy_confidence,
   $hs$SNZ-HH-2025Q4$hs$,
   $hs$Households in private occupied dwellings at 31 December 2025. Households, not dwellings — 2,141,200 dwellings includes the unoccupied ones, and an empty house buys nothing.$hs$,
   1500000000000, 2500000000000, 1000000000, 10, true),

  ($hs$nzCandidateHouseholdRate$hs$, $hs$Share of households that could plausibly buy$hs$,
   350000, $hs$ratio$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Households containing at least one adult who buys spirits or premium mixers, or who cooks with a bought acid. There is no published NZ figure for this, so it is a judgement. Sensitivity: at 0.20 the NZ TAM falls to about $18.0m; at 0.50 it rises to about $40.6m.$hs$,
   50000, 800000, 10000, 20, true),

  ($hs$bottlesPerHouseholdYear$hs$, $hs$Bottles a buying household takes per year$hs$,
   2000000, $hs$per_year$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$A 500ml bottle is roughly sixteen 30ml pours. Two bottles a year is one pour a fortnight — deliberately conservative for a house that entertains occasionally rather than weekly.$hs$,
   500000, 12000000, 500000, 30, true),

  ($hs$shelfPriceInclGstCents$hs$, $hs$Average shelf price (GST-inclusive)$hs$,
   2100000000, $hs$cents$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$The range runs $18 / $20 / $22 / $26, and The First Three at $54 realises $18 a bottle. $21.00 is the blend weighted toward No 01 and No 02, which will carry the volume. It is an assumption about mix, not a price.$hs$,
   1400000000, 3200000000, 25000000, 40, true),

  ($hs$gstRate$hs$, $hs$GST rate$hs$,
   150000, $hs$ratio$hs$::public.strategy_unit, $hs$sourced$hs$::public.strategy_confidence,
   $hs$IRD-GST$hs$,
   $hs$New Zealand GST is 15% and displayed retail prices are GST-inclusive. Every layer in this model is stated net of it.$hs$,
   0, 250000, 10000, 50, true),

  ($hs$tradeDiscountRate$hs$, $hs$Trade discount off net shelf price$hs$,
   400000, $hs$ratio$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$A 40% discount off the GST-exclusive shelf price is the usual ask from a venue or a retail door. The Flight Plan's wings section shows what that leaves; it is the number most worth arguing with in this whole file.$hs$,
   150000, 600000, 10000, 60, true),

  ($hs$nzCafesRestaurants$hs$, $hs$NZ cafés and restaurants$hs$,
   9036000000, $hs$count$hs$::public.strategy_unit, $hs$sourced$hs$::public.strategy_confidence,
   $hs$CAFE-2026$hs$,
   $hs$Businesses in the NZ cafés-and-restaurants market, 2026. This is a business count, not a site count, so a group with four sites is one row here — the model is conservative for that reason.$hs$,
   5000000000, 15000000000, 50000000, 70, true),

  ($hs$nzBarsAndClubs$hs$, $hs$NZ bars, pubs and clubs$hs$,
   2400000000, $hs$count$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Not verified in this pass. The Ministry of Justice publishes the ARLA register of active licences quarterly but no national aggregate of on-licences by premises type, and the register was not parsed here. Treat 2,400 as a placeholder and replace it with a count off the register.$hs$,
   500000000, 6000000000, 50000000, 80, true),

  ($hs$bottlesPerVenueYear$hs$, $hs$Bottles a stocking venue takes per year$hs$,
   24000000, $hs$per_year$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Two bottles a month — about one 30ml pour a day across the range. A venue running a serve on a busy list would take more; most will take less, and this is the average across both.$hs$,
   6000000, 120000000, 6000000, 90, true),

  ($hs$nzSpecialtyOnlineBuyerRate$hs$, $hs$Share of candidate households reachable online$hs$,
   300000, $hs$ratio$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Candidate households that buy specialty food or drink online at all. NZ e-commerce penetration for food and beverage sits well below general retail, which is why this is 0.30 rather than 0.80.$hs$,
   50000, 900000, 10000, 100, true),

  ($hs$nzSpecialtyRetailDoors$hs$, $hs$NZ specialty retail doors$hs$,
   900000000, $hs$count$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Independent grocers, delicatessens and bottle shops with a premium mixer bay. An estimate; no published count of this segment was located.$hs$,
   100000000, 3000000000, 25000000, 110, true),

  ($hs$bottlesPerRetailDoorYear$hs$, $hs$Bottles a retail door takes per year$hs$,
   72000000, $hs$per_year$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Six bottles a month, which is one case a month at a case of six. A door that cannot move six a month is not a door worth servicing by courier.$hs$,
   12000000, 300000000, 6000000, 120, true),

  ($hs$nzVenueListRate$hs$, $hs$Share of venues that would list a brine$hs$,
   180000, $hs$ratio$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Venues with a spirits-led list that already sell a dirty martini. An estimate. It is the number that decides whether the trade arm is a business or a hobby.$hs$,
   20000, 600000, 10000, 130, true),

  ($hs$bottlesPerDtcOrder$hs$, $hs$Bottles per direct order$hs$,
   2400000, $hs$count$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Between a single bottle and the three bottles in The First Three. The number matters because courier and packaging are charged per parcel, not per bottle — see the Flight Plan's body section.$hs$,
   1000000, 6000000, 100000, 140, true),

  ($hs$auPopulation$hs$, $hs$Australian population$hs$,
   27801023000000, $hs$count$hs$::public.strategy_unit, $hs$sourced$hs$::public.strategy_confidence,
   $hs$ABS-POP-2025Q4$hs$,
   $hs$ABS estimated resident population at 31 December 2025.$hs$,
   20000000000000, 35000000000000, 100000000000, 150, true),

  ($hs$auHouseholdSize$hs$, $hs$Average Australian household size$hs$,
   2550000, $hs$count$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Used to derive an Australian household count, because the ABS release read here reports people, not households. 2.55 is the long-run average; a 2026 household count would be better and should replace this.$hs$,
   2000000, 3500000, 50000, 160, true),

  ($hs$auCafesRestaurants$hs$, $hs$Australian cafés and restaurants$hs$,
   55700000000, $hs$count$hs$::public.strategy_unit, $hs$sourced$hs$::public.strategy_confidence,
   $hs$AU-CAFE-2024$hs$,
   $hs$Cafés and restaurants in operation at the end of the 2024 financial year. Bars and clubs are not added on the Australian side, so the AU venue arm is understated on purpose.$hs$,
   30000000000, 90000000000, 500000000, 170, true),

  ($hs$auRealisationFactor$hs$, $hs$Australian realisation factor$hs$,
   950000, $hs$multiplier$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Australian prices set to hold the same New Zealand dollar realisation per bottle, less 5% for freight across the Tasman and a distributor layer that does not exist domestically.$hs$,
   600000, 1100000, 10000, 180, true),

  ($hs$productionDaysPerWeek$hs$, $hs$Production days per week$hs$,
   2000000, $hs$count$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$One person. The other three-and-a-bit working days are orders, trade calls, content and the books — see the week in the Flight Plan's body section.$hs$,
   1000000, 6000000, 1000000, 190, true),

  ($hs$bottlesPerProductionDay$hs$, $hs$Bottles per production day$hs$,
   120000000, $hs$count$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$A day in a hired commercial kitchen: cure, strain, fill, cap, label, code. An estimate that has never been measured against a real day, and the single number most worth measuring first, because the whole SOM hangs off it.$hs$,
   40000000, 500000000, 10000000, 200, true),

  ($hs$productionWeeksPerYear$hs$, $hs$Production weeks per year$hs$,
   44000000, $hs$count$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$52 less leave, public holidays, and the weeks lost to market stalls and trade shows.$hs$,
   30000000, 52000000, 1000000, 210, true),

  ($hs$year1Utilisation$hs$, $hs$Year 1 capacity used$hs$,
   450000, $hs$ratio$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Year one is demand-limited, not capacity-limited: she can make more than she can sell. 45% is the ramp.$hs$,
   100000, 1000000, 50000, 220, true),

  ($hs$year2Utilisation$hs$, $hs$Year 2 capacity used$hs$,
   750000, $hs$ratio$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$By month 24 the constraint has crossed over: demand meets capacity and the ceiling becomes the two production days.$hs$,
   100000, 1000000, 50000, 230, true),

  ($hs$somDtcShare$hs$, $hs$Direct share of volume$hs$,
   550000, $hs$ratio$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Direct is the highest realisation per bottle and the only channel she controls. The three shares must total 1.$hs$,
   0, 1000000, 50000, 240, true),

  ($hs$somRetailShare$hs$, $hs$Specialty retail share of volume$hs$,
   200000, $hs$ratio$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Doors are slow to open and slow to close. The three shares must total 1.$hs$,
   0, 1000000, 50000, 250, true),

  ($hs$somTradeShare$hs$, $hs$Trade share of volume$hs$,
   250000, $hs$ratio$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Venues buy in cases and reorder on a cadence, which is why trade is worth a lower margin. The three shares must total 1.$hs$,
   0, 1000000, 50000, 260, true),

  ($hs$tradeCloseRate$hs$, $hs$Trade close rate$hs$,
   200000, $hs$ratio$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$One venue in five that takes a sample places a first order. Sets how many approaches a week the trade target implies.$hs$,
   50000, 600000, 10000, 270, true),

  ($hs$nzPopulation$hs$, $hs$New Zealand population$hs$,
   5361300000000, $hs$count$hs$::public.strategy_unit, $hs$sourced$hs$::public.strategy_confidence,
   $hs$SNZ-POP-2026$hs$,
   $hs$Provisional estimated resident population at 31 March 2026. Used only in the top-down cross-check.$hs$,
   4000000000000, 7000000000000, 10000000000, 280, true),

  ($hs$worldPopulationMillions$hs$, $hs$World population (millions)$hs$,
   8250000000, $hs$count$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Rounded mid-2026 figure, in millions, used only to take a population share of the global category in the cross-check. Held in millions so the stored value stays an exact integer number of millionths.$hs$,
   7000000000, 9000000000, 50000000, 290, true),

  ($hs$globalCategoryUsdMillions$hs$, $hs$Global pickle juice drinks market (USD millions)$hs$,
   920000000, $hs$count$hs$::public.strategy_unit, $hs$sourced$hs$::public.strategy_confidence,
   $hs$PJ-GLOBAL-2025$hs$,
   $hs$USD 0.92bn in 2025, forecast to USD 2.01bn by 2034 at a 9.1% CAGR. Counts packaged pickle-juice drinks — a narrower category than brine sold as a mixer and a cooking acid.$hs$,
   100000000, 5000000000, 10000000, 300, true),

  ($hs$usdToNzd$hs$, $hs$USD to NZD$hs$,
   1660000, $hs$multiplier$hs$::public.strategy_unit, $hs$estimate$hs$::public.strategy_confidence,
   null,
   $hs$Rate of the day, unhedged, used only to put the global category figure into the same currency as everything else.$hs$,
   1200000, 2200000, 10000, 310, true);
-- @@STRATEGY-SEED-END@@

-- =============================================================================
-- RLS, GRANTS AND TRIGGERS
--
-- This migration runs after the guarantees pass, so it cannot rely on that
-- pass's backfill loops. Everything below is what those loops would have done,
-- written out for these two tables.
--
-- The strategy is internal. `anon` — the public storefront — gets nothing: a
-- competitor should not be able to read the venue targets out of the published
-- site's own API, and the BrandScript's internal problem is not something a
-- customer is ever shown in raw form.
-- =============================================================================
alter table public.strategy_documents   enable row level security;
alter table public.strategy_assumptions enable row level security;

create policy strategy_documents_operator_all on public.strategy_documents
  for all to authenticated
  using (public.is_operator())
  with check (public.is_operator());

create policy strategy_assumptions_operator_all on public.strategy_assumptions
  for all to authenticated
  using (public.is_operator())
  with check (public.is_operator());

revoke all on public.strategy_documents, public.strategy_assumptions from anon;
grant all on public.strategy_documents, public.strategy_assumptions
  to authenticated, service_role;

create trigger set_updated_at before update on public.strategy_documents
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.strategy_assumptions
  for each row execute function public.set_updated_at();

-- Deliberately NOT added here: a row-level audit trigger. Every strategy edit
-- changes what the AI staff will say next and ought to land in `audit_log`, but
-- there is no generic row-audit function in this schema yet and inventing one
-- inside a strategy migration would put a trigger on the audit path that nobody
-- reviewed. The admin writes the audit row instead, once editing is built.

-- =============================================================================
-- ASSERTIONS — the guarantees pass re-run against these two tables
-- =============================================================================

-- RLS on, and a policy on each.
do $$
declare bad text;
begin
  select string_agg(c.relname || ' (' ||
           case when not c.relrowsecurity then 'RLS off' else 'no policy' end || ')', ', ')
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('strategy_documents', 'strategy_assumptions')
     and (not c.relrowsecurity
          or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if bad is not null then
    raise exception 'Strategy RLS assertion failed: %', bad;
  end if;
end;
$$;

-- The updated_at trigger is present on both.
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ')
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('strategy_documents', 'strategy_assumptions')
     and not exists (select 1 from pg_trigger g
                      where g.tgrelid = c.oid and g.tgname = 'set_updated_at');
  if bad is not null then
    raise exception 'Strategy updated_at trigger assertion failed for: %', bad;
  end if;
end;
$$;

-- anon holds nothing on either table.
do $$
declare bad text;
begin
  select string_agg(distinct table_name || '.' || privilege_type, ', ')
    into bad
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name in ('strategy_documents', 'strategy_assumptions');
  if bad is not null then
    raise exception 'Strategy grant assertion failed. anon holds: %', bad;
  end if;
end;
$$;

-- No money in a float, and no naive timestamp. Same rule as 7c in the
-- guarantees pass, scoped to these tables.
do $$
declare bad text;
begin
  select string_agg(format('%s.%s (%s)', c.table_name, c.column_name, c.data_type), ', ')
    into bad
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name in ('strategy_documents', 'strategy_assumptions')
     and (
       (c.data_type in ('real', 'double precision', 'numeric', 'money')
        and (c.column_name ~ '(cents|price|cost|amount|total|value|micro)'))
       or c.data_type in ('timestamp without time zone', 'time without time zone')
     );
  if bad is not null then
    raise exception 'Strategy type assertion failed: %', bad;
  end if;
end;
$$;

-- The seed actually landed, and it landed complete. A migration that creates
-- empty tables and reports success is how an agent ends up with no strategy and
-- nobody noticing until the captions go strange.
do $$
declare
  documents integer;
  assumptions integer;
  unsourced integer;
begin
  select count(*) into documents   from public.strategy_documents where is_active;
  select count(*) into assumptions from public.strategy_assumptions where is_active;
  if documents <> 3 then
    raise exception 'Expected 3 active strategy documents, found %', documents;
  end if;
  if assumptions < 20 then
    raise exception 'Expected at least 20 market assumptions, found %', assumptions;
  end if;
  select count(*) into unsourced
    from public.strategy_assumptions
   where confidence <> 'estimate' and source_id is null;
  if unsourced > 0 then
    raise exception '% sourced assumptions have no source id', unsourced;
  end if;
end;
$$;
