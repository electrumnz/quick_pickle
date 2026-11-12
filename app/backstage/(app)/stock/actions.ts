"use server";

import {
  addPurchaseLine,
  adjustCount,
  adjustMaterial,
  cancelPurchaseOrder,
  closeBatch,
  createMaterial,
  createPurchaseOrder,
  createSupplier,
  markPurchaseReceived,
  markPurchaseSent,
  planBatch,
  recallBatch,
  recordMade,
  recordOrderBatch,
  recordSample,
  recordWaste,
  releaseBatch,
  removePurchaseLine,
  setSupplierActive,
  updateBatch,
  updateMaterial,
  updatePurchaseOrder,
  updateSupplier,
} from "@/lib/backstage/stock/ops";
import {
  RECORD_FIELDS,
  type RecordFieldKey,
} from "@/lib/backstage/stock/record";
import { packedFromForm } from "@/lib/backstage/stock/pack-form";
import { ACCEPTED_FIELD } from "@/lib/backstage/stock/purchasing";
import { formCents, formText, submit } from "@/lib/backstage/ui/submit";

/**
 * Every button in Stock. Each one runs a single operation and goes back to
 * the page it came from with a line saying what happened.
 *
 * A form sends words. These helpers turn them into what an operation takes,
 * and when a box holds something that is not a number they pass on
 * not-a-number, which the operation turns away with its own sentence.
 */

/** A whole number: "1,200" is 1200. */
function formCount(form: FormData, key: string): number {
  const raw = formText(form, key).replace(/[,\s]/g, "");
  return /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN;
}

/** Blank means "not given". */
function optionalCount(form: FormData, key: string): number | undefined {
  return formText(form, key) === "" ? undefined : formCount(form, key);
}

function optionalCents(form: FormData, key: string): number | undefined {
  return formText(form, key) === "" ? undefined : formCents(form, key);
}

function optionalText(form: FormData, key: string): string | undefined {
  const value = formText(form, key);
  return value === "" ? undefined : value;
}

/*
 * For a form that corrects a record: a box that is not on the form leaves
 * its value alone, a box left blank clears it, anything else replaces it.
 */
function changedText(form: FormData, key: string): string | null | undefined {
  if (!form.has(key)) return undefined;
  const value = formText(form, key);
  return value === "" ? null : value;
}

function changedCount(form: FormData, key: string): number | null | undefined {
  if (!form.has(key)) return undefined;
  return formText(form, key) === "" ? null : formCount(form, key);
}

function changedCents(form: FormData, key: string): number | null | undefined {
  if (!form.has(key)) return undefined;
  return formText(form, key) === "" ? null : formCents(form, key);
}

const STOCK = "/backstage/stock";
const batchPage = (code: string) =>
  `${STOCK}/batches/${encodeURIComponent(code.toUpperCase())}`;
const supplierPage = (id: string) =>
  `${STOCK}/suppliers/${encodeURIComponent(id)}`;
const materialPage = (id: string) =>
  `${STOCK}/materials/${encodeURIComponent(id)}`;
const purchasePage = (number: string) =>
  `${STOCK}/purchase-orders/${encodeURIComponent(number.toUpperCase())}`;

/** The same page again with what was typed, so a refusal loses nothing. */
function withValues(path: string, form: FormData, keys: readonly string[]) {
  const query = new URLSearchParams();
  for (const key of keys) {
    const value = formText(form, key);
    if (value !== "") query.set(key, value);
  }
  const text = query.toString();
  return text === "" ? path : `${path}?${text}`;
}

/** The production record's boxes, whichever of them the form has. */
function recordFrom(form: FormData): Partial<Record<RecordFieldKey, string>> {
  const record: Partial<Record<RecordFieldKey, string>> = {};
  for (const field of RECORD_FIELDS) {
    if (form.has(field.key)) record[field.key] = formText(form, field.key);
  }
  return record;
}

/* ---------------------------------------------------------------- batches */

export async function planBatchAction(form: FormData): Promise<void> {
  await submit(
    planBatch,
    {
      code: optionalText(form, "code"),
      name: optionalText(form, "name"),
      plannedFor: optionalText(form, "plannedFor"),
      shotsPlanned: optionalCount(form, "shotsPlanned"),
      notes: optionalText(form, "notes"),
    },
    {
      back: withValues(`${STOCK}/batches/new`, form, [
        "code",
        "name",
        "plannedFor",
        "shotsPlanned",
        "notes",
      ]),
      to: (batch) => batchPage(batch.code),
      done: (batch) => `${batch.code} is planned.`,
    },
  );
}

export async function updateBatchAction(form: FormData): Promise<void> {
  const code = formText(form, "code");
  await submit(
    updateBatch,
    {
      code,
      newCode: optionalText(form, "newCode"),
      name: form.has("name") ? formText(form, "name") : undefined,
      madeOn: changedText(form, "madeOn"),
      bestBefore: changedText(form, "bestBefore"),
      shotsPlanned: changedCount(form, "shotsPlanned"),
      costCents: changedCents(form, "cost"),
      notes: form.has("notes") ? formText(form, "notes") : undefined,
    },
    {
      back: batchPage(code),
      to: (batch) => batchPage(batch.code),
      done: "Saved.",
    },
  );
}

export async function updateRecordAction(form: FormData): Promise<void> {
  const code = formText(form, "code");
  await submit(
    updateBatch,
    { code, record: recordFrom(form) },
    { back: `${batchPage(code)}#record`, done: "Record saved." },
  );
}

export async function recordMadeAction(form: FormData): Promise<void> {
  const code = formText(form, "code");
  await submit(
    recordMade,
    {
      code,
      shots: formCount(form, "shots"),
      madeOn: optionalText(form, "madeOn"),
      bestBefore: optionalText(form, "bestBefore"),
      costCents: optionalCents(form, "cost"),
      record: recordFrom(form),
    },
    {
      back: batchPage(code),
      done: (batch) =>
        `Recorded. ${batch.onHand.toLocaleString("en-NZ")} shots are in stock, not yet for sale.`,
    },
  );
}

export async function releaseBatchAction(form: FormData): Promise<void> {
  const code = formText(form, "code");
  await submit(
    releaseBatch,
    { code },
    {
      back: batchPage(code),
      done: "Released. Orders are now filled from it.",
    },
  );
}

export async function closeBatchAction(form: FormData): Promise<void> {
  const code = formText(form, "code");
  await submit(
    closeBatch,
    { code, writeOff: formText(form, "writeOff") === "true" },
    {
      back: batchPage(code),
      done: (batch) =>
        batch.writtenOff > 0
          ? `Closed, and ${batch.writtenOff.toLocaleString("en-NZ")} written off.`
          : "Closed.",
    },
  );
}

export async function recallBatchAction(form: FormData): Promise<void> {
  const code = formText(form, "code");
  await submit(
    recallBatch,
    { code, reason: formText(form, "reason") },
    {
      back: batchPage(code),
      // Straight to the list of who has it: that is the next thing to do.
      to: `${batchPage(code)}/recall-list`,
      done: "Recalled. Nothing more will be sold from it.",
    },
  );
}

export async function sampleAction(form: FormData): Promise<void> {
  const code = formText(form, "code");
  await submit(
    recordSample,
    {
      code,
      shots: formCount(form, "shots"),
      note: optionalText(form, "note"),
    },
    {
      back: `${batchPage(code)}#movements`,
      done: (batch) =>
        `Recorded. ${batch.onHand.toLocaleString("en-NZ")} left on hand.`,
    },
  );
}

export async function wasteAction(form: FormData): Promise<void> {
  const code = formText(form, "code");
  const why = formText(form, "why");
  await submit(
    recordWaste,
    {
      code,
      shots: formCount(form, "shots"),
      // Anything unexpected falls to the schema, which names the choices.
      why: why as "damaged" | "expired" | "other",
      note: optionalText(form, "note"),
    },
    {
      back: `${batchPage(code)}#movements`,
      done: (batch) =>
        `Written off. ${batch.onHand.toLocaleString("en-NZ")} left on hand.`,
    },
  );
}

export async function countAction(form: FormData): Promise<void> {
  const code = formText(form, "code");
  await submit(
    adjustCount,
    {
      code,
      counted: formCount(form, "counted"),
      // What the screen showed when the count was made, so only the
      // difference is applied.
      expected: optionalCount(form, "expected"),
      reason: formText(form, "reason"),
    },
    {
      back: `${batchPage(code)}#movements`,
      done: (batch) =>
        batch.change === 0
          ? "The count was already right. Nothing changed."
          : `Corrected to ${batch.onHand.toLocaleString("en-NZ")} on hand.`,
    },
  );
}

/** From an order's own page: write down the batch it was filled from. */
export async function recordOrderBatchAction(form: FormData): Promise<void> {
  const number = formText(form, "number");
  await submit(
    recordOrderBatch,
    // The batch (or mix of batches) the person says was in the box.
    { number, ...packedFromForm(form) },
    {
      back: `/backstage/orders/${encodeURIComponent(number)}`,
      done: (order) =>
        order.filled.length === 0
          ? "Its batch was already recorded."
          : "Batch recorded.",
    },
  );
}

/* -------------------------------------------------------------- suppliers */

export async function createSupplierAction(form: FormData): Promise<void> {
  await submit(
    createSupplier,
    {
      name: formText(form, "name"),
      supplies: optionalText(form, "supplies"),
      contactName: optionalText(form, "contactName"),
      email: optionalText(form, "email"),
      phone: optionalText(form, "phone"),
      website: optionalText(form, "website"),
      leadTimeDays: optionalCount(form, "leadTimeDays"),
      notes: optionalText(form, "notes"),
    },
    {
      back: `${withValues(`${STOCK}/suppliers`, form, [
        "name",
        "supplies",
        "contactName",
        "email",
        "phone",
        "website",
        "leadTimeDays",
        "notes",
      ])}#new`,
      to: (supplier) => supplierPage(supplier.id),
      done: "Supplier added.",
    },
  );
}

export async function updateSupplierAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  await submit(
    updateSupplier,
    {
      id,
      name: formText(form, "name"),
      supplies: formText(form, "supplies"),
      contactName: formText(form, "contactName"),
      email: changedText(form, "email"),
      phone: changedText(form, "phone"),
      website: changedText(form, "website"),
      leadTimeDays: changedCount(form, "leadTimeDays"),
      notes: formText(form, "notes"),
    },
    { back: supplierPage(id), done: "Saved." },
  );
}

export async function supplierActiveAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  const active = formText(form, "active") === "true";
  await submit(
    setSupplierActive,
    { id, active },
    {
      back: supplierPage(id),
      done: active ? "Back in use." : "No longer in use.",
    },
  );
}

/* -------------------------------------------------------------- materials */

export async function createMaterialAction(form: FormData): Promise<void> {
  await submit(
    createMaterial,
    {
      name: formText(form, "name"),
      unit: optionalText(form, "unit"),
      supplierId: optionalText(form, "supplierId"),
      onHand: optionalCount(form, "onHand"),
      reorderAt: optionalCount(form, "reorderAt"),
      unitCostCents: optionalCents(form, "unitCost"),
      notes: optionalText(form, "notes"),
    },
    {
      back: `${withValues(`${STOCK}/materials`, form, [
        "name",
        "unit",
        "supplierId",
        "onHand",
        "reorderAt",
        "unitCost",
        "notes",
      ])}#new`,
      to: (material) => materialPage(material.id),
      done: "Material added.",
    },
  );
}

export async function updateMaterialAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  await submit(
    updateMaterial,
    {
      id,
      name: formText(form, "name"),
      unit: formText(form, "unit"),
      supplierId: changedText(form, "supplierId"),
      reorderAt: changedCount(form, "reorderAt"),
      unitCostCents: changedCents(form, "unitCost"),
      notes: formText(form, "notes"),
    },
    { back: materialPage(id), done: "Saved." },
  );
}

export async function countMaterialAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  await submit(
    adjustMaterial,
    {
      id,
      counted: formCount(form, "counted"),
      expected: optionalCount(form, "expected"),
      reason: formText(form, "reason"),
    },
    {
      back: materialPage(id),
      done: (material) =>
        material.change === 0
          ? "The count was already right. Nothing changed."
          : `Now ${material.onHand.toLocaleString("en-NZ")} on hand.`,
    },
  );
}

/* -------------------------------------------------------- purchase orders */

export async function createPurchaseAction(form: FormData): Promise<void> {
  await submit(
    createPurchaseOrder,
    {
      supplierId: formText(form, "supplierId"),
      expectedOn: optionalText(form, "expectedOn"),
      notes: optionalText(form, "notes"),
    },
    {
      back: withValues(`${STOCK}/purchase-orders/new`, form, [
        "supplierId",
        "expectedOn",
        "notes",
      ]),
      to: (order) => purchasePage(order.number),
      done: (order) => `${order.number} started. Add what you are ordering.`,
    },
  );
}

export async function addLineAction(form: FormData): Promise<void> {
  const number = formText(form, "number");
  await submit(
    addPurchaseLine,
    {
      number,
      line: {
        materialId: optionalText(form, "materialId"),
        description: optionalText(form, "description"),
        qty: formCount(form, "qty"),
        unitCostCents: optionalCents(form, "unitCost"),
      },
    },
    { back: `${purchasePage(number)}#lines`, done: "Added." },
  );
}

export async function removeLineAction(form: FormData): Promise<void> {
  const number = formText(form, "number");
  await submit(
    removePurchaseLine,
    { number, lineId: formText(form, "lineId") },
    { back: `${purchasePage(number)}#lines`, done: "Taken off." },
  );
}

export async function updatePurchaseAction(form: FormData): Promise<void> {
  const number = formText(form, "number");
  await submit(
    updatePurchaseOrder,
    {
      number,
      expectedOn: changedText(form, "expectedOn"),
      notes: form.has("notes") ? formText(form, "notes") : undefined,
    },
    { back: purchasePage(number), done: "Saved." },
  );
}

export async function purchaseSentAction(form: FormData): Promise<void> {
  const number = formText(form, "number");
  await submit(
    markPurchaseSent,
    {
      number,
      orderedOn: optionalText(form, "orderedOn"),
      expectedOn: optionalText(form, "expectedOn"),
    },
    {
      back: purchasePage(number),
      done: "Marked as sent. Nothing was emailed: send it to them yourself.",
    },
  );
}

export async function purchaseReceivedAction(form: FormData): Promise<void> {
  const number = formText(form, "number");
  // One box for each line, named for the line: how many arrived in good
  // order. A box left blank means the line arrived as ordered.
  const accepted: { lineId: string; qty: number }[] = [];
  for (const key of form.keys()) {
    if (!key.startsWith(ACCEPTED_FIELD) || formText(form, key) === "") continue;
    accepted.push({
      lineId: key.slice(ACCEPTED_FIELD.length),
      qty: formCount(form, key),
    });
  }
  await submit(
    markPurchaseReceived,
    {
      number,
      receivedOn: optionalText(form, "receivedOn"),
      accepted: accepted.length === 0 ? undefined : accepted,
    },
    {
      back: purchasePage(number),
      done: (order) => {
        const added = order.received.filter((material) => material.qty > 0);
        return added.length === 0
          ? "Marked as received."
          : `Received. Added ${added.map((material) => `${material.qty.toLocaleString("en-NZ")} to ${material.name}`).join(", ")}.`;
      },
    },
  );
}

export async function cancelPurchaseAction(form: FormData): Promise<void> {
  const number = formText(form, "number");
  await submit(
    cancelPurchaseOrder,
    { number, reason: optionalText(form, "reason") },
    { back: purchasePage(number), done: "Cancelled." },
  );
}
