/**
 * Reading "which batch is in the box" out of a submitted form.
 *
 * The form (app/backstage/(app)/stock/order-parts.tsx) has a pick-one named
 * `batchCode` for a box that came from one batch (one for each flavour in a
 * box that holds two), and a number box for each batch named `mix-<code>`
 * for a box that mixes them. If any of the mix boxes is filled in, the mix
 * is what the person meant for that flavour.
 */

const MIX = "mix-";

/** The name of the number box for one batch's share of a mixed box. */
export function mixFieldName(code: string): string {
  return `${MIX}${code}`;
}

/** What orders.markPacked and stock.recordOrderBatch take for the batch. */
export type PackedFromInput = {
  batchCode?: string;
  batchCodes?: string[];
  batches?: { code: string; shots: number }[];
};

export function packedFromForm(form: FormData): PackedFromInput {
  const batches: { code: string; shots: number }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith(MIX) || typeof value !== "string") continue;
    const raw = value.replace(/[,\s]/g, "");
    if (raw === "" || /^0+$/.test(raw)) continue;
    batches.push({
      code: key.slice(MIX.length),
      // Not a number: passed on as such, for the operation to turn away
      // with its own sentence.
      shots: /^\d{1,7}$/.test(raw) ? Number(raw) : Number.NaN,
    });
  }
  // A box with two flavours has a pick-one for each, all named batchCode.
  // For a flavour whose mix boxes are filled in, the mix is what counts
  // (lib/backstage/stock/allocation.ts takes a flavour's mix over its pick).
  const codes = form
    .getAll("batchCode")
    .flatMap((value) =>
      typeof value === "string" && value.trim() !== "" ? [value.trim()] : [],
    );
  if (batches.length > 0) {
    return codes.length > 1 ? { batches, batchCodes: codes } : { batches };
  }
  if (codes.length > 1) return { batchCodes: codes };
  const [code] = codes;
  return code === undefined ? {} : { batchCode: code };
}
