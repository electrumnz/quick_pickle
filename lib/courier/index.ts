/**
 * Whether the courier's booking system is connected, and if not, why.
 *
 * Starshipit is the one there is (lib/courier/starshipit.ts). It is on when
 * both of its keys are set on the host, and only ever from a production
 * deployment with a real database: never a Vercel preview, a development
 * server, a back end on invented records, or a test. A preview takes test
 * orders and runs unmerged code, and an order handed over is a real box
 * waiting for a real label.
 *
 * Without it nothing changes: the courier screen's file out and tracking
 * back (lib/backstage/orders/courier.ts) work as they always did.
 */

import { databaseUrl } from "@/lib/db/client";
import { underTestRunner } from "@/lib/under-test";

import type { StarshipitOptions } from "./starshipit";

type Env = Readonly<Record<string, string | undefined>>;

export type CourierConnection = {
  /** Orders go to Starshipit and tracking comes back by itself. */
  readonly on: boolean;
  /** The settings that are missing, by name. Never a value. */
  readonly missing: readonly string[];
  /** Why it is off although both keys are set, or null. */
  readonly held: string | null;
};

export const STARSHIPIT_SETTINGS = [
  "STARSHIPIT_API_KEY",
  "STARSHIPIT_SUBSCRIPTION_KEY",
] as const;

function heldBecause(env: Env): string | null {
  if (databaseUrl(env) === null) {
    return "The back end is on invented records, so nothing goes to Starshipit.";
  }
  if (underTestRunner(env)) return "Tests never reach Starshipit.";
  if ((env.VERCEL_ENV ?? "").trim().toLowerCase() === "preview") {
    return "This is a preview deployment, and a preview never sends orders to Starshipit.";
  }
  if (env.NODE_ENV !== "production") {
    return "This is a development server, which never sends orders to Starshipit.";
  }
  return null;
}

export function courierConnection(env: Env = process.env): CourierConnection {
  const missing = STARSHIPIT_SETTINGS.filter(
    (name) => (env[name] ?? "").trim() === "",
  );
  if (missing.length > 0) return { on: false, missing, held: null };
  const held = heldBecause(env);
  return { on: held === null, missing, held };
}

/**
 * The keys and the `fetch` to use, or null when Starshipit is not connected
 * here. A test that wants it "connected" hands in both its own settings and
 * its own `fetch`: under a test runner the real one is never used.
 */
export function starshipitOptions(
  options: { readonly env?: Env; readonly fetch?: typeof fetch } = {},
): StarshipitOptions | null {
  const env = options.env ?? process.env;
  if (options.fetch === undefined) {
    if (!courierConnection(env).on) return null;
    if (underTestRunner()) return null;
  } else if (courierConnection(env).missing.length > 0) {
    return null;
  }
  return {
    apiKey: (env.STARSHIPIT_API_KEY ?? "").trim(),
    subscriptionKey: (env.STARSHIPIT_SUBSCRIPTION_KEY ?? "").trim(),
    fetch: options.fetch ?? fetch,
  };
}
