/**
 * Row readers.
 *
 * Postgres rows arrive as untyped JSON. Rather than assert a shape, every field
 * is read through a checked accessor: a column that is missing or the wrong type
 * fails loudly here instead of turning into `undefined` three layers up.
 */

import { AgentRuntimeError } from "../errors";
import type { JsonObject, JsonValue } from "../json";

export type Row = Record<string, unknown>;

export function expectRow(value: unknown, context: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentRuntimeError("store_conflict", `Expected a row for ${context}.`, { context });
  }
  return value as Row;
}

export function str(row: Row, column: string, context: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new AgentRuntimeError(
      "store_conflict",
      `Column "${column}" on ${context} is not text (got ${typeof value}).`,
      { column, context },
    );
  }
  return value;
}

export function strOrNull(row: Row, column: string): string | null {
  const value = row[column];
  return typeof value === "string" ? value : null;
}

export function num(row: Row, column: string, fallback = 0): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  // bigint columns (cost_micros) come back as strings from PostgREST.
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

export function numOrNull(row: Row, column: string): number | null {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function bool(row: Row, column: string, fallback = false): boolean {
  const value = row[column];
  return typeof value === "boolean" ? value : fallback;
}

export function strArray(row: Row, column: string): string[] {
  const value = row[column];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function json(row: Row, column: string): JsonValue | null {
  const value = row[column];
  if (value === undefined || value === null) {
    return null;
  }
  return value as JsonValue;
}

export function jsonObject(row: Row, column: string): JsonObject {
  const value = row[column];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

/** Narrow an untrusted string to one of a known union, or throw. */
export function oneOf<T extends string>(
  row: Row,
  column: string,
  allowed: readonly T[],
  context: string,
): T {
  const value = str(row, column, context);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new AgentRuntimeError(
      "store_conflict",
      `Column "${column}" on ${context} holds "${value}", which is not one of ${allowed.join(", ")}.`,
      { column, context, value },
    );
  }
  return value as T;
}
