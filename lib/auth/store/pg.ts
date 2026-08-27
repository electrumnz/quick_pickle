import "server-only";

import { Pool } from "pg";

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
 * The process-wide auth store.
 *
 * Throws when `SUPABASE_DB_URL` is absent. That is deliberate: without a
 * database there is no revocable session and no durable throttle, so the gate
 * fails closed rather than degrading into something that looks like it works.
 */
export function getAuthStore(): AuthStore {
  store ??= new SqlAuthStore(new PgSqlClient());
  return store;
}
