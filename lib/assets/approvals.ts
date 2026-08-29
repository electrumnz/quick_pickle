/**
 * Finding the picture inside a decision.
 *
 * When an agent proposes a post it cites the assets it chose by id, in the
 * payload of its tool call. That payload is what `approvals.payload` stores, so
 * the ids travel with the decision automatically — there is no second table to
 * keep in step, and no way for the citation and the approved action to drift
 * apart, because they are the same object.
 *
 * This module reads them back out. `assetIdsIn` walks the payload, and the
 * store's `approvalsFor` goes the other way. Together they are what lets the
 * founder see the photograph she is approving instead of a filename in a JSON
 * blob.
 *
 * Deliberately tolerant about shape: it collects anything that looks like an
 * asset id, wherever it sits. A payload written by a tool this unit does not own
 * still works, and an id that turns out not to be an asset is simply not found
 * by the lookup that follows.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The key names a tool is asked to use. Matches are hoisted to the front. */
const PREFERRED_KEYS = new Set([
  "assetid",
  "assetids",
  "asset_id",
  "asset_ids",
  "assets",
]);

/** Every asset-shaped id in a payload, preferred keys first, deduplicated. */
export function assetIdsIn(payload: unknown, limit = 12): readonly string[] {
  const preferred: string[] = [];
  const other: string[] = [];

  const walk = (value: unknown, underPreferredKey: boolean, depth: number): void => {
    if (depth > 6) return;
    if (typeof value === "string") {
      if (UUID.test(value)) {
        (underPreferredKey ? preferred : other).push(value.toLowerCase());
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, underPreferredKey, depth + 1);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, entry] of Object.entries(value)) {
        walk(
          entry,
          underPreferredKey || PREFERRED_KEYS.has(key.toLowerCase()),
          depth + 1,
        );
      }
    }
  };

  walk(payload, false, 0);
  return [...new Set([...preferred, ...other])].slice(0, limit);
}
