/**
 * Which model each role runs on, and when the free one stops being free.
 *
 * The company's eight roles do not need the same model. A concierge drafting a
 * reply a customer will read is a writing job; an analyst comparing this week's
 * takings to last week's is an arithmetic job. `definition.model` is per role
 * precisely so that difference can be spent, so it is spent here.
 *
 * ## The free window, and why it is written down
 *
 * Vercel's changelog, "MiniMax M3 and M2.7 are free on AI Gateway", published
 * 25 August 2026:
 *
 * > MiniMax M3 and M2.7 are free on AI Gateway via GMI Cloud through Sunday,
 * > September 6. Use `minimax/minimax-m3-free` or `minimax/minimax-m2.7-free`
 * > to route requests to GMI Cloud.
 *
 * The same entry says the `-free` ids "will return an error after the free
 * period ends", and the gateway's own model catalogue
 * (`GET https://ai-gateway.vercel.sh/v1/models`, read 30 August 2026) confirms
 * both ids at `pricing.input = "0"`, `pricing.output = "0"`, tagged `free` and
 * `tool-use`.
 *
 * {@link FREE_WINDOW_ENDS} is that date, in one place, and
 * {@link freeWindowStatus} is the only thing that reads a clock against it. The
 * cutoff **fails closed**: past the date the gateway resolver refuses a
 * free-tier id and the platform degrades to an offline model, so a promotion
 * lapsing costs the company its agents rather than an unattended bill. An id
 * that is not free-tier is never blocked, before or after — someone who
 * deliberately sets a paid model has made a decision, and this is here to stop
 * an accident, not to overrule a choice.
 */

/**
 * The last instant the GMI Cloud free window covers.
 *
 * "Through Sunday, September 6" is inclusive, so the window closes at the end
 * of that day. UTC is used rather than Pacific/Auckland because the promotion
 * is the gateway's, not the company's — the ledger's timezone has no bearing on
 * when somebody else's discount stops.
 */
export const FREE_WINDOW_ENDS = new Date("2026-09-07T00:00:00.000Z");

/** Human form of {@link FREE_WINDOW_ENDS}, for copy that a person reads. */
export const FREE_WINDOW_ENDS_WORDS = "Sunday 6 September 2026";

/**
 * The same date with the weekday and the year taken off, for the one line the
 * demonstration bar has room for.
 *
 * Not a second source of truth: it is the same instant, said shorter, and both
 * forms are derived from {@link FREE_WINDOW_ENDS} by hand in this one file.
 * The bar links to The Team, where the full form is on screen, so the short one
 * only has to be unambiguous for the week it is being read in.
 */
export const FREE_WINDOW_ENDS_SHORT = "6 September";

/** Where {@link FREE_WINDOW_ENDS} came from, quoted in the admin. */
export const FREE_WINDOW_SOURCE =
  "vercel.com/changelog/minimax-m3-and-m2-7-are-free-on-ai-gateway";

/**
 * MiniMax M3, free tier. 1M context, tool calling, vision.
 *
 * The larger of the two. Used for the roles whose output is prose somebody
 * outside the company will read, and for the one role that reads a whole
 * account file in a single turn.
 */
export const MINIMAX_M3_FREE = "minimax/minimax-m3-free";

/**
 * MiniMax M2.7, free tier. 196k context, tool calling.
 *
 * Built for agentic work — tool calling, multi-step plans — and used for the
 * roles that compute rather than compose.
 */
export const MINIMAX_M2_7_FREE = "minimax/minimax-m2.7-free";

/**
 * Every id the free window covers.
 *
 * Membership of this list is what the cutoff acts on. A model is either
 * promotional or it is not; there is no third state and no per-model expiry,
 * because the promotion has one date.
 */
export const FREE_TIER_MODELS: readonly string[] = Object.freeze([
  MINIMAX_M3_FREE,
  MINIMAX_M2_7_FREE,
]);

/** True when this id is one the free window covers, and so one the cutoff bites. */
export function isFreeTierModel(model: string): boolean {
  return FREE_TIER_MODELS.includes(model);
}

/**
 * The default model per role, with the reason it is that one.
 *
 * Read `HALF_SOUR_AGENT_MODEL_<SLUG>` to move one role, or
 * `HALF_SOUR_AGENT_MODEL` to move all of them. Neither needs a deploy and
 * neither needs a code change, which is the whole point: the free window closes
 * in days, not months.
 */
export const ROSTER_MODEL_DEFAULTS: Readonly<Record<string, string>> =
  Object.freeze({
    // Marlow computes days of cover against lead times and drafts one order.
    // Arithmetic over small tables, not prose: the agentic model is enough.
    "brine-ops": MINIMAX_M2_7_FREE,
    // Dot drafts the first reply a customer reads, and has to hold an
    // escalation rule exactly. The larger model, for the writing and the care.
    concierge: MINIMAX_M3_FREE,
    // Teller recomputes unit cost from three batches and proposes a price.
    // Numbers with a rule attached; the agentic model handles it.
    ledger: MINIMAX_M2_7_FREE,
    // Vinnie writes captions in a voice the brand rules describe. Writing job.
    social: MINIMAX_M3_FREE,
    // Ari composes campaign copy out of the BrandScript. Writing job.
    marketing: MINIMAX_M3_FREE,
    // Vic reads one account's entire file — orders, every message ever sent —
    // and writes to a named venue. Long context and a writing job at once.
    trade: MINIMAX_M3_FREE,
    // Pip turns ninety days of sales and review text into one concept.
    // Synthesis rather than counting.
    product: MINIMAX_M3_FREE,
    // Cass counts and says what the counting shows, weekly, on a schedule.
    // Comparison over a small table: the agentic model, and the faster one.
    analyst: MINIMAX_M2_7_FREE,
  });

/** A global override, applied to every role that has no override of its own. */
export const MODEL_ENV_VAR = "HALF_SOUR_AGENT_MODEL";

/** The per-role override for `slug`: `HALF_SOUR_AGENT_MODEL_BRINE_OPS`. */
export function modelEnvVarFor(slug: string): string {
  return `${MODEL_ENV_VAR}_${slug.toUpperCase().replaceAll("-", "_")}`;
}

/** The environment, narrowed to what this module reads. */
export type ModelEnv = Readonly<Record<string, string | undefined>>;

function trimmed(value: string | undefined): string | null {
  const text = value?.trim();
  return text === undefined || text === "" ? null : text;
}

/**
 * The model id a role will actually run on.
 *
 * Resolution order is per-role override, then global override, then the default
 * above. The answer is what goes into `definition.model`, which means it is what
 * is written to `public.agents`, recorded on the run's context, priced by the
 * cost meter and shown in the admin — so the founder is never told one model and
 * charged for another.
 */
export function rosterModelFor(
  slug: string,
  env: ModelEnv = process.env,
): string {
  return (
    trimmed(env[modelEnvVarFor(slug)]) ??
    trimmed(env[MODEL_ENV_VAR]) ??
    ROSTER_MODEL_DEFAULTS[slug] ??
    MINIMAX_M2_7_FREE
  );
}

/** True when the deployment has deliberately named a model for this role. */
export function isModelOverridden(
  slug: string,
  env: ModelEnv = process.env,
): boolean {
  return (
    trimmed(env[modelEnvVarFor(slug)]) !== null ||
    trimmed(env[MODEL_ENV_VAR]) !== null
  );
}

/** Every model the roster would use right now, deduplicated. */
export function rosterModels(env: ModelEnv = process.env): readonly string[] {
  return [
    ...new Set(
      Object.keys(ROSTER_MODEL_DEFAULTS).map((slug) =>
        rosterModelFor(slug, env),
      ),
    ),
  ];
}

/** Where the free window stands relative to a given instant. */
export interface FreeWindowStatus {
  /** `open` while the promotion runs, `expired` once it has closed. */
  readonly state: "open" | "expired";
  /**
   * Whole days left, rounded DOWN, and never below one while the window is
   * open. Down because a countdown on a spending cutoff should under-promise:
   * "another 7 days" with 7.8 left is true, "another 8" is not.
   */
  readonly daysRemaining: number;
  /** {@link FREE_WINDOW_ENDS_WORDS}, carried so callers need one import. */
  readonly endsOn: string;
  /** The changelog entry the date came from. */
  readonly source: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * Read the clock against {@link FREE_WINDOW_ENDS}.
 *
 * Takes the instant rather than calling `Date.now()` so both sides of the
 * boundary are testable without waiting a week for one of them.
 */
export function freeWindowStatus(now: Date): FreeWindowStatus {
  const remaining = FREE_WINDOW_ENDS.getTime() - now.getTime();
  return {
    state: remaining > 0 ? "open" : "expired",
    daysRemaining:
      remaining > 0 ? Math.max(1, Math.floor(remaining / MS_PER_DAY)) : 0,
    endsOn: FREE_WINDOW_ENDS_WORDS,
    source: FREE_WINDOW_SOURCE,
  };
}

/**
 * May this model be called at this instant?
 *
 * The only rule: a free-tier id is refused once the window has closed. Anything
 * else is allowed, always. Returns the reason rather than a boolean so the
 * refusal can be recorded on the run in words the founder can act on.
 */
export function modelUnavailableReason(
  model: string,
  now: Date,
): string | null {
  if (!isFreeTierModel(model)) {
    return null;
  }
  if (freeWindowStatus(now).state === "open") {
    return null;
  }
  return (
    `"${model}" was free on the Vercel AI Gateway via GMI Cloud only through ` +
    `${FREE_WINDOW_ENDS_WORDS}, and that window has closed. The roster will not ` +
    `call it: the id no longer serves, and rolling silently onto paid tokens is ` +
    `worse than stopping. Set ${MODEL_ENV_VAR} (or ${modelEnvVarFor("<slug>")}) ` +
    `to a model you have chosen to pay for and the roster resumes. Source: ` +
    `${FREE_WINDOW_SOURCE}.`
  );
}

/**
 * Does the environment carry a credential the gateway would accept?
 *
 * `VERCEL_OIDC_TOKEN` counts: on Vercel it is minted for the deployment and the
 * gateway provider reads it without being told to.
 */
export function hasGatewayCredential(env: ModelEnv = process.env): boolean {
  return (
    trimmed(env["AI_GATEWAY_API_KEY"]) !== null ||
    trimmed(env["VERCEL_OIDC_TOKEN"]) !== null
  );
}

/**
 * Why the deployment has no live model, or `null` when it has one.
 *
 * Policy, not construction, which is why it lives beside the model choice rather
 * than beside the provider clients: it is the same question the admin banner
 * asks and the same question the factory asks, and two answers to it would
 * eventually be two different answers.
 */
export function liveModelUnavailableReason(
  env: ModelEnv = process.env,
  now: Date = new Date(),
): string | null {
  if (!hasGatewayCredential(env)) {
    if (trimmed(env["ANTHROPIC_API_KEY"]) !== null) {
      return null;
    }
    return (
      "No model credential is configured. Set AI_GATEWAY_API_KEY (or deploy on " +
      "Vercel, where VERCEL_OIDC_TOKEN is minted for you) to run the roster on " +
      "the AI Gateway, or ANTHROPIC_API_KEY to call Anthropic directly. Until " +
      "then every agent run stops at its first model call and records this."
    );
  }
  // A credential on its own is not enough: if every model the roster would use
  // is a lapsed free-tier id there is nothing to call, and saying so once here
  // is better than eight identical halts.
  const models = rosterModels(env);
  const usable = models.filter(
    (model) => modelUnavailableReason(model, now) === null,
  );
  if (usable.length > 0) {
    return null;
  }
  const first = models[0];
  return first === undefined ? null : modelUnavailableReason(first, now);
}

/** What the admin should say about the models the roster is on, if anything. */
export interface ModelNotice {
  readonly tone: "neutral" | "danger";
  readonly title: string;
  readonly body: string;
  /**
   * The same fact in one clause, for the fixed bar at the bottom of every page.
   *
   * On a demonstration this notice no longer has a panel of its own — the
   * founder asked for the two standing admin warnings to be folded into the one
   * bar that is already on screen, and that bar has room for a clause, not a
   * paragraph. So the short form carries the only part that is useless without
   * it — the date the window closes — and `components/demo/DemoBanner.tsx`
   * links it to The Team, where {@link ModelNotice.body} is rendered in full.
   *
   * It lives on the same object as `title` and `body` rather than in a second
   * function so that the three states cannot drift apart: one decision, three
   * lengths.
   */
  readonly short: string;
}

function modelList(env: ModelEnv): string {
  const models = rosterModels(env);
  return models.length === 1
    ? (models[0] ?? "")
    : `${models.slice(0, -1).join(", ")} and ${models.at(-1) ?? ""}`;
}

/**
 * The notice the admin carries about the models behind the team.
 *
 * Returns `null` when there is nothing worth saying — a credential is present
 * and no model in use is on a clock. Silence is the normal state; a banner that
 * is always there is a banner nobody reads.
 *
 * Three things it always tells someone who can act: which model the team is on,
 * what is about to change, and the one environment variable that changes it.
 */
export function rosterModelNotice(
  env: ModelEnv = process.env,
  now: Date = new Date(),
): ModelNotice | null {
  const models = rosterModels(env);
  const free = models.filter(isFreeTierModel);
  const window = freeWindowStatus(now);

  if (
    !hasGatewayCredential(env) &&
    trimmed(env["ANTHROPIC_API_KEY"]) === null
  ) {
    return {
      tone: "danger",
      title: "The team cannot think",
      short: "The team has no model to think with",
      body:
        "No model is configured, so every agent run stops at its first model " +
        "call and records why. Nothing else is affected: the shop, the orders " +
        "and every screen in here work exactly as they did. Set " +
        "AI_GATEWAY_API_KEY in the Vercel project to put the team back on the " +
        "Vercel AI Gateway.",
    };
  }

  if (free.length === 0) {
    return null;
  }

  if (window.state === "expired") {
    return {
      tone: "danger",
      title: "The team has stopped thinking — its free models expired",
      short: `Free models ended ${FREE_WINDOW_ENDS_SHORT}`,
      body:
        `${modelList(env)} was free on the Vercel AI Gateway through ` +
        `${window.endsOn}. That window has closed, so the roster refuses to ` +
        "call it rather than rolling onto tokens you would be billed for. " +
        `Set ${MODEL_ENV_VAR} in the Vercel project to a model you have chosen ` +
        "to pay for and every agent resumes on the next run. Nothing else in " +
        `here is affected. Source: ${window.source}.`,
    };
  }

  const days =
    window.daysRemaining === 1
      ? "1 day"
      : `${String(window.daysRemaining)} days`;
  return {
    tone: "neutral",
    title: `The team is running on free models for another ${days}`,
    short: `Free models until ${FREE_WINDOW_ENDS_SHORT}`,
    body:
      `${modelList(env)} on the Vercel AI Gateway, free via GMI Cloud through ` +
      `${window.endsOn}. After that the roster stops calling them rather than ` +
      "spending money nobody approved, and every agent run will halt saying so. " +
      `Set ${MODEL_ENV_VAR} to a model you have chosen to pay for, before or ` +
      `after that date, and it is used instead. Source: ${window.source}.`,
  };
}
