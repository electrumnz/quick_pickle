-- =============================================================================
-- HALF SOUR — 11 AUDIENCE AVATARS
--
-- The two customers, stored the way the three frameworks are stored: as rows an
-- agent reads before it writes anything, not as a document a person reads once.
--
-- 20260102000000_strategy.sql already holds the BrandScript, which says what
-- each customer WANTS. This table holds who they are the rest of the week — the
-- job they are hiring a bottle for, what they do instead today, what triggers an
-- order, what stops one, what they compare the price against, and what would
-- make them buy a second time. Repeat is the whole business at 10,560 bottles a
-- year, so the last of those is not a nice-to-have field.
--
--   strategy_avatars   one row per customer. The whole avatar is held as jsonb
--                      for the same reason the BrandScript is: the shape IS the
--                      framework, and flattening it into columns would lose the
--                      part that makes it usable — an avatar is only worth
--                      having if a decision can be made from it whole.
--
-- Why a table rather than a fourth `strategy_documents` row: adding a value to
-- `public.strategy_framework` and then inserting with it inside the same
-- migration is a Postgres foot-gun (a new enum label cannot be used in the
-- transaction that added it), and the two narrow columns here — `audience` and
-- `label` — are worth having as columns, because `applies_to` scoping has to be
-- able to route the venue buyer to the trade agent and the home host to the
-- marketing agent without parsing json.
--
-- `body` duplicates `audience` and `label`. That is deliberate and it is
-- checked: a row whose column says b2b and whose document says b2c would put
-- the wrong person into an agent's prompt and nothing else would notice.
--
-- This migration sorts after 20260101999900_schema_guarantees.sql, so — exactly
-- as the strategy migration does — it carries its own RLS, its own policy, its
-- own grants, its own updated_at trigger, and then re-runs the guarantees
-- against itself.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enum
-- -----------------------------------------------------------------------------
-- There are two customers and there have only ever been two. A third value here
-- would be a third company, and the BrandScript would have to grow a third
-- script to match it.
create type public.strategy_audience as enum (
  'b2c',  -- the Friday host: buys one bottle for her own kitchen
  'b2b'   -- the bar manager: buys cases for a venue at a published trade price
);

-- -----------------------------------------------------------------------------
-- strategy_avatars
-- -----------------------------------------------------------------------------
create table public.strategy_avatars (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  audience    public.strategy_audience not null,
  -- The BrandScript character this deepens, repeated verbatim. If the two ever
  -- disagree the avatars have become a second, competing set of customers.
  label       text not null,
  version     text not null default '1.0.0',
  applies_to  text[] not null default '{}',
  position    integer not null default 100,
  body        jsonb not null,
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint strategy_avatars_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint strategy_avatars_version_format check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint strategy_avatars_position_range check (position between 1 and 1000),
  constraint strategy_avatars_body_is_object check (jsonb_typeof(body) = 'object'),
  -- The column and the document must be the same person.
  constraint strategy_avatars_body_matches_audience check (body->>'id' = audience::text),
  constraint strategy_avatars_body_matches_label check (body->>'label' = label),
  -- An avatar with no repeat story is the one field this business cannot do
  -- without: at two production days a week, growth is the second order.
  constraint strategy_avatars_has_repeat check (
    jsonb_typeof(body->'repeat') = 'object'
    and (body->'repeat'->>'bottlesPerYear') is not null),
  -- And an avatar the market model cannot count is an avatar the plan cannot
  -- pay for. `counted.countedBy` names the market inputs that count them.
  constraint strategy_avatars_is_counted check (
    jsonb_typeof(body->'counted'->'countedBy') = 'array'
    and jsonb_array_length(body->'counted'->'countedBy') > 0)
);

-- Exactly one live avatar per customer. Two live B2C avatars is two customers,
-- and the marketing agent would be handed both.
create unique index strategy_avatars_one_active_per_audience
  on public.strategy_avatars (audience) where is_active;
create index strategy_avatars_active_idx on public.strategy_avatars (position, slug) where is_active;
create index strategy_avatars_applies_idx on public.strategy_avatars using gin (applies_to);

comment on table public.strategy_avatars is
  'The two customers in enough detail to decide from. Read into agent system prompts by lib/strategy/context.ts; the storefront is tested against them by lib/strategy/audit.ts.';
comment on column public.strategy_avatars.applies_to is
  'Agent scopes, exactly as strategy_documents.applies_to. The marketing agent gets the home host; the trade agent gets the venue buyer.';
comment on column public.strategy_avatars.body is
  'One CustomerAvatar from content/strategy/avatars.ts. Decoded — never cast — by lib/strategy/schema.ts.';

-- =============================================================================
-- SEED — generated from content/strategy/avatars.ts.
-- See lib/strategy/emit-avatar-seed.ts and tests/strategy/avatars.test.ts.
-- =============================================================================
-- @@AVATAR-SEED-START@@
-- Generated from content/strategy/avatars.ts by lib/strategy/emit-avatar-seed.ts.
-- Do not hand-edit: run
--   UPDATE_AVATAR_SEED=1 npx vitest run tests/strategy/avatars.test.ts
-- after changing an avatar in code.

insert into public.strategy_avatars
  (slug, audience, label, version, applies_to, position, is_active, body)
values
  ($hs$friday-host$hs$, $hs$b2c$hs$::public.strategy_audience,
   $hs$The Friday host$hs$, $hs$1.0.0$hs$,
   array[$hs$social$hs$, $hs$email$hs$, $hs$storefront$hs$, $hs$packaging$hs$, $hs$paid$hs$, $hs$support$hs$]::text[], 10, true,
   $hs${
  "id": "b2c",
  "slug": "friday-host",
  "label": "The Friday host",
  "headline": "Cooks properly, owns a jigger, hosts four people twice a month, and buys one better ingredient at a time.",
  "derivedFrom": "brandScript.audiences.b2c.character",
  "who": "Thirty-two to forty-five, in Auckland, Wellington or Christchurch, in a household where $20 on one bottle is an ordinary grocery decision and $60 on three is a considered one. They cook five nights a week from things rather than from packets, and the sour-and-savoury end of the shelf is where their money already goes: vermouth, anchovies, a good vinegar, capers. They are the 56% who go looking for a difficult flavour and the half who are done with sweet drinks. They are not a bartender, do not want to be one, and will not buy equipment — every improvement they have made in two years has been one ingredient at a time.",
  "jobToBeDone": "Hand somebody a drink at home that tastes like the one they would have queued for at a bar, without becoming the sort of person who owns a bar cart.",
  "week": [
    {
      "when": "Monday to Thursday, about 6.30pm",
      "what": "Cooking on a weeknight. Acid is a decision they make three times a week — lemon, vinegar, or whatever is open.",
      "ourWindow": "No 01 as a cooking acid is the use that doubles the number of weeks a bottle stays open. It is also the use the storefront currently says least about."
    },
    {
      "when": "Thursday, late",
      "what": "Phone in hand. This is when the weekend gets planned and when things get bought.",
      "ourWindow": "The order that arrives before Friday has to be placed on Thursday. Dispatch days and delivery cost decide whether that order happens."
    },
    {
      "when": "Friday, 6pm",
      "what": "Four people in the kitchen and a drink to make. The martini is stirred first because it is the one they are proudest of and the one most likely to be nearly right.",
      "ourWindow": "The moment the product exists for. Everything on the site is an argument about this fifteen minutes."
    },
    {
      "when": "Saturday morning",
      "what": "A market, a good grocer, or neither. This is where they meet small food brands face to face and decide whether to trust them.",
      "ourWindow": "The stall is the only place they taste before they buy. It is also the only place the founder hears the words they use."
    },
    {
      "when": "Sunday",
      "what": "A roast, or the fridge audit. Half-used jars either get used or get thrown out, and the fridge door is where the villain lives.",
      "ourWindow": "The reorder prompt belongs here — around week ten, when the bottle is two-thirds gone."
    }
  ],
  "insteadToday": [
    {
      "option": "The brine left in the olive jar",
      "whyItPersists": "It is free, it is already in the fridge door, and it is what every recipe on the internet tells them to use.",
      "whatItCosts": "Cloudy, different every jar, salty in the wrong way, and gone halfway through the second round."
    },
    {
      "option": "Buying better everything else instead",
      "whyItPersists": "A $45 bottle of vermouth or a $30 gin is a shelf they already understand, and it does make the drink better.",
      "whatItCosts": "They keep fixing the part that was not broken. Nobody has told them the brine is the variable."
    },
    {
      "option": "Ordering it out instead",
      "whyItPersists": "The bar makes it properly and there is no washing up.",
      "whatItCosts": "About $24 a glass, and it is not the thing they wanted, which was to have made it."
    },
    {
      "option": "The imported bottle in the running shop",
      "whyItPersists": "It is the only pickle juice on a New Zealand shelf, so search sends them there.",
      "whatItCosts": "It is sold in a supplement aisle to somebody else entirely. A home cook reads that shelf and concludes the whole category is not for them."
    }
  ],
  "whereTheyAre": [
    {
      "place": "Instagram and TikTok, saved rather than followed",
      "reading": "Fifteen-second builds. The pickle martini and the pickleback are the formats carrying the category, and they are watching them without buying anything.",
      "reachedBy": "A build they can make on Friday with what is on the counter, with the measure on screen. Not a photograph of a bottle."
    },
    {
      "place": "A bar they trust, sitting at the counter",
      "reading": "The list. They order the drink they cannot make at home yet.",
      "reachedBy": "Being on that list. A venue account is also an advertisement to exactly this person, which is why the trade arm is not a separate business."
    },
    {
      "place": "Search, when they have decided",
      "reading": "Two or three words: the drink, the ingredient, and the country. This is the highest-intent moment they have and it currently lands on an imported supplement.",
      "reachedBy": "A page that answers the search with the serve, and a price that does not need a click."
    },
    {
      "place": "A Saturday market stall",
      "reading": "A tasting cup and the founder's face.",
      "reachedBy": "Being there. It converts, and it costs a Saturday."
    }
  ],
  "triggers": [
    {
      "trigger": "Somebody poured them a good one and they asked what was in it.",
      "whatTheyDoNext": "Search the brand name that evening.",
      "needs": "A page that resolves and names the serve before the ingredients."
    },
    {
      "trigger": "They made a round at home and it was flat.",
      "whatTheyDoNext": "Look for the missing variable. This is the only moment they are actively shopping for brine.",
      "needs": "One page that says which bottle is for which drink, without a paragraph."
    },
    {
      "trigger": "People are coming on Friday and there is nothing to make.",
      "whatTheyDoNext": "Order on Thursday, if it will arrive.",
      "needs": "Delivery cost and dispatch day, visible before the cart."
    },
    {
      "trigger": "A present for the friend who cooks.",
      "whatTheyDoNext": "Buy the set, because choosing for someone else is hard.",
      "needs": "The Full Set priced against three singles, which the shop already does."
    }
  ],
  "whatStopsThem": [
    {
      "objection": "What does it cost to get here?",
      "answerableOnSite": true,
      "ourAnswer": "A courier charge nobody has stated is the commonest reason an $18 bottle stays in a cart. The number belongs on the product page, not at step three of checkout."
    },
    {
      "objection": "Which of the four is mine?",
      "answerableOnSite": true,
      "ourAnswer": "Each bottle carries one job. The shop page does this well already: the job is printed beside the name."
    },
    {
      "objection": "Will it just sit in the fridge?",
      "answerableOnSite": true,
      "ourAnswer": "Twenty-five pours a bottle, and a second use in the pan. Both are true and only one of them is on the page."
    },
    {
      "objection": "Is this a drink thing or one of those bottles?",
      "answerableOnSite": true,
      "ourAnswer": "The category's only shelf presence here is in a running shop. The first line a stranger reads has to name a glass, or they file us next to it."
    },
    {
      "objection": "What happens if it arrives broken?",
      "answerableOnSite": true,
      "ourAnswer": "New Zealand consumer law gives them rights whether or not we write them down. A page that sets them out is worth more than one that hopes nobody asks."
    }
  ],
  "price": {
    "anchor": "The $24 they would have paid for the same drink at a bar, divided by the number of drinks in the bottle.",
    "comparedWith": [
      {
        "thing": "One made for them at a bar",
        "cents": 2400,
        "note": "The reference price. A $20 bottle that makes 25 of them is the whole argument, and the arithmetic is not on the page."
      },
      {
        "thing": "A jar of good olives",
        "cents": 1200,
        "note": "What they use the brine of today. This is the price they will flinch against, not the bar price."
      },
      {
        "thing": "A bottle of dry vermouth",
        "cents": 3500,
        "note": "The last ingredient they upgraded. It proves they will pay for one bottle that fixes one drink."
      },
      {
        "thing": "Aromatic bitters",
        "cents": 2800,
        "note": "Bought once, used by the drop, never questioned. The shape of purchase we want."
      }
    ],
    "unblinkingCents": 2000,
    "deliberateCents": 2600,
    "hiddenCost": "Courier. On a single bottle it can be half the price of the bottle, which is why The Full Set at $54 in one parcel is the order shape the plan actually wants — the Flight Plan's wings section says the same thing from the margin end.",
    "note": "They are not price-sensitive on the bottle. They are sensitive to paying $12 to receive an $18 bottle, and to not knowing that before the last step."
  },
  "repeat": {
    "cadence": "A bottle every ten to twelve weeks if it is only for drinks; every five or six if it gets into the cooking.",
    "bottlesPerYear": 2,
    "whatBringsThemBack": [
      "A recipe that uses a third of the bottle in one go — brined olives, a vinaigrette, a beurre blanc. The kitchen use is what converts an occasional bottle into a standing one.",
      "An email at week ten that says what is in the tank, not one that says buy again.",
      "The bottle running out in front of guests, which only helps if reordering takes under a minute.",
      "A second bottle they did not choose: the set, given as a present, comes back as a repeat order for the one they liked."
    ],
    "whatLosesThem": [
      "A first parcel that cost more to ship than they expected.",
      "Buying No 03 SMOKE first, liking it least, and concluding the range is not for them.",
      "Nothing arriving between the first order and the third month. The list is the only thing that keeps the account alive and it currently has no form to sign up to."
    ],
    "theCheck": "Repeat rate at twelve weeks, without a discount. The Flight Plan's B2C sales process already names it as stage four; nothing on the storefront currently makes it happen."
  },
  "counted": {
    "channel": "Direct — Shopify, courier-delivered",
    "countedBy": [
      "nzHouseholds",
      "nzCandidateHouseholdRate",
      "nzSpecialtyOnlineBuyerRate",
      "bottlesPerHouseholdYear",
      "bottlesPerDtcOrder",
      "somDtcShare"
    ],
    "bottlesInput": "bottlesPerHouseholdYear",
    "howMany": "216,038 reachable households in the SAM; the year-2 plan needs about 2,178 of them buying two bottles a year — 1% of the reachable pool, 1,815 orders a year, 151 a month, five a day.",
    "capacityShare": "4,356 bottles of the 7,920 made in year 2 — 55% of everything the two production days produce."
  },
  "notThisPerson": [
    "The runner who found pickle juice in a shoe shop. Different bottle, different aisle, different claim, and one this company may not make.",
    "The sweet ready-to-drink buyer. Half of this cohort is cutting sweetness; we are on the other side of that line.",
    "The bargain hunter waiting for a sale. At two production days a week there is no volume to discount into.",
    "Anyone under 18. Every serve on the site is an adult occasion and the copy rules treat it that way."
  ]
}$hs$::jsonb),
  ($hs$bar-manager$hs$, $hs$b2b$hs$::public.strategy_audience,
   $hs$The bar manager$hs$, $hs$1.0.0$hs$,
   array[$hs$wholesale$hs$, $hs$pricing$hs$, $hs$planning$hs$]::text[], 20, true,
   $hs${
  "id": "b2b",
  "slug": "bar-manager",
  "label": "The bar manager",
  "headline": "Runs a 40-to-90-seat spirits-led room, already pours the serve five times a night, and buys on cost per pour and consistency.",
  "derivedFrom": "brandScript.audiences.b2b.character",
  "who": "The person who signs off what goes on the list at an owner-operated bar or a restaurant with a proper back bar — one of about 9,036 café and restaurant businesses in a market growing at 1.0% a year with venues closing in it. They are measured on gross profit percentage and on consistency, do the stocktake on a Sunday night, and already carry six suppliers they did not choose. They are not looking for a seventh. They are looking for one line on the list to stop costing them arguments.",
  "jobToBeDone": "Make the dirty martini the same drink on a Tuesday as on a Saturday, at a cost per pour they can put in a spreadsheet and defend to an owner.",
  "week": [
    {
      "when": "Monday, 10am",
      "what": "Ordering. Six supplier emails, one spreadsheet, and a delivery window that has to fit around a lunch service.",
      "ourWindow": "A published price and a case size mean this takes forty seconds. A price that requires an email means it does not happen this week."
    },
    {
      "when": "Tuesday to Thursday, 4.30pm",
      "what": "The pre-service line-up. Ten minutes where the team tastes what is new and the manager decides whether it is worth the rail space.",
      "ourWindow": "The only moment a sample gets poured properly. The Flight Plan's trade stage three is this ten minutes and nothing else."
    },
    {
      "when": "Friday and Saturday, service",
      "what": "Five to ten of the serve a night, poured by whoever is on. Consistency is a staffing problem, not a recipe problem.",
      "ourWindow": "A bottle with a printed measure removes the variable. That is the product's actual trade argument."
    },
    {
      "when": "Sunday night",
      "what": "Stocktake and the GP conversation with the owner. Every line on the list is defended or dropped here.",
      "ourWindow": "The reorder check-in lands on Monday because of this. The seller who knows how long a case lasts them is the one who does not get dropped."
    }
  ],
  "insteadToday": [
    {
      "option": "The catering jar of olives, drained for its liquid",
      "whyItPersists": "It is already in the kitchen, it costs nothing on paper, and no one has ever costed it.",
      "whatItCosts": "An unmeasured pour, a different jar every fortnight, and a serve whose cost nobody can name."
    },
    {
      "option": "Making a house brine in-house",
      "whyItPersists": "It is free, and a good chef enjoys it.",
      "whatItCosts": "Prep hours, a different result each batch, and no food-safety record for the thing that goes in the glass."
    },
    {
      "option": "Leaving the serve off the list",
      "whyItPersists": "One less thing to go wrong.",
      "whatItCosts": "The drink is being ordered by name elsewhere. A spirits-led room without it looks like the bar two doors down."
    }
  ],
  "whereTheyAre": [
    {
      "place": "Behind their own bar, between 4 and 5pm",
      "reading": "Nothing. This is why the approach is a person and two bottles, not an email campaign.",
      "reachedBy": "Turning up at the right hour with a spec card and no speech."
    },
    {
      "place": "Their inbox, at 10am on a Monday",
      "reading": "Order confirmations and price lists.",
      "reachedBy": "One page with the price, the case size and the pour cost on it. Anything longer is read as a pitch."
    },
    {
      "place": "The trade press and the association's newsletter",
      "reading": "Closures, wage costs, and what other venues are cutting. They are reading about a tightening market, which is the mood every approach lands in.",
      "reachedBy": "Leading with the spreadsheet, not the story. A venue under pressure buys a cost, not a provenance."
    },
    {
      "place": "The distributor rep who already visits",
      "reading": "A folder of things with better margins than ours.",
      "reachedBy": "Not competing there. This is a direct relationship or it is nothing, which is also why it costs an hour."
    }
  ],
  "triggers": [
    {
      "trigger": "A drink came back to the pass, or two staff made it differently in one shift.",
      "whatTheyDoNext": "Look for a way to remove the variable.",
      "needs": "A measure on the bottle and a spec card that names it."
    },
    {
      "trigger": "The Sunday GP conversation named this drink.",
      "whatTheyDoNext": "Cost the serve properly for the first time.",
      "needs": "A published trade price and a pour count, so the cost per serve is arithmetic rather than a phone call."
    },
    {
      "trigger": "A list rewrite — new season, new menu, new bar manager.",
      "whatTheyDoNext": "Take samples from three suppliers in one fortnight.",
      "needs": "Being on the list of three. That is a diary problem, not a copy problem."
    },
    {
      "trigger": "A customer asked for it by name and they had to say no.",
      "whatTheyDoNext": "Add it, quickly, with whatever is available.",
      "needs": "Being findable at that moment. Today a venue searching lands on a storefront with no trade page at all."
    }
  ],
  "whatStopsThem": [
    {
      "objection": "What does it cost me per pour?",
      "answerableOnSite": true,
      "ourAnswer": "Trade price divided by twenty-five pours. Both numbers exist and neither is published, so the answer currently takes an email and two working days."
    },
    {
      "objection": "What is the minimum, and how often do I have to order?",
      "answerableOnSite": true,
      "ourAnswer": "Six bottles to a case, no split cases. It is in the BrandScript's agreement and nowhere a venue can read it."
    },
    {
      "objection": "Will it still be here in six months?",
      "answerableOnSite": false,
      "ourAnswer": "A one-person supplier is a real risk to a venue. Batch numbers, a named human and a check-in before the case runs out are the only answers that work, and they are answers a person gives, not a page."
    },
    {
      "objection": "Rail space. What comes off to make room?",
      "answerableOnSite": false,
      "ourAnswer": "Nothing comes off. It replaces the jar that was never a purchased line in the first place — which is the argument, and it needs the side-by-side pour to land."
    },
    {
      "objection": "Can I get it cheaper if I take more?",
      "answerableOnSite": true,
      "ourAnswer": "No. One published number for every venue of the same size. Publishing it is what makes that promise checkable."
    }
  ],
  "price": {
    "anchor": "Cost per pour against the drink's menu price, and the GP percentage that comes out of it.",
    "comparedWith": [
      {
        "thing": "No 01 HOUSE at trade, per bottle, before GST",
        "cents": 939,
        "note": "Forty per cent below the GST-exclusive shelf price. Against $6.95 of cost it leaves $2.44 — 26% — which is the number the Flight Plan says does not pay for the hour."
      },
      {
        "thing": "The same bottle at a 30% trade discount",
        "cents": 1096,
        "note": "$4.01 a bottle, 36.6%. This is the discount the wings arithmetic points at, and it changes the whole trade case."
      },
      {
        "thing": "A case of six at the published 40%",
        "cents": 5634,
        "note": "What a venue actually pays. It is also the entire first order, which is why the acquisition cost has to be measured against a year, not an order."
      },
      {
        "thing": "The catering jar they use now",
        "cents": 0,
        "note": "The number they will compare against, and it is zero on their sheet. Cost per pour is the only argument that beats free."
      }
    ],
    "unblinkingCents": 1100,
    "deliberateCents": 1400,
    "hiddenCost": "Ours, not theirs: at a one-in-five close rate, one live account costs about five approaches — two sample bottles at cost, a delivery and an hour each time, near enough $265. At $2.44 a bottle that account has to ship 109 bottles before it has paid for its own beginning.",
    "note": "The venue is not the price-sensitive party in this relationship. We are."
  },
  "repeat": {
    "cadence": "A case a month, ordered on a Monday, checked in on a week before it runs out.",
    "bottlesPerYear": 72,
    "whatBringsThemBack": [
      "The serve selling. Five a night at 20ml is six bottles a month, and a line that sells does not get argued about on a Sunday.",
      "A check-in that arrives before the case runs out rather than after, which is the Flight Plan's trade stage five and the only stage that compounds.",
      "The pour cost holding. One price, no surprises, no renegotiation.",
      "Being told when supply is short before an empty shelf tells them — No 04 especially."
    ],
    "whatLosesThem": [
      "A month of silence. A venue that runs out and does not hear from us has already replaced us with a jar.",
      "A price that moves.",
      "A split case, once, which teaches them the rule was never real.",
      "The bar manager leaving. The relationship is with a person, so the account has to be re-won on their last day."
    ],
    "theCheck": "Accounts reordering on schedule, and accounts gone quiet. Both are counted, and the second one is the one that matters."
  },
  "counted": {
    "channel": "On-premise trade — draft orders at the published trade price",
    "countedBy": [
      "nzCafesRestaurants",
      "nzBarsAndClubs",
      "nzVenueListRate",
      "bottlesPerVenueYear",
      "somTradeShare",
      "tradeCloseRate",
      "tradeDiscountRate"
    ],
    "bottlesInput": "bottlesPerVenueYear",
    "howMany": "2,058 venues in the SAM would list a brine. The year-2 plan needs 1,980 trade bottles: 83 accounts at the model's 24 bottles a year, or 28 accounts at the case-a-month this avatar describes. The second number is the one that pays for the hour — see the contradiction below.",
    "capacityShare": "1,980 bottles of the 7,920 made in year 2 — 25%, and the quarter that advertises itself on somebody else's printed list."
  },
  "notThisPerson": [
    "The 200-seat group venue with a procurement process. The volume looks good and the terms would take the margin that is left.",
    "The café with no spirits licence. There is no serve for this to replace.",
    "The venue that wants an exclusive or a bespoke blend. Two production days do not stretch to a private label.",
    "The bar that wants a sample and a price and has never poured the serve. They are a tasting, not an account."
  ]
}$hs$::jsonb);
-- @@AVATAR-SEED-END@@

-- =============================================================================
-- RLS, GRANTS AND TRIGGERS
--
-- Internal, like the rest of the strategy. `anon` — the public storefront —
-- gets nothing: an avatar is a description of a customer written for our own
-- use, and the venue targeting in it is not something a competitor should be
-- able to read out of the site's own API.
-- =============================================================================
alter table public.strategy_avatars enable row level security;

create policy strategy_avatars_operator_all on public.strategy_avatars
  for all to authenticated
  using (public.is_operator())
  with check (public.is_operator());

revoke all on public.strategy_avatars from anon;
grant all on public.strategy_avatars to authenticated, service_role;

create trigger set_updated_at before update on public.strategy_avatars
  for each row execute function public.set_updated_at();

-- =============================================================================
-- ASSERTIONS — the guarantees pass, re-run against this table
-- =============================================================================

-- RLS on, and a policy on it.
do $$
declare bad text;
begin
  select string_agg(c.relname || ' (' ||
           case when not c.relrowsecurity then 'RLS off' else 'no policy' end || ')', ', ')
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'strategy_avatars'
     and (not c.relrowsecurity
          or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if bad is not null then
    raise exception 'Avatar RLS assertion failed: %', bad;
  end if;
end;
$$;

-- The updated_at trigger is present.
do $$
begin
  if not exists (
    select 1 from pg_trigger g
     where g.tgrelid = 'public.strategy_avatars'::regclass
       and g.tgname = 'set_updated_at'
  ) then
    raise exception 'Avatar updated_at trigger assertion failed';
  end if;
end;
$$;

-- anon holds nothing.
do $$
declare bad text;
begin
  select string_agg(distinct privilege_type, ', ')
    into bad
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name = 'strategy_avatars';
  if bad is not null then
    raise exception 'Avatar grant assertion failed. anon holds: %', bad;
  end if;
end;
$$;

-- The seed landed, and it landed complete. A migration that creates an empty
-- table and reports success is how an agent ends up writing to nobody.
do $$
declare
  live integer;
  audiences integer;
begin
  select count(*) into live from public.strategy_avatars where is_active;
  select count(distinct audience) into audiences
    from public.strategy_avatars where is_active;
  if live <> 2 or audiences <> 2 then
    raise exception 'Expected one live avatar for each of the two audiences, found % row(s) across % audience(s)',
      live, audiences;
  end if;
end;
$$;
