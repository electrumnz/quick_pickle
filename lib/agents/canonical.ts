import { createHash } from "node:crypto";

import type { JsonValue } from "./json";

/**
 * Deterministic JSON serialisation: object keys sorted, no incidental
 * whitespace. Two structurally equal payloads always produce the same string,
 * which is what makes an argument fingerprint comparable across a process
 * boundary (approval requested here, executed there).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry === undefined) {
        continue;
      }
      sorted[key] = sortValue(entry);
    }
    return sorted;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/**
 * SHA-256 over the canonical form. The approval gate compares this, never the
 * raw arguments, so an agent cannot get an innocuous payload approved and then
 * execute a different one.
 */
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
