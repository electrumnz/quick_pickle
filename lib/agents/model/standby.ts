/**
 * The model the company runs on when it has no model.
 *
 * Two things must both be true when there is no gateway credential, or when the
 * free window has closed and nobody has chosen a paid model:
 *
 *  - **The app keeps working.** The Inngest endpoint is wired at import time. A
 *    runtime that throws while being assembled takes the route down with it, and
 *    a route that is down is a deployment that looks broken for a reason that
 *    has nothing to do with the storefront.
 *  - **No run pretends to have thought.** A run that quietly succeeds having
 *    called nothing is worse than one that stops, because it enters the history
 *    the founder reads as though work happened.
 *
 * So the platform is assembled, every run opens, and the first model call fails
 * with the reason written out in full. The run is recorded `failed` with
 * `model_call_failed: <reason>` in `agent_runs.error` and in `context.halt`,
 * which is exactly where the admin already looks. Nothing is billed, because
 * nothing is called: this class has no network access of any kind.
 *
 * It is a {@link ScriptedModel} in every sense that matters — deterministic,
 * offline, no credential — which is why {@link createStandbyResolver} reports
 * `kind: "scripted"`. Runs made under it are marked as such on their own
 * provenance and can never be mistaken for live ones.
 */

import type {
  LanguageModelV4,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";

import type { ModelResolver } from "./provider";

/** A `LanguageModelV4` that refuses every call with one stated reason. */
export class StandbyModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "half-sour-standby";
  readonly modelId = "standby";
  readonly supportedUrls: Record<string, RegExp[]> = {};

  /** How many calls were refused. Read by the tests that prove none went out. */
  refusals = 0;

  constructor(readonly reason: string) {}

  async doGenerate(): Promise<LanguageModelV4GenerateResult> {
    this.refusals += 1;
    throw new Error(this.reason);
  }

  async doStream(): Promise<LanguageModelV4StreamResult> {
    this.refusals += 1;
    throw new Error(this.reason);
  }
}

/**
 * A resolver that hands back {@link StandbyModel} whatever it is asked for.
 *
 * The reason travels with it, so the halt on the run says why rather than
 * "model call failed".
 */
export function createStandbyResolver(reason: string): ModelResolver {
  const model = new StandbyModel(reason);
  return {
    kind: "scripted",
    resolve: () => model,
  };
}
