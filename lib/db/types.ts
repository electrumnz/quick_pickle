import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";

export type Schema = typeof schema;

/**
 * The database, as the rest of the code sees it.
 *
 * There are two drivers behind it (node-postgres for a real server, PGlite for
 * the in-process one) and they are the same Drizzle query builder with a
 * different wire underneath. Typing both as the node-postgres flavour gives
 * the whole codebase one type to pass around. The only place the two differ
 * is the shape of a raw `execute()` result beyond `.rows`, so raw results are
 * read through `.rows` and nothing else.
 */
export type Db = NodePgDatabase<Schema>;

/** The handle a transaction body is given. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything a query can be run on. */
export type DbOrTx = Db | Tx;
