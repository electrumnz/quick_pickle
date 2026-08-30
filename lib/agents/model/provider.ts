/**
 * Model resolution.
 *
 * Three backends, one interface. Production talks to whatever the deployment is
 * configured for — the Vercel AI Gateway (`gateway`) or Anthropic directly
 * (`anthropic`) — and tests and evidence runs hand in a {@link ScriptedModel}.
 * Nothing else in the runtime knows which is in play, which is the point: the
 * safety properties are properties of the runtime, so they must hold identically
 * whichever backend answered.
 *
 * ## Why the gateway
 *
 * The roster is eight roles on five different budgets calling twenty-three
 * tools. Putting one HTTP endpoint in front of every model means the model a
 * role runs on is an id in `ROSTER_MODEL_DEFAULTS` and an environment
 * variable — not a provider package, not a client, not a code change. That
 * matters more than usual here because the models the roster currently runs on
 * are free for a fixed number of days (see `roster-models.ts`), and the swap has
 * to be possible from a dashboard by someone who is not a programmer.
 *
 * ## The cutoff
 *
 * {@link createGatewayResolver} refuses to resolve a free-tier model once
 * {@link FREE_WINDOW_ENDS} has passed. It fails closed on purpose: the run halts
 * with the reason recorded, nothing reaches the network, and nothing is billed.
 * A model id that is not free-tier is never refused, whatever the date — the
 * cutoff exists to stop an accidental bill, not to overrule a deliberate choice.
 */

import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway, type LanguageModel } from "ai";

import { AgentRuntimeError } from "../errors";

import {
  FREE_WINDOW_ENDS,
  hasGatewayCredential,
  liveModelUnavailableReason,
  modelUnavailableReason,
  type ModelEnv,
} from "./roster-models";

export {
  hasGatewayCredential,
  liveModelUnavailableReason,
} from "./roster-models";

/** The default role model when nothing else names one. */
export const DEFAULT_AGENT_MODEL = "claude-opus-5";

/** Which backend answered. Recorded on every run and every cost row. */
export type ModelBackend = "anthropic" | "gateway" | "scripted";

/** Resolves a model id to something `generateText` can call. */
export interface ModelResolver {
  /** Which backend this resolver represents; recorded on every run for provenance. */
  readonly kind: ModelBackend;
  resolve(modelId: string): LanguageModel;
  /**
   * Backend-specific settings the runtime passes to every call.
   *
   * The runtime does not know what is in here and must not: it spreads it into
   * `generateText` and nothing else. The gateway uses it to carry the routing
   * policy — chiefly whether a provider that trains on prompt data may serve the
   * request at all, which is a decision about the company's customers rather
   * than about a model.
   */
  readonly providerOptions?: ProviderOptions;
}

/** Live Anthropic models via `@ai-sdk/anthropic`. */
export function createAnthropicResolver(options: {
  readonly apiKey: string;
  readonly baseURL?: string;
}): ModelResolver {
  const anthropic = createAnthropic({
    apiKey: options.apiKey,
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
  });
  return {
    kind: "anthropic",
    resolve: (modelId: string) => anthropic(modelId),
  };
}

/**
 * Every model on the Vercel AI Gateway, by `provider/model` id.
 *
 * `@ai-sdk/gateway` ships inside `ai@7`, so this adds no dependency. Two ways to
 * authenticate, both supported here:
 *
 *  - **`AI_GATEWAY_API_KEY`.** A key minted in the Vercel dashboard. Works
 *    anywhere — locally, in CI, on another host. Pass it as `apiKey`.
 *  - **Vercel OIDC.** On Vercel the platform mints a short-lived token into
 *    `VERCEL_OIDC_TOKEN` and the gateway provider picks it up on its own when no
 *    `apiKey` is given. That is why `apiKey` is omitted rather than passed as an
 *    empty string when it is absent: an empty string would be sent as a
 *    credential and refused, where omitting it lets OIDC answer.
 *
 * `now` is injected rather than read from `Date.now()` so both sides of the free
 * window can be tested without waiting for one of them, and `fetch` is injected
 * so what this actually puts on the wire — the model id, the twenty-three tool
 * definitions, the framed tool results — is assertable without a credential and
 * without a network.
 *
 * ## Prompt training, stated plainly
 *
 * The gateway takes two routing filters that matter to a company whose agents
 * read what customers wrote: `disallowPromptTraining` restricts routing to
 * providers that do not train on prompt data, and `zeroDataRetention` to
 * providers that keep none of it. Both are **off by default here**, and that is
 * a consequence of the model choice rather than an oversight: the gateway
 * catalogue reports `no_training: "none"` and `zdr: "none"` for
 * `minimax/minimax-m3-free` and `minimax/minimax-m2.7-free`, so turning either
 * filter on leaves no provider able to serve the free ids and every call fails.
 *
 * They are one environment variable each — `AI_GATEWAY_DISALLOW_PROMPT_TRAINING`
 * and `AI_GATEWAY_ZERO_DATA_RETENTION` — and the paid `minimax/minimax-m3` is
 * `no_training: "some"`, meaning some providers serving it do honour it. So the
 * combination that a company sending customer prose to a third party actually
 * wants is a paid model id plus the filter on, and it is reachable without a
 * code change. Which is the point of putting the model behind an env var.
 */
export function createGatewayResolver(options: {
  /** Omit to let Vercel OIDC supply the credential. */
  readonly apiKey?: string;
  readonly baseURL?: string;
  /** Reads the clock the cutoff is measured against. Defaults to the real one. */
  readonly now?: () => Date;
  /** Substituted in tests to inspect the request. Defaults to the platform's. */
  readonly fetch?: typeof globalThis.fetch;
  /** Refuse to route to a provider that trains on prompt data. */
  readonly disallowPromptTraining?: boolean;
  /** Refuse to route to a provider that retains prompt data. */
  readonly zeroDataRetention?: boolean;
}): ModelResolver {
  const gateway = createGateway({
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const now = options.now ?? (() => new Date());
  const routing = {
    ...(options.disallowPromptTraining === true
      ? { disallowPromptTraining: true }
      : {}),
    ...(options.zeroDataRetention === true ? { zeroDataRetention: true } : {}),
  };
  return {
    kind: "gateway",
    ...(Object.keys(routing).length === 0
      ? {}
      : { providerOptions: { gateway: routing } }),
    resolve: (modelId: string) => {
      const unavailable = modelUnavailableReason(modelId, now());
      if (unavailable !== null) {
        // Thrown, not returned: `AgentRuntime.modelStep` resolves the model
        // inside the same try that wraps the call, so this halts the run with
        // the reason on the record and never opens a socket.
        throw new AgentRuntimeError("model_unavailable", unavailable, {
          model: modelId,
          freeWindowEnds: FREE_WINDOW_ENDS.toISOString(),
        });
      }
      return gateway(modelId);
    },
  };
}

/** Always returns the same scripted model, whatever id is asked for. */
export function createScriptedResolver(model: LanguageModel): ModelResolver {
  return {
    kind: "scripted",
    resolve: () => model,
  };
}

/**
 * Build the resolver the deployment is configured for.
 *
 * Gateway first, Anthropic second, `null` last. Returning `null` rather than
 * throwing is what lets a caller degrade to an offline model: the site, the
 * admin and the Inngest endpoint all keep working with no credential at all,
 * and only the thinking stops.
 */
export function resolverFromEnv(
  env: ModelEnv = process.env,
  now: () => Date = () => new Date(),
): ModelResolver | null {
  if (liveModelUnavailableReason(env, now()) !== null) {
    return null;
  }
  if (hasGatewayCredential(env)) {
    const apiKey = env["AI_GATEWAY_API_KEY"]?.trim();
    const baseURL = env["AI_GATEWAY_BASE_URL"]?.trim();
    return createGatewayResolver({
      ...(apiKey === undefined || apiKey === "" ? {} : { apiKey }),
      ...(baseURL === undefined || baseURL === "" ? {} : { baseURL }),
      ...(env["AI_GATEWAY_DISALLOW_PROMPT_TRAINING"]?.trim() === "1"
        ? { disallowPromptTraining: true }
        : {}),
      ...(env["AI_GATEWAY_ZERO_DATA_RETENTION"]?.trim() === "1"
        ? { zeroDataRetention: true }
        : {}),
      now,
    });
  }
  const apiKey = env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey.length === 0) {
    return null;
  }
  const baseURL = env["ANTHROPIC_BASE_URL"];
  return createAnthropicResolver({
    apiKey,
    ...(baseURL === undefined ? {} : { baseURL }),
  });
}

/** The model id an agent should use, honouring an environment override. */
export function modelIdFromEnv(
  fallback: string = DEFAULT_AGENT_MODEL,
  env: ModelEnv = process.env,
): string {
  const override = env["ANTHROPIC_MODEL"];
  return override === undefined || override.length === 0 ? fallback : override;
}
