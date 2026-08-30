/**
 * A real storefront to audit.
 *
 * The avatar audit is only worth running against pages a browser would get, so
 * this harness produces a live server and a base URL, in the cheapest way
 * available:
 *
 *   1. `AUDIT_BASE_URL`, when the caller has one — a preview deployment, or
 *      production.
 *   2. Whatever is already listening on port 3000, so a run alongside
 *      `npm run dev` costs nothing.
 *   3. Otherwise it starts `next dev` on a free port and stops it afterwards.
 *
 * It never falls back to rendering components in-process. An audit that renders
 * its own pages is measuring the same assumptions the pages were built from,
 * which is the failure this whole unit exists to avoid — so if no server can be
 * reached and none can be started, the harness throws and the audit is reported
 * as not run rather than as passed.
 *
 * ## A storefront the audit can actually measure
 *
 * Case 3 used to hand the child whatever environment the test runner happened
 * to have. On a checkout with no `.env.local` — CI's unit-test job, a fresh
 * clone — that is no `SUPABASE_DB_URL`, and `lib/demo/mode.ts` names the result
 * exactly: "a deployment that has none shows four bottles nobody can buy". The
 * audit then reported the absence of a database as a copy failure. Three checks
 * were red for it, and the two findings named the buy control and the supply
 * note — neither of which is a sentence anybody wrote wrong.
 *
 * So the spawned storefront is given the backend demo mode exists to supply:
 * the Postgres image compiled from `supabase/migrations` and `supabase/seed.sql`,
 * which needs no Postgres, no Docker and no network, and which
 * {@link ensureDemoImage} builds on demand when it is not there. It is a
 * fallback and never an override — {@link resolveDatabaseUrl} gives a
 * configured `SUPABASE_DB_URL` precedence, and this only reaches for the image
 * when neither the environment nor a dotenv file in the tree names a database.
 * Nothing about the checks changes: they still read bytes served over HTTP.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { ensureDemoImage } from "@/lib/demo/build";
import {
  DEMO_ENV_VALUE,
  DEMO_ENV_VAR,
  resolveDatabaseUrl,
} from "@/lib/demo/mode";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** The files `next dev` reads a connection string out of, in its own order. */
const DOTENV_FILES = [
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
];

export interface StorefrontHarness {
  readonly baseUrl: string;
  /** How the base URL was obtained, for the evidence header. */
  readonly source:
    "env" | "already-running" | "spawned" | "spawned on the demo database";
  stop(): Promise<void>;
}

async function alive(baseUrl: string, timeoutMs = 2_000): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(
  baseUrl: string,
  child: ChildProcess,
  deadlineMs: number,
): Promise<void> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) {
      throw new Error(
        `next dev exited with code ${String(child.exitCode)} before serving ${baseUrl}`,
      );
    }
    if (await alive(baseUrl, 3_000)) return;
    await new Promise((wake) => setTimeout(wake, 1_000));
  }
  throw new Error(`next dev did not answer on ${baseUrl} within the deadline`);
}

/**
 * Whether a dotenv file in the tree names a database.
 *
 * The child runs `next dev`, which loads its own env files, so the connection
 * string it will end up with is not necessarily one this process can see —
 * vitest reads no dotenv. Asking the files directly is how the answer is got
 * without loading them here: `@next/env` stamps `__NEXT_PROCESSED_ENV` on any
 * process it loads, children inherit it, and a child that sees it skips its own
 * env loading altogether. `e2e/support/admin.ts` reads the same files the same
 * way and for the same reason.
 */
function dotenvDeclaresDatabaseUrl(root: string): boolean {
  return DOTENV_FILES.some((file) => {
    const full = join(root, file);
    if (!existsSync(full)) return false;
    return /^\s*(?:export\s+)?SUPABASE_DB_URL\s*=\s*\S/m.test(
      readFileSync(full, "utf8"),
    );
  });
}

/**
 * The environment that guarantees the spawned storefront has a catalogue.
 *
 * Empty when a database is already named, which is the case in CI's e2e job and
 * on any machine with a `.env.local` — the storefront is then exactly the one
 * it is today. Otherwise demo mode, which is the answer this repository already
 * built for a deployment with no Postgres.
 */
async function commerceBackend(root: string): Promise<{
  readonly env: Readonly<Record<string, string>>;
  readonly demo: boolean;
}> {
  if (
    resolveDatabaseUrl(process.env) !== null ||
    dotenvDeclaresDatabaseUrl(root)
  ) {
    return { env: {}, demo: false };
  }
  await ensureDemoImage(root);
  return { env: { [DEMO_ENV_VAR]: DEMO_ENV_VALUE }, demo: true };
}

/** Find a storefront, or start one. */
export async function storefront(): Promise<StorefrontHarness> {
  const configured = process.env["AUDIT_BASE_URL"]?.replace(/\/+$/, "");
  if (configured !== undefined && configured !== "") {
    if (!(await alive(configured, 10_000))) {
      throw new Error(
        `AUDIT_BASE_URL is set to ${configured} and it did not answer.`,
      );
    }
    return {
      baseUrl: configured,
      source: "env",
      stop: async () => undefined,
    };
  }

  const local = "http://localhost:3000";
  if (await alive(local)) {
    return {
      baseUrl: local,
      source: "already-running",
      stop: async () => undefined,
    };
  }

  const port = 3400 + Math.floor(Math.random() * 200);
  const baseUrl = `http://localhost:${String(port)}`;
  const backend = await commerceBackend(REPO_ROOT);
  const child = spawn("npx", ["next", "dev", "--port", String(port)], {
    cwd: REPO_ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(port), ...backend.env },
    detached: false,
  });

  try {
    await waitFor(baseUrl, child, 180_000);
  } catch (cause) {
    child.kill("SIGKILL");
    throw cause;
  }

  return {
    baseUrl,
    source: backend.demo ? "spawned on the demo database" : "spawned",
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((wake) => setTimeout(wake, 500));
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}
