import "server-only";

import { Pool } from "pg";

import { demoSqlExecutor } from "@/lib/demo/database";
import { isDemoDatabaseUrl } from "@/lib/demo/mode";

import { getDatabaseUrl } from "../config";
import { SqlAuthStore } from "./sql-auth-store";
import type { SqlClient, SqlResult, SqlRow } from "./sql-client";
import type { AuthStore } from "./types";

/**
 * The production {@link SqlClient}: a `pg` pool against Supabase Postgres.
 *
 * The pool is cached in module scope because a connection pool is a
 * performance concern, not a security one — unlike the throttle counters, which
 * are emphatically not cached here and live in the database precisely because
 * module scope evaporates between serverless invocations.
 *
 * TLS is governed by `sslmode` in the connection string. Nothing here disables
 * certificate verification.
 */

let pool: Pool | null = null;
let store: AuthStore | null = null;

function getPool(): Pool {
  pool ??= new Pool({
    connectionString: getDatabaseUrl(),
    // The admin gate is one person signing in occasionally. A wide pool would
    // only compete with the storefront for Supabase's connection budget.
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: "half-sour-admin-auth",
  });
  return pool;
}

class PgSqlClient implements SqlClient {
  async query<Row extends SqlRow = SqlRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<SqlResult<Row>> {
    const result = await getPool().query<Row>(
      text,
      params === undefined ? undefined : [...params],
    );
    return { rows: result.rows };
  }

  async close(): Promise<void> {
    if (pool === null) return;
    const closing = pool;
    pool = null;
    store = null;
    await closing.end();
  }
}

/**
 * The demo {@link SqlClient}: the same statements, against the Postgres image
 * compiled into the deployment.
 *
 * This is a *storage* substitution and nothing else. `SqlAuthStore` is
 * unchanged, so the session row, the argon2id verification, the escalating
 * delay, the per-IP and global lockouts and the audit trail are the same code
 * running the same SQL — demo mode does not know what a password is. The image
 * carries no credential either: the `admin_sessions` rows in the seed hold
 * fabricated token hashes that no sealed cookie can ever match, and the
 * password hash has never been in the database on any provider.
 *
 * It goes through the shared `SqlExecutor` rather than straight at the
 * database, because PGlite is one connection: a bare statement issued while the
 * commerce layer has a checkout transaction open would land *inside* that
 * transaction and be rolled back with it. The executor serialises everything
 * onto one queue, so an auth write is never somebody else's uncommitted work.
 *
 * The instance is shared with the commerce layer, so a session written here is
 * visible to the request that reads it back — within one server process. Across
 * processes it is not, which is the limitation the demo banner states.
 */
class DemoSqlClient implements SqlClient {
  async query<Row extends SqlRow = SqlRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<SqlResult<Row>> {
    const result = await demoSqlExecutor().query<Row>(text, params);
    return { rows: result.rows };
  }

  async close(): Promise<void> {
    // The demo database's lifetime belongs to the process, not to this client.
  }
}

/**
 * The process-wide auth store.
 *
 * Throws when there is no database at all. That is deliberate: without one
 * there is no revocable session and no durable throttle, so the gate fails
 * closed rather than degrading into something that looks like it works.
 * `getDatabaseUrl` is what decides, and in demo mode it answers with the
 * in-process image — a database, never a credential and never a bypass.
 */
export function getAuthStore(): AuthStore {
  store ??= new SqlAuthStore(
    isDemoDatabaseUrl(getDatabaseUrl())
      ? new DemoSqlClient()
      : new PgSqlClient(),
  );
  return store;
}
