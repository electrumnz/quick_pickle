/**
 * How the Inngest functions get hold of a wired runtime.
 *
 * The tool registry belongs to the roles that use it, not to the runtime, so
 * this module takes a factory rather than constructing one. The app wires it
 * once at startup; tests wire a scripted one.
 *
 * The factory may be async, and the real one is. Wiring the company's roster
 * means reading the strategy out of `strategy_documents` and reconciling all
 * eight roles into `public.agents` — both of which are round trips to Postgres,
 * and neither of which can happen while a module is being imported. So the
 * factory is awaited on first use and the *promise* is cached, not the result:
 * two Inngest steps arriving at once get one registration between them rather
 * than two racing each other into the same table.
 */

import { AgentRuntimeError } from "@/lib/agents/errors";
import type { AgentPlatform } from "@/lib/agents/factory";

/** A factory may build the platform synchronously or asynchronously. */
export type AgentPlatformFactory = () => AgentPlatform | Promise<AgentPlatform>;

let factory: AgentPlatformFactory | null = null;
let pending: Promise<AgentPlatform> | null = null;

/** Install the factory. Call once, at module load, before any function runs. */
export function configureAgentPlatform(create: AgentPlatformFactory): void {
  factory = create;
  pending = null;
}

/** The wired runtime. Built on first use and reused for the process lifetime. */
export async function getAgentPlatform(): Promise<AgentPlatform> {
  if (pending !== null) {
    return pending;
  }
  if (factory === null) {
    throw new AgentRuntimeError(
      "invalid_agent_definition",
      "No agent platform configured. Call configureAgentPlatform() before serving Inngest functions.",
    );
  }
  const create = factory;
  // Cached before it settles, so concurrent callers share one build. Cleared on
  // failure so a transient database error at startup is retried rather than
  // remembered for the life of the process.
  pending = (async () => create())().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** Drop the cached platform. Used between tests. */
export function resetAgentPlatform(): void {
  factory = null;
  pending = null;
}
