import { INVENTORY_REASONS, type InventoryReason } from "@/lib/commerce";

/**
 * The words Stock & Batches uses.
 *
 * Outside `actions.ts` because a `"use server"` module may export nothing but
 * async functions. Every list is a closed set checked on the server, so a
 * hand-made `POST` cannot introduce a reason the screen never offered — which
 * matters more here than anywhere else in the admin, because an inventory
 * reason is what a recall reads back.
 */

export { INVENTORY_REASONS };
export type { InventoryReason };

/** Why a count moved, in the words she would use to say it out loud. */
export const COUNT_REASON_WORDS: Readonly<Record<string, string>> = {
  stocktake: "I counted them",
  damage: "Broken or spoiled",
  sample: "Given away or sampled",
  return: "Came back and is fine to sell",
  expiry: "Past its best-before",
  transfer: "Moved between the kitchen and the coolstore",
  recall: "Pulled back off the shelf",
  correction: "Fixing an earlier mistake",
};

/** How a batch is described on screen. Mirrors `public.batch_status`. */
export const BATCH_WORDS: Readonly<Record<string, string>> = {
  planned: "Planned",
  brewing: "Brewing",
  fermenting: "Fermenting",
  conditioning: "Conditioning",
  bottling: "Bottling",
  qa_hold: "Held for testing",
  released: "Released for sale",
  sold_out: "Sold out",
  recalled: "Recalled",
  discarded: "Discarded",
};

/** A closed set as `<Select>` wants it. */
export function options(
  values: readonly string[],
  words: Readonly<Record<string, string>>,
): readonly { readonly value: string; readonly label: string }[] {
  return values.map((value) => ({ value, label: words[value] ?? value }));
}
