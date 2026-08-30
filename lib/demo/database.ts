/**
 * The demo database: one PGlite per server process, restored from the image the
 * build compiled in.
 *
 * ## What this is honest about
 *
 * **Reads are consistent; writes are not durable.** Every instance opens the
 * same image, so every instance shows the same catalogue, the same 95 orders and
 * the same agent history. A *write* — packing an order, adjusting stock, adding
 * to a cart — lands in the memory of whichever instance served that request.
 * Serverless instances share no memory, so the next request may be served by an
 * instance that never saw it, and every instance forgets everything on redeploy
 * or when the platform recycles it. That is why demo mode is unmistakable on
 * screen: see `components/demo/DemoBanner.tsx`.
 *
 * **The image is data, not credentials.** It carries the seeded business —
 * products, orders, recipes, agents. It carries no password hash and no session
 * secret; `admin_sessions` rows in the seed are fabricated tokens that no cookie
 * can ever match, and the gate still verifies `ADMIN_PASSWORD_HASH` from the
 * environment on every sign-in.
 *
 * The `@electric-sql/pglite` import is type-only and erased; the runtime import
 * is dynamic, so a build with demo mode off never loads the WASM.
 */

import { readFileSync } from "node:fs";

import type { PGlite } from "@electric-sql/pglite";

import { createLazyPgliteExecutor } from "@/lib/commerce/sql/pglite";
import type { SqlExecutor } from "@/lib/commerce/sql/executor";

import { demoImagePath } from "./build";
import { DEMO_ENV_VAR, isDemoMode } from "./mode";

type DemoGlobal = {
  __halfSourDemoDb?: Promise<PGlite>;
  __halfSourDemoSql?: SqlExecutor;
};

function slot(): DemoGlobal {
  return globalThis as unknown as DemoGlobal;
}

/**
 * Fail closed.
 *
 * Nothing in this module is reachable unless `HALF_SOUR_DEMO=1`. A stray
 * `SUPABASE_DB_URL=pglite://half-sour-demo` in an environment that did not ask
 * for demo mode gets an error, not a database.
 */
function assertDemoMode(): void {
  if (isDemoMode()) return;
  throw new Error(
    `The demo database was asked for but ${DEMO_ENV_VAR} is not set to 1. ` +
      "Demo mode is opt-in through that one variable and nothing else turns it on.",
  );
}

/**
 * Open a fresh Postgres from the image on disk.
 *
 * Not memoised and not gated: this is the loader, and both the process-wide
 * database below and the conformance harness use it so that "how the image is
 * opened" has exactly one answer. The gate is on {@link demoDatabase}.
 */
export async function openDemoImage(): Promise<PGlite> {
  const file = demoImagePath();
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(file);
  } catch (cause) {
    throw new Error(
      `The demo database image is missing at ${file}. ` +
        "Build it with `npm run demo:build-image` (the `prebuild` script does " +
        `this automatically when ${DEMO_ENV_VAR}=1). Cause: ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
  }
  const { PGlite: Pglite } = await import("@electric-sql/pglite");
  return Pglite.create({
    loadDataDir: new Blob([new Uint8Array(bytes)]),
  });
}

/**
 * The process-wide demo database, opened on first use.
 *
 * Memoised on `globalThis` rather than in module scope so that Next's dev
 * server, which re-evaluates modules on every edit, does not spend a second
 * restoring the image on each save — and so the commerce layer and the auth
 * store are looking at the same rows.
 */
export function demoDatabase(): Promise<PGlite> {
  assertDemoMode();
  const store = slot();
  store.__halfSourDemoDb ??= openDemoImage();
  return store.__halfSourDemoDb;
}

/** The demo database as the `SqlExecutor` the rest of the build is written against. */
export function demoSqlExecutor(): SqlExecutor {
  assertDemoMode();
  const store = slot();
  store.__halfSourDemoSql ??= createLazyPgliteExecutor(demoDatabase);
  return store.__halfSourDemoSql;
}

/** Drop the memoised database. Tests and hot reload only. */
export async function resetDemoDatabase(): Promise<void> {
  const store = slot();
  const open = store.__halfSourDemoDb;
  store.__halfSourDemoDb = undefined;
  store.__halfSourDemoSql = undefined;
  if (open === undefined) return;
  const db = await open.catch(() => null);
  if (db !== null) await db.close();
}
