/**
 * How the Inngest functions get hold of a wired runtime.
 *
 * The tool registry belongs to the roles that use it, not to the runtime, so
 * this module takes a factory rather than constructing one. The app wires it
 * once at startup; tests wire a scripted one.
 */

import { AgentRuntimeError } from "@/lib/agents/errors";
import type { AgentPlatform } from "@/lib/agents/factory";

let factory: (() => AgentPlatform) | null = null;
let cached: AgentPlatform | null = null;

/** Install the factory. Call once, at module load, before any function runs. */
export function configureAgentPlatform(create: () => AgentPlatform): void {
  factory = create;
  cached = null;
}

/** The wired runtime. Built on first use and reused for the process lifetime. */
export function getAgentPlatform(): AgentPlatform {
  if (cached !== null) {
    return cached;
  }
  if (factory === null) {
    throw new AgentRuntimeError(
      "invalid_agent_definition",
      "No agent platform configured. Call configureAgentPlatform() before serving Inngest functions.",
    );
  }
  cached = factory();
  return cached;
}

/** Drop the cached platform. Used between tests. */
export function resetAgentPlatform(): void {
  factory = null;
  cached = null;
}
