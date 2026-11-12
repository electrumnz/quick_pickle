/**
 * The one place a database connection is made.
 *
 *   DATABASE_URL (or POSTGRES_URL) set   a real Postgres, through a small pool.
 *   neither set                          Postgres in this process (PGlite):
 *                                          tests        in memory, fresh
 *                                          development  kept under .data/pglite
 *                                          a deployment in memory, seeded with
 *                                                       demo data (see demo.ts)
 *
 * Either way the schema is brought up to date before the first query, from
 * the migrations embedded in the build, so the code and the tables it expects
 * cannot be out of step.
 */

import "server-only";

import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";

import { applyMigrations } from "./migrate";
import type { Db } from "./types";

export type DbMode = "postgres" | "embedded";

export type DbHandle = {
  readonly db: Db;
  readonly mode: DbMode;
  /**
   * True when what is written will still be there tomorrow. False for the
   * in-memory database a deployment without DATABASE_URL runs on.
   */
  readonly durable: boolean;
  close(): Promise<void>;
};

type Env = Record<string, string | undefined>;

export function databaseUrl(env: Env = process.env): string | null {
  const url = (env.DATABASE_URL ?? env.POSTGRES_URL ?? "").trim();
  return url === "" ? null : url;
}

function isLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

async function openPostgres(url: string, env: Env): Promise<DbHandle> {
  const { Pool } = await import("pg");

  // TLS is decided here, not by an `sslmode` in the URL: node-postgres reads
  // that parameter differently from every other Postgres client, and a hosted
  // pooler's certificate chain does not verify against Node's default roots.
  // With DATABASE_CA_CERT set (the provider's CA, PEM) the server is verified
  // properly. Without it the link is encrypted but the server is not proven.
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  const ca = (env.DATABASE_CA_CERT ?? "").trim();
  const ssl = isLocal(parsed.hostname)
    ? false
    : ca === ""
      ? { rejectUnauthorized: false }
      : { ca, rejectUnauthorized: true };

  const pool = new Pool({
    connectionString: parsed.toString(),
    ssl,
    // A serverless function serves one request at a time; a handful of
    // connections is plenty, and the provider's pooler sits in front.
    max: 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle client that errors must not take the process down with it.
  pool.on("error", (error) => {
    console.error(
      JSON.stringify({ event: "db.pool_error", message: error.message }),
    );
  });

  const db = drizzlePg(pool, { schema, casing: "snake_case" });
  await applyMigrations(db);
  return {
    db,
    mode: "postgres",
    durable: true,
    close: () => pool.end(),
  };
}

/**
 * Open an in-process database. `dataDir` keeps it on disk; without one it
 * lives in memory and is gone when the process is.
 */
export async function openEmbedded(dataDir?: string): Promise<DbHandle> {
  const [{ PGlite }, { drizzle: drizzlePglite }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);
  const client = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  await client.waitReady;
  const db = drizzlePglite(client, {
    schema,
    casing: "snake_case",
  }) as unknown as Db;
  await applyMigrations(db);
  return {
    db,
    mode: "embedded",
    durable: dataDir !== undefined,
    close: () => client.close(),
  };
}

async function open(env: Env): Promise<DbHandle> {
  const url = databaseUrl(env);
  if (url !== null) return openPostgres(url, env);

  if (env.NODE_ENV === "production") {
    // A deployment with no database: in memory, with demo data, and the back
    // end says so on every screen.
    const handle = await openEmbedded();
    const { seedDemo } = await import("./demo");
    await seedDemo(handle.db);
    return handle;
  }
  if (env.NODE_ENV === "test") return openEmbedded();

  const { mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), ".data", "pglite");
  await mkdir(dir, { recursive: true });
  return openEmbedded(dir);
}

/**
 * One handle per process. Kept on `globalThis` so a development reload, which
 * re-evaluates this module, does not open a second database over the first.
 */
const globalForDb = globalThis as typeof globalThis & {
  __qpDb?: Promise<DbHandle>;
};

export function getDbHandle(env: Env = process.env): Promise<DbHandle> {
  if (globalForDb.__qpDb === undefined) {
    const opening = open(env);
    globalForDb.__qpDb = opening;
    // A failed open must not be remembered: the next request tries again.
    opening.catch(() => {
      if (globalForDb.__qpDb === opening) globalForDb.__qpDb = undefined;
    });
  }
  return globalForDb.__qpDb;
}

export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}

/** For tests that swap the database, and for scripts that must exit. */
export async function closeDb(): Promise<void> {
  const current = globalForDb.__qpDb;
  globalForDb.__qpDb = undefined;
  if (current !== undefined) {
    const handle = await current.catch(() => null);
    if (handle !== null) await handle.close();
  }
}

/** Point `getDb()` at a given handle. Tests only. */
export function useDbHandle(handle: DbHandle): void {
  globalForDb.__qpDb = Promise.resolve(handle);
}
