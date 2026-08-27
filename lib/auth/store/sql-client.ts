/**
 * The narrow SQL surface the auth store needs.
 *
 * Deliberately smaller than any driver's API so that exactly one implementation
 * of the store exists and exactly one set of statements is ever executed. In
 * production the client is a `pg` pool against Supabase; under test it is
 * PGlite — real Postgres compiled to WebAssembly — with the real migration
 * files applied. The queries under test are therefore the queries that ship,
 * not a mock's approximation of them.
 */
export type SqlRow = Record<string, unknown>;

export type SqlResult<Row extends SqlRow = SqlRow> = {
  readonly rows: Row[];
};

export interface SqlClient {
  query<Row extends SqlRow = SqlRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
  close(): Promise<void>;
}
