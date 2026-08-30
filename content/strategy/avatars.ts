/**
 * The two customers, deepened into people a decision can be made from.
 *
 * These are not new customers. They are the two BrandScript characters — the
 * Friday host and the bar manager — with the rest of the picture attached: the
 * week they actually have, the thing they do instead of buying this today, what
 * triggers an order, what stops one, what they compare the price against, and
 * what would make them buy a second time. `derivedFrom` names the character
 * each one deepens and `label` repeats it verbatim, so a drift between this
 * file and `brandscript.ts` shows up as a failing test rather than as two
 * companies.
 *
 * Everything here is grounded in what was actually found, not in demographics
 * that sound plausible:
 *
 *  - The category moving is a bar-and-mixer one, not a shelf-of-remedies one.
 *    Pickle-flavoured mixer unit sales are up 140%, and the formats growing are
 *    drinks a person orders by name.
 *  - 56% of Gen Z and Millennial drinkers say they actively seek challenging
 *    flavours, and about half are cutting sweetness. That is the palate both
 *    avatars have.
 *  - In New Zealand the only pickle juice on a shelf is an imported American
 *    bottle sold through running shops, in the supplement aisle. Nobody owns
 *    the culinary lane, and nobody has told a home cook this is for them.
 *  - Hospitality here is tightening: about 9,036 café and restaurant businesses,
 *    $8.8bn, growth down to +1.0%, and venues closing. The trade avatar is
 *    written as a buyer under pressure, because that is the only kind there is.
 *  - Production tops out at 10,560 bottles a year. Both avatars are sized so
 *    that the number of them the plan needs is a number 10,560 bottles can
 *    serve — see `counted` on each, and `tests/strategy/avatars.test.ts`, which
 *    fails if an avatar drifts away from the market model that counts it.
 *
 * COPY-RULES binds this file exactly as it binds a label. Nothing below says
 * what brine does to a person: the drinks are named as drinks, the pans as
 * pans, and the only bodies mentioned are the ones holding the glass.
 */

import type {
  AudienceAvatars,
  CustomerAvatar,
  NextAction,
  StrategyContradiction,
} from "./types";

/* ---------------------------------------------------- B2C — the Friday host */

const FRIDAY_HOST: CustomerAvatar = {
  id: "b2c",
  slug: "friday-host",
  label: "The Friday host",
  headline:
    "Cooks properly, owns a jigger, hosts four people twice a month, and buys one better ingredient at a time.",
  derivedFrom: "brandScript.audiences.b2c.character",
  who: "Thirty-two to forty-five, in Auckland, Wellington or Christchurch, in a household where $20 on one bottle is an ordinary grocery decision and $60 on three is a considered one. They cook five nights a week from things rather than from packets, and the sour-and-savoury end of the shelf is where their money already goes: vermouth, anchovies, a good vinegar, capers. They are the 56% who go looking for a difficult flavour and the half who are done with sweet drinks. They are not a bartender, do not want to be one, and will not buy equipment — every improvement they have made in two years has been one ingredient at a time.",
  jobToBeDone:
    // copy-audit-approved: R-13 (names the drink being made at home; no quantity, no effect, no under-18 framing)
    "Hand somebody a drink at home that tastes like the one they would have queued for at a bar, without becoming the sort of person who owns a bar cart.",
  week: [
    {
      when: "Monday to Thursday, about 6.30pm",
      what: "Cooking on a weeknight. Acid is a decision they make three times a week — lemon, vinegar, or whatever is open.",
      ourWindow:
        "No 01 as a cooking acid is the use that doubles the number of weeks a bottle stays open. It is also the use the storefront currently says least about.",
    },
    {
      when: "Thursday, late",
      what: "Phone in hand. This is when the weekend gets planned and when things get bought.",
      ourWindow:
        "The order that arrives before Friday has to be placed on Thursday. Dispatch days and delivery cost decide whether that order happens.",
    },
    {
      when: "Friday, 6pm",
      // copy-audit-approved: R-13 (names the drink and the spirit as an occasion and an ingredient; no quantity, no effect, no under-18 framing)
      what: "Four people in the kitchen and a drink to make. The martini is stirred first because it is the one they are proudest of and the one most likely to be nearly right.",
      ourWindow:
        "The moment the product exists for. Everything on the site is an argument about this fifteen minutes.",
    },
    {
      when: "Saturday morning",
      what: "A market, a good grocer, or neither. This is where they meet small food brands face to face and decide whether to trust them.",
      ourWindow:
        "The stall is the only place they taste before they buy. It is also the only place the founder hears the words they use.",
    },
    {
      when: "Sunday",
      what: "A roast, or the fridge audit. Half-used jars either get used or get thrown out, and the fridge door is where the villain lives.",
      ourWindow:
        "The reorder prompt belongs here — around week ten, when the bottle is two-thirds gone.",
    },
  ],
  insteadToday: [
    {
      option: "The brine left in the olive jar",
      whyItPersists:
        "It is free, it is already in the fridge door, and it is what every recipe on the internet tells them to use.",
      whatItCosts:
        "Cloudy, different every jar, salty in the wrong way, and gone halfway through the second round.",
    },
    {
      option: "Buying better everything else instead",
      whyItPersists:
        // copy-audit-approved: R-13 (spirits named as ingredients being compared on a shelf; no quantity, no effect)
        "A $45 bottle of vermouth or a $30 gin is a shelf they already understand, and it does make the drink better.",
      whatItCosts:
        "They keep fixing the part that was not broken. Nobody has told them the brine is the variable.",
    },
    {
      option: "Ordering it out instead",
      whyItPersists: "The bar makes it properly and there is no washing up.",
      whatItCosts:
        "About $24 a glass, and it is not the thing they wanted, which was to have made it.",
    },
    {
      option: "The imported bottle in the running shop",
      whyItPersists:
        "It is the only pickle juice on a New Zealand shelf, so search sends them there.",
      whatItCosts:
        "It is sold in a supplement aisle to somebody else entirely. A home cook reads that shelf and concludes the whole category is not for them.",
    },
  ],
  whereTheyAre: [
    {
      place: "Instagram and TikTok, saved rather than followed",
      // copy-audit-approved: R-13 (names the drink formats the category is growing in; observation of a trend, no consumption encouragement)
      reading:
        "Fifteen-second builds. The pickle martini and the pickleback are the formats carrying the category, and they are watching them without buying anything.", // copy-audit-approved: R-13 (names the two drink formats the category is growing in; an observation about a trend, no quantity, no effect, no under-18 framing)
      reachedBy:
        "A build they can make on Friday with what is on the counter, with the measure on screen. Not a photograph of a bottle.",
    },
    {
      place: "A bar they trust, sitting at the counter",
      // copy-audit-approved: R-13 (a drink ordered by name in a venue; no quantity, no effect, no under-18 framing)
      reading: "The list. They order the drink they cannot make at home yet.",
      reachedBy:
        "Being on that list. A venue account is also an advertisement to exactly this person, which is why the trade arm is not a separate business.",
    },
    {
      place: "Search, when they have decided",
      reading:
        "Two or three words: the drink, the ingredient, and the country. This is the highest-intent moment they have and it currently lands on an imported supplement.",
      reachedBy:
        "A page that answers the search with the serve, and a price that does not need a click.",
    },
    {
      place: "A Saturday market stall",
      reading: "A tasting cup and the founder's face.",
      reachedBy: "Being there. It converts, and it costs a Saturday.",
    },
  ],
  triggers: [
    {
      // copy-audit-approved: R-13 (a drink poured for them in a venue; no quantity, no effect, no under-18 framing)
      trigger: "Somebody poured them a good one and they asked what was in it.",
      whatTheyDoNext: "Search the brand name that evening.",
      needs: "A page that resolves and names the serve before the ingredients.",
    },
    {
      trigger: "They made a round at home and it was flat.",
      whatTheyDoNext:
        "Look for the missing variable. This is the only moment they are actively shopping for brine.",
      needs:
        "One page that says which bottle is for which drink, without a paragraph.",
    },
    {
      trigger: "People are coming on Friday and there is nothing to make.",
      whatTheyDoNext: "Order on Thursday, if it will arrive.",
      needs: "Delivery cost and dispatch day, visible before the cart.",
    },
    {
      trigger: "A present for the friend who cooks.",
      whatTheyDoNext: "Buy the set, because choosing for someone else is hard.",
      needs:
        "The First Three priced against three singles, which the shop already does.",
    },
  ],
  whatStopsThem: [
    {
      objection: "What does it cost to get here?",
      answerableOnSite: true,
      ourAnswer:
        "A courier charge nobody has stated is the commonest reason an $18 bottle stays in a cart. The number belongs on the product page, not at step three of checkout.",
    },
    {
      objection: "Which of the four is mine?",
      answerableOnSite: true,
      ourAnswer:
        "Each bottle carries one job. The shop page does this well already: the job is printed beside the name.",
    },
    {
      objection: "Will it just sit in the fridge?",
      answerableOnSite: true,
      ourAnswer:
        "Twenty-five pours a bottle, and a second use in the pan. Both are true and only one of them is on the page.",
    },
    {
      objection: "Is this a drink thing or one of those bottles?",
      answerableOnSite: true,
      ourAnswer:
        "The category's only shelf presence here is in a running shop. The first line a stranger reads has to name a glass, or they file us next to it.",
    },
    {
      objection: "What happens if it arrives broken?",
      answerableOnSite: true,
      ourAnswer:
        "New Zealand consumer law gives them rights whether or not we write them down. A page that sets them out is worth more than one that hopes nobody asks.",
    },
  ],
  price: {
    anchor:
      "The $24 they would have paid for the same drink at a bar, divided by the number of drinks in the bottle.",
    comparedWith: [
      {
        thing: "One made for them at a bar",
        cents: 2_400,
        note: "The reference price. A $20 bottle that makes 25 of them is the whole argument, and the arithmetic is not on the page.",
      },
      {
        thing: "A jar of good olives",
        cents: 1_200,
        note: "What they use the brine of today. This is the price they will flinch against, not the bar price.",
      },
      {
        thing: "A bottle of dry vermouth",
        cents: 3_500,
        note: "The last ingredient they upgraded. It proves they will pay for one bottle that fixes one drink.",
      },
      {
        thing: "Aromatic bitters",
        cents: 2_800,
        note: "Bought once, used by the drop, never questioned. The shape of purchase we want.",
      },
    ],
    unblinkingCents: 2_000,
    deliberateCents: 2_600,
    hiddenCost:
      "Courier. On a single bottle it can be half the price of the bottle, which is why The First Three at $54 in one parcel is the order shape the plan actually wants — the Flight Plan's wings section says the same thing from the margin end.",
    note: "They are not price-sensitive on the bottle. They are sensitive to paying $12 to receive an $18 bottle, and to not knowing that before the last step.",
  },
  repeat: {
    cadence:
      "A bottle every ten to twelve weeks if it is only for drinks; every five or six if it gets into the cooking.",
    bottlesPerYear: 2,
    whatBringsThemBack: [
      "A recipe that uses a third of the bottle in one go — brined olives, a vinaigrette, a beurre blanc. The kitchen use is what converts an occasional bottle into a standing one.",
      "An email at week ten that says what is in the tank, not one that says buy again.",
      "The bottle running out in front of guests, which only helps if reordering takes under a minute.",
      "A second bottle they did not choose: the set, given as a present, comes back as a repeat order for the one they liked.",
    ],
    whatLosesThem: [
      "A first parcel that cost more to ship than they expected.",
      "Buying No 03 SMOKE first, liking it least, and concluding the range is not for them.",
      "Nothing arriving between the first order and the third month. The list is the only thing that keeps the account alive and it currently has no form to sign up to.",
    ],
    theCheck:
      "Repeat rate at twelve weeks, without a discount. The Flight Plan's B2C sales process already names it as stage four; nothing on the storefront currently makes it happen.",
  },
  counted: {
    channel: "Direct — Shopify, courier-delivered",
    countedBy: [
      "nzHouseholds",
      "nzCandidateHouseholdRate",
      "nzSpecialtyOnlineBuyerRate",
      "bottlesPerHouseholdYear",
      "bottlesPerDtcOrder",
      "somDtcShare",
    ],
    bottlesInput: "bottlesPerHouseholdYear",
    howMany:
      "216,038 reachable households in the SAM; the year-2 plan needs about 2,178 of them buying two bottles a year — 1% of the reachable pool, 1,815 orders a year, 151 a month, five a day.",
    capacityShare:
      "4,356 bottles of the 7,920 made in year 2 — 55% of everything the two production days produce.",
  },
  notThisPerson: [
    "The runner who found pickle juice in a shoe shop. Different bottle, different aisle, different claim, and one this company may not make.",
    "The sweet ready-to-drink buyer. Half of this cohort is cutting sweetness; we are on the other side of that line.",
    "The bargain hunter waiting for a sale. At two production days a week there is no volume to discount into.",
    "Anyone under 18. Every serve on the site is an adult occasion and the copy rules treat it that way.",
  ],
};

/* ---------------------------------------------------- B2B — the bar manager */

const BAR_MANAGER: CustomerAvatar = {
  id: "b2b",
  slug: "bar-manager",
  label: "The bar manager",
  headline:
    "Runs a 40-to-90-seat spirits-led room, already pours the serve five times a night, and buys on cost per pour and consistency.",
  derivedFrom: "brandScript.audiences.b2b.character",
  who: "The person who signs off what goes on the list at an owner-operated bar or a restaurant with a proper back bar — one of about 9,036 café and restaurant businesses in a market growing at 1.0% a year with venues closing in it. They are measured on gross profit percentage and on consistency, do the stocktake on a Sunday night, and already carry six suppliers they did not choose. They are not looking for a seventh. They are looking for one line on the list to stop costing them arguments.",
  jobToBeDone:
    // copy-audit-approved: R-13 (names the serve on a venue list; a purchasing frame, no consumption encouragement)
    "Make the dirty martini the same drink on a Tuesday as on a Saturday, at a cost per pour they can put in a spreadsheet and defend to an owner.",
  week: [
    {
      when: "Monday, 10am",
      what: "Ordering. Six supplier emails, one spreadsheet, and a delivery window that has to fit around a lunch service.",
      ourWindow:
        "A published price and a case size mean this takes forty seconds. A price that requires an email means it does not happen this week.",
    },
    {
      when: "Tuesday to Thursday, 4.30pm",
      what: "The pre-service line-up. Ten minutes where the team tastes what is new and the manager decides whether it is worth the rail space.",
      ourWindow:
        "The only moment a sample gets poured properly. The Flight Plan's trade stage three is this ten minutes and nothing else.",
    },
    {
      when: "Friday and Saturday, service",
      // copy-audit-approved: R-13 (counts a serve poured in a venue; trade volume, no consumption encouragement)
      what: "Five to ten of the serve a night, poured by whoever is on. Consistency is a staffing problem, not a recipe problem.",
      ourWindow:
        "A bottle with a printed measure removes the variable. That is the product's actual trade argument.",
    },
    {
      when: "Sunday night",
      what: "Stocktake and the GP conversation with the owner. Every line on the list is defended or dropped here.",
      ourWindow:
        "The reorder check-in lands on Monday because of this. The seller who knows how long a case lasts them is the one who does not get dropped.",
    },
  ],
  insteadToday: [
    {
      option: "The catering jar of olives, drained for its liquid",
      whyItPersists:
        "It is already in the kitchen, it costs nothing on paper, and no one has ever costed it.",
      whatItCosts:
        "An unmeasured pour, a different jar every fortnight, and a serve whose cost nobody can name.",
    },
    {
      option: "Making a house brine in-house",
      whyItPersists: "It is free, and a good chef enjoys it.",
      whatItCosts:
        "Prep hours, a different result each batch, and no food-safety record for the thing that goes in the glass.",
    },
    {
      option: "Leaving the serve off the list",
      whyItPersists: "One less thing to go wrong.",
      whatItCosts:
        "The drink is being ordered by name elsewhere. A spirits-led room without it looks like the bar two doors down.",
    },
  ],
  whereTheyAre: [
    {
      place: "Behind their own bar, between 4 and 5pm",
      reading:
        "Nothing. This is why the approach is a person and two bottles, not an email campaign.",
      reachedBy: "Turning up at the right hour with a spec card and no speech.",
    },
    {
      place: "Their inbox, at 10am on a Monday",
      reading: "Order confirmations and price lists.",
      reachedBy:
        "One page with the price, the case size and the pour cost on it. Anything longer is read as a pitch.",
    },
    {
      place: "The trade press and the association's newsletter",
      reading:
        "Closures, wage costs, and what other venues are cutting. They are reading about a tightening market, which is the mood every approach lands in.",
      reachedBy:
        "Leading with the spreadsheet, not the story. A venue under pressure buys a cost, not a provenance.",
    },
    {
      place: "The distributor rep who already visits",
      reading: "A folder of things with better margins than ours.",
      reachedBy:
        "Not competing there. This is a direct relationship or it is nothing, which is also why it costs an hour.",
    },
  ],
  triggers: [
    {
      trigger:
        "A drink came back to the pass, or two staff made it differently in one shift.",
      whatTheyDoNext: "Look for a way to remove the variable.",
      needs: "A measure on the bottle and a spec card that names it.",
    },
    {
      trigger: "The Sunday GP conversation named this drink.",
      whatTheyDoNext: "Cost the serve properly for the first time.",
      needs:
        "A published trade price and a pour count, so the cost per serve is arithmetic rather than a phone call.",
    },
    {
      trigger: "A list rewrite — new season, new menu, new bar manager.",
      whatTheyDoNext: "Take samples from three suppliers in one fortnight.",
      needs:
        "Being on the list of three. That is a diary problem, not a copy problem.",
    },
    {
      trigger: "A customer asked for it by name and they had to say no.",
      whatTheyDoNext: "Add it, quickly, with whatever is available.",
      needs:
        "Being findable at that moment. Today a venue searching lands on a storefront with no trade page at all.",
    },
  ],
  whatStopsThem: [
    {
      objection: "What does it cost me per pour?",
      answerableOnSite: true,
      ourAnswer:
        "Trade price divided by twenty-five pours. Both numbers exist and neither is published, so the answer currently takes an email and two working days.",
    },
    {
      objection: "What is the minimum, and how often do I have to order?",
      answerableOnSite: true,
      ourAnswer:
        "Six bottles to a case, no split cases. It is in the BrandScript's agreement and nowhere a venue can read it.",
    },
    {
      objection: "Will it still be here in six months?",
      answerableOnSite: false,
      ourAnswer:
        "A one-person supplier is a real risk to a venue. Batch numbers, a named human and a check-in before the case runs out are the only answers that work, and they are answers a person gives, not a page.",
    },
    {
      objection: "Rail space. What comes off to make room?",
      answerableOnSite: false,
      ourAnswer:
        "Nothing comes off. It replaces the jar that was never a purchased line in the first place — which is the argument, and it needs the side-by-side pour to land.",
    },
    {
      objection: "Can I get it cheaper if I take more?",
      answerableOnSite: true,
      ourAnswer:
        "No. One published number for every venue of the same size. Publishing it is what makes that promise checkable.",
    },
  ],
  price: {
    anchor:
      "Cost per pour against the drink's menu price, and the GP percentage that comes out of it.",
    comparedWith: [
      {
        thing: "No 01 HOUSE at trade, per bottle, before GST",
        cents: 939,
        note: "Forty per cent below the GST-exclusive shelf price. Against $6.95 of cost it leaves $2.44 — 26% — which is the number the Flight Plan says does not pay for the hour.",
      },
      {
        thing: "The same bottle at a 30% trade discount",
        cents: 1_096,
        note: "$4.01 a bottle, 36.6%. This is the discount the wings arithmetic points at, and it changes the whole trade case.",
      },
      {
        thing: "A case of six at the published 40%",
        cents: 5_634,
        note: "What a venue actually pays. It is also the entire first order, which is why the acquisition cost has to be measured against a year, not an order.",
      },
      {
        thing: "The catering jar they use now",
        cents: 0,
        note: "The number they will compare against, and it is zero on their sheet. Cost per pour is the only argument that beats free.",
      },
    ],
    unblinkingCents: 1_100,
    deliberateCents: 1_400,
    hiddenCost:
      "Ours, not theirs: at a one-in-five close rate, one live account costs about five approaches — two sample bottles at cost, a delivery and an hour each time, near enough $265. At $2.44 a bottle that account has to ship 109 bottles before it has paid for its own beginning.",
    note: "The venue is not the price-sensitive party in this relationship. We are.",
  },
  repeat: {
    cadence:
      "A case a month, ordered on a Monday, checked in on a week before it runs out.",
    bottlesPerYear: 72,
    whatBringsThemBack: [
      "The serve selling. Five a night at 20ml is six bottles a month, and a line that sells does not get argued about on a Sunday.",
      "A check-in that arrives before the case runs out rather than after, which is the Flight Plan's trade stage five and the only stage that compounds.",
      "The pour cost holding. One price, no surprises, no renegotiation.",
      "Being told when supply is short before an empty shelf tells them — No 04 especially.",
    ],
    whatLosesThem: [
      "A month of silence. A venue that runs out and does not hear from us has already replaced us with a jar.",
      "A price that moves.",
      "A split case, once, which teaches them the rule was never real.",
      "The bar manager leaving. The relationship is with a person, so the account has to be re-won on their last day.",
    ],
    theCheck:
      "Accounts reordering on schedule, and accounts gone quiet. Both are counted, and the second one is the one that matters.",
  },
  counted: {
    channel: "On-premise trade — draft orders at the published trade price",
    countedBy: [
      "nzCafesRestaurants",
      "nzBarsAndClubs",
      "nzVenueListRate",
      "bottlesPerVenueYear",
      "somTradeShare",
      "tradeCloseRate",
      "tradeDiscountRate",
    ],
    bottlesInput: "bottlesPerVenueYear",
    howMany:
      "2,058 venues in the SAM would list a brine. The year-2 plan needs 1,980 trade bottles: 83 accounts at the model's 24 bottles a year, or 28 accounts at the case-a-month this avatar describes. The second number is the one that pays for the hour — see the contradiction below.",
    capacityShare:
      "1,980 bottles of the 7,920 made in year 2 — 25%, and the quarter that advertises itself on somebody else's printed list.",
  },
  notThisPerson: [
    "The 200-seat group venue with a procurement process. The volume looks good and the terms would take the margin that is left.",
    "The café with no spirits licence. There is no serve for this to replace.",
    "The venue that wants an exclusive or a bespoke blend. Two production days do not stretch to a private label.",
    "The bar that wants a sample and a price and has never poured the serve. They are a tasting, not an account.",
  ],
};

/* -------------------------------------------- where the strategy disagrees */

const CONTRADICTIONS: readonly StrategyContradiction[] = [
  {
    id: "venue-size-versus-cost-to-serve",
    between: [
      "market.inputs.bottlesPerVenueYear = 24",
      "avatars.b2b.repeat.bottlesPerYear = 72",
    ],
    says: "The market model counts a listing venue at 24 bottles a year, which is four cases and about $58 of gross margin at the published 40% trade discount. The Flight Plan's own wings arithmetic says an account costs an hour to sample, deliver and invoice, and at a one-in-five close rate a live account costs about five approaches — near enough $265 of bottles, delivery and time. A 24-bottle account takes more than four years to repay that. The avatar is written at 72 bottles a year because that is the smallest venue this company can afford to serve.",
    wrongOne:
      "The input is being asked to do two jobs and can only do one. As the average across all 2,058 venues that would list a brine, 24 is defensible and the SAM should keep it. As the size of the accounts the trade arm actually opens, it is wrong — those are qualified venues that already pour the serve nightly. The SOM should not be counting 83 accounts at the SAM's average; it should be counting about 28 accounts at the avatar's 72.",
    settledBy:
      "The first six real accounts. Count bottles per account per quarter, and either raise bottlesPerVenueYear for the SOM or split it into two inputs — one for the reachable average, one for the accounts we open.",
  },
  {
    id: "published-price-that-is-not-published",
    between: [
      "brandScript.audiences.b2b.plan.agreement[0]",
      "the live storefront",
    ],
    says: "The B2B agreement promises trade pricing is one published number, the same for every venue of a size, so nobody finds out later that someone else got a better one. On the storefront the trade section is an email address, and the homepage offers pricing and minimums inside two working days.",
    wrongOne:
      "The storefront. The promise is the right one — it is the whole reason a venue trusts a one-person supplier — and a price sent privately on request is not a published price, whatever the number turns out to be.",
    settledBy:
      "Publishing the trade price list. It is already a dated next action in the Flight Plan, and the audit check b2b-trade-price-published stays red until it exists.",
  },
  {
    id: "menu-claim-with-no-door",
    between: ["the homepage hero", "avatars.b2b.triggers"],
    says: "The first line a stranger reads says the brine is good enough to put on a menu. A venue that agrees has nowhere to go: /wholesale is not deployed, and no page a venue lands on carries a trade link that is not an email address.",
    wrongOne:
      "Not the claim — it is true and it is the positioning. The gap is the door. A trade claim with no trade destination spends the one moment a venue is interested.",
    settledBy:
      "A /wholesale page carrying the price, the case size and the sample offer. Until it exists, four audit checks stay red for one missing route.",
  },
  {
    id: "recipe-library-that-is-not-a-place",
    between: [
      "brandScript.audiences.b2c.calls.transitional",
      "the product pages",
    ],
    says: "Every product page counts the recipes for that bottle — seven for No 02 — and the BrandScript's transitional call is the recipe library. There is no /recipes route, so the low-risk yes has nowhere to happen and the count reads as a promise the site does not keep.",
    wrongOne:
      "The site. The transitional call is correct and is the only thing on the storefront that could earn an email address honestly; the recipes exist as data already.",
    settledBy:
      "Shipping /recipes. The BrandScript next action already has a date on it; the audit check b2c-recipe-library-resolves is the test.",
  },
];

/* --------------------------------------------------------- what to do next */

const AVATAR_NEXT_ACTIONS: readonly NextAction[] = [
  {
    id: "publish-the-trade-page",
    action:
      "Ship /wholesale with the trade price, the six-bottle case, the pour cost and the sample offer on one page.",
    because:
      "Five of the seventeen audit checks are red for one missing route, and the B2B avatar's two strongest buying triggers both need a page to land on. It is also the only way the BrandScript's promise of one published price becomes true.",
    by: "2026-09-30",
    doneWhen:
      "b2b-trade-destination-resolves, b2b-trade-price-published, b2b-case-and-minimum-named, b2b-trade-path-from-a-product-page and b2b-menu-promise-has-a-door all pass.",
  },
  {
    id: "put-the-delivery-cost-on-the-page",
    action:
      "State what delivery costs and which day it leaves, on the shop page and every product page.",
    because:
      "The B2C avatar's largest unanswered objection is the courier charge on an $18 bottle, and it is unanswered until the last step of a checkout they have already left.",
    by: "2026-09-15",
    doneWhen: "b2c-delivery-cost-on-the-path passes.",
  },
  {
    id: "move-the-serve-count-above-the-button",
    action:
      "Put the pours-per-bottle line above the buy control rather than under it.",
    because:
      "It is the arithmetic that turns $20 into eighty cents a drink, and it is the sentence that answers the avatar's third objection. It currently sits about twenty characters too late.",
    by: "2026-09-15",
    doneWhen: "b2c-price-per-drink-before-the-ask passes.",
  },
  {
    id: "count-bottles-per-account",
    action:
      "Record bottles per account per quarter for the first six trade accounts, then settle bottlesPerVenueYear.",
    because:
      "The trade arm is sized on 24 bottles a year and the avatar is written at 72. One of the two is wrong, and every trade decision — how many accounts, how many approaches a week, whether 40% survives — hangs off which.",
    by: "Six accounts, or 2027-03-31, whichever comes first",
    doneWhen:
      "Six accounts have four quarters of order history and the market input has been either confirmed or split in two.",
  },
  {
    id: "ask-the-ten-hosts",
    action:
      "Ask ten people who already make drinks at home what they would pay to have a bottle delivered, and what they thought the brine was for.",
    because:
      "The B2C avatar's price ceiling and its hidden-cost claim are both estimates, and the second one — that courier cost decides the order — is the single assumption the whole direct channel rests on.",
    by: "2026-10-15",
    doneWhen:
      "Ten answers are recorded, and price.unblinkingCents and price.hiddenCost either survive them or are rewritten here.",
  },
];

export const AVATARS: AudienceAvatars = {
  version: "1.0.0",
  purpose:
    "The two people this company sells to, described in enough detail to settle an argument — so that the storefront can be tested against them rather than against taste, and so the AI team writes to a person instead of to an audience.",
  avatars: { b2c: FRIDAY_HOST, b2b: BAR_MANAGER },
  contradictions: CONTRADICTIONS,
  nextActions: AVATAR_NEXT_ACTIONS,
};
