/**
 * The narrow database seam the mock provider is written against.
 *
 * Deliberately not the Supabase JS client. PostgREST cannot open a transaction,
 * and a checkout that decrements stock, writes a ledger row, creates an order
 * and converts a cart in four separate HTTP calls is a checkout that can leave
 * a customer charged for stock that was never taken. Everything here goes
 * through one Postgres connection so `begin`/`commit` mean what they say.
 *
 * Two implementations exist: `PgSqlExecutor` (node-postgres, production and
 * local Supabase) and the PGlite executor in `lib/commerce/testing`, which runs
 * the real migrations in-process so the conformance suite tests against the
 * actual schema constraints rather than a fake.
 */

export type SqlRow = Record<string, unknown>;

export type SqlResult<R extends SqlRow> = {
  readonly rows: R[];
  readonly rowCount: number;
};

export interface SqlExecutor {
  /**
   * Run one statement. Parameters are `$1`-style placeholders; there is no
   * string interpolation of values anywhere in this codebase.
   */
  query<R extends SqlRow = SqlRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<SqlResult<R>>;

  /**
   * Run `fn` inside a transaction. Commits on return, rolls back on throw.
   * The executor handed to `fn` is bound to that transaction's connection;
   * using the outer executor inside `fn` escapes it, so don't.
   *
   * Nesting is allowed and uses savepoints.
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;

  close(): Promise<void>;
}

/** First row or null, for the very common single-row lookup. */
export async function queryOne<R extends SqlRow>(
  sql: SqlExecutor,
  text: string,
  params?: readonly unknown[],
): Promise<R | null> {
  const result = await sql.query<R>(text, params);
  return result.rows[0] ?? null;
}
