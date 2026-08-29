/**
 * HALF SOUR — strategy types.
 *
 * The three frameworks in `content/strategy/` are DATA, not prose. That is the
 * whole point of the unit: the marketing agent writes captions out of the
 * BrandScript, the trade agent targets out of the market model, and both read
 * the Flight Plan to know what the company is. A framework stored as a
 * paragraph can be read by a person and by nothing else. A framework stored as
 * seven named fields can be read by a person, rendered in the admin, seeded
 * into Postgres, diffed, and injected into a system prompt — and when a field
 * changes, the next caption changes with it.
 *
 * Three rules run through the file:
 *
 *  1. **Money is integer cents.** Same rule as the rest of the codebase. There
 *     is no float in a price path here either, including the market model,
 *     where every derived figure is computed in cents and rounded once.
 *  2. **Every number that came from somewhere carries a source id.** Every
 *     number that did not carries `confidence: "estimate"` and says so out
 *     loud. A market size whose assumptions cannot be inspected is decoration.
 *  3. **Nothing here may make a claim about the body.** `legal/COPY-RULES.md`
 *     binds this file exactly as it binds a product description. Positioning
 *     is culinary: brine as a mixer and a cooking acid.
 */

/* ------------------------------------------------------------- provenance */

/** Where a number or a statement came from. */
export interface StrategySource {
  /** Short stable id used by `sourceId` references, e.g. "RA-2025". */
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  /** ISO date this was read. */
  readonly retrieved: string;
  /** What, precisely, this source supports. */
  readonly supports: string;
}

/**
 * How much weight a figure carries.
 *
 * - `sourced`  a published figure, cited, used as published.
 * - `derived`  arithmetic over sourced figures, shown in full.
 * - `estimate` a judgement call. Honest label, not a hedge: an estimate that
 *              is labelled can be argued with, and an estimate that is not is
 *              indistinguishable from a fact.
 */
export type Confidence = "sourced" | "derived" | "estimate";

/** Something the founder should actually do, with a date on it. */
export interface NextAction {
  readonly id: string;
  /** Imperative. "Register for GST", not "GST registration is advisable". */
  readonly action: string;
  /** Why this, and why now. */
  readonly because: string;
  /** ISO date, or a trigger condition when a date would be a guess. */
  readonly by: string;
  /** How you will know it is done. */
  readonly doneWhen: string;
}

/* ---------------------------------------------------------- 1. BrandScript */

export type AudienceId = "b2c" | "b2b";

/** SB7 element 1 — a character. The customer, never the brand. */
export interface Character {
  readonly id: AudienceId;
  /** How the founder would refer to this person out loud. */
  readonly label: string;
  readonly who: string;
  /** One want. Not three. A story with three wants is not a story. */
  readonly wants: string;
  /** Why we believe that is the want. */
  readonly evidence: string;
}

/** SB7 element 2 — a problem, on three levels plus the villain. */
export interface Problem {
  /** The tangible obstacle. */
  readonly external: string;
  /** How the external problem makes them feel. This is what actually sells. */
  readonly internal: string;
  /** Why it is plain wrong for the world to work this way. */
  readonly philosophical: string;
  /** One concrete, defeatable antagonist. Not an abstraction. */
  readonly villain: string;
}

/** SB7 element 3 — a guide, who shows empathy and authority. */
export interface Guide {
  readonly empathy: string;
  /** Authority we can state without breaching COPY-RULES or the FTA. */
  readonly authority: readonly string[];
}

export interface PlanStep {
  readonly step: number;
  readonly title: string;
  readonly detail: string;
}

/** SB7 element 4 — a plan: the steps, and what we commit to. */
export interface StoryPlan {
  /** Three or four steps. More than four is a manual, not a plan. */
  readonly process: readonly PlanStep[];
  /** What we promise in exchange for the risk they take. */
  readonly agreement: readonly string[];
}

export interface CallToAction {
  readonly label: string;
  readonly href: string;
  /** True when the route is deployed. False is not a bug; it is a to-do. */
  readonly live: boolean;
  readonly note: string;
}

/** SB7 element 5 — one direct call, one transitional call. */
export interface Calls {
  readonly direct: CallToAction;
  readonly transitional: CallToAction;
}

/** SB7 elements 6 and 7 — what they avoid, and what they get. */
export interface Stakes {
  readonly failure: readonly string[];
  readonly success: readonly string[];
  /** Miller's character transformation: from → to. */
  readonly transformation: { readonly from: string; readonly to: string };
}

/** One complete seven-element script for one audience. */
export interface AudienceScript {
  readonly character: Character;
  readonly problem: Problem;
  readonly guide: Guide;
  readonly plan: StoryPlan;
  readonly calls: Calls;
  readonly stakes: Stakes;
}

/** The lines derived from the script. This is what a copy agent writes from. */
export interface DerivedMessaging {
  /** Problem → solution → result, in one breath. */
  readonly oneLiner: string;
  /** The single sentence that governs every other sentence. */
  readonly controllingIdea: string;
  /** Character, problem, plan, success — said out loud in under 30 seconds. */
  readonly elevatorPitch: string;
  /** The trade variant, because a bar manager is not a home host. */
  readonly tradeOneLiner: string;
}

export interface BrandScript {
  readonly version: string;
  /** One plain sentence: what this framework is FOR. Shown before the framework. */
  readonly purpose: string;
  readonly audiences: Readonly<Record<AudienceId, AudienceScript>>;
  readonly derived: DerivedMessaging;
  readonly nextActions: readonly NextAction[];
}

/* ---------------------------------------------------------- 2. Flight Plan */

export type FlightPlanPart =
  "cockpit" | "right-engine" | "left-engine" | "wings" | "body" | "fuel-tanks";

interface SectionCommon {
  readonly part: FlightPlanPart;
  /** "Cockpit", "Right engine" — the aeroplane word. */
  readonly aircraft: string;
  /** "Leadership", "Marketing" — the business word. */
  readonly discipline: string;
  /** One plain sentence: what this part is FOR. */
  readonly purpose: string;
  /** What goes wrong when this part is neglected. Miller's diagnostic. */
  readonly failureMode: string;
}

/** Cockpit. Miller's mission statement is a goal, a date, and the reasons. */
export interface LeadershipSection extends SectionCommon {
  readonly part: "cockpit";
  readonly mission: {
    readonly goal: string;
    readonly by: string;
    readonly because: readonly string[];
    /** The sentence, assembled. Kept explicit so it can be quoted verbatim. */
    readonly statement: string;
  };
  /** A principle is only a principle if it settles an argument. */
  readonly guidingPrinciples: readonly {
    readonly principle: string;
    readonly settles: string;
  }[];
  readonly keyCharacteristics: readonly {
    readonly characteristic: string;
    readonly looksLike: string;
  }[];
}

export interface MarketingChannel {
  readonly channel: string;
  readonly cadence: string;
  readonly job: string;
  /** The BrandScript field this channel's copy is derived from. */
  readonly derivedFrom: string;
}

export interface MarketingSection extends SectionCommon {
  readonly part: "right-engine";
  readonly oneLiner: string;
  readonly leadGenerator: {
    readonly name: string;
    readonly promise: string;
    readonly format: string;
  };
  readonly nurtureSequence: readonly {
    readonly email: number;
    readonly subject: string;
    readonly job: string;
  }[];
  readonly salesSequence: readonly {
    readonly email: number;
    readonly subject: string;
    readonly job: string;
  }[];
  readonly channels: readonly MarketingChannel[];
}

export interface SalesStage {
  readonly stage: number;
  readonly name: string;
  /** The one question that decides whether this stage is finished. */
  readonly qualifyingQuestion: string;
  readonly action: string;
  /** What is counted, so the stage can be reported on. */
  readonly measure: string;
}

export interface SalesProcess {
  readonly id: AudienceId;
  readonly name: string;
  readonly mechanism: string;
  readonly stages: readonly SalesStage[];
  /** The arithmetic that turns the market model's target into a weekly habit. */
  readonly cadence: string;
}

export interface SalesSection extends SectionCommon {
  readonly part: "left-engine";
  readonly processes: readonly SalesProcess[];
}

/** One SKU, with its unit economics computed rather than asserted. */
export interface ProductWing {
  readonly sku: string;
  readonly name: string;
  /** What this bottle is FOR. One job each. */
  readonly job: string;
  /** GST-inclusive shelf price, cents. */
  readonly shelfPriceCents: number;
  readonly costBreakdownCents: readonly {
    readonly item: string;
    readonly cents: number;
  }[];
  readonly confidence: Confidence;
  readonly note: string;
}

export interface ProductsSection extends SectionCommon {
  readonly part: "wings";
  readonly wings: readonly ProductWing[];
  readonly findings: readonly string[];
}

export interface WeekBlock {
  readonly day: string;
  readonly work: string;
  readonly hours: number;
}

export interface OverheadLine {
  readonly item: string;
  readonly centsPerMonth: number;
  readonly confidence: Confidence;
}

export interface OperationsSection extends SectionCommon {
  readonly part: "body";
  readonly week: readonly WeekBlock[];
  readonly fixedOverhead: readonly OverheadLine[];
  readonly perOrderCosts: readonly {
    readonly item: string;
    readonly cents: number;
    readonly note: string;
  }[];
  readonly constraints: readonly string[];
}

/** Miller's operating-account discipline, in NZD and with NZ tax attached. */
export interface CashAccount {
  readonly account: string;
  readonly holds: string;
  readonly rule: string;
}

export interface CashFlowSection extends SectionCommon {
  readonly part: "fuel-tanks";
  readonly accounts: readonly CashAccount[];
  /** Months of operating cost the operating account should hold. */
  readonly operatingBufferMonths: number;
  readonly gst: {
    readonly ratePercent: number;
    readonly registrationThresholdCents: number;
    readonly filingBasis: string;
    readonly note: string;
  };
  readonly rules: readonly string[];
}

export type FlightPlanSection =
  | LeadershipSection
  | MarketingSection
  | SalesSection
  | ProductsSection
  | OperationsSection
  | CashFlowSection;

export interface FlightPlan {
  readonly version: string;
  /** One plain sentence: what this framework is FOR. */
  readonly purpose: string;
  readonly cockpit: LeadershipSection;
  readonly rightEngine: MarketingSection;
  readonly leftEngine: SalesSection;
  readonly wings: ProductsSection;
  readonly body: OperationsSection;
  readonly fuelTanks: CashFlowSection;
  readonly nextActions: readonly NextAction[];
}

/* --------------------------------------------------------- 3. Market model */

/**
 * `ratio` is constrained to 0..1 in the database, because a ratio outside that
 * range is a units mistake that would silently multiply a market layer.
 * `multiplier` is the unconstrained one — an FX rate, a realisation factor.
 */
export type MarketUnit =
  "count" | "cents" | "ratio" | "multiplier" | "per_year" | "years";

/**
 * A named, editable input to the market model.
 *
 * Every figure in the TAM is either one of these or arithmetic over them.
 * Nothing is hard-coded downstream, which is what makes the model arguable:
 * change `nzHouseholds` and every layer below it moves.
 */
export interface MarketInput {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: MarketUnit;
  readonly confidence: Confidence;
  /** Present when `confidence` is "sourced" or "derived". */
  readonly sourceId?: string;
  readonly rationale: string;
  /** Sensible bounds for the admin's editor. */
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** One line of arithmetic, with the expression it evaluated. */
export interface Calculation {
  readonly id: string;
  readonly label: string;
  /** The sum as a person would write it, with the numbers substituted in. */
  readonly expression: string;
  readonly value: number;
  readonly unit: MarketUnit;
  /** Input ids this line consumed, so the dependency is inspectable. */
  readonly uses: readonly string[];
}

export interface MarketLayer {
  readonly id: "tam" | "sam" | "som";
  readonly name: string;
  /** One plain sentence: what this layer means. */
  readonly meaning: string;
  readonly steps: readonly Calculation[];
  readonly totalCents: number;
  readonly scope: string;
}

/** A number that tests the model from outside it. */
export interface CrossCheck {
  readonly id: string;
  readonly question: string;
  readonly workings: string;
  readonly reading: string;
}

/** What the SOM means in units the founder can act on this week. */
export interface SomTarget {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly derivation: string;
}

export interface MarketModel {
  readonly version: string;
  /** One plain sentence: what this framework is FOR. */
  readonly purpose: string;
  readonly currency: "NZD";
  readonly basis: string;
  readonly tam: MarketLayer;
  readonly tamWithAustralia: MarketLayer;
  readonly sam: MarketLayer;
  readonly som: MarketLayer;
  readonly somCumulative24MonthCents: number;
  readonly targets: readonly SomTarget[];
  readonly crossChecks: readonly CrossCheck[];
  readonly headwinds: readonly string[];
  readonly nextActions: readonly NextAction[];
}

/* ------------------------------------------------------------- the bundle */

/**
 * The three frameworks, plus the sources and the inputs they were built from.
 *
 * This is the object the agent runtime loads, the admin renders, and the
 * migration seeds. One shape, three consumers.
 */
export interface Strategy {
  readonly version: string;
  readonly updated: string;
  readonly sources: readonly StrategySource[];
  readonly inputs: readonly MarketInput[];
  readonly brandScript: BrandScript;
  readonly flightPlan: FlightPlan;
  readonly market: MarketModel;
}
