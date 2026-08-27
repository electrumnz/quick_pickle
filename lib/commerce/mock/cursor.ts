/**
 * Opaque pagination cursors.
 *
 * Shopify's cursors are base64 blobs whose contents callers must not read, and
 * these are the same: a scope tag plus a position, base64url encoded. The scope
 * is what stops an `orders` cursor being replayed against `products` — it does
 * not authorise anything, it just turns a silently wrong page into a clear
 * `INVALID_INPUT`.
 */

import { commerceErrors } from "../errors";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type Connection,
  type PageArgs,
  type PageInfo,
} from "../types";

export function encodeCursor(scope: string, index: number): string {
  return Buffer.from(`${scope}:${String(index)}`, "utf8").toString("base64url");
}

export function decodeCursor(scope: string, cursor: string): number {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw commerceErrors.invalidInput(`Malformed cursor: ${cursor}`, [
      "cursor",
    ]);
  }
  const separator = decoded.lastIndexOf(":");
  const cursorScope = separator === -1 ? "" : decoded.slice(0, separator);
  const index = Number(decoded.slice(separator + 1));
  if (cursorScope !== scope || !Number.isSafeInteger(index) || index < 0) {
    throw commerceErrors.invalidInput(
      `Cursor does not belong to this list (expected ${scope})`,
      ["cursor"],
    );
  }
  return index;
}

export type PageWindow = { readonly offset: number; readonly limit: number };

/**
 * Turn Relay page arguments into an offset/limit window.
 *
 * @throws {CommerceError} `INVALID_INPUT` when both directions are given, when
 * a page size is not a positive integer, or when it exceeds
 * {@link MAX_PAGE_SIZE} — all three of which Shopify also refuses.
 */
export function resolvePageWindow(
  scope: string,
  args: PageArgs,
  totalCount: number,
): PageWindow {
  const forwards = args.first !== undefined || args.after !== undefined;
  const backwards = args.last !== undefined || args.before !== undefined;
  if (forwards && backwards) {
    throw commerceErrors.invalidInput(
      "Pass either first/after or last/before, not both",
      ["first", "last"],
    );
  }

  if (backwards) {
    const size = checkedSize(args.last, "last");
    const end =
      args.before === undefined ? totalCount : decodeCursor(scope, args.before);
    const offset = Math.max(0, Math.min(end, totalCount) - size);
    return {
      offset,
      limit: Math.min(size, Math.max(0, Math.min(end, totalCount))),
    };
  }

  const size = checkedSize(args.first, "first");
  const offset =
    args.after === undefined ? 0 : decodeCursor(scope, args.after) + 1;
  return { offset, limit: size };
}

function checkedSize(value: number | undefined, field: string): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw commerceErrors.invalidInput(
      `${field} must be a positive integer, got ${String(value)}`,
      [field],
    );
  }
  if (value > MAX_PAGE_SIZE) {
    throw commerceErrors.invalidInput(
      `${field} must be at most ${String(MAX_PAGE_SIZE)}, got ${String(value)}`,
      [field],
    );
  }
  return value;
}

export function buildConnection<T>(
  scope: string,
  nodes: readonly T[],
  window: PageWindow,
  totalCount: number,
): Connection<T> {
  const pageInfo: PageInfo = {
    hasNextPage: window.offset + nodes.length < totalCount,
    hasPreviousPage: window.offset > 0,
    startCursor: nodes.length === 0 ? null : encodeCursor(scope, window.offset),
    endCursor:
      nodes.length === 0
        ? null
        : encodeCursor(scope, window.offset + nodes.length - 1),
  };
  return { nodes, pageInfo };
}

export const emptyConnection = <T>(): Connection<T> => ({
  nodes: [],
  pageInfo: {
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: null,
    endCursor: null,
  },
});
