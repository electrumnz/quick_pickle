import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { seedDemoData } from "@/lib/backstage/demo";
import { countOrders, listOrders } from "@/lib/backstage/orders/ops";
import { needsYou } from "@/lib/backstage/today/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";

/**
 * The invented records a deployment with no database starts with. They go in
 * through the real operations, so a record the operations refuse stops the
 * server from starting at all. That is caught here, not on a preview.
 */
describe("the demo records", () => {
  let handle: DbHandle;
  const viewer = systemCaller("A test", "script");

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    await seedDemoData(handle.db);
  });
  afterAll(async () => {
    await closeDb();
  });

  it("all go in, with numbers a real order could have", async () => {
    const orders = await execute(
      listOrders,
      { status: "all", limit: 100 },
      viewer,
    );
    expect(orders.length).toBeGreaterThanOrEqual(10);
    for (const order of orders) {
      expect(order.number).toMatch(ORDER_NUMBER_PATTERN);
    }
  });

  it("leave something in every part of the day's work", async () => {
    const counts = await execute(countOrders, {}, viewer);
    expect(counts.paid).toBeGreaterThan(0);
    expect(counts.packed).toBeGreaterThan(0);
    expect(counts.shipped).toBeGreaterThan(0);
  });

  it("include one thing that needs a person, so that list is never a blank on a demo", async () => {
    const needs = await execute(needsYou, {}, viewer);
    // The payment that came in short is first: money is waiting on it.
    expect(needs[0]).toMatchObject({
      key: "payment-review:QP-SHRT55",
      urgent: true,
      href: "/backstage/orders/QP-SHRT55",
    });
    // Marketing's own waiting list is there too, after it.
    expect(needs.some((need) => need.key.startsWith("marketing-"))).toBe(true);
  });
});
