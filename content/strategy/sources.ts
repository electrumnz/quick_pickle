/**
 * Every published figure the strategy layer leans on, with the date it was
 * read.
 *
 * A market model is only arguable if the reader can go and check it, so a
 * figure without a row here is not allowed to be `confidence: "sourced"`. Two
 * of the anchors below (the pickle-mixer unit-sales lift and the pickle-spirits
 * lift) are demand signals that are cited but deliberately NOT used in any
 * arithmetic — they say the category is moving, not how large it is here.
 */

import type { StrategySource } from "./types";

export const SOURCES: readonly StrategySource[] = [
  {
    id: "SNZ-POP-2026",
    title: "National population estimates: At 31 March 2026",
    publisher: "Stats NZ",
    url: "https://www.stats.govt.nz/information-releases/national-population-estimates-at-31-march-2026/",
    retrieved: "2026-08-29",
    supports:
      "New Zealand's provisional estimated resident population was 5,361,300 at 31 March 2026, growing 0.8% (43,500) in the year.",
  },
  {
    id: "SNZ-HH-2025Q4",
    title: "Dwelling and household estimates: December 2025 quarter",
    publisher: "Stats NZ",
    url: "https://www.stats.govt.nz/information-releases/dwelling-and-household-estimates-december-2025-quarter/",
    retrieved: "2026-08-29",
    supports:
      "2,057,500 households in private occupied dwellings at 31 December 2025, from a stock of 2,141,200 private dwellings.",
  },
  {
    id: "HOSP-2022",
    title: "New Zealand hospitality sector size, 2022",
    publisher: "Restaurant Association of New Zealand (brief anchor)",
    url: "https://www.restaurantnz.co.nz/membership-resources/membership-resources-trends-research/",
    retrieved: "2026-08-29",
    supports:
      "NZ hospitality sales of $13.38bn in 2022 across roughly 145,000 people employed. Used as the sector's order of magnitude, not as a current-year figure.",
  },
  {
    id: "CAFE-2026",
    title: "Cafés and restaurants in New Zealand — market size 2026",
    publisher: "Industry market data (brief anchor)",
    url: "https://www.restaurantnz.co.nz/membership-resources/membership-resources-trends-research/",
    retrieved: "2026-08-29",
    supports:
      "An $8.8bn NZ cafés-and-restaurants market in 2026 across about 9,036 businesses and 80,698 employees. The business count is the venue base this model sizes against.",
  },
  {
    id: "RA-2025",
    title: "2025 Hospitality Report and Q1 2025 Hospitality Sales Snapshot",
    publisher: "Restaurant Association of New Zealand",
    url: "https://www.restaurantnz.co.nz/trends/2025-q1-hospitality-sales-snapshot/",
    retrieved: "2026-08-29",
    supports:
      "Q1 2025 hospitality sales of $4bn, up 1.0% year on year; the restaurant and café segment up 0.3%; total sales $15.99bn for the year ended June 2025, up 1.4%.",
  },
  {
    id: "RA-CLOSURES-2025",
    title:
      "Restaurant Association warns cost pressures squeezing hospitality profits",
    publisher: "NZ Herald",
    url: "https://www.nzherald.co.nz/business/companies/retail/restaurant-association-warns-cost-pressures-squeezing-hospitality-profits/7V3I26B2BBDAXACI57YQVCZ2NQ/",
    retrieved: "2026-08-29",
    supports:
      "2,564 hospitality businesses shut in the 12 months to mid-2025 against 2,158 the year before; 297 liquidations against 199; wages about 40% of revenue.",
  },
  {
    id: "PJ-GLOBAL-2025",
    title: "Global pickle juice drinks market, 2025 to 2034",
    publisher: "Market research aggregate (brief anchor)",
    url: "https://www.restaurantnz.co.nz/membership-resources/membership-resources-trends-research/",
    retrieved: "2026-08-29",
    supports:
      "USD 0.92bn in 2025 rising to USD 2.01bn by 2034, a 9.1% CAGR. The category counted is packaged pickle-juice drinks, which is narrower than brine sold as a mixer and a cooking acid.",
  },
  {
    id: "PJ-MIXER-2025",
    title: "Pickle-flavoured mixer and spirits unit sales",
    publisher: "Category demand signal (brief anchor)",
    url: "https://www.restaurantnz.co.nz/membership-resources/membership-resources-trends-research/",
    retrieved: "2026-08-29",
    supports:
      "Pickle-flavoured mixer unit sales up 140%; pickle spirits up 10%. Cited as a direction-of-travel signal only — no line of the model's arithmetic uses it.",
  },
  {
    id: "ABS-POP-2025Q4",
    title: "National, state and territory population, December 2025",
    publisher: "Australian Bureau of Statistics",
    url: "https://www.abs.gov.au/statistics/people/population/national-state-and-territory-population/latest-release",
    retrieved: "2026-08-29",
    supports:
      "Australia's population was 27,801,023 at 31 December 2025, up 412,500 (1.5%) over the year.",
  },
  {
    id: "AU-CAFE-2024",
    title: "Australia: cafés and restaurants in operation",
    publisher: "Statista",
    url: "https://www.statista.com/statistics/1244323/australia-number-cafes-and-restaurants-in-operation/",
    retrieved: "2026-08-29",
    supports:
      "Over 55,700 cafés and restaurants operating in Australia at the end of the 2024 financial year.",
  },
  {
    id: "IRD-GST",
    title: "GST — registering and the $60,000 threshold",
    publisher: "Inland Revenue (NZ)",
    url: "https://www.ird.govt.nz/gst/registering-for-gst",
    retrieved: "2026-08-29",
    supports:
      "GST is 15% and registration is compulsory once turnover exceeds NZ$60,000 in any 12-month period, or is expected to.",
  },
];

const BY_ID = new Map(SOURCES.map((source) => [source.id, source]));

export function source(id: string): StrategySource | undefined {
  return BY_ID.get(id);
}
