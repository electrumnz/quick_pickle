/**
 * `SqlExecutor` over node-postgres.
 *
 * One pool per process, one connection checked out per transaction. Used
 * against `SUPABASE_DB_URL`, which is the service-role connection: RLS is
 * bypassed by design here, because this code *is* the server-side authority
 * that the storefront's RLS policies defer to (see the comment on
 * `carts_storefront_update` in the RLS migration — "checkout runs server-side
 * under service_role").
 */

import { Pool, type PoolClient } from "pg";

import type { SqlExecutor, SqlResult, SqlRow } from "./executor";

class PoolExecutor implements SqlExecutor {
  constructor(private readonly pool: Pool) {}

  async query<R extends SqlRow = SqlRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<SqlResult<R>> {
    const result = await this.pool.query(text, [...params]);
    return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const value = await fn(new ClientExecutor(client, 0));
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async execScript(text: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(text);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class ClientExecutor implements SqlExecutor {
  constructor(
    private readonly client: PoolClient,
    private readonly depth: number,
  ) {}

  async query<R extends SqlRow = SqlRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<SqlResult<R>> {
    const result = await this.client.query(text, [...params]);
    return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const name = `sp_${String(this.depth + 1)}`;
    await this.client.query(`savepoint ${name}`);
    try {
      const value = await fn(new ClientExecutor(this.client, this.depth + 1));
      await this.client.query(`release savepoint ${name}`);
      return value;
    } catch (error) {
      await this.client.query(`rollback to savepoint ${name}`);
      throw error;
    }
  }

  async execScript(text: string): Promise<void> {
    await this.client.query(text);
  }

  async close(): Promise<void> {
    // The pool owns the connection's lifetime, not the transaction.
  }
}

export function createPgExecutor(connectionString: string): SqlExecutor {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    // Supabase requires TLS but presents a certificate chain Node does not
    // ship a root for on every platform; the connection is still encrypted.
    ssl: connectionString.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  return new PoolExecutor(pool);
}
