/**
 * `SqlExecutor` over PGlite — Postgres compiled to WebAssembly, in this
 * process.
 *
 * Two callers, one implementation. The conformance suite uses it to run the
 * real migrations in-process (see `lib/commerce/testing/pglite.ts`), and demo
 * mode uses it to serve a deployment from an image compiled into the build (see
 * `lib/demo/database.ts`). Both want the same thing: statements that reach a
 * genuine Postgres planner and genuine check constraints.
 *
 * Two properties are worth knowing before using it.
 *
 * **The database opens lazily.** The factory takes `() => Promise<PGlite>` and
 * returns a synchronous `SqlExecutor`, because every existing caller —
 * `createPgExecutor`, the provider registry, `adminSql()` — is synchronous and
 * a database that takes half a second to open cannot be constructed inside
 * them. The first statement pays for the open; the rest do not.
 *
 * **Everything is serialised.** PGlite is one connection, and `begin` … `commit`
 * spans awaits, so two overlapping requests would otherwise interleave their
 * statements into each other's transactions — and a failed statement from one
 * would abort the other's transaction. A promise-chain lock makes the whole
 * executor strictly serial. That is not a throughput compromise: the WASM
 * instance is single-threaded and executes one statement at a time regardless.
 *
 * The `@electric-sql/pglite` import here is **type-only**, and is erased. The
 * caller supplies the instance, so importing this module never loads the WASM
 * build.
 */

import type { PGlite } from "@electric-sql/pglite";

import type { SqlExecutor, SqlResult, SqlRow } from "./executor";

/** Serialises work onto a single promise chain. */
class Lock {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    // Swallow the rejection on the chain itself; the caller still sees it.
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function toResult<R extends SqlRow>(rows: R[], affected: number | undefined) {
  // PGlite reports UPDATE/DELETE counts on `affectedRows`; `rows` is empty for
  // a statement with no RETURNING clause.
  return { rows, rowCount: affected ?? rows.length };
}

/** The executor handed to a transaction body. Savepoints, and no lock. */
class PgliteTransaction implements SqlExecutor {
  constructor(
    private readonly db: PGlite,
    private readonly depth: number,
  ) {}

  async query<R extends SqlRow = SqlRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<SqlResult<R>> {
    const result = await this.db.query<R>(text, [...params]);
    return toResult(result.rows, result.affectedRows);
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const name = `sp_${String(this.depth + 1)}`;
    await this.db.exec(`savepoint ${name}`);
    try {
      const value = await fn(new PgliteTransaction(this.db, this.depth + 1));
      await this.db.exec(`release savepoint ${name}`);
      return value;
    } catch (error) {
      await this.db.exec(`rollback to savepoint ${name}`);
      throw error;
    }
  }

  async execScript(text: string): Promise<void> {
    await this.db.exec(text);
  }

  async close(): Promise<void> {
    // The outer executor owns the database's lifetime, not the transaction.
  }
}

class PgliteExecutor implements SqlExecutor {
  private readonly lock = new Lock();

  constructor(private readonly open: () => Promise<PGlite>) {}

  async query<R extends SqlRow = SqlRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<SqlResult<R>> {
    return this.lock.run(async () => {
      const db = await this.open();
      const result = await db.query<R>(text, [...params]);
      return toResult(result.rows, result.affectedRows);
    });
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.lock.run(async () => {
      const db = await this.open();
      await db.exec("begin");
      try {
        const value = await fn(new PgliteTransaction(db, 0));
        await db.exec("commit");
        return value;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    });
  }

  async execScript(text: string): Promise<void> {
    await this.lock.run(async () => {
      const db = await this.open();
      await db.exec(text);
    });
  }

  async close(): Promise<void> {
    await this.lock.run(async () => {
      const db = await this.open();
      await db.close();
    });
  }
}

/**
 * A `SqlExecutor` for a PGlite that already exists.
 *
 * `close()` closes it, matching `createPgExecutor`, so a caller that hands its
 * database over should not also close it itself.
 */
export function createPgliteExecutor(db: PGlite): SqlExecutor {
  return new PgliteExecutor(() => Promise.resolve(db));
}

/**
 * A `SqlExecutor` for a PGlite that does not exist yet.
 *
 * `open` is called on the first statement and is expected to memoise; this
 * module does not cache it, because the caller is the one that knows whether a
 * failed open should be retried.
 */
export function createLazyPgliteExecutor(
  open: () => Promise<PGlite>,
): SqlExecutor {
  return new PgliteExecutor(open);
}
