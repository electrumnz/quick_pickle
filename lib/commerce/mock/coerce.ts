/**
 * Row coercion.
 *
 * Postgres drivers disagree about JavaScript representations — node-postgres
 * hands back `Date` for `timestamptz` and a string for `bigint`, PGlite hands
 * back `Date` and a number, and `json_agg` produces either a parsed object or a
 * string depending on the driver's type parser. Rather than trusting any of
 * that, every value crossing out of SQL goes through one of these, which fail
 * loudly instead of producing `NaN` in a price.
 */

import { CommerceError } from "../errors";

function bad(field: string, value: unknown, wanted: string): never {
  throw new CommerceError(
    "PROVIDER_UNAVAILABLE",
    `Column ${field} was ${JSON.stringify(value)}, expected ${wanted}`,
    { details: { field, wanted } },
  );
}

export function str(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  bad(field, value, "a string");
}

export function strOrNull(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return str(value, field);
}

/** Integer columns only. Rejects anything fractional, since money lives here. */
export function int(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  bad(field, value, "a safe integer");
}

export function intOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return int(value, field);
}

export function bool(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "t" || value === "true") return true;
  if (value === "f" || value === "false") return false;
  bad(field, value, "a boolean");
}

/** `timestamptz` -> ISO-8601 string. */
export function iso(value: unknown, field: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  bad(field, value, "a timestamp");
}

export function isoOrNull(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return iso(value, field);
}

export function strArray(value: unknown, field: string): string[] {
  if (Array.isArray(value))
    return value.map((item, index) => str(item, `${field}[${String(index)}]`));
  if (value === null || value === undefined) return [];
  bad(field, value, "a text[]");
}

/** `json_agg` output, which some drivers deliver as an unparsed string. */
export function jsonArray(value: unknown, field: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  }
  bad(field, value, "a json array");
}

export function jsonObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  bad(field, value, "a json object");
}

/** Narrow a text column to one of a known set of literals. */
export function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  const text = str(value, field);
  if ((allowed as readonly string[]).includes(text)) return text;
  bad(field, value, `one of ${allowed.join(" | ")}`);
}
