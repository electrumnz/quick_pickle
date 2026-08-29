/**
 * The HALF SOUR Small Business Flight Plan.
 *
 * Donald Miller's six parts, in the order an aeroplane needs them: the cockpit
 * points it somewhere, the two engines pull it forward, the wings hold it up,
 * the body carries the load, and the fuel tanks decide how far it goes. The
 * metaphor earns its place because it makes neglect diagnosable — a business
 * that feels wrong is usually one part starved, and the parts are not
 * interchangeable. Marketing cannot fix a wing.
 *
 * Two things about this particular business shape every section:
 *
 *  1. **There is one human.** The body section is her actual week, hour by
 *     hour, because in a company of one the overhead IS the calendar. Any plan
 *     that needs a seventh working day is not a plan.
 *  2. **There are two sales processes, not one.** Direct to a person, and to a
 *     venue through a Shopify draft order at trade pricing. They have different
 *     stages, different cadences, and — as the wings section shows — very
 *     different margins.
 *
 * Money is integer cents throughout. The margins in `wings` are computed by
 * {@link wingEconomics}, not typed in, so a price change cannot leave a stale
 * percentage sitting next to it.
 */

import type {
  CashFlowSection,
  Confidence,
  FlightPlan,
  LeadershipSection,
  MarketingSection,
  NextAction,
  OperationsSection,
  ProductsSection,
  ProductWing,
  SalesSection,
} from "./types";

/* ------------------------------------------------ cockpit — leadership */

const COCKPIT: LeadershipSection = {
  part: "cockpit",
  aircraft: "Cockpit",
  discipline: "Leadership",
  purpose:
    "Where the plane is going, and the handful of rules that settle an argument when you are tired and nobody else is there to ask.",
  failureMode:
    "Without it every decision is made from scratch, so the business drifts toward whatever was loudest that week — and in a company of one, that is usually the inbox.",
  mission: {
    goal: "Put HALF SOUR behind 83 New Zealand bar lists and in 2,000 New Zealand kitchens",
    by: "31 August 2028",
    because: [
      "A drink made at home deserves the same ingredient a bar would reach for, and nobody in this country is making it.",
      "A one-person company can own a category that a large one will not bother to enter, and brine is small enough to stay ours.",
      "Every bottle is made, filled and posted by the person whose name is on the company, and that stops being true the moment we grow faster than she can make.",
    ],
    statement:
      "We will put HALF SOUR behind 83 New Zealand bar lists and in 2,000 New Zealand kitchens by 31 August 2028, because a drink made at home deserves the same ingredient a bar would reach for, because a one-person company can own a category a large one will not bother to enter, and because every bottle is still made by the person whose name is on it.",
  },
  guidingPrinciples: [
    {
      principle: "Culinary, never clinical.",
      settles:
        "Every copy question. If a sentence would sit comfortably in a cookbook it ships; if it would sit comfortably in a pharmacy it does not, whatever it would do for the numbers.",
    },
    {
      principle: "The bar list before the billboard.",
      settles:
        "Where the next spare hour goes. One venue account is 24 bottles a year and it advertises itself on a printed list; an hour of posting is neither.",
    },
    {
      principle: "Make it true, then say it.",
      settles:
        "Provenance and supplier stories. No sourcing claim is published before the relationship behind it exists — the plan is written around that constraint rather than against it.",
    },
    {
      principle: "Protect Sunday.",
      settles:
        "Capacity arguments. The ceiling is two production days a week. Growth past it comes from price or a co-packer, never from a seventh day — and the market model is built on that number, so breaking the rule breaks the plan.",
    },
    {
      principle: "One decision, written down.",
      settles:
        "What the AI team may do alone. Anything a customer could see waits for a human, and the reason is recorded next to the decision, so the same argument is not had twice.",
    },
  ],
  keyCharacteristics: [
    {
      characteristic: "Exact",
      looksLike:
        "Measures, not splashes. Batch numbers, not approximations. A price list with one number on it.",
    },
    {
      characteristic: "Generous with the recipe",
      looksLike:
        "The whole method is given away, including the fix for when it goes wrong. The bottle is the thing being sold, not the knowledge.",
    },
    {
      characteristic: "Bored by hype",
      looksLike:
        "No exclamation marks, no pickle puns, no claim that needs a footnote. Restraint is the differentiator in a category built on novelty.",
    },
  ],
};

/* -------------------------------------------- right engine — marketing */

const RIGHT_ENGINE: MarketingSection = {
  part: "right-engine",
  aircraft: "Right engine",
  discipline: "Marketing",
  purpose:
    "How a stranger finds out this exists and is given something worth having before they are asked for money.",
  failureMode:
    "Starve it and the business survives on the people who already know, which in a one-person company is about forty people and their patience.",
  // copy-audit-approved: R-13 (repeats the BrandScript one-liner verbatim, which names the martini as the drink)
  oneLiner:
    "Most home martinis are let down by whatever is left in the olive jar. HALF SOUR makes brine built for the glass — so the drink you pour on a Tuesday is the drink you poured on Saturday.", // copy-audit-approved: R-13 (drink or spirit named as an occasion and an ingredient; no quantity, no effect, no under-18 framing — ASA alcohol code checked)
  leadGenerator: {
    name: "The Brine Book",
    promise:
      "Twelve drinks and four dishes, each with a measure, a time, and what to do when it goes wrong.",
    format:
      "A PDF behind an email address, and the same content on /recipes with nothing asked for at all. The page is the marketing; the PDF is the reason to leave an address.",
  },
  nurtureSequence: [
    {
      email: 1,
      subject: "The measure on the bottle",
      job: "Deliver the thing they asked for, and nothing else. No sell.",
    },
    {
      email: 2,
      // copy-audit-approved: R-13 (names the martini as the drink the email teaches)
      subject: "Why your martini goes cloudy",
      job: "Teach one specific fix. Establish authority by being useful about a problem they already have.",
    },
    {
      email: 3,
      subject: "What a brine is for in a pan",
      job: "Widen the use case past drinks, which doubles the number of weeks a bottle gets opened.",
    },
    {
      email: 4,
      subject: "The four bottles, and which one is yours",
      job: "First soft direct call. Names the plan's step one — pick the brine for the drink you actually make.",
    },
  ],
  salesSequence: [
    {
      email: 1,
      subject: "The problem, said plainly",
      job: "Open on the external problem from the BrandScript, in the customer's words.",
    },
    {
      email: 2,
      subject: "One person made this",
      job: "Empathy and authority — the guide, not the hero.",
    },
    {
      email: 3,
      subject: "Three steps, then you are done",
      job: "The process plan, verbatim.",
    },
    {
      email: 4,
      subject: "What you are avoiding",
      job: "The stakes. Failure, lightly — one line, no drama.",
    },
    {
      email: 5,
      subject: "Order a bottle",
      job: "The direct call, on its own, with nothing else in the email.",
    },
  ],
  channels: [
    {
      channel: "Instagram",
      cadence: "Three posts a week, one of them a recipe card",
      job: "Show the pour and the plate. It is a visual category and this is where the Friday host already is.",
      derivedFrom: "brandScript.audiences.b2c.plan.process",
    },
    {
      channel: "The recipe library",
      cadence: "One new recipe a fortnight",
      job: "The transitional call to action and the only durable search asset the business owns.",
      derivedFrom: "brandScript.audiences.b2c.calls.transitional",
    },
    {
      channel: "Email",
      cadence: "Fortnightly, plus the two sequences",
      job: "The list is the only audience nobody else can switch off.",
      derivedFrom: "brandScript.derived.oneLiner",
    },
    {
      channel: "The trade spec card",
      cadence: "Reprinted when the trade price changes, and never otherwise",
      job: "One page: the measure, the cost per serve, the case price. It is the marketing that closes venues.",
      derivedFrom: "brandScript.derived.tradeOneLiner",
    },
    {
      channel: "Market stalls",
      cadence: "Fortnightly, Saturday",
      job: "The only channel where a stranger tastes it before deciding. Highest conversion, lowest reach, and it costs a whole day.",
      derivedFrom: "brandScript.audiences.b2c.problem.internal",
    },
  ],
};

/* ------------------------------------------------- left engine — sales */

const LEFT_ENGINE: SalesSection = {
  part: "left-engine",
  aircraft: "Left engine",
  discipline: "Sales",
  purpose:
    "The named steps that turn interest into money, written down so that a slow month can be diagnosed instead of worried about.",
  failureMode:
    "Without a process, selling becomes a mood. In a business with two very different buyers, it also becomes two moods that get confused with each other.",
  processes: [
    {
      id: "b2c",
      name: "Direct to a person",
      mechanism:
        "Shopify checkout, courier-delivered. Everything is self-service; there is no conversation to have and no time to have it in.",
      cadence:
        "The market model's year 2 target is 4,356 direct bottles, which at 2.4 bottles an order is about 151 orders a month — roughly five a day, all packed on Tuesday.",
      stages: [
        {
          stage: 1,
          name: "Found us",
          qualifyingQuestion:
            "Did they arrive on a page that says what this is for, rather than what it is?",
          action:
            "Recipe page or a post. The one-liner is above the fold on every entry point.",
          measure: "Sessions on a recipe page",
        },
        {
          stage: 2,
          name: "Took the recipe",
          qualifyingQuestion: "Did they take the low-risk yes?",
          action: "The Brine Book, for an email address.",
          measure: "Email addresses added",
        },
        {
          stage: 3,
          name: "First bottle",
          qualifyingQuestion:
            "Did they buy one bottle for the drink they actually make?",
          action:
            "The direct call, on a product page that names the serve before the ingredients.",
          measure: "First orders, and which SKU opened the account",
        },
        {
          stage: 4,
          name: "Second order",
          qualifyingQuestion:
            "Did they come back inside twelve weeks without a discount?",
          action:
            "Post-purchase email at week six with the recipe for the bottle they bought.",
          measure: "Repeat rate at 12 weeks",
        },
      ],
    },
    {
      id: "b2b",
      name: "Trade, through draft orders",
      mechanism:
        "A Shopify draft order at trade pricing, sent for approval before it becomes an invoice. That is deliberate: the venue sees the price, the terms and the case quantity on the record before anyone commits, which is exactly what the BrandScript's agreement plan promises.",
      cadence:
        "The market model's year 2 target is 83 live accounts, which at a one-in-five close rate is 4 approaches a week for two years. That is Thursday, and it is why Thursday is protected.",
      stages: [
        {
          stage: 1,
          name: "Identified",
          qualifyingQuestion:
            "Spirits-led list, 40 seats or more, and a serve already on the menu that this replaces?",
          action:
            "Added to the trade list with the reason written next to it. The B2B agent builds this list from the market model's venue segment.",
          measure: "Qualified venues on the list",
        },
        {
          stage: 2,
          name: "Sampled",
          qualifyingQuestion:
            "Did two bottles and a spec card reach the person who signs off the list?",
          action:
            "Delivered by hand where the drive is under 30 minutes; couriered otherwise.",
          measure: "Samples placed, and with whom by name",
        },
        {
          stage: 3,
          name: "Poured against the jar",
          qualifyingQuestion:
            "Did the bar team taste them side by side, at a line-up?",
          action:
            "Ten minutes before service. If it does not happen inside two weeks, the sample is dead and the venue goes back to the list.",
          measure: "Line-ups attended",
        },
        {
          stage: 4,
          name: "First case",
          qualifyingQuestion:
            "Did a draft order for six bottles get approved at the published trade price?",
          action:
            "Draft order raised in Shopify, terms attached, invoice on approval.",
          measure: "First cases, and days from sample to case",
        },
        {
          stage: 5,
          name: "On cadence",
          qualifyingQuestion:
            "Do we know how long a case lasts them, and are we in touch a week before it runs out?",
          action:
            "Reorder date set from their covers. The check-in happens whether or not they answer.",
          measure: "Accounts reordering on schedule, and accounts gone quiet",
        },
      ],
    },
  ],
};

/* ------------------------------------------------- wings — the products */

/**
 * Per-bottle costs.
 *
 * Every figure is an estimate and labelled as one — none of them has been
 * checked against a real invoice, and the first production run should replace
 * the lot. They are here rather than absent because a margin you can argue with
 * beats a margin nobody has written down.
 */
const WINGS: readonly ProductWing[] = [
  {
    sku: "HS-01-500",
    name: "No 01 HOUSE",
    job: "The everyday one. The bottle that gets opened for cooking as well as drinking, which is what makes it the volume line.",
    shelfPriceCents: 1_800,
    costBreakdownCents: [
      { item: "Cucumber, dill, peppercorn, garlic, bay, salt", cents: 240 },
      { item: "500ml bottle, cap, label", cents: 185 },
      { item: "Carton and outer, amortised", cents: 60 },
      { item: "Direct labour at $28/hr", cents: 210 },
    ],
    confidence: "estimate",
    note: "Lowest cost, lowest price, highest volume. This is the bottle the business is priced around.",
  },
  {
    sku: "HS-02-500",
    name: "No 02 DIRTY",
    job: "One drink. Filtered clear so it will not cloud a stirred one, which is the specific failure it was built to fix.",
    shelfPriceCents: 2_000,
    costBreakdownCents: [
      {
        item: "Cornichon, green olive, lemon peel, coriander seed",
        cents: 310,
      },
      { item: "500ml bottle, cap, label", cents: 185 },
      { item: "Carton and outer, amortised", cents: 60 },
      { item: "Direct labour, including the filtration step", cents: 210 },
    ],
    confidence: "estimate",
    // copy-audit-approved: R-13 (names the martini as the serve this SKU is built for; a product-fit note, no consumption framing)
    note: "The entry SKU for both audiences, because the martini is the drink people already know they are getting wrong. Every trade conversation starts here.",
  },
  {
    sku: "HS-03-500",
    name: "No 03 SMOKE",
    job: "Heat and smoke. The bottle that wins the taste test at a market stall and loses the reorder if the customer only drinks one style.",
    shelfPriceCents: 2_200,
    costBreakdownCents: [
      { item: "Chipotle, manzano, cumin, bay", cents: 355 },
      { item: "500ml bottle, cap, label", cents: 185 },
      { item: "Carton and outer, amortised", cents: 60 },
      { item: "Direct labour, including the smoking step", cents: 250 },
    ],
    confidence: "estimate",
    note: "The smoking step is the longest part of any run and it is the reason a mixed production day yields fewer bottles than a single-line one.",
  },
  {
    sku: "HS-04-500",
    name: "No 04 WILD",
    job: "Seafood. The bottle that says the range has a top end, and the one that cannot be scaled.",
    shelfPriceCents: 2_600,
    costBreakdownCents: [
      { item: "Cucumber, native botanicals, lemon peel, salt", cents: 520 },
      { item: "500ml bottle, cap, label", cents: 185 },
      { item: "Carton and outer, amortised", cents: 60 },
      { item: "Direct labour, including the hand-sort", cents: 250 },
    ],
    confidence: "estimate",
    note: "Supply-limited by leaf availability, not by demand, and it has no label artwork yet. It should be sold as scarce because it is, not as a marketing device.",
  },
  {
    sku: "HS-SET-3",
    name: "The Full Set",
    job: "Acquisition. Three bottles in one parcel is the only direct order shape whose courier cost is not eating the margin.",
    shelfPriceCents: 5_400,
    costBreakdownCents: [
      { item: "No 01 + No 02 + No 03 at cost", cents: 2_310 },
      { item: "Gift carton and mailer", cents: 220 },
    ],
    confidence: "estimate",
    note: "Worst gross margin in the range and the strongest direct contribution per parcel, because the courier is charged once. See the finding below.",
  },
];

/** Computed unit economics for one wing. Never typed in by hand. */
export interface WingEconomics {
  readonly netShelfCents: number;
  readonly cogsCents: number;
  readonly directMarginCents: number;
  readonly directMarginPercent: number;
  readonly tradePriceCents: number;
  readonly tradeMarginCents: number;
  readonly tradeMarginPercent: number;
}

export function wingEconomics(
  wing: ProductWing,
  gstRate: number,
  tradeDiscountRate: number,
): WingEconomics {
  const netShelfCents = Math.round(wing.shelfPriceCents / (1 + gstRate));
  const cogsCents = wing.costBreakdownCents.reduce(
    (total, line) => total + line.cents,
    0,
  );
  const tradePriceCents = Math.round(netShelfCents * (1 - tradeDiscountRate));
  const directMarginCents = netShelfCents - cogsCents;
  const tradeMarginCents = tradePriceCents - cogsCents;
  const pct = (part: number, whole: number) =>
    whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
  return {
    netShelfCents,
    cogsCents,
    directMarginCents,
    directMarginPercent: pct(directMarginCents, netShelfCents),
    tradePriceCents,
    tradeMarginCents,
    tradeMarginPercent: pct(tradeMarginCents, tradePriceCents),
  };
}

const PRODUCTS: ProductsSection = {
  part: "wings",
  aircraft: "Wings",
  discipline: "Products and their margins",
  purpose:
    "What each bottle is for, what it costs to make, and what is left over — which is the number that decides whether the other five parts are worth running.",
  failureMode:
    "Weak wings and the whole plane works hard to stay up. A range that all sells and none of which pays is the hardest failure to see, because the top line looks fine.",
  wings: WINGS,
  findings: [
    "At a 40% trade discount the margin on No 01 is about a quarter of the trade price. That does not pay for the hour it takes to sample, deliver and invoice a venue. Either the discount comes down to about 30%, or a case is six bottles and never fewer — the market model assumes the second.",
    "The Full Set has the weakest gross margin in the range and the strongest contribution per parcel, because courier and packaging are charged once for three bottles rather than once for two. It is the direct order shape to push, in spite of the percentage.",
    "A single-bottle direct order is close to break-even after courier, packaging and payment fees. Either the shipping is charged, or the smallest direct offer is three bottles.",
    "No 04 is the highest margin per bottle and cannot be scaled, so it should never be discounted and never be a lead offer. It is a range-topper, and its job is to make No 02 look reasonable.",
  ],
};

/* ------------------------------------- body — overhead and operations */

const BODY: OperationsSection = {
  part: "body",
  aircraft: "Body",
  discipline: "Overhead and operations",
  purpose:
    "The weight the business carries whether or not it sells anything this week — which in a company of one is mostly her calendar.",
  failureMode:
    "Overload it and the plane will not climb. The tell is not a cash-flow problem; it is a week where nothing was made because everything else had to be done.",
  week: [
    {
      day: "Monday",
      work: "Production day 1. Cure, strain, fill, cap, label, batch-code, clean down.", // copy-audit-approved: R-15 (a kitchen clean-down step in the production day, not a composition claim)
      hours: 9,
    },
    {
      day: "Tuesday",
      work: "Orders and post. Pick, pack, courier drop, customer email, restock the shop.",
      hours: 5,
    },
    {
      day: "Wednesday",
      work: "Production day 2. Same again, usually a different line.",
      hours: 9,
    },
    {
      day: "Thursday",
      work: "Trade. Four venue approaches, sample drops, line-ups, draft orders, invoices.",
      hours: 6,
    },
    {
      day: "Friday",
      work: "Content and books. Shoot, write, schedule, reconcile, file, review what the AI team drafted.",
      hours: 5,
    },
    {
      day: "Saturday",
      work: "Market stall, fortnightly. Setup, six hours of tasting and selling, pack down.",
      hours: 7,
    },
    {
      day: "Sunday",
      work: "Off. This is a line item, not a gap. The plan is built on it.",
      hours: 0,
    },
  ],
  fixedOverhead: [
    {
      item: "Commercial kitchen hire, two days a week",
      centsPerMonth: 65_000,
      confidence: "estimate",
    },
    {
      item: "Product and public liability insurance",
      centsPerMonth: 9_500,
      confidence: "estimate",
    },
    {
      item: "Food Control Plan registration and verification, amortised",
      centsPerMonth: 5_500,
      confidence: "estimate",
    },
    { item: "Shopify and apps", centsPerMonth: 8_500, confidence: "estimate" },
    {
      item: "Domain, email and hosting",
      centsPerMonth: 2_500,
      confidence: "estimate",
    },
    {
      item: "Accounting software and the accountant",
      centsPerMonth: 18_000,
      confidence: "estimate",
    },
    {
      item: "Phone and internet, business share",
      centsPerMonth: 6_000,
      confidence: "estimate",
    },
    {
      item: "Vercel, Supabase and the AI team's model spend",
      centsPerMonth: 7_000,
      confidence: "estimate",
    },
    {
      item: "Cool store and dry storage",
      centsPerMonth: 15_000,
      confidence: "estimate",
    },
  ],
  perOrderCosts: [
    {
      item: "Courier, urban, one parcel",
      cents: 850,
      note: "The same whether the parcel holds one bottle or three. This single fact is why The Full Set exists.",
    },
    {
      item: "Mailer, void fill and label",
      cents: 220,
      note: "Glass in a courier network needs real packaging, and the cheap version costs more in breakages.",
    },
    {
      item: "Payment processing",
      cents: 91,
      note: "About 2.9% plus 30c on a $21 order. Scales with the order value, so it is worse per bottle on singles.",
    },
  ],
  constraints: [
    "Two production days a week is the hard ceiling. At 120 bottles a day and 44 working weeks that is 10,560 bottles a year, and no amount of marketing moves it.",
    "One person is also the packer. Every hour of direct order growth takes an hour from trade or from production, and trade is worth 24 bottles a year per hour spent.",
    "The kitchen is hired, so a production day cannot be moved at short notice and a missed Monday cannot be made up on Sunday.",
    "No 04 is limited by leaf supply, which is a constraint on the range and not on the week.",
  ],
};

/* ------------------------------------------- fuel tanks — the cash flow */

const FUEL_TANKS: CashFlowSection = {
  part: "fuel-tanks",
  aircraft: "Fuel tanks",
  discipline: "Cash flow",
  purpose:
    "Where the money sits between coming in and going out, so that a good month cannot be spent twice and a bad one does not stop the plane.",
  failureMode:
    "One account for everything. It always looks like there is money, right up until GST is due and there is not.",
  accounts: [
    {
      account: "1. Operating",
      holds:
        "Every dollar the business takes, on the way in. Nothing is paid from anywhere else.",
      rule: "Everything lands here first. When the balance is above the buffer below, the excess is swept on the same day each month — not when it feels comfortable.",
    },
    {
      account: "2. Personal",
      holds: "Her wage.",
      rule: "A fixed amount on a fixed date, whether it was a good month or a bad one. A wage that moves with takings is not a wage, it is a mood.",
    },
    {
      account: "3. Tax",
      holds: "GST collected, and income tax set aside.",
      rule: "15% of every GST-inclusive sale moves here the week it lands, before input credits are netted off. Those credits become the buffer instead of a surprise.",
    },
    {
      account: "4. Business profit",
      holds: "What is left after the wage and the tax.",
      rule: "Swept quarterly. It is not spending money — it is the account that proves the business works, and it pays for the co-packer conversation when it comes.",
    },
    {
      account: "5. Investment capital",
      holds: "Money earmarked for one named thing.",
      rule: "Nothing goes in without the thing being named first: the WILD label artwork, the second brining vessel, the trade show stand. A pot with no name gets spent on whatever breaks.",
    },
  ],
  operatingBufferMonths: 3,
  gst: {
    ratePercent: 15,
    registrationThresholdCents: 6_000_000,
    filingBasis: "Two-monthly, payments basis",
    note: "Year 1 modelled net revenue is above the $60,000 threshold, so registration becomes compulsory during year 1 rather than at the end of it. Registration is required within 21 days of expecting to cross it — the trigger is the expectation, not the crossing. Displayed retail prices stay GST-inclusive; trade prices are quoted GST-exclusive and must carry '+ GST' on the same line.",
  },
  rules: [
    "Hold three months of operating cost in the operating account before sweeping anything, and step it to six months once year 2 closes. Six is the target; three is what is reachable first, and a target that is not reachable gets ignored.",
    "Sweep on a date, not on a feeling. The same day every month, whatever the balance looks like.",
    "The tax account is not a line of credit. If a purchase needs money that is sitting in it, the answer is no.",
    "Stock is cash in glass. A production run of a line that is not selling is the fastest way for a profitable month to end with an empty bank account.",
    "Once residual income tax passes $5,000 in a year, provisional tax starts the following year and the payment dates move. Ask the accountant before the first year closes, not after.",
  ],
};

/* --------------------------------------------------------- next actions */

const FLIGHT_PLAN_NEXT_ACTIONS: readonly NextAction[] = [
  {
    id: "open-the-five-accounts",
    action:
      "Open the five bank accounts and set the monthly sweep on a fixed date.",
    because:
      "It is the cheapest of every action in this plan and the one that stops a good month being spent twice. It also has to be in place before GST registration, not after.",
    by: "2026-09-12",
    doneWhen:
      "Five accounts exist, the sweep is a calendar entry, and the first sweep has happened.",
  },
  {
    id: "settle-trade-terms",
    action:
      "Publish one trade price list with a six-bottle case minimum on it.",
    because:
      "The wings arithmetic shows a 40% discount on single bottles does not pay for the hour it takes to service the account. The B2B sales process, the market model's trade arm and the BrandScript's agreement plan all assume this document exists.",
    by: "Before the first trade order is raised",
    doneWhen:
      "The list is a PDF, the same number is in Shopify's trade price rules, and the spec card quotes it.",
  },
  {
    id: "cost-a-real-run",
    action:
      "Cost one real production run against invoices and replace the estimates in the wings section.",
    because:
      "Every cost line in this plan is an estimate. The margins drive the trade discount decision, the direct order shape and the whole market model, and none of them is safe until one run has been costed properly.",
    by: "After the next production run",
    doneWhen:
      "Each cost line reads confidence: derived, with the run it was costed from.",
  },
  {
    id: "protect-thursday",
    action:
      "Put four venue approaches in the calendar for every Thursday, as recurring appointments.",
    because:
      "83 accounts at a one-in-five close rate is exactly four approaches a week for two years. It is the only line in this plan that fails silently — nothing breaks on the week it is skipped, and the target is gone by month eighteen.",
    by: "2026-09-05",
    doneWhen:
      "The recurring block exists and the trade list has four named venues in it every Thursday morning.",
  },
];

/* -------------------------------------------------------------- the plan */

export const FLIGHT_PLAN: FlightPlan = {
  version: "1.0.0",
  purpose:
    "A one-page map of the six parts of the business, so that when something feels wrong you can tell which part is starved — instead of working harder on the part that already works.",
  cockpit: COCKPIT,
  rightEngine: RIGHT_ENGINE,
  leftEngine: LEFT_ENGINE,
  wings: PRODUCTS,
  body: BODY,
  fuelTanks: FUEL_TANKS,
  nextActions: FLIGHT_PLAN_NEXT_ACTIONS,
};

/** Total fixed overhead a month, computed rather than asserted. */
export function monthlyOverheadCents(plan: FlightPlan = FLIGHT_PLAN): number {
  return plan.body.fixedOverhead.reduce(
    (total, line) => total + line.centsPerMonth,
    0,
  );
}

/** Hours in the founder's modelled week. Also computed. */
export function weeklyHours(plan: FlightPlan = FLIGHT_PLAN): number {
  return plan.body.week.reduce((total, block) => total + block.hours, 0);
}

/** Kept exported so the admin can label an estimate without re-deriving it. */
export const ESTIMATE: Confidence = "estimate";
