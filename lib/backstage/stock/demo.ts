/**
 * Invented stock for a deployment with no database, so the Stock screens
 * have something to show: four batches at different points in their lives,
 * three suppliers whose names say they are made up, the materials bought
 * from them and three purchase orders (one in, one late, one still a draft).
 *
 * Everything goes in through the same operations a person would use, at
 * pretend times over the last two months, so each record's history reads
 * the way a real one would. None of the numbers or dates here says anything
 * about the real product: the best-before dates are only there to show what
 * the screens do with one.
 */

import type { Db } from "@/lib/db/types";
import { addDays, nzDateKey } from "@/lib/time";

import { systemCaller } from "../core/actor";
import { OpError } from "../core/errors";
import { execute } from "../core/op";
import { getOrder } from "../orders/ops";
import {
  closeBatch,
  createMaterial,
  createPurchaseOrder,
  createSupplier,
  listBatches,
  listOrdersWithoutBatch,
  listSuppliers,
  markPurchaseReceived,
  markPurchaseSent,
  planBatch,
  recordMade,
  recordOrderBatch,
  recordSample,
  recordWaste,
  releaseBatch,
} from "./ops";

const DAY = 24 * 60 * 60_000;

export async function seedStockDemo(db: Db, now: Date): Promise<void> {
  const demo = systemCaller("Demo data", "script");
  /** The clock, turned back. Never later than a minute ago. */
  const at = (daysAgo: number) => ({
    db,
    now: new Date(
      Math.min(now.getTime() - daysAgo * DAY, now.getTime() - 60_000),
    ),
  });
  const today = nzDateKey(now);

  // Only ever on a database with no stock in it yet.
  const [anyBatch] = await execute(listBatches, { limit: 1 }, demo, at(0));
  const [anySupplier] = await execute(
    listSuppliers,
    { show: "all", limit: 1 },
    demo,
    at(0),
  );
  if (anyBatch !== undefined || anySupplier !== undefined) return;

  /* ---- suppliers, materials and what has been ordered ------------------ */

  const bottles = await execute(
    createSupplier,
    {
      name: "Bottles & Co (invented)",
      supplies: "bottles and caps",
      contactName: "Rangi Parata",
      email: "sales@bottlesandco.example",
      website: "bottlesandco.example",
      leadTimeDays: 10,
      notes: "Made up for the demo. Sells by the carton of 500.",
    },
    demo,
    at(60),
  );
  const labels = await execute(
    createSupplier,
    {
      name: "Label Press (invented)",
      supplies: "wrap labels",
      contactName: "Mele Fonua",
      email: "hello@labelpress.example",
      leadTimeDays: 5,
      notes: "Made up for the demo. Needs the artwork as a PDF.",
    },
    demo,
    at(60),
  );
  const cartons = await execute(
    createSupplier,
    {
      name: "Carton Shed (invented)",
      supplies: "shipping cartons and tape",
      contactName: "Ana Kelly",
      email: "ana@cartonshed.example",
      leadTimeDays: 3,
      notes: "Made up for the demo.",
    },
    demo,
    at(58),
  );

  const bottle = await execute(
    createMaterial,
    {
      name: "100 ml bottle",
      supplierId: bottles.id,
      onHand: 180,
      reorderAt: 500,
      unitCostCents: 35,
    },
    demo,
    at(58),
  );
  const cap = await execute(
    createMaterial,
    {
      name: "White screw cap",
      supplierId: bottles.id,
      onHand: 240,
      reorderAt: 500,
      unitCostCents: 8,
    },
    demo,
    at(58),
  );
  const label = await execute(
    createMaterial,
    {
      name: "Wrap label",
      supplierId: labels.id,
      onHand: 150,
      reorderAt: 500,
      unitCostCents: 12,
    },
    demo,
    at(58),
  );
  const carton = await execute(
    createMaterial,
    {
      name: "Shipping carton, small",
      supplierId: cartons.id,
      onHand: 60,
      reorderAt: 40,
      unitCostCents: 95,
    },
    demo,
    at(58),
  );
  await execute(
    createMaterial,
    {
      name: "Packing tape",
      unit: "roll",
      supplierId: cartons.id,
      onHand: 6,
      reorderAt: 2,
      unitCostCents: 450,
    },
    demo,
    at(58),
  );

  // One order that came in, which lifts the bottles and caps off their
  // reorder levels.
  const arrived = await execute(
    createPurchaseOrder,
    {
      supplierId: bottles.id,
      notes: "Deliver to the back door, weekdays before three.",
      lines: [
        { materialId: bottle.id, qty: 2000 },
        { materialId: cap.id, qty: 2000 },
      ],
    },
    demo,
    at(32),
  );
  await execute(markPurchaseSent, { number: arrived.number }, demo, at(32));
  await execute(markPurchaseReceived, { number: arrived.number }, demo, at(19));

  // And one that should have arrived a week ago and has not, for labels
  // that are under their reorder level.
  const late = await execute(
    createPurchaseOrder,
    {
      supplierId: labels.id,
      notes: "Same artwork as the sample roll.",
      lines: [
        { materialId: label.id, qty: 3000 },
        {
          description: "Artwork set-up, one time",
          qty: 1,
          unitCostCents: 6000,
        },
      ],
    },
    demo,
    at(15),
  );
  await execute(markPurchaseSent, { number: late.number }, demo, at(15));

  // And one still being put together: a draft, which nobody has been sent.
  await execute(
    createPurchaseOrder,
    {
      supplierId: cartons.id,
      notes: "Ask whether they do a smaller carton for the six.",
      lines: [{ materialId: carton.id, qty: 100 }],
    },
    demo,
    at(1),
  );

  /* ---- batches --------------------------------------------------------- */

  // A small trial run: all of it given away or written off, then closed.
  await execute(
    planBatch,
    {
      code: "B001",
      name: "Trial run",
      plannedFor: addDays(today, -56),
      shotsPlanned: 60,
    },
    demo,
    at(62),
  );
  await execute(
    recordMade,
    {
      code: "B001",
      shots: 60,
      bestBefore: addDays(today, -5),
      record: {
        madeBy: "Ashleigh (demo)",
        madeAt: "The test kitchen (invented)",
        checks: "Demo entry. The real checks come from the food control plan.",
        lots: "Demo entry. Lot numbers go here, one to a line.",
      },
    },
    demo,
    at(56),
  );
  await execute(releaseBatch, { code: "B001" }, demo, at(55));
  await execute(
    recordSample,
    { code: "B001", shots: 36, note: "Tasting at the club rooms" },
    demo,
    at(50),
  );
  await execute(
    recordSample,
    { code: "B001", shots: 12, note: "A dozen to three shops to try" },
    demo,
    at(45),
  );
  await execute(
    recordWaste,
    { code: "B001", shots: 12, why: "damaged", note: "A carton was dropped" },
    demo,
    at(41),
  );
  await execute(closeBatch, { code: "B001" }, demo, at(40));

  // The run on the shelf now, getting near its date.
  await execute(
    planBatch,
    {
      code: "B002",
      name: "First run",
      plannedFor: addDays(today, -21),
      shotsPlanned: 240,
    },
    demo,
    at(27),
  );
  await execute(
    recordMade,
    {
      code: "B002",
      shots: 240,
      bestBefore: addDays(today, 21),
      costCents: 31200,
      record: {
        madeBy: "Ashleigh (demo)",
        madeAt: "The test kitchen (invented)",
        checks: "Demo entry. The real checks come from the food control plan.",
        lots: "Demo entry. Lot numbers go here, one to a line.",
      },
    },
    demo,
    at(21),
  );
  await execute(releaseBatch, { code: "B002" }, demo, at(20));
  await execute(
    recordSample,
    { code: "B002", shots: 24, note: "Saturday market stall" },
    demo,
    at(12),
  );
  await execute(
    recordWaste,
    { code: "B002", shots: 6, why: "damaged", note: "Caps not sealed" },
    demo,
    at(9),
  );

  // A bigger run, just released.
  await execute(
    planBatch,
    {
      code: "B003",
      name: "Second run",
      plannedFor: addDays(today, -6),
      shotsPlanned: 600,
    },
    demo,
    at(12),
  );
  await execute(
    recordMade,
    {
      code: "B003",
      shots: 600,
      bestBefore: addDays(today, 120),
      costCents: 66000,
      record: {
        madeBy: "Ashleigh (demo)",
        madeAt: "The test kitchen (invented)",
        checks: "Demo entry. The real checks come from the food control plan.",
        lots: "Demo entry. Lot numbers go here, one to a line.",
      },
    },
    demo,
    at(6),
  );
  await execute(releaseBatch, { code: "B003" }, demo, at(5));

  // And the next one, still only on the calendar.
  await execute(
    planBatch,
    {
      code: "B004",
      name: "Third run",
      plannedFor: addDays(today, 10),
      shotsPlanned: 600,
    },
    demo,
    at(2),
  );

  /* ---- the demo orders that are already packed or gone ----------------- */

  // The orders demo runs first, so its boxes were packed before any batch
  // existed. Give each one its batch, dated a minute after it was packed so
  // that its history reads in the order things happened. Two batches are on
  // sale, so the batch has to be named: the older run, which is the one a
  // packer would have been working through.
  const unrecorded = await execute(
    listOrdersWithoutBatch,
    { limit: 200 },
    demo,
    at(0),
  );
  for (const row of [...unrecorded].reverse()) {
    const order = await execute(getOrder, { number: row.number }, demo, at(0));
    const packedAt = order.packedAt ?? at(0).now;
    try {
      await execute(
        recordOrderBatch,
        { number: row.number, batchCode: "B002" },
        demo,
        {
          db,
          now: new Date(Math.min(packedAt.getTime() + 60_000, now.getTime())),
        },
      );
    } catch (error) {
      // An order the invented shelf cannot cover keeps "no batch recorded".
      // A demo that will not start is worse than a demo with a gap in it.
      if (!(error instanceof OpError)) throw error;
    }
  }
}
