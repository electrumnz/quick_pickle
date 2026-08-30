/**
 * The roster, assembled.
 *
 * One call gets you every role in the company, built against the strategy as it
 * stands in the database right now. Nothing is cached: an agent started after a
 * strategy edit picks the edit up, which is the entire reason the strategy lives
 * in `strategy_documents` rather than in a constant.
 *
 * `registerRoster` then reconciles all nine into `public.agents` through the
 * runtime's own `register`, so what the admin lists is what the runtime will
 * actually run — not a card someone drew.
 */

import type { Strategy } from "@/content/strategy/types";
import { loadStrategyAgents, type StrategyStore } from "@/lib/strategy";

import {
  StaticCapabilityDirectory,
  type Capability,
  type CapabilityAdvertisement,
  type CapabilityDirectory,
} from "../boundary/handoff";

import type { AgentRuntime } from "../runtime/runtime";
import type { AgentDefinition } from "../types";
import {
  analystRole,
  conciergeRole,
  financeRole,
  marketingRole,
  opsRole,
  productRole,
  securityRole,
  socialRole,
  tradeRole,
} from "./definitions";
import type { RosterRole } from "./types";

/**
 * Every slug in the roster, in the order the admin lists them: the ones that
 * keep the doors open first, then the ones that grow it, then the ones that
 * report on it.
 */
export const ROSTER_SLUGS = [
  "brine-ops",
  "concierge",
  "ledger",
  "social",
  "marketing",
  "trade",
  "product",
  "analyst",
  "security",
] as const;

export type RosterSlug = (typeof ROSTER_SLUGS)[number];

export interface Roster {
  readonly roles: readonly RosterRole[];
  readonly strategy: Strategy;
}

/** Build all nine roles from one loaded strategy plus the two strategy agents. */
export function buildRoster(
  strategy: Strategy,
  strategyAgents: {
    readonly marketing: AgentDefinition;
    readonly trade: AgentDefinition;
  },
): Roster {
  const roles: readonly RosterRole[] = [
    opsRole(strategy),
    conciergeRole(strategy),
    financeRole(strategy),
    socialRole(strategy),
    marketingRole(strategyAgents.marketing),
    tradeRole(strategyAgents.trade),
    productRole(strategy),
    analystRole(strategy),
    securityRole(strategy),
  ];
  return { roles, strategy };
}

/**
 * Load the strategy once and build the whole roster from it.
 *
 * The same read that gives Ari and Vic their prompts gives the other six theirs,
 * so the company cannot end up with two positions.
 */
export async function loadRoster(store: StrategyStore): Promise<Roster> {
  const agents = await loadStrategyAgents(store);
  return buildRoster(agents.strategy, {
    marketing: agents.marketing,
    trade: agents.trade,
  });
}

/** Look a role up by slug. */
export function roleFor(roster: Roster, slug: string): RosterRole | null {
  return roster.roles.find((role) => role.definition.slug === slug) ?? null;
}

/**
 * Make every role known to the runtime and reconcile it into `public.agents`.
 *
 * Returns the agent id per slug. Registration is the runtime's own method, so a
 * role that would not survive the database's check constraints fails here,
 * loudly, rather than at the first run.
 */
export async function registerRoster(
  runtime: AgentRuntime,
  roster: Roster,
): Promise<Readonly<Record<string, string>>> {
  const ids: Record<string, string> = {};
  for (const role of roster.roles) {
    ids[role.definition.slug] = await runtime.register(role.definition);
  }
  return ids;
}

/** Every tool any role in the roster is granted, deduplicated and sorted. */
export function grantedToolNames(roster: Roster): readonly string[] {
  const names = new Set<string>();
  for (const role of roster.roles) {
    for (const tool of role.definition.tools) names.add(tool);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

/**
 * The phone book: who advertises what.
 *
 * Built from the roster rather than hand-written, so a role added to
 * `buildRoster` is routable the moment it exists and a role removed stops being
 * routable at the same instant. This is what lets a handoff name a capability
 * instead of an agent.
 */
export function capabilityDirectory(roster: Roster): CapabilityDirectory {
  const ads: CapabilityAdvertisement[] = roster.roles.map((role) => ({
    agentSlug: role.definition.slug,
    agentName: role.definition.name,
    capabilities: [...role.capabilities],
  }));
  return new StaticCapabilityDirectory(ads);
}

/** Every capability advertised by anyone in the roster, deduplicated and sorted. */
export function advertisedCapabilities(roster: Roster): readonly Capability[] {
  const names = new Set<Capability>();
  for (const role of roster.roles) {
    for (const capability of role.capabilities) names.add(capability);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}
