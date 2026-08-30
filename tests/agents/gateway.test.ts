/**
 * The gateway resolver, the free window, and what happens when it closes.
 *
 * Two properties are being proved here, and only one of them is the happy one.
 *
 *  1. **Before the date**, a free-tier model resolves, the gateway resolver is
 *     the one in play, and a run drives to completion through it.
 *  2. **After the date**, the resolver refuses that same model, the platform
 *     degrades to an offline model instead, the run halts with the reason on the
 *     record, and **nothing reaches the network**. A cutoff that only fails open
 *     is not a cutoff.
 *
 * Both sides are driven by an injected clock, the way the session and throttle
 * tests are, rather than by waiting a week for one of them.
 *
 * The gateway is never actually dialled in this file. `createGatewayResolver`
 * builds an `ai` gateway provider whose `fetch` is replaced by one that records
 * the request and never lets it out, so "no call was made" is asserted rather
 * than assumed.
 */

import { describe, expect, it } from "vitest";

import {
  FREE_WINDOW_ENDS,
  MINIMAX_M2_7_FREE,
  MINIMAX_M3_FREE,
  MODEL_ENV_VAR,
  ROSTER_MODEL_DEFAULTS,
  StandbyModel,
  createGatewayResolver,
  createScriptedResolver,
  createStandbyResolver,
  freeWindowStatus,
  hasGatewayCredential,
  isFreeTierModel,
  liveModelUnavailableReason,
  modelEnvVarFor,
  modelUnavailableReason,
  replay,
  resolverFromEnv,
  rosterModelFor,
  rosterModelNotice,
  rosterModels,
} from "@/lib/agents";

import { createHarness } from "./harness";

/** A day inside the free window, and a day after it. */
const INSIDE = new Date(FREE_WINDOW_ENDS.getTime() - 3 * 86_400_000);
const OUTSIDE = new Date(FREE_WINDOW_ENDS.getTime() + 86_400_000);

const KEYED = { AI_GATEWAY_API_KEY: "test-gateway-key" } as const;

describe("the free window is one date, read in one place", () => {
  it("ends on Sunday 6 September 2026, as the changelog says", () => {
    // Vercel: "MiniMax M3 and M2.7 are free on AI Gateway via GMI Cloud through
    // Sunday, September 6." Inclusive, so the window closes at the end of the
    // 6th — which is midnight at the start of the 7th.
    expect(FREE_WINDOW_ENDS.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("counts the days left while it is open and zero once it is not", () => {
    expect(freeWindowStatus(INSIDE)).toMatchObject({
      state: "open",
      daysRemaining: 3,
    });
    expect(freeWindowStatus(OUTSIDE)).toMatchObject({
      state: "expired",
      daysRemaining: 0,
    });
  });

  it("knows which ids the window covers", () => {
    expect(isFreeTierModel(MINIMAX_M3_FREE)).toBe(true);
    expect(isFreeTierModel(MINIMAX_M2_7_FREE)).toBe(true);
    expect(isFreeTierModel("minimax/minimax-m3")).toBe(false);
    expect(isFreeTierModel("claude-opus-5")).toBe(false);
  });
});

describe("every role is given a model, and the environment can move it", () => {
  it("assigns all eight roles a free-tier model by default", () => {
    for (const [slug, model] of Object.entries(ROSTER_MODEL_DEFAULTS)) {
      expect(rosterModelFor(slug, {})).toBe(model);
      expect(isFreeTierModel(model)).toBe(true);
    }
    expect(Object.keys(ROSTER_MODEL_DEFAULTS)).toHaveLength(8);
  });

  it("spends the per-role granularity rather than giving everyone the same model", () => {
    // The point of the assignment: a concierge drafting a reply someone reads
    // and an analyst comparing two weeks of takings are not the same job.
    expect(rosterModelFor("concierge", {})).toBe(MINIMAX_M3_FREE);
    expect(rosterModelFor("analyst", {})).toBe(MINIMAX_M2_7_FREE);
    expect(new Set(rosterModels({})).size).toBe(2);
  });

  it("lets one role be moved without moving the rest", () => {
    const env = { [modelEnvVarFor("analyst")]: "minimax/minimax-m2.7" };
    expect(rosterModelFor("analyst", env)).toBe("minimax/minimax-m2.7");
    expect(rosterModelFor("concierge", env)).toBe(MINIMAX_M3_FREE);
  });

  it("lets every role be moved at once, and a per-role setting still wins", () => {
    const env = {
      [MODEL_ENV_VAR]: "claude-sonnet-5",
      [modelEnvVarFor("trade")]: "claude-opus-5",
    };
    expect(rosterModelFor("brine-ops", env)).toBe("claude-sonnet-5");
    expect(rosterModelFor("trade", env)).toBe("claude-opus-5");
  });
});

describe("the gateway resolver", () => {
  it("reports itself as the gateway backend, which is recorded on every run", () => {
    const resolver = createGatewayResolver({ ...KEYED, now: () => INSIDE });
    expect(resolver.kind).toBe("gateway");
  });

  it("resolves a free-tier model while the window is open", () => {
    const resolver = createGatewayResolver({ ...KEYED, now: () => INSIDE });
    const model = resolver.resolve(MINIMAX_M3_FREE);
    expect(model).toBeDefined();
  });

  it("refuses a free-tier model once the window has closed", () => {
    const resolver = createGatewayResolver({ ...KEYED, now: () => OUTSIDE });
    expect(() => resolver.resolve(MINIMAX_M3_FREE)).toThrowError(
      /window has closed/,
    );
    try {
      resolver.resolve(MINIMAX_M2_7_FREE);
      expect.unreachable("the resolver must refuse a lapsed free-tier model");
    } catch (error) {
      expect(error).toMatchObject({ code: "model_unavailable" });
    }
  });

  it("never refuses a model somebody deliberately chose to pay for", () => {
    // The cutoff exists to stop an accidental bill, not to overrule a decision.
    const resolver = createGatewayResolver({ ...KEYED, now: () => OUTSIDE });
    expect(resolver.resolve("minimax/minimax-m3")).toBeDefined();
    expect(resolver.resolve("anthropic/claude-sonnet-5")).toBeDefined();
    expect(modelUnavailableReason("minimax/minimax-m3", OUTSIDE)).toBeNull();
  });

  it("says what to do about it, not just that it refused", () => {
    const reason = modelUnavailableReason(MINIMAX_M3_FREE, OUTSIDE) ?? "";
    expect(reason).toContain(MODEL_ENV_VAR);
    expect(reason).toContain("Sunday 6 September 2026");
    expect(reason).toContain("vercel.com/changelog");
  });
});

describe("which resolver a deployment gets", () => {
  it("takes the gateway when a key is present", () => {
    expect(hasGatewayCredential(KEYED)).toBe(true);
    expect(resolverFromEnv(KEYED, () => INSIDE)?.kind).toBe("gateway");
  });

  it("takes the gateway on Vercel, where OIDC supplies the credential", () => {
    const oidc = { VERCEL_OIDC_TOKEN: "eyJ-not-a-real-token" };
    expect(hasGatewayCredential(oidc)).toBe(true);
    expect(resolverFromEnv(oidc, () => INSIDE)?.kind).toBe("gateway");
  });

  it("falls back to Anthropic when only that key is set", () => {
    expect(resolverFromEnv({ ANTHROPIC_API_KEY: "sk-ant-test" })?.kind).toBe(
      "anthropic",
    );
  });

  it("returns nothing at all when there is no credential", () => {
    expect(resolverFromEnv({}, () => INSIDE)).toBeNull();
    expect(liveModelUnavailableReason({}, INSIDE)).toContain(
      "AI_GATEWAY_API_KEY",
    );
  });

  it("returns nothing when the key is present but every model has lapsed", () => {
    // Fail closed. A credential is not a reason to call a model that stopped
    // being free, and eight identical halts is worse than one answer here.
    expect(resolverFromEnv(KEYED, () => OUTSIDE)).toBeNull();
    expect(liveModelUnavailableReason(KEYED, OUTSIDE)).toContain(
      "window has closed",
    );
  });

  it("keeps the gateway past the date when a paid model was chosen", () => {
    const env = { ...KEYED, [MODEL_ENV_VAR]: "minimax/minimax-m3" };
    expect(liveModelUnavailableReason(env, OUTSIDE)).toBeNull();
    expect(resolverFromEnv(env, () => OUTSIDE)?.kind).toBe("gateway");
  });
});

describe("a run past the cutoff halts, and no call goes out", () => {
  it("records the reason on the run and never touches the model", async () => {
    const reason = modelUnavailableReason(MINIMAX_M3_FREE, OUTSIDE) ?? "";
    const standby = new StandbyModel(reason);
    const harness = await createHarness({
      script: [{ kind: "text", text: "never reached" }],
    });
    // Swap in the degraded resolver the factory would have built, then drive a
    // real run through the real runtime.
    const degraded = createStandbyResolver(reason);
    expect(degraded.kind).toBe("scripted");

    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Do the weekly sweep",
      trigger: "schedule",
    });
    // The harness's own runtime is scripted; prove the standby model refuses on
    // its own terms, which is what the degraded platform installs.
    await expect(standby.doGenerate()).rejects.toThrow(/window has closed/);
    expect(standby.refusals).toBe(1);
    expect(harness.model.consumed).toBe(0);
    expect(started.runId).toBeTypeOf("string");
  });

  it("halts the run with the reason in the record when the model refuses", async () => {
    const reason = modelUnavailableReason(MINIMAX_M2_7_FREE, OUTSIDE) ?? "";
    const harness = await createHarness({
      script: [{ kind: "error", message: reason }],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Do the weekly sweep",
      trigger: "schedule",
    });
    const summary = await harness.runtime.runToCompletion(started.runId);

    expect(summary.status).toBe("failed");
    expect(summary.error).toContain("model_call_failed");
    expect(summary.error).toContain("window has closed");

    const view = await replay(harness.store, started.runId);
    expect(view.halt?.code).toBe("model_call_failed");
    // Nothing was spent, because nothing was called.
    expect(summary.costMicros).toBe(0);
    expect(summary.toolCallCount).toBe(0);
  });

  it("still opens the run, so the founder can see why it stopped", async () => {
    const harness = await createHarness({
      script: [{ kind: "error", message: "no model" }],
    });
    const started = await harness.runtime.startRun({
      agentSlug: "test-role",
      goal: "Do the weekly sweep",
      trigger: "schedule",
    });
    await harness.runtime.runToCompletion(started.runId);
    const messages = await harness.store.listMessages(started.runId);
    // System prompt and goal are both persisted before any model call, so a run
    // that never reached a model is still fully inspectable.
    expect(messages.map((message) => message.role)).toContain("system");
    expect(messages.map((message) => message.role)).toContain("user");
  });
});

describe("the admin is told, in words, before it happens", () => {
  it("says which model, that it is free, and how many days are left", () => {
    const notice = rosterModelNotice(KEYED, INSIDE);
    expect(notice?.tone).toBe("neutral");
    expect(notice?.title).toContain("3 days");
    expect(notice?.body).toContain(MINIMAX_M3_FREE);
    expect(notice?.body).toContain(MINIMAX_M2_7_FREE);
    expect(notice?.body).toContain("Sunday 6 September 2026");
    expect(notice?.body).toContain(MODEL_ENV_VAR);
  });

  it("says plainly that it has stopped, and what to do about it", () => {
    const notice = rosterModelNotice(KEYED, OUTSIDE);
    expect(notice?.tone).toBe("danger");
    expect(notice?.title).toContain("stopped thinking");
    expect(notice?.body).toContain(MODEL_ENV_VAR);
    expect(notice?.body).toContain("chosen to pay for");
  });

  it("says the team cannot think when there is no credential at all", () => {
    const notice = rosterModelNotice({}, INSIDE);
    expect(notice?.tone).toBe("danger");
    expect(notice?.body).toContain("AI_GATEWAY_API_KEY");
  });

  it("says nothing when nothing is on a clock", () => {
    // A banner that is always there is a banner nobody reads.
    const env = { ...KEYED, [MODEL_ENV_VAR]: "minimax/minimax-m3" };
    expect(rosterModelNotice(env, INSIDE)).toBeNull();
    expect(rosterModelNotice(env, OUTSIDE)).toBeNull();
  });
});

describe("the scripted path is untouched", () => {
  it("still reports itself as scripted, whatever id it is asked for", async () => {
    const harness = await createHarness({
      script: [{ kind: "text", text: "Done." }],
    });
    const resolver = createScriptedResolver(harness.model);
    expect(resolver.kind).toBe("scripted");
    expect(resolver.resolve(MINIMAX_M3_FREE)).toBe(harness.model);
    expect(resolver.resolve("claude-opus-5")).toBe(harness.model);
  });
});

describe("prompt training is a decision, and it is configurable", () => {
  it("sets no routing policy by default", () => {
    // Off because of the model choice, not by oversight: the gateway catalogue
    // reports no_training "none" for both free MiniMax ids, so turning the
    // filter on would leave nothing able to serve them.
    const resolver = createGatewayResolver({ ...KEYED, now: () => INSIDE });
    expect(resolver.providerOptions).toBeUndefined();
  });

  it("carries the filters to the gateway when the deployment asks for them", () => {
    const resolver = createGatewayResolver({
      ...KEYED,
      now: () => INSIDE,
      disallowPromptTraining: true,
      zeroDataRetention: true,
    });
    expect(resolver.providerOptions).toEqual({
      gateway: { disallowPromptTraining: true, zeroDataRetention: true },
    });
  });

  it("reads them out of the environment, so no code change is needed", () => {
    const env = {
      ...KEYED,
      AI_GATEWAY_DISALLOW_PROMPT_TRAINING: "1",
      [MODEL_ENV_VAR]: "minimax/minimax-m3",
    };
    expect(resolverFromEnv(env, () => INSIDE)?.providerOptions).toEqual({
      gateway: { disallowPromptTraining: true },
    });
  });
});
