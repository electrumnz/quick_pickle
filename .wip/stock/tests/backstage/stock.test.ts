import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditLog,
  events,
  materials,
  orders,
  purchaseOrders,
  stockMovements,
  users,
} from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { describeOp, execute } from "@/lib/backstage/core/op";
import { seedDemoOrders } from "@/lib/backstage/orders/demo";
import {
  cancelOrder,
  getOrder,
  listOrders,
  markPacked,
  markShipped,
  recordOrder,
} from "@/lib/backstage/orders/ops";
import {
  addWorkingDays,
  daysBetween,
  isDateKey,
  isGoodOn,
  todayKey,
} from "@/lib/backstage/stock/dates";
import { seedStockDemo } from "@/lib/backstage/stock/demo";
import { planTakes, type ShelfBatch } from "@/lib/backstage/stock/allocation";
import {
  addPurchaseLine,
  adjustCount,
  adjustMaterial,
  cancelPurchaseOrder,
  closeBatch,
  createMaterial,
  createPurchaseOrder,
  createSupplier,
  getBatch,
  getMaterial,
  getPurchaseOrder,
  getSupplier,
  listBatches,
  listMaterials,
  listOrdersWithoutBatch,
  listPurchaseOrders,
  listSuppliers,
  markPurchaseReceived,
  markPurchaseSent,
  orderStock,
  planBatch,
  recallBatch,
  recallList,
  recordMade,
  recordOrderBatch,
  recordSample,
  recordWaste,
  releaseBatch,
  removePurchaseLine,
  setSupplierActive,
  STOCK_OPS,
  stockAvailable,
  stockPicture,
  suggestBatchCode,
  updateBatch,
  updateMaterial,
  updatePurchaseOrder,
  updateSupplier,
} from "@/lib/backstage/stock/ops";
import {
  NEXT_BATCH_STATUS,
  NEXT_PURCHASE_STATUS,
} from "@/lib/backstage/stock/status";
import { openEmbedded, type DbHandle } from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { addDays } from "@/lib/time";

/** Two in the afternoon on 12 November 2026, in New Zealand. */
const START = Date.parse("2026-11-12T01:00:00Z");
const TODAY = "2026-11-12";
const DAY = 24 * 60 * 60_000;

const shop = systemCaller("The shop", "storefront");

/**
 * A fresh database with three members of staff and a clock that moves on a
 * minute with every operation, so the order things happened in is never in
 * doubt. Every call names its database, so nothing here leans on the
 * process's own.
 */
type World = {
  readonly handle: DbHandle;
  readonly owner: Caller;
  readonly staff: Caller;
  readonly viewer: Caller;
  /** Options for `execute`: this database, a minute later than last time. */
  readonly run: () => { db: DbHandle["db"]; now: Date };
};

async function openWorld(): Promise<World> {
  const handle = await openEmbedded();
  const make = async (role: "owner" | "staff" | "viewer"): Promise<Caller> => {
    const id = newId("usr");
    await handle.db
      .insert(users)
      .values({ id, email: `${role}@example.co.nz`, name: role, role });
    return {
      actor: { type: "human", userId: id, name: role, role },
      via: "ui",
      confirmed: true,
    };
  };
  let clock = START;
  return {
    handle,
    owner: await make("owner"),
    staff: await make("staff"),
    viewer: await make("viewer"),
    run: () => {
      clock += 60_000;
      return { db: handle.db, now: new Date(clock) };
    },
  };
}

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
let orderCount = 0;

/** An order number nobody has used yet, in the shape the shop makes them. */
function nextOrderNumber(): string {
  orderCount += 1;
  let value = orderCount;
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out = (ALPHABET[value % ALPHABET.length] ?? "2") + out;
    value = Math.floor(value / ALPHABET.length);
  }
  return `QP-${out}`;
}

/** Put a paid order straight into the back end, holding this many shots. */
async function buy(
  world: World,
  shots: number,
  over: { test?: boolean; first?: string; pending?: boolean } = {},
): Promise<string> {
  const number = nextOrderNumber();
  const first = over.first ?? "Sam";
  const options = world.run();
  await execute(
    recordOrder,
    {
      number,
      placedAt: options.now,
      mode: "live",
      customer: {
        email: `${first.toLowerCase()}@example.co.nz`,
        phone: "021 555 010",
        firstName: first,
        lastName: "Tester",
      },
      delivery: {
        line1: "12 Sideline Road",
        line2: "Flat 2",
        suburb: null,
        city: "Levin",
        region: "Manawatū-Whanganui",
        postcode: "5510",
        rural: false,
        notes: null,
      },
      // One made-up pack of the size the test wants, so nothing here leans
      // on what the catalogue happens to sell today.
      lines: [
        {
          sku: `TEST-${String(shots)}`,
          name: "Test pack",
          shots,
          qty: 1,
          unitCents: 1000,
          lineCents: 1000,
        },
      ],
      subtotalCents: 1000,
      shippingCents: 0,
      totalCents: 1000,
      currency: "NZD",
      payment: {
        provider: over.test ? "test" : "fake",
        status: over.test ? "test" : over.pending ? "pending" : "paid",
        reference: `REF-${number}`,
      },
      joinCrew: false,
    },
    shop,
    options,
  );
  return number;
}

/** A best-before date comfortably ahead, for a batch whose date is not the point. */
const GOOD_UNTIL = "2027-06-30";

/**
 * Plan a batch and take it as far as asked. It gets a best-before date well
 * ahead unless the test gives its own, since a batch cannot be released
 * without one. `bestBefore: null` leaves it with none. With `at`, all of it
 * happens at that moment instead of on the test's clock: the way to have a
 * batch that was released while good and has gone past its date since.
 */
async function makeBatch(
  world: World,
  code: string,
  shots: number,
  options: {
    madeOn?: string;
    bestBefore?: string | null;
    upTo?: "planned" | "made" | "released";
    at?: Date;
  } = {},
): Promise<void> {
  const when = () =>
    options.at === undefined
      ? world.run()
      : { db: world.handle.db, now: options.at };
  await execute(planBatch, { code }, world.staff, when());
  if (options.upTo === "planned") return;
  await execute(
    recordMade,
    {
      code,
      shots,
      madeOn: options.madeOn,
      bestBefore:
        options.bestBefore === null
          ? undefined
          : (options.bestBefore ?? GOOD_UNTIL),
    },
    world.staff,
    when(),
  );
  if (options.upTo === "made") return;
  await execute(releaseBatch, { code }, world.staff, when());
}

async function onHand(world: World, code: string): Promise<number> {
  return (await execute(getBatch, { code }, world.viewer, world.run())).onHand;
}

async function eventsOf(world: World, type: string) {
  return world.handle.db
    .select()
    .from(events)
    .where(eq(events.type, type))
    .orderBy(asc(events.at));
}

async function movementsFor(world: World, number: string) {
  const [order] = await world.handle.db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.number, number));
  if (order === undefined) throw new Error(`no order ${number}`);
  return world.handle.db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.orderId, order.id))
    .orderBy(asc(stockMovements.at));
}

async function historyOf(world: World, entityType: string, id: string) {
  const rows = await world.handle.db
    .select({ summary: auditLog.summary })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.at));
  return rows.map((row) => row.summary);
}

describe("calendar dates", () => {
  it("knows a real date from a made-up one", () => {
    expect(isDateKey("2026-11-12")).toBe(true);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("12/11/2026")).toBe(false);
    expect(isDateKey("2026-11-12T09:00")).toBe(false);
  });

  it("counts days, and working days around a weekend", () => {
    expect(daysBetween("2026-11-12", "2026-11-12")).toBe(0);
    expect(daysBetween("2026-11-12", "2026-12-12")).toBe(30);
    expect(daysBetween("2026-11-12", "2026-11-02")).toBe(-10);
    // Over the end of daylight saving, a day is still a day.
    expect(daysBetween("2027-04-01", "2027-04-08")).toBe(7);
    // 12 November 2026 is a Thursday.
    expect(addWorkingDays("2026-11-12", 1)).toBe("2026-11-13");
    expect(addWorkingDays("2026-11-12", 2)).toBe("2026-11-16");
    expect(addWorkingDays("2026-11-12", 5)).toBe("2026-11-19");
    expect(addWorkingDays("2026-11-12", 0)).toBe("2026-11-12");
  });
});

describe("batches, from a plan to the last bottle", () => {
  let world: World;
  beforeAll(async () => {
    world = await openWorld();
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("is the state machine that was asked for", () => {
    expect(NEXT_BATCH_STATUS).toEqual({
      planned: ["made"],
      made: ["released", "recalled"],
      released: ["closed", "recalled"],
      closed: ["recalled"],
      recalled: [],
    });
  });

  it("suggests the next code, takes another, and keeps them unique", async () => {
    const { staff, viewer, run } = world;
    expect(await execute(suggestBatchCode, {}, viewer, run())).toEqual({
      code: "B001",
    });
    const first = await execute(planBatch, {}, staff, run());
    expect(first.code).toBe("B001");
    expect(
      await execute(getBatch, { code: "b001" }, viewer, run()),
    ).toMatchObject({
      code: "B001",
      name: "Batch B001",
      status: "planned",
      onHand: 0,
    });

    // Her own code, typed in lower case, and the run carries on from it.
    await execute(
      planBatch,
      {
        code: "b007",
        name: "Summer run",
        plannedFor: "2026-12-01",
        shotsPlanned: 600,
      },
      staff,
      run(),
    );
    expect(await execute(suggestBatchCode, {}, viewer, run())).toEqual({
      code: "B008",
    });
    expect(
      await execute(getBatch, { code: "B007" }, viewer, run()),
    ).toMatchObject({
      name: "Summer run",
      madeOn: "2026-12-01",
      shotsPlanned: 600,
    });

    await expect(
      execute(planBatch, { code: "B007" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "There is already a batch B007. Every batch needs its own code.",
      fields: { code: "B007 is already used" },
    });
    await expect(
      execute(planBatch, { code: "not a code!" }, staff, run()),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      execute(getBatch, { code: "B999" }, viewer, run()),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("moves planned, made, released, closed and refuses to skip", async () => {
    const { staff, viewer, run } = world;
    const code = "B001";

    // A planned batch is only a line on the calendar.
    await expect(
      execute(releaseBatch, { code }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "B001 is only planned, so it cannot be released.",
    });
    await expect(
      execute(closeBatch, { code }, staff, run()),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      execute(recallBatch, { code, reason: "no reason at all" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "B001 is only planned, so it cannot be recalled.",
    });
    await expect(
      execute(recordSample, { code, shots: 1 }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message:
        "B001 has not been made yet, so there is nothing to record against it.",
    });

    // Made: the shots counted go into stock, once.
    expect(
      await execute(
        recordMade,
        {
          code,
          shots: 100,
          bestBefore: "2027-03-01",
          costCents: 12000,
          record: {
            madeBy: "Ashleigh",
            lots: "Bottles lot 14",
            more: { "Label roll": "R-22" },
          },
        },
        staff,
        run(),
      ),
    ).toEqual({ code, status: "made", onHand: 100 });
    const made = await execute(getBatch, { code }, viewer, run());
    expect(made).toMatchObject({
      status: "made",
      madeOn: TODAY,
      bestBefore: "2027-03-01",
      daysToBestBefore: daysBetween(TODAY, "2027-03-01"),
      shotsPlanned: 100,
      costCents: 12000,
      onHand: 100,
      next: ["released", "recalled"],
    });
    expect(made.record).toMatchObject({
      madeBy: "Ashleigh",
      madeAt: "",
      lots: "Bottles lot 14",
      more: { "Label roll": "R-22" },
    });
    expect(made.movements).toHaveLength(1);
    expect(made.movements[0]).toMatchObject({
      kind: "made",
      shots: 100,
      by: "staff",
    });
    // Nothing sold is nought, not the minus nought that prints as "-0".
    expect(made.sold).toBe(0);
    expect((await eventsOf(world, "batch.made")).at(-1)?.payload).toEqual({
      code,
      shots: 100,
      madeOn: TODAY,
      bestBefore: "2027-03-01",
    });

    // Recording it again, with a different number, changes nothing.
    expect(
      await execute(recordMade, { code, shots: 500 }, staff, run()),
    ).toEqual({ code, status: "made", onHand: 100 });
    expect(
      (await execute(getBatch, { code }, viewer, run())).movements,
    ).toHaveLength(1);

    // Made is not yet for sale, and cannot be closed from here.
    await expect(
      execute(closeBatch, { code }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "B001 is made but not released, so it cannot be closed.",
    });

    // Released: no movement, just cleared.
    expect(await execute(releaseBatch, { code }, staff, run())).toEqual({
      code,
      status: "released",
      onHand: 100,
    });
    await execute(releaseBatch, { code }, staff, run());
    expect(await eventsOf(world, "batch.released")).toHaveLength(1);
    expect(
      (await execute(getBatch, { code }, viewer, run())).movements,
    ).toHaveLength(1);
    await expect(
      execute(recordMade, { code, shots: 10 }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "B001 is released, so it cannot be recorded as made.",
    });

    // Closing with shots still on the shelf has to be meant.
    await expect(
      execute(closeBatch, { code }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("B001 still has 100 shots on hand"),
    });
    expect(
      await execute(closeBatch, { code, writeOff: true }, staff, run()),
    ).toEqual({ code, status: "closed", writtenOff: 100 });
    const closed = await execute(getBatch, { code }, viewer, run());
    expect(closed).toMatchObject({
      status: "closed",
      onHand: 0,
      next: ["recalled"],
    });
    expect(closed.movements[0]).toMatchObject({ kind: "waste", shots: -100 });
    expect(closed.totals).toMatchObject({ made: 100, waste: -100 });

    // Closed is closed.
    expect(await execute(closeBatch, { code }, staff, run())).toEqual({
      code,
      status: "closed",
      writtenOff: 0,
    });
    await expect(
      execute(releaseBatch, { code }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "B001 is closed, so it cannot be released.",
    });

    expect(await historyOf(world, "batch", closed.id)).toEqual([
      "Planned batch B001",
      "Made B001: 100 shots, best before 1 Mar 2027",
      "Released B001 for sale with 100 shots on hand",
      "Closed B001 and wrote off the last 100 shots",
    ]);
  });

  it("will not take dates that cannot be right", async () => {
    const { staff, run } = world;
    await execute(planBatch, { code: "B020" }, staff, run());
    await expect(
      execute(
        recordMade,
        { code: "B020", shots: 10, madeOn: addDays(TODAY, 1) },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { madeOn: "That day has not happened yet" },
    });
    await expect(
      execute(
        recordMade,
        {
          code: "B020",
          shots: 10,
          madeOn: addDays(TODAY, -3),
          bestBefore: addDays(TODAY, -4),
        },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { bestBefore: "Earlier than the day it was made" },
    });
    await expect(
      execute(recordMade, { code: "B020", shots: 0 }, staff, run()),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { shots: "At least one shot" },
    });
    await expect(
      execute(
        recordMade,
        { code: "B020", shots: 10, bestBefore: "2026-02-30" },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("corrects the details that can still be corrected", async () => {
    const { staff, viewer, run } = world;
    // B020 is still planned: everything about it can change, even its code.
    expect(
      await execute(
        updateBatch,
        {
          code: "B020",
          newCode: "b021",
          name: "Autumn run",
          madeOn: "2026-12-10",
          shotsPlanned: 300,
        },
        staff,
        run(),
      ),
    ).toMatchObject({ code: "B021" });
    expect(
      await execute(getBatch, { code: "B021" }, viewer, run()),
    ).toMatchObject({
      name: "Autumn run",
      madeOn: "2026-12-10",
      shotsPlanned: 300,
    });
    await expect(
      execute(updateBatch, { code: "B021", newCode: "B007" }, staff, run()),
    ).rejects.toMatchObject({ code: "conflict" });

    // Once it is made the count is no longer a plan to be edited.
    await execute(recordMade, { code: "B021", shots: 280 }, staff, run());
    await expect(
      execute(updateBatch, { code: "B021", shotsPlanned: 300 }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("correction after a count"),
    });
    await expect(
      execute(updateBatch, { code: "B021", madeOn: null }, staff, run()),
    ).rejects.toMatchObject({ code: "invalid_input" });

    // The record is laid over what was there, part by part.
    await execute(
      updateBatch,
      {
        code: "B021",
        bestBefore: "2027-05-01",
        costCents: 30000,
        record: { madeBy: "Sam", checks: "Seals checked on every tenth" },
      },
      staff,
      run(),
    );
    await execute(
      updateBatch,
      { code: "B021", record: { madeAt: "The kitchen" } },
      staff,
      run(),
    );
    const batch = await execute(getBatch, { code: "B021" }, viewer, run());
    expect(batch).toMatchObject({ bestBefore: "2027-05-01", costCents: 30000 });
    expect(batch.record).toMatchObject({
      madeBy: "Sam",
      madeAt: "The kitchen",
      checks: "Seals checked on every tenth",
    });
    const history = await historyOf(world, "batch", batch.id);
    expect(history.at(-2)).toBe(
      "Changed B021: best before no date to 1 May 2027, cost not known to $300, the record (made by, checks taken)",
    );

    // Saying the same thing again is not a change.
    await execute(
      updateBatch,
      { code: "B021", bestBefore: "2027-05-01" },
      staff,
      run(),
    );
    expect(await historyOf(world, "batch", batch.id)).toEqual(history);

    // Released: the code is on orders by now.
    await execute(releaseBatch, { code: "B021" }, staff, run());
    await expect(
      execute(updateBatch, { code: "B021", newCode: "B030" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("the code cannot be changed"),
    });
  });

  it("recalls from made, released and closed, and nothing leaves recalled", async () => {
    const { staff, viewer, run } = world;
    await makeBatch(world, "R-MADE", 40, { upTo: "made" });
    await makeBatch(world, "R-OUT", 40);
    await makeBatch(world, "R-SHUT", 40);
    await execute(closeBatch, { code: "R-SHUT", writeOff: true }, staff, run());

    // It cannot be undone, so it wants a yes, and says what it will do.
    await expect(
      execute(
        recallBatch,
        { code: "R-OUT", reason: "A cap seal failed" },
        { ...staff, confirmed: false },
        run(),
      ),
    ).rejects.toMatchObject({
      code: "needs_confirmation",
      message:
        "This recalls batch R-OUT. No more orders will be filled from it and it can never be released again. It does not contact customers or anyone else: the recall list says who has shots from it.",
    });
    expect(
      (await execute(getBatch, { code: "R-OUT" }, viewer, run())).status,
    ).toBe("released");
    await expect(
      execute(recallBatch, { code: "R-OUT", reason: "x" }, staff, run()),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { reason: "Say why it is being recalled" },
    });

    for (const code of ["R-MADE", "R-OUT", "R-SHUT"]) {
      expect(
        await execute(
          recallBatch,
          { code, reason: "A cap seal failed" },
          staff,
          run(),
        ),
      ).toMatchObject({ code, status: "recalled", orders: 0, shots: 0 });
      const batch = await execute(getBatch, { code }, viewer, run());
      expect(batch).toMatchObject({
        status: "recalled",
        next: [],
        recall: { reason: "A cap seal failed", on: TODAY },
      });

      // Nothing leaves recalled.
      for (const attempt of [
        () => execute(releaseBatch, { code }, staff, run()),
        () => execute(closeBatch, { code, writeOff: true }, staff, run()),
        () => execute(recordMade, { code, shots: 5 }, staff, run()),
      ]) {
        await expect(attempt()).rejects.toMatchObject({
          code: "conflict",
          message: expect.stringContaining(`${code} is recalled`),
        });
      }
      // Recalling it again is not an error and not a second recall.
      await execute(
        recallBatch,
        { code, reason: "Said twice by mistake" },
        staff,
        run(),
      );
      expect(
        (await execute(getBatch, { code }, viewer, run())).recall?.reason,
      ).toBe("A cap seal failed");
      expect(
        (await historyOf(world, "batch", batch.id)).filter((line) =>
          line.startsWith("Recalled"),
        ),
      ).toEqual([`Recalled ${code}: A cap seal failed`]);
    }
    const recalled = await eventsOf(world, "batch.recalled");
    expect(recalled).toHaveLength(3);
    expect(recalled.at(1)?.payload).toEqual({
      code: "R-OUT",
      reason: "A cap seal failed",
      orders: 0,
      shots: 0,
      onHand: 40,
    });

    // What is left of a recalled batch can be destroyed, not given away.
    await expect(
      execute(recordSample, { code: "R-OUT", shots: 1 }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message:
        "R-OUT has been recalled, so nothing more can be given away from it.",
    });
    expect(
      await execute(
        recordWaste,
        { code: "R-OUT", shots: 40, why: "other", note: "Destroyed" },
        staff,
        run(),
      ),
    ).toEqual({ code: "R-OUT", onHand: 0 });

    // And only its notes can still be written on.
    await execute(
      updateBatch,
      { code: "R-OUT", notes: "Everyone has been rung." },
      staff,
      run(),
    );
    await expect(
      execute(updateBatch, { code: "R-OUT", name: "Renamed" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "R-OUT has been recalled, so only its notes can be changed.",
    });
    expect(
      await execute(getBatch, { code: "R-OUT" }, viewer, run()),
    ).toMatchObject({
      notes: "Everyone has been rung.",
      recall: { reason: "A cap seal failed" },
    });
  });

  it("lists batches newest first, by state", async () => {
    const { viewer, run } = world;
    const all = await execute(listBatches, {}, viewer, run());
    expect(all.map((batch) => batch.code).slice(0, 3)).toEqual([
      "R-SHUT",
      "R-OUT",
      "R-MADE",
    ]);
    const planned = await execute(
      listBatches,
      { status: "planned" },
      viewer,
      run(),
    );
    expect(planned.map((batch) => batch.code)).toEqual(["B007"]);
    expect(
      (await execute(listBatches, { status: "recalled" }, viewer, run()))
        .length,
    ).toBe(3);
  });
});

describe("best-before dates", () => {
  let world: World;
  /** Half past eleven at night on the 12th, in New Zealand. */
  const lateTonight = () => ({
    db: world.handle.db,
    now: new Date("2026-11-12T10:30:00Z"),
  });
  /** An hour on: half past midnight on the 13th. */
  const afterMidnight = () => ({
    db: world.handle.db,
    now: new Date("2026-11-12T11:30:00Z"),
  });
  beforeAll(async () => {
    world = await openWorld();
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("has one rule for whether a batch is still good", () => {
    expect(isGoodOn("2026-11-12", "2026-11-11")).toBe(true);
    // Good through the end of the day itself.
    expect(isGoodOn("2026-11-12", "2026-11-12")).toBe(true);
    expect(isGoodOn("2026-11-12", "2026-11-13")).toBe(false);
    // With no date there is nothing to show that it is good.
    expect(isGoodOn(null, "2026-11-12")).toBe(false);
    // "Today" is the New Zealand day, worked out from the moment in hand: an
    // hour either side of midnight here is the same day on a server in UTC.
    expect(todayKey(lateTonight().now)).toBe("2026-11-12");
    expect(todayKey(afterMidnight().now)).toBe("2026-11-13");
  });

  it("will not release a batch with no best-before date, or one that has passed", async () => {
    const { staff, viewer, run } = world;
    await makeBatch(world, "ND", 40, {
      madeOn: addDays(TODAY, -30),
      bestBefore: null,
      upTo: "made",
    });
    await expect(
      execute(releaseBatch, { code: "ND" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "ND has no best-before date. Add one, then release it.",
      fields: { bestBefore: "Needed before the batch can be released" },
    });

    await execute(
      updateBatch,
      { code: "ND", bestBefore: addDays(TODAY, -1) },
      staff,
      run(),
    );
    await expect(
      execute(releaseBatch, { code: "ND" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message:
        "ND passed its best-before date on 11 Nov 2026, so it cannot be released for sale.",
    });
    expect(await execute(getBatch, { code: "ND" }, viewer, run())).toMatchObject(
      { status: "made", good: false, daysToBestBefore: -1 },
    );
    expect(await eventsOf(world, "batch.released")).toHaveLength(0);

    // Dated today, it is still good today.
    await execute(updateBatch, { code: "ND", bestBefore: TODAY }, staff, run());
    expect(
      await execute(releaseBatch, { code: "ND" }, staff, run()),
    ).toMatchObject({ status: "released", onHand: 40 });
    expect(await execute(getBatch, { code: "ND" }, viewer, run())).toMatchObject(
      { status: "released", good: true, daysToBestBefore: 0 },
    );
    expect((await eventsOf(world, "batch.released")).at(-1)?.payload).toEqual({
      code: "ND",
      onHand: 40,
      bestBefore: TODAY,
    });

    // Once it is on sale the date can be corrected, never taken away.
    await expect(
      execute(updateBatch, { code: "ND", bestBefore: null }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "ND is released, so it has to keep a best-before date.",
      fields: { bestBefore: "A released batch needs one" },
    });
  });

  it("sells a batch through the end of its best-before day and not a shot after", async () => {
    const { staff, viewer } = world;
    // ND, best before today, is the only batch on sale. Late tonight it
    // still goes out.
    const tonight = await buy(world, 6);
    expect(
      await execute(stockAvailable, {}, viewer, lateTonight()),
    ).toMatchObject({ ready: 40 });
    await execute(markPacked, { number: tonight }, staff, lateTonight());
    expect(await onHand(world, "ND")).toBe(34);

    // Past midnight the same bottles are on the same shelf, and not for sale.
    const tomorrow = await buy(world, 6);
    expect(
      await execute(stockAvailable, {}, viewer, afterMidnight()),
    ).toEqual({ tracking: true, ready: 0, promised: 6, available: 0 });
    expect(
      await execute(orderStock, { number: tomorrow }, viewer, afterMidnight()),
    ).toMatchObject({
      choices: [],
      plan: null,
      mustChoose: false,
      blocked: true,
      summary:
        "The only shots on hand are past their best-before date, so this cannot be packed from them. Release a batch that is in date first.",
    });
    await expect(
      execute(markPacked, { number: tomorrow }, staff, afterMidnight()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: `The only shots on hand are past their best-before date, so ${tomorrow} cannot be packed from them. Release a batch that is in date first.`,
    });
    // Naming the batch does not get round its date.
    await expect(
      execute(
        markPacked,
        { number: tomorrow, batchCode: "ND" },
        staff,
        afterMidnight(),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message:
        "ND passed its best-before date on 12 Nov 2026, so orders cannot be filled from it.",
    });
    await expect(
      execute(
        markPacked,
        { number: tomorrow, batches: [{ code: "ND", shots: 6 }] },
        staff,
        afterMidnight(),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await execute(getOrder, { number: tomorrow }, viewer, afterMidnight()))
        .status,
    ).toBe("paid");
    expect(await movementsFor(world, tomorrow)).toEqual([]);

    // The picture says so, and says what to do with them.
    const picture = await execute(stockPicture, {}, viewer, afterMidnight());
    expect(picture).toMatchObject({
      ready: 0,
      pastDate: 34,
      promised: 6,
      available: 0,
    });
    expect(picture.byBatch.map((batch) => [batch.code, batch.good])).toEqual([
      ["ND", false],
    ]);
    expect(picture.attention.map((item) => item.kind)).toEqual([
      "past-best-before",
      "short-for-orders",
    ]);
    expect(picture.attention[0]?.text).toBe(
      "ND passed its best-before date on 12 Nov 2026 and still has 34 shots on hand. They cannot be sold: write them off.",
    );
    expect(picture.attention[1]?.text).toBe(
      "Orders waiting to be packed need 6 shots and only 0 are ready to sell.",
    );

    // A fresh batch goes on sale beside it. It is the only one offered, so
    // there is nothing to choose.
    await makeBatch(world, "NEW", 20, { at: afterMidnight().now });
    expect(
      await execute(orderStock, { number: tomorrow }, viewer, afterMidnight()),
    ).toMatchObject({
      choices: [{ code: "NEW", onHand: 20 }],
      plan: [{ code: "NEW", shots: 6 }],
      mustChoose: false,
      blocked: false,
    });
    await execute(markPacked, { number: tomorrow }, staff, afterMidnight());
    expect(await onHand(world, "NEW")).toBe(14);
    expect(await onHand(world, "ND")).toBe(34);

    // What is left of the old one can still be written off.
    await execute(
      recordWaste,
      { code: "ND", shots: 34, why: "expired" },
      staff,
      afterMidnight(),
    );
    expect(
      await execute(stockPicture, {}, viewer, afterMidnight()),
    ).toMatchObject({ ready: 14, pastDate: 0 });
  });
});

describe("shots on hand", () => {
  let world: World;
  beforeAll(async () => {
    world = await openWorld();
    await makeBatch(world, "B001", 100, { bestBefore: "2027-03-01" });
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("is the sum of every kind of movement", async () => {
    const { staff, viewer, run } = world;
    expect(
      await execute(
        recordSample,
        { code: "B001", shots: 6, note: "Saturday market" },
        staff,
        run(),
      ),
    ).toEqual({ code: "B001", onHand: 94 });
    expect(
      await execute(
        recordWaste,
        { code: "B001", shots: 4, why: "expired" },
        staff,
        run(),
      ),
    ).toEqual({ code: "B001", onHand: 90 });
    // A count finds two more than the screen said.
    expect(
      await execute(
        adjustCount,
        { code: "B001", counted: 92, reason: "Recount after the market" },
        staff,
        run(),
      ),
    ).toEqual({ code: "B001", onHand: 92, change: 2 });
    // And then three fewer.
    expect(
      await execute(
        adjustCount,
        { code: "B001", change: -3, reason: "Three found leaking" },
        staff,
        run(),
      ),
    ).toEqual({ code: "B001", onHand: 89, change: -3 });

    // An order goes out, comes back, and goes out again.
    const number = await buy(world, 24);
    await execute(markPacked, { number }, staff, run());
    expect(await onHand(world, "B001")).toBe(65);
    await execute(markPacked, { number, undo: true }, staff, run());
    expect(await onHand(world, "B001")).toBe(89);
    await execute(markPacked, { number }, staff, run());

    const batch = await execute(getBatch, { code: "B001" }, viewer, run());
    expect(batch.totals).toEqual({
      made: 100,
      sample: -6,
      waste: -4,
      adjust: -1,
      sold: -48,
      returned: 24,
    });
    expect(batch.onHand).toBe(65);
    expect(batch.sold).toBe(24);
    expect(batch.orders).toHaveLength(1);
    expect(batch.orders[0]).toMatchObject({
      number,
      shots: 24,
      status: "packed",
      name: "Sam Tester",
    });
    expect(batch.orderCount).toBe(1);
    // Newest first, each with what it was and who did it.
    expect(
      batch.movements.map((row) => [row.kind, row.shots, row.orderNumber]),
    ).toEqual([
      ["sold", -24, number],
      ["returned", 24, number],
      ["sold", -24, number],
      ["adjust", -3, null],
      ["adjust", 2, null],
      ["waste", -4, null],
      ["sample", -6, null],
      ["made", 100, null],
    ]);
    expect(batch.movements.find((row) => row.kind === "waste")?.note).toBe(
      "Past its date",
    );
    expect(batch.movements.find((row) => row.kind === "sample")?.note).toBe(
      "Saturday market",
    );

    const [listed] = await execute(listBatches, {}, viewer, run());
    expect(listed).toMatchObject({ code: "B001", onHand: 65 });
    expect(await historyOf(world, "batch", batch.id)).toEqual(
      expect.arrayContaining([
        "Gave away 6 shots from B001: Saturday market",
        "Wrote off 4 shots from B001: past its date",
        "Corrected the count of B001 from 90 to 92: Recount after the market",
        "Corrected the count of B001 from 92 to 89: Three found leaking",
      ]),
    );
  });

  it("refuses to go below zero, and says how many there are", async () => {
    const { staff, run } = world;
    await expect(
      execute(recordSample, { code: "B001", shots: 66 }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "B001 has 65 shots on hand, so 66 cannot be taken from it.",
      fields: { shots: "Only 65 on hand" },
    });
    await expect(
      execute(
        recordWaste,
        { code: "B001", shots: 1000, why: "damaged" },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "B001 has 65 shots on hand, so 1,000 cannot be taken from it.",
    });
    await expect(
      execute(
        adjustCount,
        { code: "B001", change: -66, reason: "Far too many" },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "B001 has 65 shots on hand, so 66 cannot be taken from it.",
    });
    expect(await onHand(world, "B001")).toBe(65);
  });

  it("wants a reason for a correction and a number that makes sense", async () => {
    const { staff, run } = world;
    // What a form or a bot might send that the schema should turn away. The
    // cast is the point: these are not shapes the types would let through.
    for (const input of [
      { code: "B001", counted: 60 },
      { code: "B001", counted: 60, reason: "" },
      { code: "B001", counted: -1, reason: "Minus one" },
      { code: "B001", counted: 60.5, reason: "Half a shot" },
      { code: "B001", counted: Number.NaN, reason: "Not a number" },
      { code: "B001", reason: "No number at all" },
      { code: "B001", counted: 60, change: -5, reason: "Both at once" },
    ]) {
      await expect(
        execute(adjustCount, input as never, staff, run()),
        JSON.stringify(input),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(
      execute(
        adjustCount,
        { code: "B001", counted: 60 } as never,
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      fields: { reason: "Say why, in a few words" },
    });
    await expect(
      execute(
        recordWaste,
        { code: "B001", shots: 1, why: "other" },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { note: "Say what happened to them" },
    });
    expect(await onHand(world, "B001")).toBe(65);
  });

  it("writes nothing when the count was already right", async () => {
    const { staff, viewer, run } = world;
    const before = (await execute(getBatch, { code: "B001" }, viewer, run()))
      .movements.length;
    expect(
      await execute(
        adjustCount,
        { code: "B001", counted: 65, reason: "Counted, all there" },
        staff,
        run(),
      ),
    ).toEqual({ code: "B001", onHand: 65, change: 0 });
    expect(
      (await execute(getBatch, { code: "B001" }, viewer, run())).movements,
    ).toHaveLength(before);
  });

  it("applies the difference the counter saw, so what moved meanwhile is not undone", async () => {
    const { staff, viewer, run } = world;
    // The screen said 65 when the count began. Five were given away while it
    // was going on, and the counter found 63 against the 65 they were shown.
    await execute(
      recordSample,
      { code: "B001", shots: 5, note: "Handed out during the count" },
      staff,
      run(),
    );
    expect(
      await execute(
        adjustCount,
        {
          code: "B001",
          counted: 63,
          expected: 65,
          reason: "Two short on the shelf",
        },
        staff,
        run(),
      ),
    ).toEqual({ code: "B001", onHand: 58, change: -2 });
    // Writing 63 over the number would have put the five samples back. What
    // is recorded is a movement of two, dated now, with the reason.
    const batch = await execute(getBatch, { code: "B001" }, viewer, run());
    expect(batch.movements[0]).toMatchObject({
      kind: "adjust",
      shots: -2,
      note: "Two short on the shelf",
    });
    expect(batch.movements[1]).toMatchObject({ kind: "sample", shots: -5 });
    expect((await historyOf(world, "batch", batch.id)).at(-1)).toBe(
      "Corrected the count of B001 from 60 to 58: Two short on the shelf",
    );
    // What the screen showed only means something beside a count.
    await expect(
      execute(
        adjustCount,
        { code: "B001", change: 1, expected: 58, reason: "Both at once" },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: {
        expected: "The number the screen showed only goes with a count",
      },
    });

    // The seven turn up again, for the tests that follow.
    await execute(
      adjustCount,
      { code: "B001", change: 7, reason: "Found behind the cartons" },
      staff,
      run(),
    );
    expect(await onHand(world, "B001")).toBe(65);
  });

  it("says stock is low once, at the step that takes it under the line", async () => {
    const { staff, run } = world;
    expect(await eventsOf(world, "stock.low")).toHaveLength(0);

    // 65 ready, the line is 48 unless told otherwise.
    await execute(recordSample, { code: "B001", shots: 20 }, staff, run());
    const first = await eventsOf(world, "stock.low");
    expect(first).toHaveLength(1);
    // Nothing is waiting to be packed, so none of the 45 is spoken for.
    expect(first[0]?.payload).toEqual({
      onHand: 45,
      promised: 0,
      threshold: 48,
      because: "sample",
      code: "B001",
    });
    // Already under: going lower is not news.
    await execute(recordSample, { code: "B001", shots: 5 }, staff, run());
    expect(await eventsOf(world, "stock.low")).toHaveLength(1);

    // Back up to 60, then under a line the caller chose.
    await execute(
      adjustCount,
      { code: "B001", change: 20, reason: "Found a carton" },
      staff,
      run(),
    );
    await execute(
      recordWaste,
      { code: "B001", shots: 15, why: "damaged", lowStockAt: 50 },
      staff,
      run(),
    );
    const second = await eventsOf(world, "stock.low");
    expect(second).toHaveLength(2);
    expect(second[1]?.payload).toEqual({
      onHand: 45,
      promised: 0,
      threshold: 50,
      because: "waste",
      code: "B001",
    });

    // A batch that is not for sale yet does not count towards "ready".
    await makeBatch(world, "B002", 500, { upTo: "made" });
    await execute(recordSample, { code: "B002", shots: 499 }, staff, run());
    expect(await eventsOf(world, "stock.low")).toHaveLength(2);
  });

  it("says so too when closing or recalling a batch is what does it", async () => {
    const { staff, run } = world;
    // 45 in B001. Another 60 makes 105 ready.
    await makeBatch(world, "B003", 60);
    // Closing B001 leaves 60: still over the line, so nothing is said.
    await execute(closeBatch, { code: "B001", writeOff: true }, staff, run());
    expect(await eventsOf(world, "stock.low")).toHaveLength(2);
    // Recalling B003 leaves nothing at all.
    await execute(
      recallBatch,
      { code: "B003", reason: "Labels printed with the wrong date" },
      staff,
      run(),
    );
    const afterRecall = await eventsOf(world, "stock.low");
    expect(afterRecall).toHaveLength(3);
    expect(afterRecall[2]?.payload).toEqual({
      onHand: 0,
      promised: 0,
      threshold: 48,
      because: "recalled",
      code: "B003",
    });

    await makeBatch(world, "B004", 50);
    await execute(closeBatch, { code: "B004", writeOff: true }, staff, run());
    const afterClose = await eventsOf(world, "stock.low");
    expect(afterClose).toHaveLength(4);
    expect(afterClose[3]?.payload).toEqual({
      onHand: 0,
      promised: 0,
      threshold: 48,
      because: "closed",
      code: "B004",
    });
    expect((await eventsOf(world, "batch.closed")).at(-1)?.payload).toEqual({
      code: "B004",
      writtenOff: 50,
    });
  });
});

describe("working out where an order's shots come from", () => {
  // Rows as releasedShelf hands them over: already in first-expired order.
  // "past" marks a batch whose best-before day has gone by.
  const shelf = (
    ...rows: [code: string, onHand: number, past?: "past"][]
  ): readonly ShelfBatch[] =>
    rows.map(([code, onHandNow, past], index) => ({
      id: code,
      code,
      name: code,
      bestBefore: addDays(TODAY, past === "past" ? -1 - index : 30 + index),
      madeOn: addDays(TODAY, -30),
      createdAt: new Date(START),
      onHand: onHandNow,
      good: past !== "past",
    }));

  it("takes one batch when one batch can cover it, earliest first", () => {
    expect(planTakes(shelf(["A", 30], ["B", 100]), 24)).toEqual({
      ok: true,
      takes: [{ batchId: "A", code: "A", shots: 24 }],
    });
    expect(planTakes(shelf(["A", 6], ["B", 100]), 24)).toEqual({
      ok: true,
      takes: [{ batchId: "B", code: "B", shots: 24 }],
    });
    expect(planTakes(shelf(["A", 24]), 24)).toMatchObject({ ok: true });
  });

  it("splits earliest first only when no one batch can", () => {
    expect(
      planTakes(shelf(["A", 10], ["B", 0], ["C", 20], ["D", 20]), 36),
    ).toEqual({
      ok: true,
      takes: [
        { batchId: "A", code: "A", shots: 10 },
        { batchId: "C", code: "C", shots: 20 },
        { batchId: "D", code: "D", shots: 6 },
      ],
    });
  });

  it("says when there is nothing, and when there is not enough", () => {
    expect(planTakes([], 6)).toEqual({ ok: false, reason: "nothing-released" });
    expect(planTakes(shelf(["A", 0]), 6)).toEqual({
      ok: false,
      reason: "nothing-released",
    });
    expect(planTakes(shelf(["A", 5], ["B", 3]), 24)).toEqual({
      ok: false,
      reason: "short",
      onHand: 8,
    });
  });

  it("never plans to take from a batch past its date", () => {
    // The old batch has plenty, and it is first in line. It is skipped.
    expect(planTakes(shelf(["OLD", 100, "past"], ["NEW", 30]), 24)).toEqual({
      ok: true,
      takes: [{ batchId: "NEW", code: "NEW", shots: 24 }],
    });
    // What is past its date does not count towards "enough" either.
    expect(planTakes(shelf(["OLD", 100, "past"], ["NEW", 30]), 36)).toEqual({
      ok: false,
      reason: "short",
      onHand: 30,
    });
    // And when it is all there is, that is said, with how many.
    expect(planTakes(shelf(["OLD", 100, "past"], ["OLDER", 4, "past"]), 6))
      .toEqual({ ok: false, reason: "past-date", onHand: 104 });
  });
});

describe("filling orders from batches", () => {
  let world: World;
  let unrecorded: string;
  let alsoUnrecorded: string;
  beforeAll(async () => {
    world = await openWorld();
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("packs with no batches at all, records nothing and does not fail", async () => {
    const { staff, viewer, run } = world;
    unrecorded = await buy(world, 24);
    expect(
      await execute(orderStock, { number: unrecorded }, viewer, run()),
    ).toMatchObject({
      shots: 24,
      filled: [],
      choices: [],
      plan: null,
      summary:
        "No batch has stock released for sale, so no batch will be recorded when this is packed.",
    });

    expect(
      await execute(markPacked, { number: unrecorded }, staff, run()),
    ).toEqual({ status: "packed" });
    expect(await movementsFor(world, unrecorded)).toEqual([]);
    const order = await execute(
      getOrder,
      { number: unrecorded },
      viewer,
      run(),
    );
    expect(await historyOf(world, "order", order.id)).toContain(
      `Packed ${unrecorded}`,
    );
    expect(
      await execute(orderStock, { number: unrecorded }, viewer, run()),
    ).toMatchObject({
      filled: [],
      missing: 24,
      summary: "No batch recorded for this order.",
    });

    // Unpacking and cancelling work just the same with nothing to put back.
    await execute(markPacked, { number: unrecorded, undo: true }, staff, run());
    await execute(markPacked, { number: unrecorded }, staff, run());
    expect(await movementsFor(world, unrecorded)).toEqual([]);

    // A batch that is planned, or made and not released, changes nothing.
    await makeBatch(world, "HELD", 500, { upTo: "made" });
    alsoUnrecorded = await buy(world, 6);
    await execute(markPacked, { number: alsoUnrecorded }, staff, run());
    expect(await movementsFor(world, alsoUnrecorded)).toEqual([]);

    // And there is nothing to record it against afterwards, either.
    await expect(
      execute(recordOrderBatch, { number: unrecorded }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message:
        "No released batch has any stock on hand, so there is nothing to record this order against.",
    });
  });

  it("suggests the earliest batch that can cover it, and records the one the packer names", async () => {
    const { staff, viewer, run } = world;
    // Made in the other order, to show it is the date that decides.
    await makeBatch(world, "LATE", 100, { bestBefore: "2027-03-10" });
    await makeBatch(world, "EARLY", 30, { bestBefore: "2027-01-10" });

    const first = await buy(world, 24);
    const before = await execute(orderStock, { number: first }, viewer, run());
    expect(
      before.choices.map((choice) => [
        choice.code,
        choice.onHand,
        choice.enough,
      ]),
    ).toEqual([
      ["EARLY", 30, true],
      ["LATE", 100, true],
    ]);
    expect(before).toMatchObject({
      need: 24,
      plan: [{ code: "EARLY", shots: 24 }],
      mustChoose: true,
      blocked: false,
      summary:
        "Take 24 shots from EARLY if you can: of the batches that can fill it, that one has the earliest best-before date. Say which batch is in the box when it is packed.",
    });

    // Two batches are on sale, so nobody guesses which one is in the box.
    await expect(
      execute(markPacked, { number: first }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: `More than one batch is on sale, so ${first} has to be marked packed with the batch that is in the box: EARLY (30 on hand, best before 10 Jan 2027) or LATE (100 on hand, best before 10 Mar 2027).`,
    });
    expect(
      (await execute(getOrder, { number: first }, viewer, run())).status,
    ).toBe("paid");
    expect(await movementsFor(world, first)).toEqual([]);

    await execute(
      markPacked,
      { number: first, batchCode: "early" },
      staff,
      run(),
    );
    const moved = await movementsFor(world, first);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      kind: "sold",
      shots: -24,
      note: `Order ${first}`,
    });
    expect(await onHand(world, "EARLY")).toBe(6);
    const order = await execute(getOrder, { number: first }, viewer, run());
    expect(await historyOf(world, "order", order.id)).toContain(
      `Packed ${first}: 24 shots from EARLY`,
    );
    expect(
      await execute(orderStock, { number: first }, viewer, run()),
    ).toMatchObject({
      filled: [{ code: "EARLY", shots: 24, status: "released" }],
      missing: 0,
      need: 0,
      mustChoose: false,
      summary: "Filled with 24 shots from EARLY.",
    });

    // EARLY has 6 left: for a dozen the suggestion is LATE, whole, not half
    // and half.
    const second = await buy(world, 12);
    const dozen = await execute(orderStock, { number: second }, viewer, run());
    expect(dozen.plan).toEqual([{ code: "LATE", shots: 12 }]);
    expect(dozen.choices.map((choice) => [choice.code, choice.enough])).toEqual(
      [
        ["EARLY", false],
        ["LATE", true],
      ],
    );
    await execute(
      markPacked,
      { number: second, batchCode: "LATE" },
      staff,
      run(),
    );
    expect(await onHand(world, "EARLY")).toBe(6);
    expect(await onHand(world, "LATE")).toBe(88);

    // And a box of six finishes EARLY off.
    const third = await buy(world, 6);
    await execute(
      markPacked,
      { number: third, batchCode: "EARLY" },
      staff,
      run(),
    );
    expect(await onHand(world, "EARLY")).toBe(0);

    // One batch left with anything in it: there is nothing to choose, so
    // nothing has to be said.
    const fourth = await buy(world, 8);
    expect(
      await execute(orderStock, { number: fourth }, viewer, run()),
    ).toMatchObject({
      choices: [{ code: "LATE", onHand: 88 }],
      plan: [{ code: "LATE", shots: 8 }],
      mustChoose: false,
      summary: "Packing takes 8 shots from LATE.",
    });
    await execute(markPacked, { number: fourth }, staff, run());
    expect(await onHand(world, "LATE")).toBe(80);
  });

  it("takes a mix of batches when the packer says the box is mixed", async () => {
    const { staff, viewer, run } = world;
    await makeBatch(world, "MID", 20, { bestBefore: "2027-02-10" });
    // 20 in MID and 80 in LATE: ninety has to come from both.
    const number = await buy(world, 90);
    expect(await execute(orderStock, { number }, viewer, run())).toMatchObject({
      need: 90,
      plan: [
        { code: "MID", shots: 20 },
        { code: "LATE", shots: 70 },
      ],
      mustChoose: true,
      summary:
        "No one batch can fill it. Take 20 shots from MID and 70 from LATE, and say so when it is packed.",
    });

    // The split is a suggestion too. It is not taken unless it is said.
    await expect(
      execute(markPacked, { number }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("More than one batch is on sale"),
    });
    // One batch cannot cover it.
    await expect(
      execute(markPacked, { number, batchCode: "LATE" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: `LATE has 80 shots on hand and ${number} needs 90. Pick another batch, or split it across batches.`,
    });
    // A mix has to add up to the whole order.
    await expect(
      execute(
        markPacked,
        {
          number,
          batches: [
            { code: "MID", shots: 20 },
            { code: "LATE", shots: 60 },
          ],
        },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: `Those add up to 80 shots and ${number} needs 90.`,
      fields: { batches: "They have to add up to 90" },
    });
    // And each batch has to have what is taken from it.
    await expect(
      execute(
        markPacked,
        {
          number,
          batches: [
            { code: "MID", shots: 30 },
            { code: "LATE", shots: 60 },
          ],
        },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "MID has 20 shots on hand, so 30 cannot be taken from it.",
    });
    // One batch or a mix, not both at once. Whole shots only.
    for (const input of [
      { number, batchCode: "LATE", batches: [{ code: "MID", shots: 90 }] },
      { number, batches: [] },
      { number, batches: [{ code: "MID", shots: 0 }] },
      { number, batches: [{ code: "MID", shots: 20.5 }] },
    ]) {
      await expect(
        execute(markPacked, input, staff, run()),
        JSON.stringify(input),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect((await execute(getOrder, { number }, viewer, run())).status).toBe(
      "paid",
    );
    expect(await movementsFor(world, number)).toEqual([]);

    await execute(
      markPacked,
      {
        number,
        batches: [
          { code: "late", shots: 70 },
          { code: "MID", shots: 20 },
        ],
      },
      staff,
      run(),
    );
    const moved = await movementsFor(world, number);
    expect(moved.map((row) => row.shots).sort((a, b) => a - b)).toEqual([
      -70, -20,
    ]);
    expect(await onHand(world, "MID")).toBe(0);
    expect(await onHand(world, "LATE")).toBe(10);
    const order = await execute(getOrder, { number }, viewer, run());
    expect(await historyOf(world, "order", order.id)).toContain(
      `Packed ${number}: 20 shots from MID and 70 from LATE`,
    );
    expect(
      (await execute(orderStock, { number }, viewer, run())).filled.map(
        (row) => [row.code, row.shots],
      ),
    ).toEqual([
      ["LATE", 70],
      ["MID", 20],
    ]);
  });

  it("refuses when there is stock but not enough, and leaves the order where it was", async () => {
    const { staff, viewer, run } = world;
    const number = await buy(world, 24);
    expect(await execute(orderStock, { number }, viewer, run())).toMatchObject({
      plan: null,
      onHandIfShort: 10,
      blocked: true,
      summary:
        "Only 10 shots on hand in released batches, and this order needs 24. Release another batch or correct the count before packing it.",
    });
    await expect(
      execute(markPacked, { number }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: `Only 10 shots on hand in released batches, and ${number} needs 24. Release another batch or correct the count, then try again.`,
    });
    // Shipping it straight from the queue is refused the same way.
    await expect(
      execute(markShipped, { number }, staff, run()),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await execute(getOrder, { number }, viewer, run())).status).toBe(
      "paid",
    );
    expect(await movementsFor(world, number)).toEqual([]);
    expect(await onHand(world, "LATE")).toBe(10);
  });

  it("fills from the batch the packer names, or says why it cannot", async () => {
    const { staff, viewer, run } = world;
    await makeBatch(world, "PICK", 50, { bestBefore: "2027-06-01" });

    // The suggestion for six is LATE (earlier date, enough left). The packer
    // has PICK in their hand, and that is what goes on record.
    const number = await buy(world, 6);
    expect((await execute(orderStock, { number }, viewer, run())).plan).toEqual(
      [{ code: "LATE", shots: 6 }],
    );
    await execute(markPacked, { number, batchCode: "pick" }, staff, run());
    expect(await onHand(world, "PICK")).toBe(44);
    expect(await onHand(world, "LATE")).toBe(10);

    const big = await buy(world, 24);
    await expect(
      execute(markPacked, { number: big, batchCode: "LATE" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: `LATE has 10 shots on hand and ${big} needs 24. Pick another batch, or split it across batches.`,
    });
    await expect(
      execute(markPacked, { number: big, batchCode: "HELD" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message:
        "HELD is made but not released, so orders cannot be filled from it.",
    });
    await expect(
      execute(markPacked, { number: big, batchCode: "NOPE" }, staff, run()),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      (await execute(getOrder, { number: big }, viewer, run())).status,
    ).toBe("paid");
    expect(await movementsFor(world, big)).toEqual([]);
  });

  it("takes no stock for a test order", async () => {
    const { staff, viewer, run } = world;
    const number = await buy(world, 12, { test: true });
    // Two batches are on sale, and it still packs without one being named.
    await execute(markPacked, { number }, staff, run());
    expect(await movementsFor(world, number)).toEqual([]);
    expect(await onHand(world, "PICK")).toBe(44);
    expect(await execute(orderStock, { number }, viewer, run())).toMatchObject({
      isTest: true,
      missing: 0,
      need: 0,
      mustChoose: false,
      summary: "A test order. No stock is taken for it.",
    });
    await expect(
      execute(recordOrderBatch, { number }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: `${number} is a test order, so no stock is taken for it.`,
    });
  });

  it("puts an unpacked box back, and a cancelled one only when someone says so", async () => {
    const { staff, viewer, run } = world;
    const number = await buy(world, 12);
    await execute(markPacked, { number, batchCode: "PICK" }, staff, run());
    expect(await onHand(world, "PICK")).toBe(32);

    // Not packed after all: the box was never made up, so the shots are back.
    await execute(markPacked, { number, undo: true }, staff, run());
    expect(await onHand(world, "PICK")).toBe(44);
    const afterUndo = await movementsFor(world, number);
    expect(afterUndo.map((row) => [row.kind, row.shots])).toEqual([
      ["sold", -12],
      ["returned", 12],
    ]);
    expect(afterUndo[1]?.note).toBe(`Order ${number}: not packed after all`);
    expect(
      (await execute(orderStock, { number }, viewer, run())).filled,
    ).toEqual([]);

    // Packed again, then called off. Nobody said the bottles went back on
    // the shelf, so they are written off: off the order, and not for sale.
    await execute(markPacked, { number, batchCode: "PICK" }, staff, run());
    expect(await onHand(world, "PICK")).toBe(32);
    await execute(
      cancelOrder,
      { number, reason: "Ordered twice by mistake" },
      staff,
      run(),
    );
    expect(await onHand(world, "PICK")).toBe(32);
    const all = await movementsFor(world, number);
    expect(all.map((row) => [row.kind, row.shots])).toEqual([
      ["sold", -12],
      ["returned", 12],
      ["sold", -12],
      ["returned", 12],
    ]);
    expect(all[3]?.note).toBe(`Order ${number}: order cancelled`);
    expect(await execute(orderStock, { number }, viewer, run())).toMatchObject({
      filled: [],
      missing: 0,
      summary: "Cancelled. It holds no stock.",
    });
    const order = await execute(getOrder, { number }, viewer, run());
    expect(await historyOf(world, "order", order.id)).toEqual(
      expect.arrayContaining([
        `Put ${number} back to "to pack". Returned 12 shots to PICK`,
        `Cancelled ${number}: Ordered twice by mistake. Wrote off 12 shots from PICK, not put back on the shelf`,
      ]),
    );
    // It is off the batch's list of orders. The write-off is on the batch,
    // with the order it came off in its note.
    const batch = await execute(getBatch, { code: "PICK" }, viewer, run());
    expect(batch.orders.map((row) => row.number)).not.toContain(number);
    expect(batch.totals).toMatchObject({ returned: 24, waste: -12 });
    expect(batch.movements[0]).toMatchObject({
      kind: "waste",
      shots: -12,
      orderNumber: null,
      note: `Not put back on the shelf. Order ${number}: order cancelled`,
    });

    // Cancelled with the bottles going back: they are on the shelf again and
    // nothing is written off.
    const kept = await buy(world, 6);
    await execute(
      markPacked,
      { number: kept, batchCode: "PICK" },
      staff,
      run(),
    );
    expect(await onHand(world, "PICK")).toBe(26);
    await execute(
      cancelOrder,
      { number: kept, reason: "Changed their mind", restock: true },
      staff,
      run(),
    );
    expect(await onHand(world, "PICK")).toBe(32);
    const keptOrder = await execute(getOrder, { number: kept }, viewer, run());
    expect(await historyOf(world, "order", keptOrder.id)).toContain(
      `Cancelled ${kept}: Changed their mind. Returned 6 shots to PICK`,
    );
    expect(
      (await execute(getBatch, { code: "PICK" }, viewer, run())).totals.waste,
    ).toBe(-12);

    // An order that was never packed has nothing to deal with, either way.
    const never = await buy(world, 6);
    await execute(
      cancelOrder,
      { number: never, reason: "Changed their mind", restock: true },
      staff,
      run(),
    );
    expect(await movementsFor(world, never)).toEqual([]);
    expect(await onHand(world, "PICK")).toBe(32);
  });

  it("ships straight from the queue only when there is no doubt which batch", async () => {
    const { staff, viewer, run } = world;
    // LATE and PICK are both on sale, so shipping cannot pick one either.
    const number = await buy(world, 6);
    await expect(
      execute(markShipped, { number, carrier: "NZ Post" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: `More than one batch is on sale, so ${number} has to be marked packed with the batch that is in the box: LATE (10 on hand, best before 10 Mar 2027) or PICK (32 on hand, best before 1 Jun 2027).`,
    });
    expect((await execute(getOrder, { number }, viewer, run())).status).toBe(
      "paid",
    );
    // Packed first with its batch, then shipped: the shots are taken once.
    await execute(markPacked, { number, batchCode: "LATE" }, staff, run());
    await execute(markShipped, { number }, staff, run());
    expect(await movementsFor(world, number)).toHaveLength(1);
    expect(await onHand(world, "LATE")).toBe(4);

    // With LATE finished there is only PICK, and no doubt.
    await execute(
      recordWaste,
      { code: "LATE", shots: 4, why: "damaged" },
      staff,
      run(),
    );
    const direct = await buy(world, 6);
    await execute(
      markShipped,
      { number: direct, carrier: "NZ Post" },
      staff,
      run(),
    );
    expect(
      (await movementsFor(world, direct)).map((row) => [row.kind, row.shots]),
    ).toEqual([["sold", -6]]);
    expect(await onHand(world, "PICK")).toBe(26);
    const order = await execute(getOrder, { number: direct }, viewer, run());
    expect(await historyOf(world, "order", order.id)).toContain(
      `Shipped ${direct} with NZ Post. Took 6 shots from PICK`,
    );
  });

  it("records the batch afterwards for an order that went out without one", async () => {
    const { staff, viewer, run } = world;
    const waiting = await execute(listOrdersWithoutBatch, {}, viewer, run());
    expect(waiting.map((row) => row.number)).toContain(unrecorded);
    expect(waiting.find((row) => row.number === unrecorded)).toMatchObject({
      shots: 24,
      status: "packed",
      name: "Sam Tester",
    });
    expect(
      (await execute(stockPicture, {}, viewer, run())).attention.find(
        (item) => item.kind === "no-batch-recorded",
      )?.text,
    ).toBe("2 orders have been packed or sent with no batch recorded.");

    expect(
      await execute(
        recordOrderBatch,
        { number: unrecorded, batchCode: "PICK" },
        staff,
        run(),
      ),
    ).toEqual({ number: unrecorded, filled: [{ code: "PICK", shots: 24 }] });
    expect(await onHand(world, "PICK")).toBe(2);
    const order = await execute(
      getOrder,
      { number: unrecorded },
      viewer,
      run(),
    );
    expect(await historyOf(world, "order", order.id)).toContain(
      `Recorded that ${unrecorded} was filled with 24 shots from PICK`,
    );
    // Twice takes nothing the second time.
    expect(
      await execute(recordOrderBatch, { number: unrecorded }, staff, run()),
    ).toEqual({ number: unrecorded, filled: [] });
    expect(await onHand(world, "PICK")).toBe(2);
    expect(
      (await execute(listOrdersWithoutBatch, {}, viewer, run())).map(
        (row) => row.number,
      ),
    ).not.toContain(unrecorded);

    // The other one needs six and the shelf has two: it stays unrecorded
    // rather than being written against stock that is not there.
    await expect(
      execute(recordOrderBatch, { number: alsoUnrecorded }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: `Only 2 shots on hand in released batches, and ${alsoUnrecorded} needs 6. Release another batch or correct the count, then try again.`,
    });

    // Not for an order still in the queue, or one that was called off.
    const queued = await buy(world, 6);
    await expect(
      execute(recordOrderBatch, { number: queued }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: `${queued} has not been packed yet. Its batch is recorded when it is packed.`,
    });
    await execute(
      cancelOrder,
      { number: queued, reason: "Called off" },
      staff,
      run(),
    );
    await expect(
      execute(recordOrderBatch, { number: queued }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: `${queued} was cancelled, so it holds no stock.`,
    });
    await expect(
      execute(recordOrderBatch, { number: "QP-ZZZZZZ" }, staff, run()),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("says stock is low when an order is what takes it under the line", async () => {
    const { staff, viewer, run } = world;
    // Every crossing so far was an order's doing, and each was said once.
    const lows = await eventsOf(world, "stock.low");
    expect(lows.length).toBeGreaterThan(0);
    expect(lows.every((event) => event.payload.because === "order")).toBe(true);

    await makeBatch(world, "FRESH", 60, { bestBefore: "2027-09-01" });
    const before = (await eventsOf(world, "stock.low")).length;
    const number = await buy(world, 48);
    // 62 ready (2 in PICK, 60 in FRESH), and this one takes it to 14. Two
    // orders of 24 are still waiting to be packed, which the event says too.
    await execute(markPacked, { number, batchCode: "FRESH" }, staff, run());
    const after = await eventsOf(world, "stock.low");
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.payload).toEqual({
      onHand: 14,
      promised: 48,
      threshold: 48,
      because: "order",
      order: number,
    });
    // What the event says is what the picture says.
    expect(await execute(stockAvailable, {}, viewer, run())).toEqual({
      tracking: true,
      ready: 14,
      promised: 48,
      available: 0,
    });
  });

  it("gives two orders packed at the same moment their turn, and never the same shots", async () => {
    const { staff, viewer, run } = world;
    // 12 left in FRESH, and two boxes of eight that both want them.
    const a = await buy(world, 8);
    const b = await buy(world, 8);
    const results = await Promise.allSettled([
      execute(markPacked, { number: a, batchCode: "FRESH" }, staff, run()),
      execute(markPacked, { number: b, batchCode: "FRESH" }, staff, run()),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const refused = results.find((result) => result.status === "rejected");
    expect(refused).toMatchObject({
      reason: {
        code: "conflict",
        message: expect.stringContaining("FRESH has 4 shots on hand"),
      },
    });
    expect(await onHand(world, "FRESH")).toBe(4);
    // Exactly one of them is packed and holds the eight.
    const statuses = [
      (await execute(getOrder, { number: a }, viewer, run())).status,
      (await execute(getOrder, { number: b }, viewer, run())).status,
    ].sort();
    expect(statuses).toEqual(["packed", "paid"]);
    expect(
      (await movementsFor(world, a)).length +
        (await movementsFor(world, b)).length,
    ).toBe(1);
  });
});

describe("the recall list", () => {
  let world: World;
  let unrecorded: string;
  let whole: string;
  let split: string;
  let cancelled: string;
  let binned: string;

  beforeAll(async () => {
    world = await openWorld();
    const { staff, run } = world;
    // One box goes out before any batch is on record.
    unrecorded = await buy(world, 6, { first: "Una" });
    await execute(markShipped, { number: unrecorded }, staff, run());

    await makeBatch(world, "R1", 50, { bestBefore: "2027-01-10" });
    await makeBatch(world, "R2", 100, { bestBefore: "2027-03-10" });

    // 24 from R1, and shipped.
    whole = await buy(world, 24, { first: "Whetu" });
    await execute(
      markPacked,
      { number: whole, batchCode: "R1" },
      staff,
      run(),
    );
    await execute(markShipped, { number: whole }, staff, run());
    // 110: all 26 left in R1 and 84 from R2. Packed, still here.
    split = await buy(world, 110, { first: "Sione" });
    await execute(
      markPacked,
      {
        number: split,
        batches: [
          { code: "R1", shots: 26 },
          { code: "R2", shots: 84 },
        ],
      },
      staff,
      run(),
    );
    // Packed from R2, then called off and put back: its shots never left.
    cancelled = await buy(world, 6, { first: "Cal" });
    await execute(
      markPacked,
      { number: cancelled, batchCode: "R2" },
      staff,
      run(),
    );
    await execute(
      cancelOrder,
      { number: cancelled, reason: "Called off", restock: true },
      staff,
      run(),
    );
    // Another called off, and nobody said its bottles went back: written off.
    binned = await buy(world, 4, { first: "Bin" });
    await execute(
      markPacked,
      { number: binned, batchCode: "R2" },
      staff,
      run(),
    );
    await execute(
      cancelOrder,
      { number: binned, reason: "Box was crushed" },
      staff,
      run(),
    );
    await execute(
      recordSample,
      { code: "R2", shots: 2, note: "Two to the club captain" },
      staff,
      run(),
    );
    await execute(
      adjustCount,
      { code: "R2", change: -1, reason: "One short on the recount" },
      staff,
      run(),
    );
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("names every order that holds shots from the batch, and how to reach them", async () => {
    const { viewer, run } = world;
    const list = await execute(recallList, { code: "r1" }, viewer, run());
    expect(list.batch).toMatchObject({
      code: "R1",
      status: "released",
      bestBefore: "2027-01-10",
      onHand: 0,
      recall: null,
    });
    expect(list.complete).toBe(true);
    expect(list.totals).toEqual({ orders: 2, shots: 50, sent: 1, notSent: 1 });
    // Newest first.
    expect(list.orders.map((row) => [row.number, row.shots, row.sent])).toEqual(
      [
        [split, 26, false],
        [whole, 24, true],
      ],
    );
    expect(list.orders[1]).toMatchObject({
      number: whole,
      status: "shipped",
      name: "Whetu Tester",
      email: "whetu@example.co.nz",
      phone: "021 555 010",
      address: [
        "12 Sideline Road",
        "Flat 2",
        "Levin 5510",
        "Manawatū-Whanganui",
      ],
    });
    expect(list.orders[1]?.shippedAt).toBeInstanceOf(Date);
    // The box sent before batches were recorded is on no list, and it says so.
    expect(list.noBatchRecorded).toBe(1);
    // Every one of the fifty is on an order.
    expect(list.balance).toEqual({
      made: 50,
      adjustments: 0,
      sold: 50,
      samples: 0,
      waste: 0,
      onHand: 0,
      addsUp: true,
    });
  });

  it("leaves out what came back, and accounts for every other shot", async () => {
    const { viewer, run } = world;
    const list = await execute(recallList, { code: "R2" }, viewer, run());
    expect(list.orders.map((row) => [row.number, row.shots])).toEqual([
      [split, 84],
    ]);
    expect(list.orders.map((row) => row.number)).not.toContain(cancelled);
    expect(list.orders.map((row) => row.number)).not.toContain(binned);
    expect(list.totals).toEqual({ orders: 1, shots: 84, sent: 0, notSent: 1 });

    // What left with no order behind it, with the note made at the time.
    expect(list.samples.shots).toBe(2);
    expect(list.samples.notes).toHaveLength(1);
    expect(list.samples.notes[0]).toMatchObject({
      shots: 2,
      note: "Two to the club captain",
    });
    expect(list.waste.shots).toBe(4);
    expect(list.waste.notes).toHaveLength(1);
    expect(list.waste.notes[0]).toMatchObject({
      shots: 4,
      note: `Not put back on the shelf. Order ${binned}: order cancelled`,
    });
    expect(list.corrections.shots).toBe(-1);
    expect(list.corrections.notes).toHaveLength(1);
    expect(list.corrections.notes[0]).toMatchObject({
      shots: -1,
      note: "One short on the recount",
    });

    // And the sum: made, less the one the recount could not find, is what
    // went out on orders, was given away, was written off and is still here.
    expect(list.batch.onHand).toBe(9);
    expect(list.balance).toEqual({
      made: 100,
      adjustments: -1,
      sold: 84,
      samples: 2,
      waste: 4,
      onHand: 9,
      addsUp: true,
    });
    const { balance } = list;
    expect(balance.made + balance.adjustments).toBe(
      balance.sold + balance.samples + balance.waste + balance.onHand,
    );
  });

  it("goes by the batch the packer named, not the one that would have been suggested", async () => {
    const { staff, viewer, run } = world;
    // R3 goes on sale next to R2, and R2 has the earlier date: R2 is the
    // suggestion. The packer says the box holds R3.
    await makeBatch(world, "R3", 30, { bestBefore: "2027-05-10" });
    const number = await buy(world, 6, { first: "Niko" });
    expect((await execute(orderStock, { number }, viewer, run())).plan).toEqual(
      [{ code: "R2", shots: 6 }],
    );
    await execute(markPacked, { number, batchCode: "R3" }, staff, run());

    const named = await execute(recallList, { code: "R3" }, viewer, run());
    expect(
      named.orders.map((row) => [row.number, row.name, row.shots]),
    ).toEqual([[number, "Niko Tester", 6]]);
    const suggested = await execute(recallList, { code: "R2" }, viewer, run());
    expect(suggested.orders.map((row) => row.number)).not.toContain(number);
  });

  it("says when the list was cut short", async () => {
    const { viewer, run } = world;
    const list = await execute(
      recallList,
      { code: "R1", limit: 1 },
      viewer,
      run(),
    );
    expect(list.complete).toBe(false);
    expect(list.orders).toHaveLength(1);
    // The totals still count everyone.
    expect(list.totals).toMatchObject({ orders: 2, shots: 50 });
  });

  it("recalling stops the batch being sold and counts who has it", async () => {
    const { staff, viewer, run } = world;
    expect(
      await execute(
        recallBatch,
        { code: "R2", reason: "Glass found in a bottle" },
        staff,
        run(),
      ),
    ).toEqual({
      code: "R2",
      status: "recalled",
      orders: 1,
      shots: 84,
      onHand: 9,
    });
    expect((await eventsOf(world, "batch.recalled")).at(-1)?.payload).toEqual({
      code: "R2",
      reason: "Glass found in a bottle",
      orders: 1,
      shots: 84,
      onHand: 9,
    });
    // Stock was already under the line (the big order took it there), so
    // the recall is not the step that says so.
    expect(
      (await eventsOf(world, "stock.low")).map(
        (event) => event.payload.because,
      ),
    ).toEqual(["order"]);
    const list = await execute(recallList, { code: "R2" }, viewer, run());
    expect(list.batch).toMatchObject({
      status: "recalled",
      recall: { reason: "Glass found in a bottle", on: TODAY },
    });
    expect(list.orders).toHaveLength(1);

    // Nothing is filled from it again, whoever asks.
    const next = await buy(world, 6);
    await expect(
      execute(markPacked, { number: next, batchCode: "R2" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "R2 is recalled, so orders cannot be filled from it.",
    });
    // What is left in it is not for sale, and no longer counts as ready.
    expect(await execute(stockAvailable, {}, viewer, run())).toMatchObject({
      ready: 24,
    });
    // With R2 recalled, R3 is the only batch on sale: no need to name it.
    await execute(markPacked, { number: next }, staff, run());
    expect(
      (await movementsFor(world, next)).map((row) => [row.kind, row.shots]),
    ).toEqual([["sold", -6]]);
    expect(await onHand(world, "R3")).toBe(18);

    // The box still here is pulled: its shots come off the order and back
    // onto the batches they came from, where the recalled ones stay unsold.
    await execute(markPacked, { number: split, undo: true }, staff, run());
    expect(await onHand(world, "R2")).toBe(93);
    expect(await onHand(world, "R1")).toBe(26);
    const after = await execute(recallList, { code: "R2" }, viewer, run());
    expect(after.orders).toEqual([]);
    expect(after.balance).toMatchObject({
      sold: 0,
      onHand: 93,
      addsUp: true,
    });
  });
});

describe("the stock picture", () => {
  let world: World;
  beforeAll(async () => {
    world = await openWorld();
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("starts out empty and says nothing is being counted yet", async () => {
    const { viewer, run } = world;
    expect(await execute(stockPicture, {}, viewer, run())).toMatchObject({
      tracking: false,
      ready: 0,
      byBatch: [],
      notReleased: 0,
      planned: 0,
      nearBestBefore: [],
      promised: 0,
      available: 0,
      pastDate: 0,
      low: false,
      attention: [],
    });
    // The quick answer says the same, and that it is not counting yet.
    expect(await execute(stockAvailable, {}, viewer, run())).toEqual({
      tracking: false,
      ready: 0,
      promised: 0,
      available: 0,
    });
  });

  it("adds up what is ready, what is waiting and what is near its date", async () => {
    const { staff, viewer, run } = world;
    await makeBatch(world, "FAR", 80, { bestBefore: addDays(TODAY, 200) });
    await makeBatch(world, "NEAR", 50, { bestBefore: addDays(TODAY, 10) });
    // Released ten days ago while it was still good. Its date has passed since.
    await makeBatch(world, "PAST", 5, {
      bestBefore: addDays(TODAY, -2),
      at: new Date(START - 10 * DAY),
    });
    await makeBatch(world, "HELD", 40, {
      bestBefore: addDays(TODAY, 20),
      upTo: "made",
    });
    await makeBatch(world, "LATER", 1, { upTo: "planned" });
    await makeBatch(world, "GONE", 30, { bestBefore: addDays(TODAY, 3) });
    await execute(closeBatch, { code: "GONE", writeOff: true }, staff, run());

    // Nothing is promised yet: low is measured on what is free to sell.
    expect(
      (
        await execute(stockPicture, { lowStockAt: 200 }, viewer, run())
      ).attention.find((item) => item.kind === "low-stock")?.text,
    ).toBe("Stock is running low: 130 shots free to sell.");

    // An order waiting to be packed, a test one and one not yet paid. Only
    // the first is a promise.
    await buy(world, 30);
    await buy(world, 24, { test: true });
    await buy(world, 12, { pending: true });

    const picture = await execute(stockPicture, {}, viewer, run());
    expect(picture).toMatchObject({
      tracking: true,
      // FAR and NEAR. The five in PAST are on the shelf and not for sale.
      ready: 130,
      pastDate: 5,
      promised: 30,
      available: 100,
      notReleased: 40,
      planned: 1,
      low: false,
      lowStockAt: 48,
      nearDays: 30,
    });
    expect(await execute(stockAvailable, {}, viewer, run())).toEqual({
      tracking: true,
      ready: 130,
      promised: 30,
      available: 100,
    });
    // First expired first, the one past its date too, marked as not good.
    expect(
      picture.byBatch.map((batch) => [batch.code, batch.onHand, batch.good]),
    ).toEqual([
      ["PAST", 5, false],
      ["NEAR", 50, true],
      ["FAR", 80, true],
    ]);
    expect(picture.waiting.map((batch) => batch.code)).toEqual(["HELD"]);
    expect(
      picture.nearBestBefore.map((batch) => [
        batch.code,
        batch.daysToBestBefore,
      ]),
    ).toEqual([
      ["PAST", -2],
      ["NEAR", 10],
      ["HELD", 20],
    ]);
    expect(picture.attention.map((item) => item.kind)).toEqual([
      "past-best-before",
      "near-best-before",
      "near-best-before",
      "not-released",
    ]);
    expect(picture.attention[0]).toEqual({
      kind: "past-best-before",
      text: "PAST passed its best-before date on 10 Nov 2026 and still has 5 shots on hand. They cannot be sold: write them off.",
      href: "/backstage/stock/batches/PAST",
    });
    expect(picture.attention[1]?.text).toBe(
      "NEAR reaches its best-before date in 10 days (22 Nov 2026), with 50 shots on hand.",
    );
    expect(picture.attention[3]?.text).toBe(
      "HELD has been made but not released for sale: 40 shots waiting.",
    );

    // N is the caller's to choose.
    const tight = await execute(stockPicture, { nearDays: 5 }, viewer, run());
    expect(tight.nearBestBefore.map((batch) => batch.code)).toEqual(["PAST"]);
    const wide = await execute(stockPicture, { nearDays: 365 }, viewer, run());
    expect(wide.nearBestBefore.map((batch) => batch.code)).toEqual([
      "PAST",
      "NEAR",
      "HELD",
      "FAR",
    ]);
  });

  it("flags low stock, and stock that cannot cover the orders waiting", async () => {
    const { viewer, run } = world;
    const low = await execute(stockPicture, { lowStockAt: 200 }, viewer, run());
    expect(low.low).toBe(true);
    expect(low.attention.find((item) => item.kind === "low-stock")).toEqual({
      kind: "low-stock",
      text: "Stock is running low: 100 shots free to sell, once the 30 promised to orders are packed.",
      href: "/backstage/stock/batches",
    });

    // A big order takes what is promised past what is there.
    await buy(world, 120);
    const short = await execute(stockPicture, {}, viewer, run());
    expect(short).toMatchObject({
      ready: 130,
      promised: 150,
      // Never less than nothing.
      available: 0,
      low: true,
    });
    expect(
      short.attention.find((item) => item.kind === "short-for-orders")?.text,
    ).toBe(
      "Orders waiting to be packed need 150 shots and only 130 are ready to sell.",
    );
    // One or the other is said, not both.
    expect(
      short.attention.find((item) => item.kind === "low-stock"),
    ).toBeUndefined();
  });

  it("brings in the materials to reorder and the purchase orders that are late", async () => {
    const { staff, viewer, run } = world;
    const supplier = await execute(
      createSupplier,
      { name: "Label Press (invented)" },
      staff,
      run(),
    );
    const label = await execute(
      createMaterial,
      {
        name: "Wrap label",
        supplierId: supplier.id,
        onHand: 150,
        reorderAt: 500,
      },
      staff,
      run(),
    );
    const purchase = await execute(
      createPurchaseOrder,
      { supplierId: supplier.id, lines: [{ materialId: label.id, qty: 3000 }] },
      staff,
      run(),
    );
    await execute(
      markPurchaseSent,
      {
        number: purchase.number,
        orderedOn: addDays(TODAY, -10),
        expectedOn: addDays(TODAY, -3),
      },
      staff,
      run(),
    );

    const picture = await execute(stockPicture, {}, viewer, run());
    expect(picture.materialsToReorder).toEqual([
      { id: label.id, name: "Wrap label", onHand: 150, reorderAt: 500 },
    ]);
    expect(picture.purchasesOverdue).toEqual([
      {
        number: "PO-0001",
        supplier: "Label Press (invented)",
        expectedOn: addDays(TODAY, -3),
        daysLate: 3,
      },
    ]);
    expect(
      picture.attention.find((item) => item.kind === "purchase-overdue"),
    ).toEqual({
      kind: "purchase-overdue",
      text: "PO-0001 from Label Press (invented) was due on 9 Nov 2026 and has not been marked as received.",
      href: "/backstage/stock/purchase-orders/PO-0001",
    });
    expect(
      picture.attention.find((item) => item.kind === "material-low"),
    ).toEqual({
      kind: "material-low",
      text: "Wrap label: 150 on hand. Reorder at 500.",
      href: `/backstage/stock/materials/${label.id}`,
    });
  });
});

describe("suppliers and materials", () => {
  let world: World;
  let bottlesId: string;
  let labelId: string;
  beforeAll(async () => {
    world = await openWorld();
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("keeps a supplier's details, tidied on the way in", async () => {
    const { staff, viewer, run } = world;
    const { id } = await execute(
      createSupplier,
      {
        name: "  Bottles & Co (invented)  ",
        supplies: "bottles and caps",
        contactName: "Rangi Parata",
        email: "Sales@BottlesAndCo.example",
        phone: "09 555 0142",
        website: "bottlesandco.example/trade",
        leadTimeDays: 10,
        notes: "Sells by the carton.",
      },
      staff,
      run(),
    );
    bottlesId = id;
    expect(await execute(getSupplier, { id }, viewer, run())).toMatchObject({
      name: "Bottles & Co (invented)",
      supplies: "bottles and caps",
      contactName: "Rangi Parata",
      email: "sales@bottlesandco.example",
      phone: "09 555 0142",
      website: "https://bottlesandco.example/trade",
      leadTimeDays: 10,
      notes: "Sells by the carton.",
      active: true,
      materials: 0,
      openPurchases: 0,
    });

    // The same name again, however it is typed.
    await expect(
      execute(
        createSupplier,
        { name: "bottles & co (INVENTED)" },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "There is already a supplier called bottles & co (INVENTED).",
    });
    // Things that are not what they say they are.
    for (const input of [
      { name: "" },
      { name: "X", email: "not an email" },
      { name: "X", website: "javascript:alert(1)" },
      { name: "X", website: "not a web address" },
      { name: "X", phone: "ring me" },
      { name: "X", leadTimeDays: -1 },
      { name: "X", leadTimeDays: 2.5 },
    ]) {
      await expect(
        execute(createSupplier, input, staff, run()),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(
      execute(getSupplier, { id: "sup_nobody" }, viewer, run()),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("changes what is given and leaves the rest", async () => {
    const { staff, viewer, run } = world;
    await execute(
      updateSupplier,
      { id: bottlesId, leadTimeDays: 12, phone: null },
      staff,
      run(),
    );
    const supplier = await execute(
      getSupplier,
      { id: bottlesId },
      viewer,
      run(),
    );
    expect(supplier).toMatchObject({
      leadTimeDays: 12,
      phone: null,
      email: "sales@bottlesandco.example",
      contactName: "Rangi Parata",
    });
    const history = await historyOf(world, "supplier", bottlesId);
    expect(history).toEqual([
      "Added Bottles & Co (invented) as a supplier of bottles and caps",
      "Changed Bottles & Co (invented): phone, lead time",
    ]);
    // Nothing changed, nothing written.
    await execute(
      updateSupplier,
      { id: bottlesId, leadTimeDays: 12 },
      staff,
      run(),
    );
    expect(await historyOf(world, "supplier", bottlesId)).toEqual(history);
  });

  it("stops using a supplier without losing them", async () => {
    const { staff, viewer, run } = world;
    const other = await execute(
      createSupplier,
      { name: "Carton Shed (invented)", supplies: "cartons" },
      staff,
      run(),
    );
    expect(
      await execute(
        setSupplierActive,
        { id: other.id, active: false },
        staff,
        run(),
      ),
    ).toEqual({ id: other.id, active: false });
    await execute(
      setSupplierActive,
      { id: other.id, active: false },
      staff,
      run(),
    );
    expect(await historyOf(world, "supplier", other.id)).toEqual([
      "Added Carton Shed (invented) as a supplier of cartons",
      "Stopped using Carton Shed (invented)",
    ]);

    const names = async (show: "active" | "inactive" | "all") =>
      (await execute(listSuppliers, { show }, viewer, run())).map(
        (row) => row.name,
      );
    expect(await names("active")).toEqual(["Bottles & Co (invented)"]);
    expect(await names("inactive")).toEqual(["Carton Shed (invented)"]);
    expect(await names("all")).toEqual([
      "Bottles & Co (invented)",
      "Carton Shed (invented)",
    ]);
    expect(
      (
        await execute(
          listSuppliers,
          { show: "all", q: "CARTON" },
          viewer,
          run(),
        )
      ).map((row) => row.name),
    ).toEqual(["Carton Shed (invented)"]);

    // No new purchase order for one that is switched off.
    await expect(
      execute(createPurchaseOrder, { supplierId: other.id }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("is marked as not in use"),
    });
    await execute(
      setSupplierActive,
      { id: other.id, active: true },
      staff,
      run(),
    );
    expect(await names("active")).toHaveLength(2);
  });

  it("lists materials with the ones to reorder first", async () => {
    const { staff, viewer, run } = world;
    const bottle = await execute(
      createMaterial,
      {
        name: "100 ml bottle",
        supplierId: bottlesId,
        onHand: 2000,
        reorderAt: 500,
        unitCostCents: 35,
      },
      staff,
      run(),
    );
    const label = await execute(
      createMaterial,
      { name: "Wrap label", onHand: 150, reorderAt: 500, unitCostCents: 12 },
      staff,
      run(),
    );
    labelId = label.id;
    await execute(
      createMaterial,
      { name: "Packing tape", unit: "roll", onHand: 6 },
      staff,
      run(),
    );

    const all = await execute(listMaterials, {}, viewer, run());
    expect(all.map((row) => [row.name, row.onHand, row.low])).toEqual([
      ["Wrap label", 150, true],
      ["100 ml bottle", 2000, false],
      ["Packing tape", 6, false],
    ]);
    expect(all[1]).toMatchObject({
      unit: "each",
      supplierId: bottlesId,
      supplierName: "Bottles & Co (invented)",
      reorderAt: 500,
      unitCostCents: 35,
      onOrder: 0,
    });
    expect(all[2]).toMatchObject({ unit: "roll", reorderAt: null, low: false });
    expect(
      (await execute(listMaterials, { only: "low" }, viewer, run())).map(
        (row) => row.name,
      ),
    ).toEqual(["Wrap label"]);
    expect(
      (
        await execute(listMaterials, { supplierId: bottlesId }, viewer, run())
      ).map((row) => row.id),
    ).toEqual([bottle.id]);
    expect(
      (await execute(getSupplier, { id: bottlesId }, viewer, run())).materials,
    ).toBe(1);

    // It started under its reorder level, and said so at once.
    const lows = await eventsOf(world, "material.low");
    expect(lows).toHaveLength(1);
    expect(lows[0]).toMatchObject({
      entityType: "material",
      entityId: label.id,
      payload: {
        name: "Wrap label",
        onHand: 150,
        reorderAt: 500,
        supplierId: null,
      },
    });

    await expect(
      execute(createMaterial, { name: "wrap LABEL" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "There is already a material called wrap LABEL.",
    });
    await expect(
      execute(
        createMaterial,
        { name: "Cap", supplierId: "sup_nobody" },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      execute(createMaterial, { name: "Cap", onHand: -5 }, staff, run()),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("changes the count with a reason and writes down old and new", async () => {
    const { staff, viewer, run } = world;
    expect(
      await execute(
        adjustMaterial,
        { id: labelId, counted: 120, reason: "Used on the trial run" },
        staff,
        run(),
      ),
    ).toEqual({ id: labelId, onHand: 120, change: -30 });
    expect(
      await execute(
        adjustMaterial,
        { id: labelId, change: 5, reason: "Found a part roll" },
        staff,
        run(),
      ),
    ).toEqual({ id: labelId, onHand: 125, change: 5 });
    expect(await historyOf(world, "material", labelId)).toEqual([
      "Added Wrap label to materials with 150 on hand",
      "Corrected Wrap label from 150 to 120 on hand: Used on the trial run",
      "Corrected Wrap label from 120 to 125 on hand: Found a part roll",
    ]);
    const [line] = await world.handle.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, labelId),
          eq(auditLog.operation, "stock.adjustMaterial"),
        ),
      )
      .orderBy(asc(auditLog.at));
    expect(line?.data).toEqual({ before: 150, after: 120, change: -30 });

    await expect(
      execute(
        adjustMaterial,
        { id: labelId, change: -126, reason: "Too many" },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message:
        "There are only 125 of Wrap label on hand, so 126 cannot be taken off.",
    });
    for (const input of [
      { id: labelId, counted: 100 },
      { id: labelId, counted: 100, reason: "x" },
      { id: labelId, reason: "No number" },
      { id: labelId, counted: 1, change: 1, reason: "Both at once" },
      { id: labelId, counted: -1, reason: "Below nothing" },
    ]) {
      await expect(
        execute(adjustMaterial, input as never, staff, run()),
        JSON.stringify(input),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    // The same number again is not a change.
    expect(
      await execute(
        adjustMaterial,
        { id: labelId, counted: 125, reason: "Counted, all there" },
        staff,
        run(),
      ),
    ).toEqual({ id: labelId, onHand: 125, change: 0 });
    expect(
      (await execute(getMaterial, { id: labelId }, viewer, run())).onHand,
    ).toBe(125);
    // Already under its level the whole way: said once, at the start.
    expect(await eventsOf(world, "material.low")).toHaveLength(1);

    // A count is set against what the screen showed when it was made. Ten
    // more went on while the count was under way, and the count found five
    // fewer than the screen had said: five come off, and the ten stay.
    await execute(
      adjustMaterial,
      { id: labelId, change: 10, reason: "A part roll handed back" },
      staff,
      run(),
    );
    expect(
      await execute(
        adjustMaterial,
        {
          id: labelId,
          counted: 120,
          expected: 125,
          reason: "Five short on the count",
        },
        staff,
        run(),
      ),
    ).toEqual({ id: labelId, onHand: 130, change: -5 });
    expect((await historyOf(world, "material", labelId)).at(-1)).toBe(
      "Corrected Wrap label from 135 to 130 on hand: Five short on the count",
    );
    await expect(
      execute(
        adjustMaterial,
        { id: labelId, change: 1, expected: 130, reason: "Both at once" },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: {
        expected: "The number the screen showed only goes with a count",
      },
    });
  });

  it("says a material is low at the step that takes it there", async () => {
    const { staff, viewer, run } = world;
    const [bottle] = await execute(
      listMaterials,
      { q: "bottle" },
      viewer,
      run(),
    );
    if (bottle === undefined) throw new Error("no bottle");

    // 2,000 on hand, reorder at 500: still fine at 501.
    await execute(
      adjustMaterial,
      { id: bottle.id, counted: 501, reason: "After the second run" },
      staff,
      run(),
    );
    expect(await eventsOf(world, "material.low")).toHaveLength(1);
    // "Reorder when on hand falls to this": at 500 it is time.
    await execute(
      adjustMaterial,
      { id: bottle.id, change: -1, reason: "One cracked" },
      staff,
      run(),
    );
    const lows = await eventsOf(world, "material.low");
    expect(lows).toHaveLength(2);
    expect(lows[1]?.payload).toEqual({
      name: "100 ml bottle",
      onHand: 500,
      reorderAt: 500,
      supplierId: bottlesId,
    });
    await execute(
      adjustMaterial,
      { id: bottle.id, change: -100, reason: "Used" },
      staff,
      run(),
    );
    expect(await eventsOf(world, "material.low")).toHaveLength(2);

    // Raising the level over what is on hand is the same news.
    const [tape] = await execute(listMaterials, { q: "tape" }, viewer, run());
    if (tape === undefined) throw new Error("no tape");
    await execute(
      updateMaterial,
      {
        id: tape.id,
        reorderAt: 10,
        unitCostCents: 450,
        supplierId: bottlesId,
        notes: "The wide brown sort.",
      },
      staff,
      run(),
    );
    expect(await eventsOf(world, "material.low")).toHaveLength(3);
    expect(
      await execute(getMaterial, { id: tape.id }, viewer, run()),
    ).toMatchObject({
      reorderAt: 10,
      low: true,
      unitCostCents: 450,
      supplierName: "Bottles & Co (invented)",
      notes: "The wide brown sort.",
      onHand: 6,
    });
    expect((await historyOf(world, "material", tape.id)).at(-1)).toBe(
      "Changed Packing tape: supplier Bottles & Co (invented), reorder level not set to 10, unit cost not known to $4.50, notes",
    );
    // Clearing the level switches the alert off.
    await execute(
      updateMaterial,
      { id: tape.id, reorderAt: null },
      staff,
      run(),
    );
    expect(
      (await execute(getMaterial, { id: tape.id }, viewer, run())).low,
    ).toBe(false);
  });
});

describe("purchase orders", () => {
  let world: World;
  let supplierId: string;
  let bottleId: string;
  let capId: string;
  beforeAll(async () => {
    world = await openWorld();
    const { staff, run } = world;
    supplierId = (
      await execute(
        createSupplier,
        { name: "Bottles & Co (invented)", leadTimeDays: 5 },
        staff,
        run(),
      )
    ).id;
    bottleId = (
      await execute(
        createMaterial,
        { name: "100 ml bottle", supplierId, onHand: 180, unitCostCents: 35 },
        staff,
        run(),
      )
    ).id;
    capId = (
      await execute(
        createMaterial,
        { name: "White screw cap", supplierId, onHand: 240 },
        staff,
        run(),
      )
    ).id;
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("is the state machine that was asked for", () => {
    expect(NEXT_PURCHASE_STATUS).toEqual({
      draft: ["sent", "cancelled"],
      sent: ["received", "cancelled"],
      received: [],
      cancelled: [],
    });
  });

  it("numbers them in order, even when two are started at once", async () => {
    const { staff, viewer, run } = world;
    const first = await execute(
      createPurchaseOrder,
      { supplierId },
      staff,
      run(),
    );
    expect(first.number).toBe("PO-0001");

    const together = await Promise.all([
      execute(createPurchaseOrder, { supplierId }, staff, run()),
      execute(createPurchaseOrder, { supplierId }, staff, run()),
      execute(createPurchaseOrder, { supplierId }, staff, run()),
    ]);
    expect(together.map((order) => order.number).sort()).toEqual([
      "PO-0002",
      "PO-0003",
      "PO-0004",
    ]);

    // The next number comes from the table, not from a count of rows.
    await world.handle.db
      .update(purchaseOrders)
      .set({ number: "PO-0041" })
      .where(eq(purchaseOrders.number, "PO-0004"));
    expect(
      (await execute(createPurchaseOrder, { supplierId }, staff, run())).number,
    ).toBe("PO-0042");

    const listed = await execute(listPurchaseOrders, {}, viewer, run());
    expect(listed.map((order) => order.number)).toEqual([
      "PO-0042",
      "PO-0041",
      "PO-0003",
      "PO-0002",
      "PO-0001",
    ]);
    expect(listed[0]).toMatchObject({
      status: "draft",
      supplierName: "Bottles & Co (invented)",
      lines: 0,
      totalCents: 0,
      overdue: false,
    });
    await expect(
      execute(createPurchaseOrder, { supplierId: "sup_nobody" }, staff, run()),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("takes lines that are a material or just words", async () => {
    const { staff, viewer, run } = world;
    const number = "PO-0001";
    // A material brings its own name and usual cost.
    await execute(
      addPurchaseLine,
      { number, line: { materialId: bottleId, qty: 2000 } },
      staff,
      run(),
    );
    // Or the cost can be given, and a material with none starts at nothing.
    await execute(
      addPurchaseLine,
      { number, line: { materialId: capId, qty: 2000, unitCostCents: 8 } },
      staff,
      run(),
    );
    const freight = await execute(
      addPurchaseLine,
      {
        number: "po-0001",
        line: { description: "Freight", qty: 1, unitCostCents: 4500 },
      },
      staff,
      run(),
    );
    const extra = await execute(
      addPurchaseLine,
      { number, line: { description: "Added by mistake", qty: 3 } },
      staff,
      run(),
    );

    await expect(
      execute(addPurchaseLine, { number, line: { qty: 5 } }, staff, run()),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { "line.description": "Pick a material or say what it is" },
    });
    await expect(
      execute(
        addPurchaseLine,
        { number, line: { description: "Nothing", qty: 0 } },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { "line.qty": "Order at least one" },
    });
    await expect(
      execute(
        addPurchaseLine,
        { number, line: { materialId: "mat_nothing", qty: 1 } },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    await execute(
      removePurchaseLine,
      { number, lineId: extra.lineId },
      staff,
      run(),
    );
    // Taking it off twice is not an error.
    await execute(
      removePurchaseLine,
      { number, lineId: extra.lineId },
      staff,
      run(),
    );

    const order = await execute(getPurchaseOrder, { number }, viewer, run());
    expect(order).toMatchObject({
      number,
      status: "draft",
      lines: 3,
      // 2,000 at 35c, 2,000 at 8c, and $45 of freight.
      totalCents: 70_000 + 16_000 + 4500,
      next: ["sent", "cancelled"],
      overdue: false,
      daysLate: null,
      supplier: { name: "Bottles & Co (invented)", leadTimeDays: 5 },
    });
    expect(
      order.items.map((line) => [
        line.description,
        line.qty,
        line.unitCostCents,
        line.lineCents,
        line.materialId,
      ]),
    ).toEqual([
      ["100 ml bottle", 2000, 35, 70_000, bottleId],
      ["Freight", 1, 4500, 4500, null],
      ["White screw cap", 2000, 8, 16_000, capId],
    ]);
    expect(freight.lineId).toMatch(/^pol_/);
    expect(await historyOf(world, "purchase_order", order.id)).toEqual([
      "Started PO-0001 for Bottles & Co (invented)",
      "Added 2,000 × 100 ml bottle to PO-0001",
      "Added 2,000 × White screw cap to PO-0001",
      "Added 1 × Freight to PO-0001",
      "Added 3 × Added by mistake to PO-0001",
      "Took 3 × Added by mistake off PO-0001",
    ]);

    // Lines can come with the order too.
    const withLines = await execute(
      createPurchaseOrder,
      {
        supplierId,
        expectedOn: addDays(TODAY, 14),
        notes: "Ring before delivering.",
        lines: [
          { materialId: bottleId, qty: 500 },
          { description: "Sample caps", qty: 10, unitCostCents: 0 },
        ],
      },
      staff,
      run(),
    );
    expect(
      await execute(
        getPurchaseOrder,
        { number: withLines.number },
        viewer,
        run(),
      ),
    ).toMatchObject({
      lines: 2,
      totalCents: 17_500,
      expectedOn: addDays(TODAY, 14),
      notes: "Ring before delivering.",
    });
  });

  it("marks it sent only with a yes, and says plainly that nothing is emailed", async () => {
    const { staff, viewer, run } = world;
    const number = "PO-0001";
    await expect(
      execute(
        markPurchaseSent,
        { number },
        { ...staff, confirmed: false },
        run(),
      ),
    ).rejects.toMatchObject({
      code: "needs_confirmation",
      message:
        "This marks PO-0001 as sent to the supplier. It only records that: no email goes out from here, so the order still has to be sent to them by hand.",
    });
    expect(
      (await execute(getPurchaseOrder, { number }, viewer, run())).status,
    ).toBe("draft");

    // An empty order has nothing to send.
    await expect(
      execute(markPurchaseSent, { number: "PO-0002" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message:
        "PO-0002 has nothing on it yet. Add what is being ordered first.",
    });
    await expect(
      execute(
        markPurchaseSent,
        { number, orderedOn: addDays(TODAY, 1) },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      execute(
        markPurchaseSent,
        { number, expectedOn: addDays(TODAY, -1) },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { expectedOn: "Earlier than the day it was sent" },
    });

    // Sent today, a Thursday, with five working days' lead time.
    expect(await execute(markPurchaseSent, { number }, staff, run())).toEqual({
      number,
      status: "sent",
      orderedOn: TODAY,
      expectedOn: "2026-11-19",
    });
    const sent = await eventsOf(world, "purchase.sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      entityType: "purchase_order",
      payload: {
        number,
        supplierId,
        orderedOn: TODAY,
        expectedOn: "2026-11-19",
        totalCents: 90_500,
      },
    });
    // Twice is once.
    await execute(markPurchaseSent, { number }, staff, run());
    expect(await eventsOf(world, "purchase.sent")).toHaveLength(1);
    const order = await execute(getPurchaseOrder, { number }, viewer, run());
    expect((await historyOf(world, "purchase_order", order.id)).at(-1)).toBe(
      "Marked PO-0001 as sent to Bottles & Co (invented), due 19 Nov 2026",
    );

    // What is on a sent order is settled.
    await expect(
      execute(
        addPurchaseLine,
        { number, line: { description: "One more thing", qty: 1 } },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "PO-0001 is sent, so what is on it cannot be changed.",
    });
    const firstLine = order.items[0];
    if (firstLine === undefined) throw new Error("no lines");
    await expect(
      execute(
        removePurchaseLine,
        { number, lineId: firstLine.id },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    // The date it is due can still move, and what is on order shows up.
    await execute(
      updatePurchaseOrder,
      {
        number,
        expectedOn: "2026-11-24",
        notes: "They rang: a few days late.",
      },
      staff,
      run(),
    );
    expect(
      await execute(getPurchaseOrder, { number }, viewer, run()),
    ).toMatchObject({
      expectedOn: "2026-11-24",
      notes: "They rang: a few days late.",
    });
    await expect(
      execute(
        updatePurchaseOrder,
        { number, expectedOn: addDays(TODAY, -5) },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(
      (await execute(getMaterial, { id: bottleId }, viewer, run())).onOrder,
    ).toBe(2000);
    // One sent and five drafts.
    expect(
      (await execute(getSupplier, { id: supplierId }, viewer, run()))
        .openPurchases,
    ).toBe(6);
  });

  it("is overdue once its date has passed", async () => {
    const { staff, viewer } = world;
    const later = {
      db: world.handle.db,
      now: new Date(Date.parse("2026-11-27T01:00:00Z")),
    };
    const order = await execute(
      getPurchaseOrder,
      { number: "PO-0001" },
      viewer,
      later,
    );
    expect(order).toMatchObject({ overdue: true, daysLate: 3 });
    expect(
      (
        await execute(listPurchaseOrders, { status: "sent" }, viewer, later)
      ).map((row) => [row.number, row.overdue]),
    ).toEqual([["PO-0001", true]]);
    expect(
      (await execute(listPurchaseOrders, { status: "open" }, viewer, later))
        .length,
    ).toBe(6);
    expect(
      (
        await execute(listPurchaseOrders, { materialId: capId }, viewer, later)
      ).map((row) => row.number),
    ).toEqual(["PO-0001"]);
    // The clock in this file's other tests has not moved.
    expect(staff.confirmed).toBe(true);
  });

  it("receives into the materials, once, in the same step", async () => {
    const { staff, viewer, run } = world;
    const number = "PO-0001";
    // A draft has not been sent, so it cannot have arrived.
    await expect(
      execute(markPurchaseReceived, { number: "PO-0002" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "PO-0002 is still a draft, so it cannot be marked as received.",
    });
    await expect(
      execute(
        markPurchaseReceived,
        { number, receivedOn: addDays(TODAY, 2) },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });

    const result = await execute(
      markPurchaseReceived,
      { number },
      staff,
      run(),
    );
    expect(result).toMatchObject({ number, status: "received" });
    expect(
      [...result.received].sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      {
        id: bottleId,
        name: "100 ml bottle",
        ordered: 2000,
        qty: 2000,
        onHand: 2180,
      },
      {
        id: capId,
        name: "White screw cap",
        ordered: 2000,
        qty: 2000,
        onHand: 2240,
      },
    ]);
    const onHandNow = async () =>
      (
        await world.handle.db
          .select({ name: materials.name, onHand: materials.onHand })
          .from(materials)
          .orderBy(asc(materials.name))
      ).map((row) => [row.name, row.onHand]);
    expect(await onHandNow()).toEqual([
      ["100 ml bottle", 2180],
      ["White screw cap", 2240],
    ]);
    // Each material's history has the old number and the new one.
    expect((await historyOf(world, "material", bottleId)).at(-1)).toBe(
      "100 ml bottle: 180 to 2,180 on hand, received on PO-0001",
    );
    expect((await historyOf(world, "material", capId)).at(-1)).toBe(
      "White screw cap: 240 to 2,240 on hand, received on PO-0001",
    );
    const order = await execute(getPurchaseOrder, { number }, viewer, run());
    expect(order).toMatchObject({
      status: "received",
      receivedOn: TODAY,
      next: [],
      overdue: false,
    });
    expect((await historyOf(world, "purchase_order", order.id)).at(-1)).toBe(
      "Received PO-0001 from Bottles & Co (invented)",
    );
    const received = await eventsOf(world, "purchase.received");
    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toMatchObject({
      number,
      supplierId,
      receivedOn: TODAY,
      asOrdered: true,
    });

    // Marking it again adds nothing a second time.
    expect(
      await execute(markPurchaseReceived, { number }, staff, run()),
    ).toEqual({ number, status: "received", received: [] });
    expect(await onHandNow()).toEqual([
      ["100 ml bottle", 2180],
      ["White screw cap", 2240],
    ]);
    expect(await eventsOf(world, "purchase.received")).toHaveLength(1);
    expect(
      (await execute(getMaterial, { id: bottleId }, viewer, run())).onOrder,
    ).toBe(0);

    // Nothing more happens to an order that is in.
    await expect(
      execute(cancelPurchaseOrder, { number }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "PO-0001 is already received, so it cannot be cancelled.",
    });
    await expect(
      execute(markPurchaseSent, { number }, staff, run()),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      execute(
        updatePurchaseOrder,
        { number, notes: "Too late to change" },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("cancels a draft or a sent order, and changes no count", async () => {
    const { staff, viewer, run } = world;
    expect(
      await execute(
        cancelPurchaseOrder,
        { number: "PO-0002", reason: "Not needed after all" },
        staff,
        run(),
      ),
    ).toEqual({ number: "PO-0002", status: "cancelled" });
    await execute(cancelPurchaseOrder, { number: "PO-0002" }, staff, run());
    const order = await execute(
      getPurchaseOrder,
      { number: "PO-0002" },
      viewer,
      run(),
    );
    expect(order).toMatchObject({ status: "cancelled", next: [] });
    expect(await historyOf(world, "purchase_order", order.id)).toEqual([
      "Started PO-0002 for Bottles & Co (invented)",
      "Cancelled PO-0002: Not needed after all",
    ]);

    // A sent one can be called off too; the material never arrives.
    await execute(
      addPurchaseLine,
      { number: "PO-0003", line: { materialId: bottleId, qty: 100 } },
      staff,
      run(),
    );
    await execute(markPurchaseSent, { number: "PO-0003" }, staff, run());
    await execute(cancelPurchaseOrder, { number: "PO-0003" }, staff, run());
    await expect(
      execute(markPurchaseReceived, { number: "PO-0003" }, staff, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "PO-0003 is cancelled, so it cannot be marked as received.",
    });
    expect(
      (await execute(getMaterial, { id: bottleId }, viewer, run())).onHand,
    ).toBe(2180);
    expect(
      (await eventsOf(world, "purchase.cancelled")).map(
        (event) => event.payload,
      ),
    ).toEqual([
      { number: "PO-0002", supplierId, wasSent: false },
      { number: "PO-0003", supplierId, wasSent: true },
    ]);
    await expect(
      execute(getPurchaseOrder, { number: "PO-9999" }, viewer, run()),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      execute(getPurchaseOrder, { number: "nine" }, viewer, run()),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("adds only what arrived in good order when a delivery is short or damaged", async () => {
    const { staff, viewer, run } = world;
    const { number } = await execute(
      createPurchaseOrder,
      {
        supplierId,
        lines: [
          { materialId: bottleId, qty: 500 },
          { materialId: capId, qty: 500 },
          { description: "Freight", qty: 1, unitCostCents: 2500 },
        ],
      },
      staff,
      run(),
    );
    await execute(markPurchaseSent, { number }, staff, run());
    const order = await execute(getPurchaseOrder, { number }, viewer, run());
    const bottles = order.items.find((line) => line.materialId === bottleId);
    const caps = order.items.find((line) => line.materialId === capId);
    if (bottles === undefined || caps === undefined) {
      throw new Error("the lines are missing");
    }

    // A line from somewhere else is turned away, and nothing is received.
    await expect(
      execute(
        markPurchaseReceived,
        { number, accepted: [{ lineId: "pol_nobody", qty: 1 }] },
        staff,
        run(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: `That line is not on ${number}.`,
      fields: { accepted: "Not a line on this order" },
    });
    // Whole things only, and never fewer than none.
    for (const qty of [-1, 2.5]) {
      await expect(
        execute(
          markPurchaseReceived,
          { number, accepted: [{ lineId: bottles.id, qty }] },
          staff,
          run(),
        ),
        String(qty),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(
      (await execute(getPurchaseOrder, { number }, viewer, run())).status,
    ).toBe("sent");

    // 450 of the 500 bottles were fit to use and the caps were the wrong
    // size altogether. Nothing is said about the freight.
    const result = await execute(
      markPurchaseReceived,
      {
        number,
        accepted: [
          { lineId: bottles.id, qty: 450 },
          { lineId: caps.id, qty: 0 },
        ],
      },
      staff,
      run(),
    );
    expect(
      [...result.received].sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      {
        id: bottleId,
        name: "100 ml bottle",
        ordered: 500,
        qty: 450,
        onHand: 2630,
      },
      {
        id: capId,
        name: "White screw cap",
        ordered: 500,
        qty: 0,
        onHand: 2240,
      },
    ]);
    expect(
      (await execute(getMaterial, { id: bottleId }, viewer, run())).onHand,
    ).toBe(2630);
    expect(
      (await execute(getMaterial, { id: capId }, viewer, run())).onHand,
    ).toBe(2240);
    // The bottle's history says how many of the order it was. Nothing was
    // added to the caps, so nothing is written on them.
    expect((await historyOf(world, "material", bottleId)).at(-1)).toBe(
      `100 ml bottle: 2,180 to 2,630 on hand, received on ${number} (450 of the 500 ordered)`,
    );
    expect((await historyOf(world, "material", capId)).at(-1)).toBe(
      "White screw cap: 240 to 2,240 on hand, received on PO-0001",
    );
    // And the order's own history says what was not as ordered.
    expect(
      (await historyOf(world, "purchase_order", order.id)).at(-1),
    ).toBe(
      `Received ${number} from Bottles & Co (invented). Not as ordered: 450 of 500 × 100 ml bottle, 0 of 500 × White screw cap`,
    );
    expect(
      (await eventsOf(world, "purchase.received")).at(-1)?.payload,
    ).toMatchObject({ number, asOrdered: false });

    // An order is received once. What is still to come needs a new order.
    expect(
      await execute(
        markPurchaseReceived,
        { number, accepted: [{ lineId: bottles.id, qty: 50 }] },
        staff,
        run(),
      ),
    ).toEqual({ number, status: "received", received: [] });
    expect(
      (await execute(getMaterial, { id: bottleId }, viewer, run())).onHand,
    ).toBe(2630);
  });
});

describe("who may do what", () => {
  let world: World;
  let supplierId: string;
  let materialId: string;
  let order: string;
  beforeAll(async () => {
    world = await openWorld();
    const { staff, run } = world;
    await makeBatch(world, "B001", 100);
    await makeBatch(world, "B002", 100, { upTo: "planned" });
    supplierId = (
      await execute(createSupplier, { name: "Supplier" }, staff, run())
    ).id;
    materialId = (
      await execute(createMaterial, { name: "Material" }, staff, run())
    ).id;
    await execute(
      createPurchaseOrder,
      { supplierId, lines: [{ materialId, qty: 1 }] },
      staff,
      run(),
    );
    order = await buy(world, 6);
    await execute(markPacked, { number: order }, staff, run());
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("lets a viewer read all of it", async () => {
    const { viewer, run } = world;
    expect((await execute(stockPicture, {}, viewer, run())).ready).toBe(94);
    expect(
      (await execute(stockAvailable, {}, viewer, run())).available,
    ).toBe(94);
    expect(await execute(listBatches, {}, viewer, run())).toHaveLength(2);
    expect(
      (await execute(getBatch, { code: "B001" }, viewer, run())).onHand,
    ).toBe(94);
    expect(await execute(suggestBatchCode, {}, viewer, run())).toEqual({
      code: "B003",
    });
    expect(
      (await execute(recallList, { code: "B001" }, viewer, run())).orders,
    ).toHaveLength(1);
    expect(
      (await execute(orderStock, { number: order }, viewer, run())).filled,
    ).toHaveLength(1);
    expect(await execute(listOrdersWithoutBatch, {}, viewer, run())).toEqual(
      [],
    );
    expect(await execute(listSuppliers, {}, viewer, run())).toHaveLength(1);
    expect(
      (await execute(getSupplier, { id: supplierId }, viewer, run())).name,
    ).toBe("Supplier");
    expect(await execute(listMaterials, {}, viewer, run())).toHaveLength(1);
    expect(
      (await execute(getMaterial, { id: materialId }, viewer, run())).name,
    ).toBe("Material");
    expect(await execute(listPurchaseOrders, {}, viewer, run())).toHaveLength(
      1,
    );
    expect(
      (await execute(getPurchaseOrder, { number: "PO-0001" }, viewer, run()))
        .lines,
    ).toBe(1);
  });

  it("refuses a viewer every change, and changes nothing", async () => {
    const { viewer, run } = world;
    const attempts: readonly (() => Promise<unknown>)[] = [
      () => execute(planBatch, { code: "B009" }, viewer, run()),
      () => execute(updateBatch, { code: "B001", name: "Mine" }, viewer, run()),
      () => execute(recordMade, { code: "B002", shots: 5 }, viewer, run()),
      () => execute(releaseBatch, { code: "B002" }, viewer, run()),
      () =>
        execute(closeBatch, { code: "B001", writeOff: true }, viewer, run()),
      () =>
        execute(
          recallBatch,
          { code: "B001", reason: "Because" },
          viewer,
          run(),
        ),
      () => execute(recordSample, { code: "B001", shots: 1 }, viewer, run()),
      () =>
        execute(
          recordWaste,
          { code: "B001", shots: 1, why: "damaged" },
          viewer,
          run(),
        ),
      () =>
        execute(
          adjustCount,
          { code: "B001", counted: 1, reason: "Because" },
          viewer,
          run(),
        ),
      () => execute(recordOrderBatch, { number: order }, viewer, run()),
      () => execute(createSupplier, { name: "Another" }, viewer, run()),
      () =>
        execute(
          updateSupplier,
          { id: supplierId, name: "Mine" },
          viewer,
          run(),
        ),
      () =>
        execute(
          setSupplierActive,
          { id: supplierId, active: false },
          viewer,
          run(),
        ),
      () => execute(createMaterial, { name: "Another" }, viewer, run()),
      () =>
        execute(
          updateMaterial,
          { id: materialId, name: "Mine" },
          viewer,
          run(),
        ),
      () =>
        execute(
          adjustMaterial,
          { id: materialId, counted: 9, reason: "Because" },
          viewer,
          run(),
        ),
      () => execute(createPurchaseOrder, { supplierId }, viewer, run()),
      () =>
        execute(
          updatePurchaseOrder,
          { number: "PO-0001", notes: "Mine" },
          viewer,
          run(),
        ),
      () =>
        execute(
          addPurchaseLine,
          { number: "PO-0001", line: { description: "More", qty: 1 } },
          viewer,
          run(),
        ),
      () =>
        execute(
          removePurchaseLine,
          { number: "PO-0001", lineId: "pol_x" },
          viewer,
          run(),
        ),
      () => execute(markPurchaseSent, { number: "PO-0001" }, viewer, run()),
      () => execute(markPurchaseReceived, { number: "PO-0001" }, viewer, run()),
      () => execute(cancelPurchaseOrder, { number: "PO-0001" }, viewer, run()),
      () => execute(markPacked, { number: order, undo: true }, viewer, run()),
    ];
    // Every write the area has is on this list.
    expect(attempts).toHaveLength(
      STOCK_OPS.filter((op) => op.access !== "read").length + 1,
    );
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({
        code: "forbidden",
        message: "Your account can look but not change things.",
      });
    }
    expect((await execute(stockPicture, {}, viewer, run())).ready).toBe(94);
    expect(await execute(listBatches, {}, viewer, run())).toHaveLength(2);
    expect(
      (await execute(getPurchaseOrder, { number: "PO-0001" }, viewer, run()))
        .status,
    ).toBe("draft");
  });

  it("asks for a yes before anything outward or that cannot be undone", async () => {
    const { staff, owner, viewer, run } = world;
    const unsure = (caller: Caller): Caller => ({
      ...caller,
      confirmed: false,
    });
    for (const caller of [unsure(staff), unsure(owner)]) {
      await expect(
        execute(
          recallBatch,
          { code: "B001", reason: "Something is wrong" },
          caller,
          run(),
        ),
      ).rejects.toMatchObject({ code: "needs_confirmation" });
      await expect(
        execute(markPurchaseSent, { number: "PO-0001" }, caller, run()),
      ).rejects.toMatchObject({ code: "needs_confirmation" });
    }
    // A viewer is told no before being asked whether they are sure.
    await expect(
      execute(
        recallBatch,
        { code: "B001", reason: "Something is wrong" },
        unsure(viewer),
        run(),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (await execute(getBatch, { code: "B001" }, viewer, run())).status,
    ).toBe("released");

    // Everything else in stock stays inside the back end and needs no yes.
    const needYes = STOCK_OPS.filter((op) => op.effect !== "none").map(
      (op) => `${op.name}: ${op.effect}`,
    );
    expect(needYes).toEqual([
      "stock.recallBatch: destructive",
      "stock.markPurchaseSent: outward",
    ]);
    for (const op of STOCK_OPS) {
      if (op.effect !== "none")
        expect(op.explain, op.name).toBeTypeOf("function");
    }
  });
});

describe("the operations, as a caller who cannot see the code meets them", () => {
  it("each has a name of its own and says what it does", () => {
    const names = STOCK_OPS.map((op) => op.name);
    expect(new Set(names).size).toBe(names.length);
    for (const op of STOCK_OPS) {
      expect(op.name, op.name).toMatch(/^stock\.[a-z][a-zA-Z]+$/);
      expect(op.title.length, op.name).toBeGreaterThan(8);
      expect(op.description.length, op.name).toBeGreaterThan(80);
      // The long dash reads as machine-written; none in words a person reads.
      expect(`${op.title} ${op.description}`, op.name).not.toMatch(/[—–]/);
    }
  });

  it("each can be described without the code, input and all", () => {
    for (const op of STOCK_OPS) {
      const described = describeOp(op);
      expect(described.name).toBe(op.name);
      expect(described.input, op.name).toMatchObject({ type: "object" });
    }
    // The steps in an order's life that move stock say how, since bots
    // read that too.
    expect(describeOp(markPacked).description).toMatch(/batchCode/);
    expect(describeOp(markPacked).description).toMatch(/batches/);
    expect(describeOp(cancelOrder).description).toMatch(/restock/);
  });
});

describe("the invented stock a demo starts with", () => {
  const NOW = new Date(START);

  it("goes into an empty database, and only once", async () => {
    const handle = await openEmbedded();
    try {
      const demo = systemCaller("Test", "script");
      const at = { db: handle.db, now: NOW };
      await seedStockDemo(handle.db, NOW);

      const batches = await execute(listBatches, {}, demo, at);
      expect(
        batches.map((batch) => [batch.code, batch.status, batch.onHand]),
      ).toEqual([
        ["B004", "planned", 0],
        ["B003", "released", 600],
        ["B002", "released", 210],
        ["B001", "closed", 0],
      ]);
      const suppliers = await execute(listSuppliers, {}, demo, at);
      expect(suppliers).toHaveLength(3);
      // Nobody could mistake them for real companies.
      for (const supplier of suppliers) {
        expect(supplier.name).toMatch(/\(invented\)$/);
        expect(supplier.email ?? "x@y.example").toMatch(/\.example$/);
      }
      const materialRows = await execute(listMaterials, {}, demo, at);
      expect(materialRows).toHaveLength(5);
      expect(
        materialRows.filter((row) => row.low).map((row) => row.name),
      ).toEqual(["Wrap label"]);
      expect(
        materialRows.find((row) => row.name === "Wrap label")?.onOrder,
      ).toBe(3000);
      expect(
        materialRows.find((row) => row.name === "100 ml bottle")?.onHand,
      ).toBe(2180);

      const purchases = await execute(listPurchaseOrders, {}, demo, at);
      expect(
        purchases.map((row) => [row.number, row.status, row.overdue]),
      ).toEqual([
        ["PO-0002", "sent", true],
        ["PO-0001", "received", false],
      ]);

      const picture = await execute(stockPicture, {}, demo, at);
      expect(picture).toMatchObject({
        tracking: true,
        ready: 810,
        planned: 1,
        noBatchRecorded: 0,
      });
      expect(picture.attention.map((item) => item.kind)).toEqual([
        "purchase-overdue",
        "near-best-before",
        "material-low",
      ]);

      // A second go finds stock already there and leaves it alone.
      await seedStockDemo(handle.db, NOW);
      expect(await execute(listBatches, {}, demo, at)).toHaveLength(4);
      expect(await execute(listSuppliers, {}, demo, at)).toHaveLength(3);
    } finally {
      await handle.close();
    }
  });

  it("gives the demo orders that are already packed or gone their batch", async () => {
    const handle = await openEmbedded();
    try {
      const demo = systemCaller("Test", "script");
      const at = { db: handle.db, now: NOW };
      await seedDemoOrders(handle.db, NOW);
      await seedStockDemo(handle.db, NOW);

      const gone = [
        ...(await execute(listOrders, { status: "packed" }, demo, at)),
        ...(await execute(listOrders, { status: "shipped" }, demo, at)),
        ...(await execute(listOrders, { status: "delivered" }, demo, at)),
      ];
      expect(gone.length).toBeGreaterThan(0);
      for (const order of gone) {
        const stock = await execute(
          orderStock,
          { number: order.number },
          demo,
          at,
        );
        expect(stock.missing, order.number).toBe(0);
        expect(
          stock.filled.reduce((sum, row) => sum + row.shots, 0),
          order.number,
        ).toBe(order.shots);
      }
      expect(await execute(listOrdersWithoutBatch, {}, demo, at)).toEqual([]);

      const sold = gone.reduce((sum, order) => sum + order.shots, 0);
      const toPack = (
        await execute(listOrders, { status: "paid" }, demo, at)
      ).filter((order) => !order.isTest);
      expect(toPack.length).toBeGreaterThan(0);
      const promised = toPack.reduce((sum, order) => sum + order.shots, 0);
      const picture = await execute(stockPicture, {}, demo, at);
      expect(picture).toMatchObject({
        ready: 810 - sold,
        promised,
        available: 810 - sold - promised,
        pastDate: 0,
        noBatchRecorded: 0,
      });

      // Two batches are on sale, so each order to pack asks which is in the
      // box and suggests the older run. Taking the suggestion works.
      for (const order of toPack) {
        const stock = await execute(
          orderStock,
          { number: order.number },
          demo,
          at,
        );
        expect(stock, order.number).toMatchObject({
          mustChoose: true,
          blocked: false,
          plan: [{ code: "B002", shots: order.shots }],
        });
        expect(stock.choices.map((choice) => choice.code)).toEqual([
          "B002",
          "B003",
        ]);
      }
      const [first] = toPack;
      if (first === undefined) throw new Error("no order to pack");
      await expect(
        execute(markPacked, { number: first.number }, demo, at),
      ).rejects.toMatchObject({ code: "conflict" });
      await execute(
        markPacked,
        { number: first.number, batchCode: "B002" },
        demo,
        at,
      );

      const list = await execute(recallList, { code: "B002" }, demo, at);
      expect(list.totals.orders).toBe(gone.length + 1);
      expect(list.noBatchRecorded).toBe(0);
      expect(list.balance.addsUp).toBe(true);
    } finally {
      await handle.close();
    }
  });
});
