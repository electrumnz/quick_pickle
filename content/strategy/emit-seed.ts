/**
 * The strategy, as SQL.
 *
 * The migration seeds `strategy_documents` and `strategy_assumptions` from the
 * typed modules in this directory rather than from a hand-written INSERT,
 * because a hand-written INSERT is a second copy of the strategy that drifts
 * the first time somebody edits one and not the other.
 *
 * The generated text is pasted into the migration between two markers, and
 * `tests/strategy/seed-parity.test.ts` fails if the two ever diverge:
 *
 *   UPDATE_STRATEGY_SEED=1 npx vitest run tests/strategy/seed-parity.test.ts
 *
 * rewrites the migration's seed block from these modules. Everything else in
 * the migration — the tables, the constraints, the policies — is hand-written
 * and is not touched.
 *
 * Values are dollar-quoted (`$hs$…$hs$`), so no JSON string ever has to be
 * escaped on its way into Postgres and the SQL stays readable in a diff.
 */

import { MARKET_INPUTS } from "./market";
import { STRATEGY } from "./index";
import type { MarketInput, Strategy } from "./types";

export const SEED_START = "-- @@STRATEGY-SEED-START@@";
export const SEED_END = "-- @@STRATEGY-SEED-END@@";

/** Millionths, matching `strategy_assumptions.value_micro`. */
const MICRO = 1_000_000;

function micro(value: number): string {
  return String(Math.round(value * MICRO));
}

/** A dollar-quoted literal. The tag is fixed and appears in no payload. */
function q(value: string): string {
  if (value.includes("$hs$")) {
    throw new Error("A strategy string contains the dollar-quote tag $hs$.");
  }
  return `$hs$${value}$hs$`;
}

function textArray(values: readonly string[]): string {
  return `array[${values.map((value) => q(value)).join(", ")}]::text[]`;
}

const EMPTY_TEXT_ARRAY = "'{}'::text[]";

function jsonLiteral(value: unknown): string {
  return `${q(JSON.stringify(value, null, 2))}::jsonb`;
}

/** The three document rows, in the order the admin shows them. */
function documentRows(strategy: Strategy): string {
  const rows: {
    slug: string;
    framework: string;
    title: string;
    purpose: string;
    version: string;
    appliesTo: readonly string[];
    priority: number;
    body: unknown;
  }[] = [
    {
      slug: "flight-plan",
      framework: "flight_plan",
      title: "Small Business Flight Plan",
      purpose: strategy.flightPlan.purpose,
      version: strategy.flightPlan.version,
      appliesTo: [],
      priority: 10,
      body: strategy.flightPlan,
    },
    {
      slug: "brandscript",
      framework: "brandscript",
      title: "StoryBrand BrandScript",
      purpose: strategy.brandScript.purpose,
      version: strategy.brandScript.version,
      appliesTo: [
        "social",
        "email",
        "storefront",
        "packaging",
        "wholesale",
        "paid",
        "support",
      ],
      priority: 20,
      body: strategy.brandScript,
    },
    {
      slug: "market-sizing",
      framework: "market_sizing",
      title: "Market sizing — TAM, SAM, SOM",
      purpose: strategy.market.purpose,
      version: strategy.market.version,
      appliesTo: ["wholesale", "pricing", "planning"],
      priority: 30,
      body: {
        purpose: strategy.market.purpose,
        basis: strategy.market.basis,
        headwinds: strategy.market.headwinds,
        nextActions: strategy.market.nextActions,
      },
    },
  ];

  const values = rows
    .map(
      (row) =>
        `  (${q(row.slug)}, ${q(row.framework)}::public.strategy_framework,\n` +
        `   ${q(row.title)},\n` +
        `   ${q(row.purpose)},\n` +
        `   ${q(row.version)}, ${row.appliesTo.length === 0 ? EMPTY_TEXT_ARRAY : textArray(row.appliesTo)}, ${String(row.priority)}, true,\n` +
        `   ${jsonLiteral(row.body)})`,
    )
    .join(",\n\n");

  return (
    "insert into public.strategy_documents\n" +
    "  (slug, framework, title, purpose, version, applies_to, priority, is_active, body)\n" +
    "values\n" +
    `${values};`
  );
}

/** One row per named, editable market assumption. */
function assumptionRows(inputs: readonly MarketInput[]): string {
  const values = inputs
    .map(
      (input, index) =>
        `  (${q(input.id)}, ${q(input.label)},\n` +
        `   ${micro(input.value)}, ${q(input.unit)}::public.strategy_unit, ${q(input.confidence)}::public.strategy_confidence,\n` +
        `   ${input.sourceId === undefined ? "null" : q(input.sourceId)},\n` +
        `   ${q(input.rationale)},\n` +
        `   ${micro(input.min)}, ${micro(input.max)}, ${micro(input.step)}, ${String((index + 1) * 10)}, true)`,
    )
    .join(",\n\n");

  return (
    "insert into public.strategy_assumptions\n" +
    "  (slug, label, value_micro, unit, confidence, source_id, rationale,\n" +
    "   min_micro, max_micro, step_micro, position, is_active)\n" +
    "values\n" +
    `${values};`
  );
}

/** The whole seed block, exactly as it appears between the markers. */
export function strategySeedSql(
  strategy: Strategy = STRATEGY,
  inputs: readonly MarketInput[] = MARKET_INPUTS,
): string {
  return [
    "-- Generated from content/strategy by content/strategy/emit-seed.ts.",
    "-- Do not hand-edit: run",
    "--   UPDATE_STRATEGY_SEED=1 npx vitest run tests/strategy/seed-parity.test.ts",
    "-- after changing the strategy in code.",
    "",
    documentRows(strategy),
    "",
    assumptionRows(inputs),
  ].join("\n");
}
