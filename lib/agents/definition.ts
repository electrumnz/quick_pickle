import { z } from "zod";

import { DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_STEPS } from "./constants";
import { AgentRuntimeError } from "./errors";
import {
  AGENT_AUTONOMIES,
  APPROVAL_SUBJECTS,
  type AgentDefinition,
  type AgentRecord,
} from "./types";

/** Matches the `agents_slug_format` check constraint. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** Matches the `agent_tool_calls_name_format` check constraint. */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_.]*$/;

const budgetSchema = z
  .object({
    perRunCents: z.number().int().nonnegative(),
    dailyCents: z.number().int().nonnegative(),
    monthlyCents: z.number().int().nonnegative(),
    singleActionCents: z.number().int().nonnegative().optional(),
  })
  .refine((budget) => budget.monthlyCents >= budget.dailyCents, {
    message:
      "monthlyCents must be >= dailyCents (mirrors agents_monthly_ge_daily)",
  })
  .refine((budget) => budget.dailyCents >= budget.perRunCents, {
    message:
      "dailyCents must be >= perRunCents; a run that cannot finish inside the day cap is a trap",
  });

const definitionSchema = z
  .object({
    slug: z
      .string()
      .regex(SLUG_PATTERN, "slug must match ^[a-z0-9][a-z0-9-]*$"),
    name: z.string().min(1),
    jobTitle: z.string().min(1),
    purpose: z.string().min(1),
    model: z.string().min(1),
    systemPrompt: z.string().min(1),
    tools: z.array(z.string().regex(TOOL_NAME_PATTERN)).readonly(),
    autonomy: z.enum(AGENT_AUTONOMIES),
    requiresApprovalFor: z.array(z.enum(APPROVAL_SUBJECTS)).readonly(),
    budget: budgetSchema,
    maxSteps: z.number().int().positive().default(DEFAULT_MAX_STEPS),
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_MAX_OUTPUT_TOKENS),
    brandRuleScopes: z.array(z.string()).readonly().default([]),
    schedule: z
      .object({ cron: z.string().min(1), timezone: z.string().min(1) })
      .optional(),
  })
  // Mirrors `agents_autonomy_approvals`: an observe-only agent has nothing to approve.
  .refine(
    (definition) =>
      definition.autonomy !== "observe" ||
      definition.requiresApprovalFor.length === 0,
    {
      message: "an observe agent may not declare requiresApprovalFor subjects",
    },
  )
  // Mirrors `agents_propose_needs_subjects`.
  .refine(
    (definition) =>
      definition.autonomy !== "propose" ||
      definition.requiresApprovalFor.length > 0,
    { message: "a propose agent must declare at least one approval subject" },
  )
  .refine(
    (definition) => new Set(definition.tools).size === definition.tools.length,
    {
      message: "duplicate tool names in the grant list",
    },
  );

/** The shape callers pass to {@link defineAgent}. */
export type AgentDefinitionInput = z.input<typeof definitionSchema>;

/**
 * Declare a role.
 *
 * This is the whole surface for adding a new agent to the company: no new
 * codepath, no new function, just a definition. The returned object is frozen —
 * a role's grants must not be mutable at runtime.
 */
export function defineAgent(input: AgentDefinitionInput): AgentDefinition {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new AgentRuntimeError(
      "invalid_agent_definition",
      `Invalid agent definition "${String(input.slug)}": ${issues}`,
      { slug: String(input.slug) },
    );
  }
  const value = parsed.data;
  return Object.freeze({
    slug: value.slug,
    name: value.name,
    jobTitle: value.jobTitle,
    purpose: value.purpose,
    model: value.model,
    systemPrompt: value.systemPrompt,
    tools: Object.freeze([...value.tools]),
    autonomy: value.autonomy,
    requiresApprovalFor: Object.freeze([...value.requiresApprovalFor]),
    budget: Object.freeze({ ...value.budget }),
    maxSteps: value.maxSteps,
    ...(value.temperature === undefined
      ? {}
      : { temperature: value.temperature }),
    maxOutputTokens: value.maxOutputTokens,
    brandRuleScopes: Object.freeze([...value.brandRuleScopes]),
    ...(value.schedule === undefined
      ? {}
      : { schedule: Object.freeze({ ...value.schedule }) }),
  });
}

/**
 * Project a definition onto the column set of `public.agents`, so a role can be
 * seeded or reconciled into the database without a hand-written INSERT.
 */
export function definitionToAgentRow(definition: AgentDefinition): {
  slug: string;
  name: string;
  job_title: string;
  purpose: string;
  model: string;
  system_prompt: string;
  tools: string[];
  autonomy: AgentDefinition["autonomy"];
  requires_approval_for: string[];
  daily_spend_cap_cents: number;
  monthly_spend_cap_cents: number;
  single_action_cap_cents: number | null;
  schedule_cron: string | null;
  timezone: string;
} {
  return {
    slug: definition.slug,
    name: definition.name,
    job_title: definition.jobTitle,
    purpose: definition.purpose,
    model: definition.model,
    system_prompt: definition.systemPrompt,
    tools: [...definition.tools],
    autonomy: definition.autonomy,
    requires_approval_for: [...definition.requiresApprovalFor],
    daily_spend_cap_cents: definition.budget.dailyCents,
    monthly_spend_cap_cents: definition.budget.monthlyCents,
    single_action_cap_cents: definition.budget.singleActionCents ?? null,
    schedule_cron: definition.schedule?.cron ?? null,
    timezone: definition.schedule?.timezone ?? "Pacific/Auckland",
  };
}

/**
 * Reconcile a stored agent row over its code-declared definition.
 *
 * The database wins for the fields an operator can change from the admin
 * (autonomy, caps, enablement, tool grants); the code wins for the fields that
 * are part of the deployment (prompt, step ceiling). This is what lets the
 * founder tighten an agent's leash without a deploy.
 */
export function mergeDefinitionWithRecord(
  definition: AgentDefinition,
  record: AgentRecord,
): AgentDefinition {
  return Object.freeze({
    ...definition,
    model: record.model,
    systemPrompt: record.systemPrompt ?? definition.systemPrompt,
    tools: Object.freeze([...record.tools]),
    autonomy: record.autonomy,
    requiresApprovalFor: Object.freeze([...record.requiresApprovalFor]),
    budget: Object.freeze({
      perRunCents: Math.min(
        definition.budget.perRunCents,
        record.dailySpendCapCents,
      ),
      dailyCents: record.dailySpendCapCents,
      monthlyCents: record.monthlySpendCapCents,
      ...(record.singleActionCapCents === null
        ? {}
        : { singleActionCents: record.singleActionCapCents }),
    }),
  });
}
