/**
 * The two roles that reason from the strategy.
 *
 * A role in this company is an `AgentDefinition` and nothing else — no new
 * codepath, no new authorisation rule (see `lib/agents/README.md`). So wiring
 * the strategy to an agent is not a change to the runtime: it is a definition
 * whose `systemPrompt` is composed from data that was loaded out of the
 * database a moment earlier.
 *
 *   ARI  (marketing) writes from the BrandScript.
 *   VIC  (trade)     targets from the market model and the B2B script.
 *
 * Both are `propose` autonomy with an approval subject declared, because
 * everything either of them produces is something a customer could see, and the
 * approval gate in `lib/agents` is what makes that safe rather than a policy
 * anybody has to remember.
 */

import { defineAgent, type AgentDefinition } from "@/lib/agents";
import type { Strategy } from "@/content/strategy/types";

import { composeStrategyBriefing } from "./context";
import type { StrategyStore } from "./store";

/** Scopes each role is loaded with. Mirrors `strategy_documents.applies_to`. */
export const MARKETING_SCOPES = ["social", "email", "storefront"] as const;
export const TRADE_SCOPES = ["wholesale", "pricing", "planning"] as const;

const MARKETING_ROLE_PROMPT = `
You draft social captions, emails and product copy for HALF SOUR, a New Zealand
pickle brine company with exactly one human in it.

You do not decide what the company believes. That is settled below, in the
strategy, and your job is to say it well in the format you have been asked for.

Working rules:
- Open on the customer's problem, not on the product.
- One idea per sentence. No exclamation marks, no puns on the word pickle.
- Every piece carries exactly one call to action, taken from the BrandScript.
- If you cannot make a piece work without inventing a fact — a number, a
  supplier, a place, an award — write less instead and say what is missing.
- Run every draft against the claims rules before you hand it over. When in
  doubt, produce less: an unsent sentence has never breached the Fair Trading
  Act.
`.trim();

const TRADE_ROLE_PROMPT = `
You build and work the trade list for HALF SOUR: the bars, restaurants and
specialty retailers that could carry the range, and the approach to each one.

You do not invent the target. It is in the market model below, and it is a
count of accounts, not a feeling — every venue you propose has to be one the
model would recognise, and you say which segment it came from.

Working rules:
- Qualify before you approach: a spirits-led list, 40 seats or more, and a serve
  already on the menu that this replaces.
- Lead with cost per pour and consistency. A venue under wage pressure buys on
  the spreadsheet, not on the story.
- Trade pricing is one published number. Never offer a different one, never
  imply one is available.
- A case is six bottles. Never propose splitting one.
- Never state a sourcing relationship, an origin or a provenance fact that is
  not already recorded. Where you need one, say so and stop.
`.trim();

function withStrategy(basePrompt: string, briefing: string): string {
  return `${basePrompt}\n\n${briefing}`;
}

/**
 * The marketing role, built against a loaded strategy.
 *
 * `systemPrompt` is a function of `strategy`. That is the whole dependency: a
 * different strategy produces a different definition, which produces a
 * different system prompt, which produces different copy.
 */
export function defineMarketingAgent(strategy: Strategy): AgentDefinition {
  return defineAgent({
    slug: "marketing",
    name: "Ari",
    jobTitle: "Marketing",
    purpose:
      "Writes every customer-facing word from the BrandScript, and never from its own idea of what the brand is.",
    model: "claude-opus-5",
    systemPrompt: withStrategy(
      MARKETING_ROLE_PROMPT,
      composeStrategyBriefing(strategy, {
        scopes: [...MARKETING_SCOPES],
        audience: "b2c",
        includeMarket: false,
      }),
    ),
    tools: ["read_catalogue", "save_internal_draft", "send_external_message"],
    autonomy: "propose",
    requiresApprovalFor: ["social_post", "content_asset", "email_campaign"],
    budget: { perRunCents: 40, dailyCents: 300, monthlyCents: 6_000 },
    maxSteps: 8,
    brandRuleScopes: ["social", "email", "storefront"],
  });
}

/** The trade role, built against the same loaded strategy. */
export function defineTradeAgent(strategy: Strategy): AgentDefinition {
  return defineAgent({
    slug: "trade",
    name: "Vic",
    jobTitle: "Trade",
    purpose:
      "Builds the venue list the market model implies, and drafts the approach to each one.",
    model: "claude-opus-5",
    systemPrompt: withStrategy(
      TRADE_ROLE_PROMPT,
      composeStrategyBriefing(strategy, {
        scopes: [...TRADE_SCOPES],
        audience: "b2b",
        includeMarket: true,
      }),
    ),
    tools: ["read_catalogue", "save_internal_draft", "send_external_message"],
    autonomy: "propose",
    requiresApprovalFor: ["email_outreach", "content_asset"],
    budget: { perRunCents: 40, dailyCents: 300, monthlyCents: 6_000 },
    maxSteps: 8,
    brandRuleScopes: ["wholesale", "email"],
  });
}

export interface StrategyAgents {
  readonly marketing: AgentDefinition;
  readonly trade: AgentDefinition;
  readonly strategy: Strategy;
}

/**
 * Load the strategy and build both roles from it.
 *
 * This is the call site the agent runtime uses: one read of
 * `strategy_documents` and `strategy_assumptions`, then two definitions that
 * carry it. Nothing is cached — an agent started after a strategy edit picks
 * the edit up, which is the point of storing it in the database at all.
 */
export async function loadStrategyAgents(
  store: StrategyStore,
): Promise<StrategyAgents> {
  const strategy = await store.loadStrategy();
  return {
    marketing: defineMarketingAgent(strategy),
    trade: defineTradeAgent(strategy),
    strategy,
  };
}
