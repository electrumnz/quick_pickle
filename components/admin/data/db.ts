import "server-only";

import {
  createPgExecutor,
  getCommerceProvider,
  type CommerceProvider,
  type SqlExecutor,
} from "@/lib/commerce";

/**
 * The admin's two doors onto the business.
 *
 * **Orders, products and inventory go through the commerce provider.** That is
 * the seam Shopify plugs into; an admin screen that reached into
 * `public.orders` itself would keep working against the mock and break the day
 * the store moves to the real API.
 *
 * **Everything Shopify does not own goes through SQL.** Recipes, batches,
 * suppliers, agents, approvals, brand rules and the audit log are Half Sour's
 * own tables, and there is no adapter for them because there is nothing to
 * adapt to.
 *
 * Both are wrapped so a missing environment variable or an unreachable
 * database renders an honest panel instead of a stack trace. The admin is the
 * place the founder finds out something is wrong; it is not allowed to be the
 * thing that is wrong.
 */

type DbGlobal = { __halfSourAdminSql?: SqlExecutor };

/** One pool per server process, kept across hot reloads in development. */
export function adminSql(): SqlExecutor {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (url === undefined || url === "") {
    throw new Error(
      "SUPABASE_DB_URL is not set, so the admin cannot read the business database.",
    );
  }
  const store = globalThis as unknown as DbGlobal;
  store.__halfSourAdminSql ??= createPgExecutor(url);
  return store.__halfSourAdminSql;
}

/** The commerce adapter — mock against Supabase today, Shopify tomorrow. */
export function commerce(): CommerceProvider {
  return getCommerceProvider();
}

// ---------------------------------------------------------------------------
// Loading, and failing in plain English
// ---------------------------------------------------------------------------

export type Loaded<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly problem: string; readonly detail: string };

/**
 * Run a page's queries, and turn a failure into something a person can read.
 *
 * The `problem` is what she needs to know. The `detail` is what a developer
 * needs, and the pages tuck it inside a collapsed `<details>` rather than
 * throwing it at her.
 */
export async function load<T>(read: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      problem:
        "The admin could not reach the business database, so this page has nothing to show. Nothing is lost — it will fill in as soon as the connection is back.",
      detail,
    };
  }
}

// ---------------------------------------------------------------------------
// Reading a SQL row without `any`
// ---------------------------------------------------------------------------
//
// `SqlRow` is `Record<string, unknown>`, which is the honest type for a driver
// result. These narrow it at the boundary so every screen below works with
// real types rather than casts.

export function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

export function textOrNull(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  return typeof value === "string" && value !== "" ? value : null;
}

export function int(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return Math.trunc(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }
  return 0;
}

/** Postgres `numeric` arrives as a string, on purpose: it is exact there. */
export function decimal(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function bool(row: Record<string, unknown>, key: string): boolean {
  return row[key] === true;
}

export function boolOrNull(
  row: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = row[key];
  return typeof value === "boolean" ? value : null;
}

/** A timestamp as an ISO string, or null. `pg` hands back a `Date`. */
export function isoOrNull(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value !== "") return value;
  return null;
}

export function iso(row: Record<string, unknown>, key: string): string {
  return isoOrNull(row, key) ?? new Date(0).toISOString();
}

export function textArray(
  row: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = row[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
