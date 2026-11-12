/**
 * Reading "which batch is in the box" out of a submitted form.
 *
 * The form (app/backstage/(app)/stock/order-parts.tsx) has a pick-one named
 * `batchCode` for a box that came from one batch, and a number box for each
 * batch named `mix-<code>` for a box that mixes them. If any of the mix
 * boxes is filled in, the mix is what the person meant.
 */

const MIX = "mix-";

/** The name of the number box for one batch's share of a mixed box. */
export function mixFieldName(code: string): string {
  return `${MIX}${code}`;
}

/** What orders.markPacked and stock.recordOrderBatch take for the batch. */
export type PackedFromInput = {
  batchCode?: string;
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
  if (batches.length > 0) return { batches };

  const code = form.get("batchCode");
  return typeof code === "string" && code.trim() !== ""
    ? { batchCode: code.trim() }
    : {};
}
