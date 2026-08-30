/**
 * Demo mode — the one switch, and the one place it is read.
 *
 * HALF SOUR's storefront reads from `content/`, so it renders without a
 * database. Everything else — the shop's stock and cart, the admin, the agent
 * screens — needs Postgres, and a deployment that has none shows four bottles
 * nobody can buy and an admin that will not open. Demo mode fills that gap with
 * a Postgres compiled into the deployment itself.
 *
 * ## The rules this file exists to keep
 *
 * **One variable.** `HALF_SOUR_DEMO=1`. Nothing else turns demo mode on: not
 * `NODE_ENV`, not a hostname, not the absence of a database. A demo that can
 * switch itself on is a demo that can switch itself on in production.
 *
 * **Unset means nothing changes.** Every branch keyed on {@link isDemoMode}
 * falls through to the behaviour that shipped before this file existed. In
 * particular `COMMERCE_PROVIDER` still throws when it is missing, and the admin
 * gate still refuses to sign anyone in without `ADMIN_PASSWORD_HASH` and
 * `ADMIN_SESSION_SECRET`.
 *
 * **Demo mode supplies a database and nothing else.** It never supplies a
 * credential, never relaxes the password check, never shortens the throttle and
 * never mints a session. The only thing it stands in for is `SUPABASE_DB_URL`.
 *
 * **This predicate is not re-derived anywhere.** Every surface — commerce
 * config, the SQL executor factory, the auth store, the banner, `robots.txt` —
 * imports {@link isDemoMode} from here. There is deliberately no second way to
 * ask the question, because two ways eventually disagree and the disagreement
 * is always the security-relevant one.
 */

/** The only environment variable that turns demo mode on. */
export const DEMO_ENV_VAR = "HALF_SOUR_DEMO";

/** The only value of it that counts. */
export const DEMO_ENV_VALUE = "1";

/**
 * A connection string that means "the image compiled into this deployment".
 *
 * Written as a URL with its own scheme rather than as an empty string or a
 * boolean so that it travels through every layer that already passes a
 * connection string around — `CommerceConfig.databaseUrl`,
 * `createPgExecutor`, `getDatabaseUrl` — without any of them growing a second
 * parameter. It is never a real DSN and nothing tries to dial it.
 */
export const DEMO_DATABASE_URL = "pglite://half-sour-demo";

/**
 * The environment, narrowed to what this module reads.
 *
 * `process.env` satisfies it. Tests and `readCommerceConfig` pass their own
 * object so a case can vary the environment without mutating the process.
 */
export type DemoEnv = Readonly<Record<string, string | undefined>>;

/** The predicate. `HALF_SOUR_DEMO=1`, and nothing else. */
export function isDemoMode(env: DemoEnv = process.env): boolean {
  return env[DEMO_ENV_VAR]?.trim() === DEMO_ENV_VALUE;
}

/** True for the stand-in connection string, whitespace and all. */
export function isDemoDatabaseUrl(connectionString: string): boolean {
  return connectionString.trim() === DEMO_DATABASE_URL;
}

/**
 * The Postgres connection string, or null when there is not one.
 *
 * Demo mode does not override a configured `SUPABASE_DB_URL`: if a real
 * database is named, that is the database, because a demo flag left on by
 * accident must never quietly divert writes away from live data. It only fills
 * the hole when the variable is absent.
 */
export function resolveDatabaseUrl(env: DemoEnv = process.env): string | null {
  const configured = env.SUPABASE_DB_URL?.trim();
  if (configured !== undefined && configured !== "") return configured;
  return isDemoMode(env) ? DEMO_DATABASE_URL : null;
}
