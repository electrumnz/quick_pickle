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
import {
  liveModelUnavailableReason,
  resolverFromEnv,
  type ModelResolver,
} from "./model/provider";
import { createStandbyResolver } from "./model/standby";
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
 * The real runtime: Supabase for storage, the AI Gateway for inference.
 *
 * It does not throw when there is no model.
 *
 * That used to be the behaviour, and the reasoning was sound as far as it went:
 * an agent platform with nothing behind it should fail at wiring time rather
 * than at three in the morning. What it missed is *where* the wiring happens.
 * `app/api/inngest/route.ts` builds this at module scope, so a throw does not
 * fail one run — it takes the endpoint down, and a deployment with no gateway
 * key looks broken in a way that has nothing to do with the thing that is
 * actually missing.
 *
 * So it degrades instead, to {@link createStandbyResolver}: every run opens,
 * every run's first model call fails with the reason written out in full, and
 * the reason lands in `agent_runs.error` and `context.halt` where the admin
 * already reads it. Nothing reaches the network and nothing is billed. The
 * distinction that matters is preserved on the record either way — a standby
 * run is `modelProvider: "scripted"`, so it can never be mistaken for a live
 * one.
 *
 * Set `requireLiveModel` when a caller genuinely cannot continue without a
 * model — a script whose whole purpose is a live call, say — and it throws as
 * before.
 */
export function createProductionRuntime(options: {
  readonly registry: ToolRegistry;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly logger?: AgentLogger;
  /** Throw rather than degrade when no live model is configured. */
  readonly requireLiveModel?: boolean;
}): AgentPlatform {
  const env = options.env ?? process.env;
  const unavailable = liveModelUnavailableReason(env);
  if (unavailable !== null && options.requireLiveModel === true) {
    throw new AgentRuntimeError("model_unavailable", unavailable);
  }
  const models =
    resolverFromEnv(env) ??
    createStandbyResolver(unavailable ?? UNKNOWN_MODEL_REASON);
  return createAgentRuntime({
    store: new SupabaseAgentStore(createServiceClient(env)),
    registry: options.registry,
    models,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}

/** Belt and braces: `resolverFromEnv` returned null with no reason to give. */
const UNKNOWN_MODEL_REASON =
  "No model is configured for this deployment, and the reason could not be " +
  "determined. Set AI_GATEWAY_API_KEY to run the roster on the Vercel AI Gateway.";
