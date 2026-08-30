/**
 * What this deployment is holding, said without ever holding it.
 *
 * Ward's job includes noticing that a credential is missing, or that the front
 * door has no password on it. Doing that means looking at the environment, and
 * looking at the environment is the single most dangerous thing an agent in
 * this company does — because everything an agent sees is written into
 * `agent_messages`, replayed in the admin, and read back by whoever opens the
 * run. A tool that returned a token would put that token in the database in
 * plain text, permanently, and it would have been the security agent that did
 * it.
 *
 * So this module has one rule and the rule is absolute: **a value never leaves
 * it.** Every function here answers a question of the form "is X configured",
 * "does X have the right shape", "what is missing" — by NAME. There is no code
 * path that reads a variable's contents into a return value, no path that logs
 * one, and no path that interpolates one into a sentence. The tests in
 * `tests/roster/security.test.ts` set every watched variable to a recognisable
 * string and assert that string appears nowhere in the whole report.
 *
 * The pattern is not new: `describeAuthConfigGaps()` in `lib/auth/config.ts`
 * has named missing variables without naming their values since the sign-in
 * page needed to explain why it would not open. That function is reused here
 * rather than re-implemented, so there is one wording for "ADMIN_PASSWORD_HASH
 * is not set" and one place to change it.
 */

import { describeAuthConfigGaps } from "@/lib/auth/config";
import {
  DEMO_ENV_VAR,
  demoOpensAdmin,
  isDemoMode,
  resolveDatabaseUrl,
} from "@/lib/demo/mode";

/** The environment, narrowed to what this module reads. */
export type SecurityEnv = Readonly<Record<string, string | undefined>>;

/**
 * Where the report comes from.
 *
 * Both injectable, because a security check nobody can test against a
 * controlled environment is a security check nobody can trust. Production
 * passes neither and gets the real process and the real gap reporter.
 */
export interface SecurityEnvironment {
  readonly env?: SecurityEnv;
  /** Defaults to {@link describeAuthConfigGaps}. */
  readonly authGaps?: () => readonly string[];
}

/** One credential this deployment is watched for, and what it is for. */
export interface WatchedSecret {
  /** The environment variable's NAME. Never its value. */
  readonly name: string;
  /** What it is, in one sentence somebody non-technical can act on. */
  readonly what: string;
  /** What its absence means. Not every absence is a fault. */
  readonly whenMissing: string;
}

/**
 * The credentials this codebase actually reads.
 *
 * Compiled by reading every `process.env` reference in `lib`, `app`, `inngest`
 * and `proxy.ts`, not from a generic checklist: a security report that lists
 * variables this deployment has never heard of trains its reader to skim.
 */
export const WATCHED_SECRETS: readonly WatchedSecret[] = Object.freeze([
  {
    name: "ADMIN_PASSWORD_HASH",
    what: "The password on the front door of this admin, stored scrambled so the real one is never written down anywhere.",
    whenMissing:
      "Nobody can sign in at all — and on a demonstration deployment the admin is open to anyone who has the address.",
  },
  {
    name: "ADMIN_SESSION_SECRET",
    what: "The key that seals your sign-in cookie, so nobody can forge one and walk in as you.",
    whenMissing:
      "Sign-in is refused outright rather than issuing a cookie that could be faked.",
  },
  {
    name: "SUPABASE_DB_URL",
    what: "Where the business database lives — orders, customers, everything in these screens.",
    whenMissing:
      "There is no real database attached. On a demonstration that is deliberate; anywhere else it means the admin will not open.",
  },
  {
    name: "AI_GATEWAY_API_KEY",
    what: "What the team thinks with. Every agent's model call goes through it.",
    whenMissing:
      "The team stops at its first thought and says so. Nothing is exposed by it.",
  },
  {
    name: "SHOPIFY_ADMIN_ACCESS_TOKEN",
    what: "Full read and write on the Shopify store — products, orders, customers.",
    whenMissing:
      "The shop runs on the local mirror only. Nothing here can change the live store.",
  },
  {
    name: "SHOPIFY_STOREFRONT_ACCESS_TOKEN",
    what: "Read-only access to the public storefront catalogue.",
    whenMissing: "The storefront reads the local mirror instead.",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    what: "A master key that steps past every row-level rule in the database.",
    whenMissing:
      "Nothing here is using one. That is the safer state, not a fault.",
  },
  {
    name: "INNGEST_EVENT_KEY",
    what: "Lets this deployment queue the background jobs the agents run on.",
    whenMissing: "Scheduled agent work is not queued.",
  },
]);

/** Where a watched credential stands, by name, with no value anywhere near it. */
export interface SecretStanding {
  readonly name: string;
  readonly configured: boolean;
  readonly what: string;
  /** Present only when it is not configured. */
  readonly whenMissing: string | null;
}

/** What the deployment is holding, and what it is standing wide open on. */
export interface SecretPosture {
  readonly secrets: readonly SecretStanding[];
  readonly configuredCount: number;
  readonly missing: readonly string[];
  /**
   * Sentences a person can act on, already worded.
   *
   * The auth-gate half comes from {@link describeAuthConfigGaps}; the rest is
   * added here. Every one of them names a variable and describes a shape.
   * None of them contains a value.
   */
  readonly warnings: readonly string[];
  /** True when this deployment lets anyone into the admin with no password. */
  readonly adminOpensWithoutPassword: boolean;
  /** True when `HALF_SOUR_DEMO=1`, whatever the database is. */
  readonly demoMode: boolean;
}

function present(env: SecurityEnv, name: string): boolean {
  const raw = env[name];
  return typeof raw === "string" && raw.trim() !== "";
}

/**
 * Read the deployment's credential posture.
 *
 * Returns names, booleans and sentences. Grep this function for `env[` and you
 * will find exactly one use, inside {@link present}, whose return type is
 * `boolean`.
 */
export function describeSecretPosture(
  source: SecurityEnvironment = {},
): SecretPosture {
  const env = source.env ?? process.env;
  const gaps = (source.authGaps ?? describeAuthConfigGaps)();

  const secrets: SecretStanding[] = WATCHED_SECRETS.map((secret) => {
    const configured = present(env, secret.name);
    return {
      name: secret.name,
      configured,
      what: secret.what,
      whenMissing: configured ? null : secret.whenMissing,
    };
  });

  const warnings: string[] = [...gaps];
  const open = demoOpensAdmin(env);
  if (open) {
    warnings.push(
      "This admin opens without a password. Anyone who has the address is " +
        "already inside it, including everything on these screens. That is on " +
        `purpose while ${DEMO_ENV_VAR}=1 and the data is invented — unset that ` +
        "variable and the password gate comes straight back.",
    );
  }
  if (isDemoMode(env) && !open && resolveDatabaseUrl(env) !== null) {
    warnings.push(
      `${DEMO_ENV_VAR}=1 is set beside a real SUPABASE_DB_URL. The admin still ` +
        "asks for a password, which is correct, but a demonstration flag left " +
        "on next to live data is worth taking off.",
    );
  }
  if (
    present(env, "SUPABASE_SERVICE_ROLE_KEY") &&
    present(env, "SUPABASE_DB_URL")
  ) {
    warnings.push(
      "SUPABASE_SERVICE_ROLE_KEY is configured alongside a direct database " +
        "connection. Two master keys where one would do is two things to lose; " +
        "if nothing is using the service role key, take it out of the project.",
    );
  }

  return {
    secrets,
    configuredCount: secrets.filter((secret) => secret.configured).length,
    missing: secrets
      .filter((secret) => !secret.configured)
      .map((secret) => secret.name),
    warnings,
    adminOpensWithoutPassword: open,
    demoMode: isDemoMode(env),
  };
}
