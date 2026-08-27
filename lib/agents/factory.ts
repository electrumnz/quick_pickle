/**
 * Assembling a runtime.
 *
 * Two ways in: {@link createAgentRuntime} wires an explicit set of parts (used
 * by tests and by the evidence scripts), and {@link createProductionRuntime}
 * builds the real one from environment configuration. Both produce the same
 * object with the same guarantees.
 */

import { ApprovalService } from "./approvals/service";
import { systemClock, type Clock } from "./clock";
import { StoreControlPlane, type ControlPlane } from "./control/kill-switch";
import { CostMeter } from "./cost/meter";
import { AgentRuntimeError } from "./errors";
import { createConsoleLogger, type AgentLogger } from "./logger";
import { resolverFromEnv, type ModelResolver } from "./model/provider";
import {
  SupabaseAgentStore,
  createServiceClient,
} from "./store/supabase-store";
import type { AgentStore } from "./store/types";
import type { ToolRegistry } from "./tools/registry";
import { AgentRuntime } from "./runtime/runtime";
import { RunHistory } from "./runtime/history";

/** Everything a fully wired runtime exposes. */
export interface AgentPlatform {
  readonly runtime: AgentRuntime;
  readonly store: AgentStore;
  readonly approvals: ApprovalService;
  readonly control: ControlPlane;
  readonly meter: CostMeter;
  readonly history: RunHistory;
  readonly logger: AgentLogger;
  readonly clock: Clock;
}

export interface CreateRuntimeOptions {
  readonly store: AgentStore;
  readonly registry: ToolRegistry;
  readonly models: ModelResolver;
  readonly clock?: Clock;
  readonly logger?: AgentLogger;
  readonly control?: ControlPlane;
  readonly controlPollIntervalMs?: number;
  readonly fxNzdPerUsd?: number;
}

/** Wire a runtime from explicit parts. */
export function createAgentRuntime(
  options: CreateRuntimeOptions,
): AgentPlatform {
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? createConsoleLogger();
  const control =
    options.control ?? new StoreControlPlane(options.store, clock, logger);
  const approvals = new ApprovalService(options.store, clock, logger);
  const meter = new CostMeter({
    store: options.store,
    clock,
    logger,
    ...(options.fxNzdPerUsd === undefined
      ? {}
      : { fxNzdPerUsd: options.fxNzdPerUsd }),
  });
  const runtime = new AgentRuntime({
    store: options.store,
    registry: options.registry,
    control,
    approvals,
    meter,
    models: options.models,
    clock,
    logger,
    ...(options.controlPollIntervalMs === undefined
      ? {}
      : { controlPollIntervalMs: options.controlPollIntervalMs }),
  });
  return {
    runtime,
    store: options.store,
    approvals,
    control,
    meter,
    history: new RunHistory(options.store),
    logger,
    clock,
  };
}

/**
 * The real runtime: Supabase for storage, Anthropic for inference.
 *
 * @throws AgentRuntimeError when `ANTHROPIC_API_KEY` is absent. The runtime is
 * fully testable without it, but it will not pretend to run live work without a
 * model behind it.
 */
export function createProductionRuntime(options: {
  readonly registry: ToolRegistry;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly logger?: AgentLogger;
}): AgentPlatform {
  const env = options.env ?? process.env;
  const models = resolverFromEnv(env);
  if (models === null) {
    throw new AgentRuntimeError(
      "invalid_agent_definition",
      "ANTHROPIC_API_KEY is not set; the production runtime has no model to call.",
    );
  }
  return createAgentRuntime({
    store: new SupabaseAgentStore(createServiceClient(env)),
    registry: options.registry,
    models,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}
