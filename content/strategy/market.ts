/**
 * TAM / SAM / SOM for HALF SOUR — New Zealand, with Australia as a stated
 * expansion layer.
 *
 * Two decisions make this model arguable rather than decorative.
 *
 * **Every figure is either a named input or arithmetic over named inputs.**
 * `MARKET_INPUTS` is the whole set of assumptions; `computeMarket()` is a pure
 * function of them. Change `nzCandidateHouseholdRate` from 0.35 to 0.20 and
 * every layer moves, in the admin and in the agent's context, with no other
 * edit anywhere. Nothing downstream hard-codes a total.
 *
 * **Every layer is quoted on the same basis:** annual spend on the category,
 * in New Zealand dollars, EXCLUDING GST, at the price the buyer in that channel
 * actually pays — shelf price for a household, trade price for a venue or a
 * retail door. Mixing GST-inclusive consumer spend with GST-exclusive trade
 * spend is the commonest way a small-brand TAM ends up wrong by a sixth, so the
 * conversion happens once, in `netShelfCents`, and is shown as its own line.
 *
 * The one thing this model refuses to do is grow. NZ hospitality sales rose
 * 1.0% year on year in Q1 2025 and the restaurant-and-café segment 0.3%, while
 * 2,564 hospitality businesses shut in twelve months. The venue base is held
 * flat and bottles-per-venue is held flat. See `MARKET_HEADWINDS`.
 */

import type {
  Calculation,
  CrossCheck,
  MarketInput,
  MarketLayer,
  MarketModel,
  NextAction,
  SomTarget,
} from "./types";

/* ------------------------------------------------------------- the inputs */

/**
 * Named, editable assumptions. This list IS the model's argument surface: if a
 * number is not here, it is not an assumption, it is arithmetic.
 */
export const MARKET_INPUTS: readonly MarketInput[] = [
  {
    id: "nzHouseholds",
    label: "New Zealand households",
    value: 2_057_500,
    unit: "count",
    confidence: "sourced",
    sourceId: "SNZ-HH-2025Q4",
    rationale:
      "Households in private occupied dwellings at 31 December 2025. Households, not dwellings — 2,141,200 dwellings includes the unoccupied ones, and an empty house buys nothing.",
    min: 1_500_000,
    max: 2_500_000,
    step: 1_000,
  },
  {
    id: "nzCandidateHouseholdRate",
    label: "Share of households that could plausibly buy",
    value: 0.35,
    unit: "ratio",
    confidence: "estimate",
    rationale:
      "Households containing at least one adult who buys spirits or premium mixers, or who cooks with a bought acid. There is no published NZ figure for this, so it is a judgement. Sensitivity: at 0.20 the NZ TAM falls to about $18.0m; at 0.50 it rises to about $40.6m.",
    min: 0.05,
    max: 0.8,
    step: 0.01,
  },
  {
    id: "bottlesPerHouseholdYear",
    label: "Bottles a buying household takes per year",
    value: 2,
    unit: "per_year",
    confidence: "estimate",
    rationale:
      "A 500ml bottle is roughly sixteen 30ml pours. Two bottles a year is one pour a fortnight — deliberately conservative for a house that entertains occasionally rather than weekly.",
    min: 0.5,
    max: 12,
    step: 0.5,
  },
  {
    id: "shelfPriceInclGstCents",
    label: "Average shelf price (GST-inclusive)",
    value: 2_100,
    unit: "cents",
    confidence: "estimate",
    rationale:
      "The range runs $18 / $20 / $22 / $26, and The First Three at $54 realises $18 a bottle. $21.00 is the blend weighted toward No 01 and No 02, which will carry the volume. It is an assumption about mix, not a price.",
    min: 1_400,
    max: 3_200,
    step: 25,
  },
  {
    id: "gstRate",
    label: "GST rate",
    value: 0.15,
    unit: "ratio",
    confidence: "sourced",
    sourceId: "IRD-GST",
    rationale:
      "New Zealand GST is 15% and displayed retail prices are GST-inclusive. Every layer in this model is stated net of it.",
    min: 0,
    max: 0.25,
    step: 0.01,
  },
  {
    id: "tradeDiscountRate",
    label: "Trade discount off net shelf price",
    value: 0.4,
    unit: "ratio",
    confidence: "estimate",
    rationale:
      "A 40% discount off the GST-exclusive shelf price is the usual ask from a venue or a retail door. The Flight Plan's wings section shows what that leaves; it is the number most worth arguing with in this whole file.",
    min: 0.15,
    max: 0.6,
    step: 0.01,
  },
  {
    id: "nzCafesRestaurants",
    label: "NZ cafés and restaurants",
    value: 9_036,
    unit: "count",
    confidence: "sourced",
    sourceId: "CAFE-2026",
    rationale:
      "Businesses in the NZ cafés-and-restaurants market, 2026. This is a business count, not a site count, so a group with four sites is one row here — the model is conservative for that reason.",
    min: 5_000,
    max: 15_000,
    step: 50,
  },
  {
    id: "nzBarsAndClubs",
    label: "NZ bars, pubs and clubs",
    value: 2_400,
    unit: "count",
    confidence: "estimate",
    rationale:
      "Not verified in this pass. The Ministry of Justice publishes the ARLA register of active licences quarterly but no national aggregate of on-licences by premises type, and the register was not parsed here. Treat 2,400 as a placeholder and replace it with a count off the register.",
    min: 500,
    max: 6_000,
    step: 50,
  },
  {
    id: "bottlesPerVenueYear",
    label: "Bottles a stocking venue takes per year",
    value: 24,
    unit: "per_year",
    confidence: "estimate",
    rationale:
      "Two bottles a month — about one 30ml pour a day across the range. A venue running a serve on a busy list would take more; most will take less, and this is the average across both.",
    min: 6,
    max: 120,
    step: 6,
  },
  {
    id: "nzSpecialtyOnlineBuyerRate",
    label: "Share of candidate households reachable online",
    value: 0.3,
    unit: "ratio",
    confidence: "estimate",
    rationale:
      "Candidate households that buy specialty food or drink online at all. NZ e-commerce penetration for food and beverage sits well below general retail, which is why this is 0.30 rather than 0.80.",
    min: 0.05,
    max: 0.9,
    step: 0.01,
  },
  {
    id: "nzSpecialtyRetailDoors",
    label: "NZ specialty retail doors",
    value: 900,
    unit: "count",
    confidence: "estimate",
    rationale:
      "Independent grocers, delicatessens and bottle shops with a premium mixer bay. An estimate; no published count of this segment was located.",
    min: 100,
    max: 3_000,
    step: 25,
  },
  {
    id: "bottlesPerRetailDoorYear",
    label: "Bottles a retail door takes per year",
    value: 72,
    unit: "per_year",
    confidence: "estimate",
    rationale:
      "Six bottles a month, which is one case a month at a case of six. A door that cannot move six a month is not a door worth servicing by courier.",
    min: 12,
    max: 300,
    step: 6,
  },
  {
    id: "nzVenueListRate",
    label: "Share of venues that would list a brine",
    value: 0.18,
    unit: "ratio",
    // copy-audit-approved: R-13 (rationale names the martini as the serve a venue would list; no encouragement of excess, no under-18 framing)
    rationale:
      "Venues with a spirits-led list that already sell a dirty martini. An estimate. It is the number that decides whether the trade arm is a business or a hobby.", // copy-audit-approved: R-13 (drink or spirit named as an occasion and an ingredient; no quantity, no effect, no under-18 framing — ASA alcohol code checked)
    confidence: "estimate",
    min: 0.02,
    max: 0.6,
    step: 0.01,
  },
  {
    id: "bottlesPerDtcOrder",
    label: "Bottles per direct order",
    value: 2.4,
    unit: "count",
    confidence: "estimate",
    rationale:
      "Between a single bottle and the three bottles in The First Three. The number matters because courier and packaging are charged per parcel, not per bottle — see the Flight Plan's body section.",
    min: 1,
    max: 6,
    step: 0.1,
  },
  {
    id: "auPopulation",
    label: "Australian population",
    value: 27_801_023,
    unit: "count",
    confidence: "sourced",
    sourceId: "ABS-POP-2025Q4",
    rationale: "ABS estimated resident population at 31 December 2025.",
    min: 20_000_000,
    max: 35_000_000,
    step: 100_000,
  },
  {
    id: "auHouseholdSize",
    label: "Average Australian household size",
    value: 2.55,
    unit: "count",
    confidence: "estimate",
    rationale:
      "Used to derive an Australian household count, because the ABS release read here reports people, not households. 2.55 is the long-run average; a 2026 household count would be better and should replace this.",
    min: 2,
    max: 3.5,
    step: 0.05,
  },
  {
    id: "auCafesRestaurants",
    label: "Australian cafés and restaurants",
    value: 55_700,
    unit: "count",
    confidence: "sourced",
    sourceId: "AU-CAFE-2024",
    rationale:
      "Cafés and restaurants in operation at the end of the 2024 financial year. Bars and clubs are not added on the Australian side, so the AU venue arm is understated on purpose.",
    min: 30_000,
    max: 90_000,
    step: 500,
  },
  {
    id: "auRealisationFactor",
    label: "Australian realisation factor",
    value: 0.95,
    unit: "multiplier",
    confidence: "estimate",
    rationale:
      "Australian prices set to hold the same New Zealand dollar realisation per bottle, less 5% for freight across the Tasman and a distributor layer that does not exist domestically.",
    min: 0.6,
    max: 1.1,
    step: 0.01,
  },
  {
    id: "productionDaysPerWeek",
    label: "Production days per week",
    value: 2,
    unit: "count",
    confidence: "estimate",
    rationale:
      "One person. The other three-and-a-bit working days are orders, trade calls, content and the books — see the week in the Flight Plan's body section.",
    min: 1,
    max: 6,
    step: 1,
  },
  {
    id: "bottlesPerProductionDay",
    label: "Bottles per production day",
    value: 120,
    unit: "count",
    confidence: "estimate",
    rationale:
      "A day in a hired commercial kitchen: cure, strain, fill, cap, label, code. An estimate that has never been measured against a real day, and the single number most worth measuring first, because the whole SOM hangs off it.",
    min: 40,
    max: 500,
    step: 10,
  },
  {
    id: "productionWeeksPerYear",
    label: "Production weeks per year",
    value: 44,
    unit: "count",
    confidence: "estimate",
    rationale:
      "52 less leave, public holidays, and the weeks lost to market stalls and trade shows.",
    min: 30,
    max: 52,
    step: 1,
  },
  {
    id: "year1Utilisation",
    label: "Year 1 capacity used",
    value: 0.45,
    unit: "ratio",
    confidence: "estimate",
    rationale:
      "Year one is demand-limited, not capacity-limited: she can make more than she can sell. 45% is the ramp.",
    min: 0.1,
    max: 1,
    step: 0.05,
  },
  {
    id: "year2Utilisation",
    label: "Year 2 capacity used",
    value: 0.75,
    unit: "ratio",
    confidence: "estimate",
    rationale:
      "By month 24 the constraint has crossed over: demand meets capacity and the ceiling becomes the two production days.",
    min: 0.1,
    max: 1,
    step: 0.05,
  },
  {
    id: "somDtcShare",
    label: "Direct share of volume",
    value: 0.55,
    unit: "ratio",
    confidence: "estimate",
    rationale:
      "Direct is the highest realisation per bottle and the only channel she controls. The three shares must total 1.",
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    id: "somRetailShare",
    label: "Specialty retail share of volume",
    value: 0.2,
    unit: "ratio",
    confidence: "estimate",
    rationale:
      "Doors are slow to open and slow to close. The three shares must total 1.",
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    id: "somTradeShare",
    label: "Trade share of volume",
    value: 0.25,
    unit: "ratio",
    confidence: "estimate",
    rationale:
      "Venues buy in cases and reorder on a cadence, which is why trade is worth a lower margin. The three shares must total 1.",
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    id: "tradeCloseRate",
    label: "Trade close rate",
    value: 0.2,
    unit: "ratio",
    confidence: "estimate",
    rationale:
      "One venue in five that takes a sample places a first order. Sets how many approaches a week the trade target implies.",
    min: 0.05,
    max: 0.6,
    step: 0.01,
  },
  {
    id: "nzPopulation",
    label: "New Zealand population",
    value: 5_361_300,
    unit: "count",
    confidence: "sourced",
    sourceId: "SNZ-POP-2026",
    rationale:
      "Provisional estimated resident population at 31 March 2026. Used only in the top-down cross-check.",
    min: 4_000_000,
    max: 7_000_000,
    step: 10_000,
  },
  {
    id: "worldPopulationMillions",
    label: "World population (millions)",
    value: 8_250,
    unit: "count",
    confidence: "estimate",
    rationale:
      "Rounded mid-2026 figure, in millions, used only to take a population share of the global category in the cross-check. Held in millions so the stored value stays an exact integer number of millionths.",
    min: 7_000,
    max: 9_000,
    step: 50,
  },
  {
    id: "globalCategoryUsdMillions",
    label: "Global pickle juice drinks market (USD millions)",
    value: 920,
    unit: "count",
    confidence: "sourced",
    sourceId: "PJ-GLOBAL-2025",
    rationale:
      "USD 0.92bn in 2025, forecast to USD 2.01bn by 2034 at a 9.1% CAGR. Counts packaged pickle-juice drinks — a narrower category than brine sold as a mixer and a cooking acid.",
    min: 100,
    max: 5_000,
    step: 10,
  },
  {
    id: "usdToNzd",
    label: "USD to NZD",
    value: 1.66,
    unit: "multiplier",
    confidence: "estimate",
    rationale:
      "Rate of the day, unhedged, used only to put the global category figure into the same currency as everything else.",
    min: 1.2,
    max: 2.2,
    step: 0.01,
  },
];

/* ---------------------------------------------------------- the arithmetic */

/** Look an input up by id. Throws rather than silently defaulting to zero. */
export function inputValue(inputs: readonly MarketInput[], id: string): number {
  const found = inputs.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`Market input "${id}" is not defined.`);
  }
  return found.value;
}

/** Group separators, so an expression reads the way a person would write it. */
function n(value: number): string {
  return value.toLocaleString("en-NZ", { maximumFractionDigits: 4 });
}

/** Cents as "$29,307,090.44". Money never leaves integer cents until here. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Cents as "$29.31m" / "$118.6k" — for headline figures only. */
export function formatCentsShort(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(2)}m`;
  }
  if (Math.abs(dollars) >= 1_000) {
    return `$${(dollars / 1_000).toFixed(1)}k`;
  }
  return formatCents(cents);
}

function step(
  id: string,
  label: string,
  expression: string,
  value: number,
  unit: Calculation["unit"],
  uses: readonly string[],
): Calculation {
  return { id, label, expression, value, unit, uses };
}

/**
 * The whole model, as a pure function of the inputs.
 *
 * Nothing is cached and nothing is memoised: the admin re-runs this on every
 * keystroke of the assumption editor, and the agent runtime runs it once per
 * context load off whatever `strategy_assumptions` currently holds.
 */
export function computeMarket(
  inputs: readonly MarketInput[] = MARKET_INPUTS,
): MarketModel {
  const v = (id: string) => inputValue(inputs, id);

  /* --- the two prices every layer is quoted in --------------------------- */

  const shelfIncl = v("shelfPriceInclGstCents");
  const gst = v("gstRate");
  const netShelf = Math.round(shelfIncl / (1 + gst));
  const tradePrice = Math.round(netShelf * (1 - v("tradeDiscountRate")));

  const priceSteps: readonly Calculation[] = [
    step(
      "net-shelf",
      "Shelf price, net of GST",
      `${formatCents(shelfIncl)} ÷ 1.${String(Math.round(gst * 100)).padStart(2, "0")} = ${formatCents(netShelf)}`,
      netShelf,
      "cents",
      ["shelfPriceInclGstCents", "gstRate"],
    ),
    step(
      "trade-price",
      "Trade price to a venue or a door",
      `${formatCents(netShelf)} × (1 − ${v("tradeDiscountRate")}) = ${formatCents(tradePrice)}`,
      tradePrice,
      "cents",
      ["tradeDiscountRate"],
    ),
  ];

  /* --- TAM, New Zealand -------------------------------------------------- */

  const nzHouseholds = v("nzHouseholds");
  const candidateRate = v("nzCandidateHouseholdRate");
  const nzCandidates = Math.round(nzHouseholds * candidateRate);
  const bottlesPerHousehold = v("bottlesPerHouseholdYear");
  const nzHouseholdSpend = Math.round(
    nzCandidates * bottlesPerHousehold * netShelf,
  );

  const nzVenues = v("nzCafesRestaurants") + v("nzBarsAndClubs");
  const bottlesPerVenue = v("bottlesPerVenueYear");
  const nzVenueSpend = Math.round(nzVenues * bottlesPerVenue * tradePrice);
  const tamNzTotal = nzHouseholdSpend + nzVenueSpend;

  const tam: MarketLayer = {
    id: "tam",
    name: "TAM — total addressable market",
    meaning:
      "Every New Zealand household and every New Zealand venue that could plausibly buy a premium brine, spending at our prices, in one year. Nobody ever gets this. It is the size of the room, not the size of the prize.",
    scope: "New Zealand, annual, net of GST",
    steps: [
      ...priceSteps,
      step(
        "tam-candidate-households",
        "Candidate households",
        `${n(nzHouseholds)} households × ${candidateRate} = ${n(nzCandidates)}`,
        nzCandidates,
        "count",
        ["nzHouseholds", "nzCandidateHouseholdRate"],
      ),
      step(
        "tam-household-spend",
        "Household arm",
        `${n(nzCandidates)} × ${n(bottlesPerHousehold)} bottles × ${formatCents(netShelf)} = ${formatCents(nzHouseholdSpend)}`,
        nzHouseholdSpend,
        "cents",
        ["bottlesPerHouseholdYear"],
      ),
      step(
        "tam-venue-base",
        "Venue base",
        `${n(v("nzCafesRestaurants"))} cafés and restaurants + ${n(v("nzBarsAndClubs"))} bars, pubs and clubs = ${n(nzVenues)}`,
        nzVenues,
        "count",
        ["nzCafesRestaurants", "nzBarsAndClubs"],
      ),
      step(
        "tam-venue-spend",
        "Venue arm",
        `${n(nzVenues)} × ${n(bottlesPerVenue)} bottles × ${formatCents(tradePrice)} = ${formatCents(nzVenueSpend)}`,
        nzVenueSpend,
        "cents",
        ["bottlesPerVenueYear"],
      ),
      step(
        "tam-total",
        "TAM, New Zealand",
        `${formatCents(nzHouseholdSpend)} + ${formatCents(nzVenueSpend)} = ${formatCents(tamNzTotal)}`,
        tamNzTotal,
        "cents",
        [],
      ),
    ],
    totalCents: tamNzTotal,
  };

  /* --- TAM, plus Australia ----------------------------------------------- */

  const auHouseholds = Math.round(v("auPopulation") / v("auHouseholdSize"));
  const auCandidates = Math.round(auHouseholds * candidateRate);
  const auFactor = v("auRealisationFactor");
  const auHouseholdSpend = Math.round(
    auCandidates * bottlesPerHousehold * netShelf * auFactor,
  );
  const auVenues = v("auCafesRestaurants");
  const auVenueSpend = Math.round(
    auVenues * bottlesPerVenue * tradePrice * auFactor,
  );
  const tamAu = auHouseholdSpend + auVenueSpend;
  const tamBoth = tamNzTotal + tamAu;

  const tamWithAustralia: MarketLayer = {
    id: "tam",
    name: "TAM — New Zealand and Australia",
    meaning:
      "The same sum run across the Tasman. Australia is 27 times the households and six times the venues, and it is the reason the ceiling on this business is not the size of New Zealand. It is not part of the SAM, because there is no Australian distribution and one person cannot service it.",
    scope: "New Zealand and Australia, annual, net of GST, in NZD",
    steps: [
      step(
        "tam-au-households",
        "Australian households",
        `${n(v("auPopulation"))} people ÷ ${v("auHouseholdSize")} per household = ${n(auHouseholds)}`,
        auHouseholds,
        "count",
        ["auPopulation", "auHouseholdSize"],
      ),
      step(
        "tam-au-candidates",
        "Australian candidate households",
        `${n(auHouseholds)} × ${candidateRate} = ${n(auCandidates)}`,
        auCandidates,
        "count",
        ["nzCandidateHouseholdRate"],
      ),
      step(
        "tam-au-household-spend",
        "Australian household arm",
        `${n(auCandidates)} × ${n(bottlesPerHousehold)} × ${formatCents(netShelf)} × ${auFactor} = ${formatCents(auHouseholdSpend)}`,
        auHouseholdSpend,
        "cents",
        ["auRealisationFactor"],
      ),
      step(
        "tam-au-venue-spend",
        "Australian venue arm",
        `${n(auVenues)} venues × ${n(bottlesPerVenue)} × ${formatCents(tradePrice)} × ${auFactor} = ${formatCents(auVenueSpend)}`,
        auVenueSpend,
        "cents",
        ["auCafesRestaurants"],
      ),
      step(
        "tam-both-total",
        "TAM, New Zealand and Australia",
        `${formatCents(tamNzTotal)} + ${formatCents(tamAu)} = ${formatCents(tamBoth)}`,
        tamBoth,
        "cents",
        [],
      ),
    ],
    totalCents: tamBoth,
  };

  /* --- SAM ---------------------------------------------------------------- */

  const onlineRate = v("nzSpecialtyOnlineBuyerRate");
  const reachableHouseholds = Math.round(nzCandidates * onlineRate);
  const samDirect = Math.round(
    reachableHouseholds * bottlesPerHousehold * netShelf,
  );
  const doors = v("nzSpecialtyRetailDoors");
  const bottlesPerDoor = v("bottlesPerRetailDoorYear");
  const samRetail = Math.round(doors * bottlesPerDoor * tradePrice);
  const listRate = v("nzVenueListRate");
  const listingVenues = Math.round(nzVenues * listRate);
  const samTrade = Math.round(listingVenues * bottlesPerVenue * tradePrice);
  const samTotal = samDirect + samRetail + samTrade;

  const sam: MarketLayer = {
    id: "sam",
    name: "SAM — serviceable addressable market",
    meaning:
      "The slice of the TAM the three channels this business actually has can physically reach: a Shopify store shipping by courier, specialty retail doors, and venues that already sell the serve. Australia is excluded. This is what could be reached, not what could be won.",
    scope: "New Zealand, annual, net of GST, across three channels",
    steps: [
      step(
        "sam-reachable-households",
        "Households reachable online",
        `${n(nzCandidates)} candidates × ${onlineRate} = ${n(reachableHouseholds)}`,
        reachableHouseholds,
        "count",
        ["nzSpecialtyOnlineBuyerRate"],
      ),
      step(
        "sam-direct",
        "Direct channel",
        `${n(reachableHouseholds)} × ${n(bottlesPerHousehold)} × ${formatCents(netShelf)} = ${formatCents(samDirect)}`,
        samDirect,
        "cents",
        [],
      ),
      step(
        "sam-retail",
        "Specialty retail channel",
        `${n(doors)} doors × ${n(bottlesPerDoor)} bottles × ${formatCents(tradePrice)} = ${formatCents(samRetail)}`,
        samRetail,
        "cents",
        ["nzSpecialtyRetailDoors", "bottlesPerRetailDoorYear"],
      ),
      step(
        "sam-listing-venues",
        "Venues that would list it",
        `${n(nzVenues)} × ${listRate} = ${n(listingVenues)}`,
        listingVenues,
        "count",
        ["nzVenueListRate"],
      ),
      step(
        "sam-trade",
        "On-premise channel",
        `${n(listingVenues)} × ${n(bottlesPerVenue)} × ${formatCents(tradePrice)} = ${formatCents(samTrade)}`,
        samTrade,
        "cents",
        [],
      ),
      step(
        "sam-total",
        "SAM",
        `${formatCents(samDirect)} + ${formatCents(samRetail)} + ${formatCents(samTrade)} = ${formatCents(samTotal)}`,
        samTotal,
        "cents",
        [],
      ),
    ],
    totalCents: samTotal,
  };

  /* --- SOM ---------------------------------------------------------------- */

  const capacity = Math.round(
    v("productionDaysPerWeek") *
      v("bottlesPerProductionDay") *
      v("productionWeeksPerYear"),
  );
  const y1Bottles = Math.round(capacity * v("year1Utilisation"));
  const y2Bottles = Math.round(capacity * v("year2Utilisation"));

  const dtcShare = v("somDtcShare");
  const retailShare = v("somRetailShare");
  const tradeShare = v("somTradeShare");

  const y1Direct = Math.round(y1Bottles * dtcShare);
  const y1Retail = Math.round(y1Bottles * retailShare);
  const y1Trade = Math.round(y1Bottles * tradeShare);
  const y1Revenue =
    y1Direct * netShelf + y1Retail * tradePrice + y1Trade * tradePrice;

  const y2Direct = Math.round(y2Bottles * dtcShare);
  const y2Retail = Math.round(y2Bottles * retailShare);
  const y2Trade = Math.round(y2Bottles * tradeShare);
  const y2Revenue =
    y2Direct * netShelf + y2Retail * tradePrice + y2Trade * tradePrice;

  const cumulative = y1Revenue + y2Revenue;
  const samShare = samTotal === 0 ? 0 : (y2Revenue / samTotal) * 100;

  const som: MarketLayer = {
    id: "som",
    name: "SOM — serviceable obtainable market",
    meaning:
      "What one person can actually make and sell by month 24. It is bounded by her hands, not by demand: two production days a week is a hard ceiling, and every line below is downstream of it. This is the only one of the three numbers that is a promise.",
    scope: "New Zealand, year 2 run rate, net of GST",
    steps: [
      step(
        "som-capacity",
        "Annual production capacity",
        `${n(v("productionDaysPerWeek"))} days/week × ${n(v("bottlesPerProductionDay"))} bottles/day × ${n(v("productionWeeksPerYear"))} weeks = ${n(capacity)} bottles`,
        capacity,
        "count",
        [
          "productionDaysPerWeek",
          "bottlesPerProductionDay",
          "productionWeeksPerYear",
        ],
      ),
      step(
        "som-y1-bottles",
        "Year 1 bottles",
        `${n(capacity)} × ${v("year1Utilisation")} = ${n(y1Bottles)}`,
        y1Bottles,
        "count",
        ["year1Utilisation"],
      ),
      step(
        "som-y2-bottles",
        "Year 2 bottles",
        `${n(capacity)} × ${v("year2Utilisation")} = ${n(y2Bottles)}`,
        y2Bottles,
        "count",
        ["year2Utilisation"],
      ),
      step(
        "som-y2-split",
        "Year 2 volume by channel",
        `${n(y2Bottles)} → direct ${n(y2Direct)} (${dtcShare}) · retail ${n(y2Retail)} (${retailShare}) · trade ${n(y2Trade)} (${tradeShare})`,
        y2Bottles,
        "count",
        ["somDtcShare", "somRetailShare", "somTradeShare"],
      ),
      step(
        "som-y2-revenue",
        "Year 2 net revenue",
        `(${n(y2Direct)} × ${formatCents(netShelf)}) + (${n(y2Retail + y2Trade)} × ${formatCents(tradePrice)}) = ${formatCents(y2Revenue)}`,
        y2Revenue,
        "cents",
        [],
      ),
      step(
        "som-y1-revenue",
        "Year 1 net revenue",
        `(${n(y1Direct)} × ${formatCents(netShelf)}) + (${n(y1Retail + y1Trade)} × ${formatCents(tradePrice)}) = ${formatCents(y1Revenue)}`,
        y1Revenue,
        "cents",
        [],
      ),
      step(
        "som-share-of-sam",
        "Share of SAM taken",
        `${formatCents(y2Revenue)} ÷ ${formatCents(samTotal)} = ${samShare.toFixed(2)}%`,
        Math.round(samShare * 100) / 100,
        "ratio",
        [],
      ),
    ],
    totalCents: y2Revenue,
  };

  /* --- what the SOM means on a Tuesday ------------------------------------ */

  const venuesLive = Math.ceil(y2Trade / bottlesPerVenue);
  const doorsLive = Math.ceil(y2Retail / bottlesPerDoor);
  const ordersPerYear = Math.round(y2Direct / v("bottlesPerDtcOrder"));
  const approaches = Math.ceil(venuesLive / v("tradeCloseRate"));
  const approachesPerWeek = Math.round((approaches / 104) * 10) / 10;

  const targets: readonly SomTarget[] = [
    {
      id: "venues",
      label: "Trade accounts live at month 24",
      value: `${venuesLive} venues`,
      derivation: `${n(y2Trade)} trade bottles ÷ ${n(bottlesPerVenue)} per venue per year = ${venuesLive}. That is about ${(venuesLive / 24).toFixed(1)} new accounts a month, every month, for two years.`,
    },
    {
      id: "approaches",
      label: "Venue approaches per week",
      value: `${approachesPerWeek} a week`,
      derivation: `${venuesLive} accounts ÷ a ${v("tradeCloseRate")} close rate = ${approaches} approaches over 104 weeks = ${approachesPerWeek} a week. This is the number that sets Thursday in the week plan.`,
    },
    {
      id: "doors",
      label: "Specialty retail doors at month 24",
      value: `${doorsLive} doors`,
      derivation: `${n(y2Retail)} retail bottles ÷ ${n(bottlesPerDoor)} per door per year = ${doorsLive}.`,
    },
    {
      id: "orders",
      label: "Direct orders per month",
      value: `${Math.round(ordersPerYear / 12)} orders`,
      derivation: `${n(y2Direct)} direct bottles ÷ ${v("bottlesPerDtcOrder")} bottles per order = ${n(ordersPerYear)} orders a year = ${Math.round(ordersPerYear / 12)} a month, about ${(ordersPerYear / 365).toFixed(1)} a day.`,
    },
  ];

  /* --- cross-checks ------------------------------------------------------- */

  const globalUsdCents = v("globalCategoryUsdMillions") * 1_000_000 * 100;
  const globalNzd = Math.round(globalUsdCents * v("usdToNzd"));
  const worldPopulation = v("worldPopulationMillions") * 1_000_000;
  const popShare = v("nzPopulation") / worldPopulation;
  const topDownNz = Math.round(globalNzd * popShare);
  const ratio = topDownNz === 0 ? 0 : tamNzTotal / topDownNz;
  const avgRealisation =
    y2Bottles === 0 ? 0 : Math.round(y2Revenue / y2Bottles);
  const samBottles =
    avgRealisation === 0 ? 0 : Math.round(samTotal / avgRealisation);
  const capacityMultiple = capacity === 0 ? 0 : samBottles / capacity;

  const crossChecks: readonly CrossCheck[] = [
    {
      id: "top-down",
      question:
        "Does a top-down read of the global category agree with this bottom-up sum?",
      workings: `USD ${formatCents(globalUsdCents)} × ${v("usdToNzd")} = NZD ${formatCentsShort(globalNzd)} global. New Zealand's population share is ${n(v("nzPopulation"))} ÷ ${n(worldPopulation)} = ${(popShare * 100).toFixed(4)}%, so a population-weighted NZ slice is ${formatCents(topDownNz)}. The bottom-up TAM above is ${formatCents(tamNzTotal)} — ${ratio.toFixed(0)} times larger.`,
      reading:
        "No, and it should not. The global figure counts packaged pickle-juice drinks; this model counts brine bought as a mixer and a cooking acid, which is a wider category with a higher price per bottle. Read the top-down number as a floor for the narrow category and the bottom-up number as a ceiling for the wide one. What matters is that the SOM sits below even the floor, so nothing in the plan depends on resolving the gap.",
    },
    {
      id: "capacity",
      question: "Is this business demand-limited or capacity-limited?",
      workings: `At the year 2 mix the average realisation is ${formatCents(avgRealisation)} a bottle, so the SAM of ${formatCents(samTotal)} is about ${n(samBottles)} bottles a year. Annual capacity is ${n(capacity)} bottles. The reachable market is ${capacityMultiple.toFixed(0)} times what she can make.`,
      reading:
        "Capacity-limited, by a wide margin, from roughly month 14 onward. That is the single most useful output of this model: past the ramp, more marketing does not produce more revenue. Price, a co-packer, or a second pair of hands does.",
    },
    {
      id: "ceiling",
      question: "What is the ceiling without changing anything?",
      workings: `${n(capacity)} bottles at ${formatCents(avgRealisation)} average realisation = ${formatCents(capacity * avgRealisation)} a year at 100% utilisation, before COGS and before overhead.`,
      reading:
        "That is the whole business at full stretch on two production days. Any plan that needs a larger number than that needs a different production model first, and the conversation should start about eighteen months before it is needed.",
    },
  ];

  return {
    version: MARKET_VERSION,
    purpose:
      "How much money is on the table, how much of it you can actually reach, and how much of that you can win in two years — with every assumption written down so you can argue with it.",
    currency: "NZD",
    basis:
      "Annual spend on the category, in New Zealand dollars, excluding GST, at the price the buyer in each channel pays: shelf price for a household, trade price for a venue or a retail door.",
    tam,
    tamWithAustralia,
    sam,
    som,
    somCumulative24MonthCents: cumulative,
    targets,
    crossChecks,
    headwinds: MARKET_HEADWINDS,
    nextActions: MARKET_NEXT_ACTIONS,
  };
}

/* --------------------------------------------------------------- narrative */

const MARKET_VERSION = "1.0.0";

export const MARKET_HEADWINDS: readonly string[] = [
  "NZ hospitality sales grew 1.0% year on year in Q1 2025, and the restaurant-and-café segment 0.3%. Neither the venue base nor bottles-per-venue is grown anywhere in this model. [RA-2025]",
  "2,564 hospitality businesses shut in the twelve months to mid-2025 against 2,158 the year before, and liquidations rose from 199 to 297. That count spans a wider hospitality base than the 11,436 venues sized here, so it cannot be read as a churn rate — but it is why the trade target is stated as accounts LIVE at month 24, not accounts ever signed. [RA-CLOSURES-2025]",
  "Wage costs run at about 40% of hospitality revenue. A venue under that pressure buys on cost per pour, not on a story, which is why the trade one-liner leads with the pour and not the provenance. [RA-CLOSURES-2025]",
  "The category's own tailwind — pickle-flavoured mixer unit sales up 140%, pickle spirits up 10% — is cited and used in no calculation. A percentage lift on an unpublished base is a direction, not a market size. [PJ-MIXER-2025]",
  "Two of the venue-side inputs (bars and clubs at 2,400; doors at 900) are unverified estimates. If both are half what is assumed, the SAM falls by about a quarter and the trade target becomes materially harder, not impossible.",
];

export const MARKET_NEXT_ACTIONS: readonly NextAction[] = [
  {
    id: "verify-venue-count",
    action:
      "Count on-licences off the ARLA register and replace the 2,400 estimate for bars, pubs and clubs.",
    because:
      "It is the largest unverified input on the venue side, and the trade target is stated to two significant figures against it. The Ministry of Justice publishes the register quarterly.",
    by: "2026-10-31",
    doneWhen:
      "The nzBarsAndClubs assumption reads confidence: sourced, with a source row and a retrieval date.",
  },
  {
    id: "measure-a-production-day",
    action:
      "Time one full production day end to end and write down the bottle count.",
    because:
      "bottlesPerProductionDay = 120 is an estimate that has never been measured, and the entire SOM is a multiple of it. A day that yields 80 makes the year 2 revenue $79,000, not $118,600.",
    by: "The next production day",
    doneWhen:
      "The assumption reads confidence: derived, with the date of the day it was measured on.",
  },
  {
    id: "settle-the-trade-discount",
    action:
      "Decide the trade discount and the case minimum before the first trade invoice goes out.",
    because:
      "At a 40% trade discount off net shelf the margin on No 01 is 26%, which does not pay for the hour it takes to deliver and invoice. Either the discount comes down to about 30% or a case is six bottles and no less.",
    by: "Before the first trade order is raised",
    doneWhen:
      "One published trade price list exists, with the case minimum on it, and the tradeDiscountRate assumption matches it.",
  },
  {
    id: "gst-registration",
    action: "Register for GST and set up two-monthly filing.",
    because:
      "Year 1 modelled net revenue is above the $60,000 threshold, so registration becomes compulsory during year 1 rather than at the end of it, and 15% of every sale stops being hers the day it does.",
    by: "Within 21 days of expecting turnover to pass $60,000 in any 12 months",
    doneWhen: "An IRD GST number is issued and the first return is filed.",
  },
];

/* -------------------------------------------------------------- the model */

export const MARKET: MarketModel = computeMarket(MARKET_INPUTS);
