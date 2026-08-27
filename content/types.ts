/**
 * HALF SOUR — content types.
 *
 * The content layer is DATA, not markup. Every recipe, supplier, stockist and
 * story chapter is a typed record in `content/`, read through
 * `content/repository.ts`. Pages render records; they never carry copy of
 * their own. That is what lets the admin edit a recipe later without a deploy,
 * and it is what lets `legal/scripts/audit-copy.mjs` scan the words in one
 * place rather than chasing them through JSX.
 *
 * Two rules run through the whole file:
 *
 *  1. Measurements are strings, not numbers. "60 ml", "1 barspoon", "2 dashes"
 *     and "half a lemon" are all real bar measurements and only one of them is
 *     a number. The display string is the source of truth; `metricMl` carries
 *     the machine value when there is one, for scaling.
 *  2. Anything that could be read as a claim about where something comes from
 *     is a `ProvenanceFact`, never a bare string. See `content/provenance.ts`.
 */

export type BrineId =
  "no-01-house" | "no-02-dirty" | "no-03-smoke" | "no-04-wild";

/** A bottle. Prices and handles mirror the live Shopify catalogue. */
export interface Brine {
  readonly id: BrineId;
  /** "01" — set in mono on the label and everywhere else. */
  readonly number: string;
  /** "HOUSE" */
  readonly name: string;
  /** "Dill and Peppercorn Brine" */
  readonly descriptor: string;
  /** Shopify product handle. */
  readonly handle: string;
  readonly priceNzd: number;
  readonly volumeMl: number;
  /** One line, in voice. Leads with what to do with it. */
  readonly line: string;
  /** What you actually taste, in order. */
  readonly notes: readonly string[];
  /** The ingredient run, as printed on the label. */
  readonly run: readonly string[];
  /** True when supply, not demand, sets the ceiling. */
  readonly supplyLimited: boolean;
}

/* ---------------------------------------------------------------- recipes */

export type RecipeKind = "drink" | "dish";

/**
 * Difficulty is about technique, not effort. A twelve-hour cure is `easy`;
 * a split-second dilution window is not.
 */
export type Difficulty = "easy" | "some-practice" | "practised";

// The spirits this library actually uses. Named as ingredients only. Checked against the
// ASA alcohol code: nothing here encourages excessive or rapid consumption, nothing is
// aimed at under-18s, and nothing claims a drink offsets the effects of alcohol.
// copy-audit-approved: R-13
export type Spirit =
  "gin" | "vodka" | "whiskey" | "tequila" | "mezcal" | "beer" | "none";

export type Occasion =
  | "bar-service"
  | "before-dinner"
  | "at-the-table"
  | "sunday-lunch"
  | "long-cook"
  | "party"
  | "hair-of-the-dog"
  | "no-alcohol";

/** A single line in an ingredient list. */
export interface Measure {
  /** As it should be read aloud: "60 ml", "1 barspoon", "2 dashes". */
  readonly amount: string;
  readonly item: string;
  /** The bit a good recipe includes and a lazy one leaves out. */
  readonly note?: string;
  /** Machine value in millilitres, when the amount is volumetric. */
  readonly metricMl?: number;
  /** Machine value in grams, when the amount is by weight. */
  readonly metricG?: number;
}

export interface MeasureGroup {
  /** Omitted when the recipe has a single list. */
  readonly heading?: string;
  readonly items: readonly Measure[];
}

export interface Step {
  readonly text: string;
  /** Shown as a countdown chip when a step is timed. */
  readonly seconds?: number;
}

/** Scaling a drink to a bottle, for a bar that pre-batches. */
export interface Batch {
  readonly headline: string;
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  readonly note: string;
}

export interface Recipe {
  readonly slug: string;
  readonly title: string;
  /** Sits above the title. Two or three words. */
  readonly kicker: string;
  /** The deck. One or two sentences, instruction first. */
  readonly summary: string;
  readonly kind: RecipeKind;
  readonly brine: BrineId;
  /** Brines that also work, in order of preference. */
  readonly alsoWorksWith: readonly BrineId[];
  readonly spirit: Spirit;
  readonly occasions: readonly Occasion[];
  readonly difficulty: Difficulty;
  /** Minutes of hands-on work. */
  readonly prepMinutes: number;
  /** Minutes of heat. Zero for a drink. */
  readonly cookMinutes: number;
  /** Minutes of waiting — a cure, a chill, a rest. Not hands-on. */
  readonly restMinutes: number;
  /** "One drink", "Serves four", "Makes 250 ml". */
  readonly yieldText: string;
  readonly serveIn?: string;
  readonly ice?: string;
  readonly garnish?: string;
  readonly ingredients: readonly MeasureGroup[];
  readonly steps: readonly Step[];
  /** Why it works, and what to do when it does not. */
  readonly notes: readonly string[];
  readonly swaps?: readonly string[];
  readonly batch?: Batch;
  /** Equipment worth naming. Becomes schema.org `tool`. */
  readonly tools?: readonly string[];
  /** ISO date. Drives the library's sort order and the feed. */
  readonly published: string;
  readonly updated?: string;
  readonly keywords: readonly string[];
  /** Free-text credit where the drink is not ours. Printed verbatim. */
  readonly credit?: string;
}

/** Total wall-clock time, which is what a reader is actually choosing on. */
export function totalMinutes(recipe: Recipe): number {
  return recipe.prepMinutes + recipe.cookMinutes + recipe.restMinutes;
}

/** ISO-8601 duration for schema.org. `PT0M` is not valid, so guard for zero. */
export function isoDuration(minutes: number): string | undefined {
  if (minutes <= 0) return undefined;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `PT${hours > 0 ? `${hours}H` : ""}${mins > 0 ? `${mins}M` : ""}`;
}

/** "1 h 20 min", "45 min", "2 days" — how a person says it. */
export function humanDuration(minutes: number): string {
  if (minutes <= 0) return "None";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  const days = Math.round(minutes / (60 * 24));
  return days === 1 ? "1 day" : `${days} days`;
}
