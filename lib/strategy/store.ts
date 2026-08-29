/**
 * Reading the strategy back out.
 *
 * This is the same shape as `AgentStore.listBrandRules` on purpose. Brand rules
 * are already data an agent pulls into its system prompt, and editing a row
 * changes what every agent says with no deploy; the strategy is the next layer
 * of the same idea, so it is loaded the same way rather than a second way.
 *
 * Two implementations:
 *
 *   {@link SqlStrategyStore}     the real tables, over any `$1`-style client —
 *                                `pg` in the admin, PGlite in the tests.
 *   {@link StaticStrategyStore}  the code-defined strategy in `content/strategy`,
 *                                used by the evidence scripts and as the
 *                                admin's honest fallback when the database is
 *                                unreachable.
 *
 * Both return the same `Strategy`, so nothing downstream — not the prompt
 * composer, not the admin, not the tests — knows which one it has.
 */

import { computeMarket } from "@/content/strategy/market";
import { STRATEGY } from "@/content/strategy";
import type {
  Confidence,
  MarketInput,
  MarketUnit,
  Strategy,
  StrategySource,
} from "@/content/strategy/types";

import {
  decodeBrandScript,
  decodeFlightPlan,
  decodeMarketNarrative,
} from "./schema";
import {
  STRATEGY_FRAMEWORKS,
  fromMicro,
  type StrategyAssumptionRecord,
  type StrategyDocumentRecord,
  type StrategyFramework,
} from "./types";

/* ----------------------------------------------------------------- ports */

export type StrategySqlRow = Record<string, unknown>;

/**
 * The narrowest client this store needs. `SqlExecutor` from `lib/commerce` and
 * a PGlite wrapper both satisfy it structurally, so neither has to be imported
 * here and neither has to change to be usable.
 */
export interface StrategySqlClient {
  query<R extends StrategySqlRow = StrategySqlRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: R[] }>;
}

export interface StrategyStore {
  /**
   * The documents an agent with these scopes should be given. Empty `scopes`
   * means everything, exactly as `listBrandRules` behaves.
   */
  listDocuments(
    scopes: readonly string[],
  ): Promise<readonly StrategyDocumentRecord[]>;
  listAssumptions(): Promise<readonly StrategyAssumptionRecord[]>;
  /** The three frameworks assembled, with the market model recomputed. */
  loadStrategy(): Promise<Strategy>;
}

export class StrategyStoreError extends Error {
  constructor(context: string, cause: unknown) {
    super(
      `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "StrategyStoreError";
  }
}

/* --------------------------------------------------------- row narrowing */

function str(row: StrategySqlRow, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  throw new StrategyStoreError(
    `strategy row column "${key}"`,
    new Error(`expected text, got ${typeof value}`),
  );
}

function strOrNull(row: StrategySqlRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** `bigint` columns arrive from `pg` as strings; from PGlite as numbers. */
function big(row: StrategySqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new StrategyStoreError(
    `strategy row column "${key}"`,
    new Error(`expected a number, got ${typeof value}`),
  );
}

function int(row: StrategySqlRow, key: string): number {
  return Math.trunc(big(row, key));
}

function textArray(row: StrategySqlRow, key: string): readonly string[] {
  const value = row[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function iso(row: StrategySqlRow, key: string): string {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value !== "") return value;
  return new Date(0).toISOString();
}

function oneOf<T extends string>(
  allowed: readonly T[],
  value: string,
  column: string,
): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new StrategyStoreError(
      `strategy row column "${column}"`,
      new Error(`"${value}" is not one of ${allowed.join(", ")}`),
    );
  }
  return found;
}

const UNITS: readonly MarketUnit[] = [
  "count",
  "cents",
  "ratio",
  "multiplier",
  "per_year",
  "years",
];
const CONFIDENCES: readonly Confidence[] = ["sourced", "derived", "estimate"];

/** `jsonb` arrives parsed from `pg` and from PGlite; a string is defensive. */
function jsonBody(row: StrategySqlRow, key: string): unknown {
  const value = row[key];
  if (typeof value === "string") {
    return JSON.parse(value) as unknown;
  }
  return value;
}

function mapDocument(row: StrategySqlRow): StrategyDocumentRecord {
  return {
    slug: str(row, "slug"),
    framework: oneOf(STRATEGY_FRAMEWORKS, str(row, "framework"), "framework"),
    title: str(row, "title"),
    purpose: str(row, "purpose"),
    version: str(row, "version"),
    appliesTo: textArray(row, "applies_to"),
    priority: int(row, "priority"),
    body: jsonBody(row, "body"),
    isActive: row["is_active"] === true,
    updatedAt: iso(row, "updated_at"),
  };
}

function mapAssumption(row: StrategySqlRow): StrategyAssumptionRecord {
  return {
    slug: str(row, "slug"),
    label: str(row, "label"),
    value: fromMicro(big(row, "value_micro")),
    unit: oneOf(UNITS, str(row, "unit"), "unit"),
    confidence: oneOf(CONFIDENCES, str(row, "confidence"), "confidence"),
    sourceId: strOrNull(row, "source_id"),
    rationale: str(row, "rationale"),
    minValue: fromMicro(big(row, "min_micro")),
    maxValue: fromMicro(big(row, "max_micro")),
    stepValue: fromMicro(big(row, "step_micro")),
    position: int(row, "position"),
    isActive: row["is_active"] === true,
  };
}

/** An assumption row, as the market model wants to see it. */
export function assumptionToInput(
  record: StrategyAssumptionRecord,
): MarketInput {
  return {
    id: record.slug,
    label: record.label,
    value: record.value,
    unit: record.unit,
    confidence: record.confidence,
    ...(record.sourceId === null ? {} : { sourceId: record.sourceId }),
    rationale: record.rationale,
    min: record.minValue,
    max: record.maxValue,
    step: record.stepValue,
  };
}

/* ------------------------------------------------------------- SQL store */

const DOCUMENT_COLUMNS = `slug, framework, title, purpose, version, applies_to,
                          priority, body, is_active, updated_at`;

export class SqlStrategyStore implements StrategyStore {
  constructor(
    private readonly sql: StrategySqlClient,
    /**
     * Sources are reference material, not business state, so they stay in code
     * rather than becoming a fourth table nobody edits.
     */
    private readonly sources: readonly StrategySource[] = STRATEGY.sources,
  ) {}

  async listDocuments(
    scopes: readonly string[],
  ): Promise<readonly StrategyDocumentRecord[]> {
    const text =
      scopes.length === 0
        ? `select ${DOCUMENT_COLUMNS}
             from public.strategy_documents
            where is_active
            order by priority, slug`
        : `select ${DOCUMENT_COLUMNS}
             from public.strategy_documents
            where is_active
              and (cardinality(applies_to) = 0 or applies_to && $1::text[])
            order by priority, slug`;
    const params = scopes.length === 0 ? [] : [[...scopes]];
    const result = await this.sql.query(text, params);
    return result.rows.map(mapDocument);
  }

  async listAssumptions(): Promise<readonly StrategyAssumptionRecord[]> {
    const result = await this.sql.query(
      `select slug, label, value_micro, unit, confidence, source_id, rationale,
              min_micro, max_micro, step_micro, position, is_active
         from public.strategy_assumptions
        where is_active
        order by position, slug`,
    );
    return result.rows.map(mapAssumption);
  }

  async loadStrategy(): Promise<Strategy> {
    const [documents, assumptions] = await Promise.all([
      this.listDocuments([]),
      this.listAssumptions(),
    ]);
    return assembleStrategy(documents, assumptions, this.sources);
  }
}

/* ---------------------------------------------------------- static store */

/**
 * The strategy as it stands in `content/strategy`.
 *
 * Used by the evidence generator, by the agent-wiring tests, and by the admin
 * when the database cannot be reached — a Brand & Plan page that shows nothing
 * because Postgres is down is worse than one that shows the deployed position
 * and says so.
 */
export class StaticStrategyStore implements StrategyStore {
  constructor(private readonly strategy: Strategy = STRATEGY) {}

  async listDocuments(
    scopes: readonly string[],
  ): Promise<readonly StrategyDocumentRecord[]> {
    return staticDocuments(this.strategy).filter(
      (document) =>
        scopes.length === 0 ||
        document.appliesTo.length === 0 ||
        document.appliesTo.some((scope) => scopes.includes(scope)),
    );
  }

  async listAssumptions(): Promise<readonly StrategyAssumptionRecord[]> {
    return this.strategy.inputs.map((input, index) => ({
      slug: input.id,
      label: input.label,
      value: input.value,
      unit: input.unit,
      confidence: input.confidence,
      sourceId: input.sourceId ?? null,
      rationale: input.rationale,
      minValue: input.min,
      maxValue: input.max,
      stepValue: input.step,
      position: (index + 1) * 10,
      isActive: true,
    }));
  }

  async loadStrategy(): Promise<Strategy> {
    return this.strategy;
  }
}

/* ------------------------------------------------------------- assembly */

/** Scope sets, kept next to each other so the routing is readable in one place. */
export const DOCUMENT_SCOPES: Readonly<Record<StrategyFramework, string[]>> = {
  // Everyone writing anything needs the story.
  brandscript: [
    "social",
    "email",
    "storefront",
    "packaging",
    "wholesale",
    "paid",
    "support",
  ],
  // The plan is context for every role, so it carries no scopes at all.
  flight_plan: [],
  // Market sizing is for the roles that target and price.
  market_sizing: ["wholesale", "pricing", "planning"],
};

const DOCUMENT_TITLES: Readonly<Record<StrategyFramework, string>> = {
  brandscript: "StoryBrand BrandScript",
  flight_plan: "Small Business Flight Plan",
  market_sizing: "Market sizing — TAM, SAM, SOM",
};

const DOCUMENT_SLUGS: Readonly<Record<StrategyFramework, string>> = {
  brandscript: "brandscript",
  flight_plan: "flight-plan",
  market_sizing: "market-sizing",
};

const DOCUMENT_PRIORITY: Readonly<Record<StrategyFramework, number>> = {
  flight_plan: 10,
  brandscript: 20,
  market_sizing: 30,
};

/**
 * The code-defined strategy projected onto the row shape.
 *
 * This is also what the migration seeds, which is why
 * `tests/strategy/seed-parity.test.ts` can compare the two byte for byte.
 */
export function staticDocuments(
  strategy: Strategy = STRATEGY,
): readonly StrategyDocumentRecord[] {
  const row = (
    framework: StrategyFramework,
    purpose: string,
    version: string,
    body: unknown,
  ): StrategyDocumentRecord => ({
    slug: DOCUMENT_SLUGS[framework],
    framework,
    title: DOCUMENT_TITLES[framework],
    purpose,
    version,
    appliesTo: DOCUMENT_SCOPES[framework],
    priority: DOCUMENT_PRIORITY[framework],
    body,
    isActive: true,
    updatedAt: `${strategy.updated}T00:00:00.000Z`,
  });

  return [
    row(
      "flight_plan",
      strategy.flightPlan.purpose,
      strategy.flightPlan.version,
      strategy.flightPlan,
    ),
    row(
      "brandscript",
      strategy.brandScript.purpose,
      strategy.brandScript.version,
      strategy.brandScript,
    ),
    row("market_sizing", strategy.market.purpose, strategy.market.version, {
      purpose: strategy.market.purpose,
      basis: strategy.market.basis,
      headwinds: strategy.market.headwinds,
      nextActions: strategy.market.nextActions,
    }),
  ];
}

/**
 * Put the rows back together into a `Strategy`.
 *
 * The market model is not read out of a row — it is recomputed from the
 * assumptions by `computeMarket`, so a figure on the admin's Market screen and
 * a figure in an agent's system prompt cannot disagree.
 */
export function assembleStrategy(
  documents: readonly StrategyDocumentRecord[],
  assumptions: readonly StrategyAssumptionRecord[],
  sources: readonly StrategySource[] = STRATEGY.sources,
): Strategy {
  const find = (framework: StrategyFramework): StrategyDocumentRecord => {
    const found = documents.find(
      (document) => document.framework === framework,
    );
    if (found === undefined) {
      throw new StrategyStoreError(
        "assemble strategy",
        new Error(`no active strategy_documents row for "${framework}"`),
      );
    }
    return found;
  };

  const brandDoc = find("brandscript");
  const planDoc = find("flight_plan");
  const marketDoc = find("market_sizing");

  const inputs = assumptions.map(assumptionToInput);
  const narrative = decodeMarketNarrative(marketDoc.slug, marketDoc.body);
  const computed = computeMarket(inputs);

  const updated = documents
    .map((document) => document.updatedAt)
    .sort()
    .at(-1);

  return {
    version: `${planDoc.version}/${brandDoc.version}/${marketDoc.version}`,
    updated: (updated ?? STRATEGY.updated).slice(0, 10),
    sources,
    inputs,
    brandScript: decodeBrandScript(brandDoc.slug, brandDoc.body),
    flightPlan: decodeFlightPlan(planDoc.slug, planDoc.body),
    market: {
      ...computed,
      version: marketDoc.version,
      purpose: narrative.purpose,
      basis: narrative.basis,
      headwinds: narrative.headwinds,
      nextActions: narrative.nextActions,
    },
  };
}
