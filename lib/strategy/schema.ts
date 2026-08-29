/**
 * Decoders for the JSON bodies stored in `strategy_documents`.
 *
 * The founder can edit a strategy row in the database and change what every
 * agent says, with no deploy. That is the feature. The cost of the feature is
 * that a row can be wrong, and a wrong row must fail loudly at the boundary
 * rather than quietly halfway through composing a system prompt — so nothing
 * crosses from `jsonb` into a typed value without going through here.
 *
 * There is no `as BrandScript` anywhere in this unit. This file is the only
 * reason that is possible.
 */

import { z } from "zod";

import type {
  BrandScript,
  FlightPlan,
  NextAction,
} from "@/content/strategy/types";

const nonEmpty = z.string().min(1);

const nextActionSchema = z.object({
  id: nonEmpty,
  action: nonEmpty,
  because: nonEmpty,
  by: nonEmpty,
  doneWhen: nonEmpty,
});

/* ------------------------------------------------------------ BrandScript */

const characterSchema = z.object({
  id: z.enum(["b2c", "b2b"]),
  label: nonEmpty,
  who: nonEmpty,
  wants: nonEmpty,
  evidence: nonEmpty,
});

const problemSchema = z.object({
  external: nonEmpty,
  internal: nonEmpty,
  philosophical: nonEmpty,
  villain: nonEmpty,
});

const guideSchema = z.object({
  empathy: nonEmpty,
  authority: z.array(nonEmpty).min(1),
});

const planSchema = z.object({
  process: z
    .array(
      z.object({
        step: z.number().int().positive(),
        title: nonEmpty,
        detail: nonEmpty,
      }),
    )
    .min(1),
  agreement: z.array(nonEmpty).min(1),
});

const ctaSchema = z.object({
  label: nonEmpty,
  href: nonEmpty,
  live: z.boolean(),
  note: nonEmpty,
});

const stakesSchema = z.object({
  failure: z.array(nonEmpty).min(1),
  success: z.array(nonEmpty).min(1),
  transformation: z.object({ from: nonEmpty, to: nonEmpty }),
});

const audienceScriptSchema = z.object({
  character: characterSchema,
  problem: problemSchema,
  guide: guideSchema,
  plan: planSchema,
  calls: z.object({ direct: ctaSchema, transitional: ctaSchema }),
  stakes: stakesSchema,
});

const brandScriptSchema = z.object({
  version: nonEmpty,
  purpose: nonEmpty,
  audiences: z.object({ b2c: audienceScriptSchema, b2b: audienceScriptSchema }),
  derived: z.object({
    oneLiner: nonEmpty,
    controllingIdea: nonEmpty,
    elevatorPitch: nonEmpty,
    tradeOneLiner: nonEmpty,
  }),
  nextActions: z.array(nextActionSchema),
});

/* ------------------------------------------------------------ Flight Plan */

const sectionCommon = {
  aircraft: nonEmpty,
  discipline: nonEmpty,
  purpose: nonEmpty,
  failureMode: nonEmpty,
};

const leadershipSchema = z.object({
  ...sectionCommon,
  part: z.literal("cockpit"),
  mission: z.object({
    goal: nonEmpty,
    by: nonEmpty,
    because: z.array(nonEmpty).min(1),
    statement: nonEmpty,
  }),
  guidingPrinciples: z
    .array(z.object({ principle: nonEmpty, settles: nonEmpty }))
    .min(1),
  keyCharacteristics: z
    .array(z.object({ characteristic: nonEmpty, looksLike: nonEmpty }))
    .min(1),
});

const marketingSchema = z.object({
  ...sectionCommon,
  part: z.literal("right-engine"),
  oneLiner: nonEmpty,
  leadGenerator: z.object({
    name: nonEmpty,
    promise: nonEmpty,
    format: nonEmpty,
  }),
  nurtureSequence: z.array(
    z.object({
      email: z.number().int().positive(),
      subject: nonEmpty,
      job: nonEmpty,
    }),
  ),
  salesSequence: z.array(
    z.object({
      email: z.number().int().positive(),
      subject: nonEmpty,
      job: nonEmpty,
    }),
  ),
  channels: z.array(
    z.object({
      channel: nonEmpty,
      cadence: nonEmpty,
      job: nonEmpty,
      derivedFrom: nonEmpty,
    }),
  ),
});

const salesSchema = z.object({
  ...sectionCommon,
  part: z.literal("left-engine"),
  processes: z
    .array(
      z.object({
        id: z.enum(["b2c", "b2b"]),
        name: nonEmpty,
        mechanism: nonEmpty,
        cadence: nonEmpty,
        stages: z
          .array(
            z.object({
              stage: z.number().int().positive(),
              name: nonEmpty,
              qualifyingQuestion: nonEmpty,
              action: nonEmpty,
              measure: nonEmpty,
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

const confidenceSchema = z.enum(["sourced", "derived", "estimate"]);

const productsSchema = z.object({
  ...sectionCommon,
  part: z.literal("wings"),
  wings: z
    .array(
      z.object({
        sku: nonEmpty,
        name: nonEmpty,
        job: nonEmpty,
        shelfPriceCents: z.number().int().nonnegative(),
        costBreakdownCents: z
          .array(
            z.object({ item: nonEmpty, cents: z.number().int().nonnegative() }),
          )
          .min(1),
        confidence: confidenceSchema,
        note: nonEmpty,
      }),
    )
    .min(1),
  findings: z.array(nonEmpty),
});

const operationsSchema = z.object({
  ...sectionCommon,
  part: z.literal("body"),
  week: z
    .array(
      z.object({
        day: nonEmpty,
        work: nonEmpty,
        hours: z.number().nonnegative(),
      }),
    )
    .min(1),
  fixedOverhead: z.array(
    z.object({
      item: nonEmpty,
      centsPerMonth: z.number().int().nonnegative(),
      confidence: confidenceSchema,
    }),
  ),
  perOrderCosts: z.array(
    z.object({
      item: nonEmpty,
      cents: z.number().int().nonnegative(),
      note: nonEmpty,
    }),
  ),
  constraints: z.array(nonEmpty),
});

const cashFlowSchema = z.object({
  ...sectionCommon,
  part: z.literal("fuel-tanks"),
  accounts: z
    .array(z.object({ account: nonEmpty, holds: nonEmpty, rule: nonEmpty }))
    .min(1),
  operatingBufferMonths: z.number().positive(),
  gst: z.object({
    ratePercent: z.number().nonnegative(),
    registrationThresholdCents: z.number().int().nonnegative(),
    filingBasis: nonEmpty,
    note: nonEmpty,
  }),
  rules: z.array(nonEmpty),
});

const flightPlanSchema = z.object({
  version: nonEmpty,
  purpose: nonEmpty,
  cockpit: leadershipSchema,
  rightEngine: marketingSchema,
  leftEngine: salesSchema,
  wings: productsSchema,
  body: operationsSchema,
  fuelTanks: cashFlowSchema,
  nextActions: z.array(nextActionSchema),
});

/* ----------------------------------------------- the market narrative row */

/**
 * The market document holds only the words. Every number lives in
 * `strategy_assumptions` and the arithmetic lives in
 * `content/strategy/market.ts`, so there is exactly one place a market figure
 * can come from and it is never a stale copy in a JSON blob.
 */
export interface MarketNarrative {
  readonly purpose: string;
  readonly basis: string;
  readonly headwinds: readonly string[];
  readonly nextActions: readonly NextAction[];
}

const marketNarrativeSchema = z.object({
  purpose: nonEmpty,
  basis: nonEmpty,
  headwinds: z.array(nonEmpty),
  nextActions: z.array(nextActionSchema),
});

/* ------------------------------------------------------------- the doors */

export class StrategyDecodeError extends Error {
  constructor(
    readonly slug: string,
    readonly issues: string,
  ) {
    super(`strategy_documents row "${slug}" is not usable: ${issues}`);
    this.name = "StrategyDecodeError";
  }
}

function issueText(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function decodeBrandScript(slug: string, body: unknown): BrandScript {
  const parsed = brandScriptSchema.safeParse(body);
  if (!parsed.success) {
    throw new StrategyDecodeError(slug, issueText(parsed.error));
  }
  return parsed.data;
}

export function decodeFlightPlan(slug: string, body: unknown): FlightPlan {
  const parsed = flightPlanSchema.safeParse(body);
  if (!parsed.success) {
    throw new StrategyDecodeError(slug, issueText(parsed.error));
  }
  return parsed.data;
}

export function decodeMarketNarrative(
  slug: string,
  body: unknown,
): MarketNarrative {
  const parsed = marketNarrativeSchema.safeParse(body);
  if (!parsed.success) {
    throw new StrategyDecodeError(slug, issueText(parsed.error));
  }
  return parsed.data;
}
