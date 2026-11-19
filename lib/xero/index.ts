/**
 * Whether the shop has a Xero app to connect with, and if not, why.
 *
 * The owner makes the app in Xero's developer portal (a web app), and its
 * two values go on the host: `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET`
 * (the infra workflow's `connect-xero`). Then the owner connects their
 * organisation from Settings, Xero. Like email and Starshipit, it only ever
 * reaches Xero from production with a real database: never a preview, a
 * development server, a back end on invented records, or a test.
 */

import { databaseUrl } from "@/lib/db/client";
import { siteUrl } from "@/lib/site";
import { underTestRunner } from "@/lib/under-test";

import type { XeroApp } from "./client";

type Env = Readonly<Record<string, string | undefined>>;

export const XERO_SETTINGS = ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"] as const;

/** Where Xero sends the owner back to. The app in Xero must list it. */
export const XERO_CALLBACK_PATH = "/backstage/xero/callback";

export function xeroRedirectUri(): string {
  return `${siteUrl()}${XERO_CALLBACK_PATH}`;
}

export type XeroSetting = {
  /** Xero can be connected, and the books sent, from here. */
  readonly on: boolean;
  readonly missing: readonly string[];
  readonly held: string | null;
};

function heldBecause(env: Env): string | null {
  if (databaseUrl(env) === null) {
    return "The back end is on invented records, so nothing goes to Xero.";
  }
  if (underTestRunner(env)) return "Tests never reach Xero.";
  if ((env.VERCEL_ENV ?? "").trim().toLowerCase() === "preview") {
    return "This is a preview deployment, and a preview never sends anything to Xero.";
  }
  if (env.NODE_ENV !== "production") {
    return "This is a development server, which never sends anything to Xero.";
  }
  return null;
}

export function xeroSetting(env: Env = process.env): XeroSetting {
  const missing = XERO_SETTINGS.filter(
    (name) => (env[name] ?? "").trim() === "",
  );
  if (missing.length > 0) return { on: false, missing, held: null };
  const held = heldBecause(env);
  return { on: held === null, missing, held };
}

/**
 * The app's values and the `fetch` to use, or null when Xero cannot be
 * reached from here. A test hands in its own settings and its own `fetch`.
 */
export function xeroApp(
  options: { readonly env?: Env; readonly fetch?: typeof fetch } = {},
): XeroApp | null {
  const env = options.env ?? process.env;
  if (options.fetch === undefined) {
    if (!xeroSetting(env).on || underTestRunner()) return null;
  } else if (xeroSetting(env).missing.length > 0) {
    return null;
  }
  return {
    clientId: (env.XERO_CLIENT_ID ?? "").trim(),
    clientSecret: (env.XERO_CLIENT_SECRET ?? "").trim(),
    fetch: options.fetch ?? fetch,
  };
}
