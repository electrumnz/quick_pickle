/**
 * Model resolution.
 *
 * Production talks to Anthropic through the AI SDK's Anthropic provider. Tests
 * and evidence runs hand in a {@link ScriptedModel}. Nothing else in the runtime
 * knows which is in play, which is the point: the safety properties are
 * properties of the runtime, so they must hold identically either way.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/** The default role model. */
export const DEFAULT_AGENT_MODEL = "claude-opus-5";

/** Resolves a model id to something `generateText` can call. */
export interface ModelResolver {
  /** Which backend this resolver represents; recorded on every run for provenance. */
  readonly kind: "anthropic" | "scripted";
  resolve(modelId: string): LanguageModel;
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
 * Returns `null` when live calls are asked for but no key is present, so a
 * caller can fall back to a scripted model rather than crash at import time.
 */
export function resolverFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ModelResolver | null {
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
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env["ANTHROPIC_MODEL"];
  return override === undefined || override.length === 0 ? fallback : override;
}
