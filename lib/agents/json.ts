/** JSON value model shared by transcript persistence and tool payloads. */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** True when the value round-trips through `JSON.stringify` unchanged in shape. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Coerce an arbitrary value into a `JsonValue` by serialising it.
 *
 * Used at the persistence boundary: anything a tool returns must survive a
 * round-trip through Postgres `jsonb`, so it is normalised here rather than
 * trusted to be JSON already.
 */
export function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
