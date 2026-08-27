/**
 * The Inngest endpoint.
 *
 * Inngest calls this route to run each step of a durable agent run. It is an
 * API surface, not part of the admin UI.
 */

import { serve } from "inngest/next";

import { configureAgentPlatform, functions, inngest } from "@/inngest";
import { ToolRegistry, createProductionRuntime } from "@/lib/agents";

/**
 * Wire the runtime the functions will use.
 *
 * The tool registry and the agent definitions belong to the roles that use them,
 * not to the runtime, so this starts empty: the unit that defines the company's
 * agents replaces the registry here and calls `platform.runtime.register(...)`
 * for each role. Until then the endpoint serves the functions and the runtime
 * refuses work for agents it has never been told about.
 */
configureAgentPlatform(() =>
  createProductionRuntime({ registry: new ToolRegistry() }),
);

export const { GET, POST, PUT } = serve({ client: inngest, functions });
