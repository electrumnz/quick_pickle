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
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

export interface StorefrontHarness {
  readonly baseUrl: string;
  /** How the base URL was obtained, for the evidence header. */
  readonly source: "env" | "already-running" | "spawned";
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
  const child = spawn("npx", ["next", "dev", "--port", String(port)], {
    cwd: REPO_ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(port) },
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
    source: "spawned",
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((wake) => setTimeout(wake, 500));
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}
