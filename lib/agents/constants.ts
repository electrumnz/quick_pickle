/**
 * Named limits and durations for the agent runtime.
 *
 * Everything time-shaped in `lib/agents` is expressed through these constants so
 * a reader never has to decode a bare number at a call site.
 */

/** Milliseconds in one second. Base unit for every duration below. */
const MS_PER_SECOND = 1_000;
/** Seconds in one minute. */
const SECONDS_PER_MINUTE = 60;
/** Minutes in one hour. */
const MINUTES_PER_HOUR = 60;

/** One second, in milliseconds. */
export const ONE_SECOND_MS = MS_PER_SECOND;
/** One minute, in milliseconds. */
export const ONE_MINUTE_MS = MS_PER_SECOND * SECONDS_PER_MINUTE;
/** One hour, in milliseconds. */
export const ONE_HOUR_MS = ONE_MINUTE_MS * MINUTES_PER_HOUR;

/**
 * How long a minted effect grant stays usable. A grant is single-use and is
 * consumed inside the same durable step that mints it, so this only bounds a
 * pathological stall between mint and execute.
 */
export const EFFECT_GRANT_TTL_MS = 5 * ONE_MINUTE_MS;

/** How often the in-flight control watcher re-reads the kill switch. */
export const CONTROL_POLL_INTERVAL_MS = ONE_SECOND_MS;

/** Wall-clock ceiling on a single model call before the runtime aborts it. */
export const MODEL_CALL_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

/**
 * How long an Inngest run will park on `waitForEvent` waiting for a human
 * decision before the approval is treated as expired. Inngest duration string.
 */
export const APPROVAL_WAIT_TIMEOUT = "3d";

/** Default ceiling on model calls per run when a definition does not set one. */
export const DEFAULT_MAX_STEPS = 12;

/** Default output-token ceiling for a single model call. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

/** Tokens per pricing unit in the price book (prices are quoted per million). */
export const TOKENS_PER_PRICING_UNIT = 1_000_000;

/** Micros (millionths of a currency unit) in one cent. */
export const MICROS_PER_CENT = 10_000;

/** Micros in one whole currency unit. */
export const MICROS_PER_UNIT = 1_000_000;

/**
 * `approvals.amount_cents` at or above this value may not be filed as `low`
 * risk — mirrors the `approvals_money_risk` check constraint in the schema.
 */
export const LOW_RISK_AMOUNT_CEILING_CENTS = 5_000;
