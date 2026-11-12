import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mailMessages } from "@/db/schema";
import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { seedDemoData } from "@/lib/backstage/demo";
import { listOrderEmails } from "@/lib/backstage/orders/emails";
import { countOrders, listOrders } from "@/lib/backstage/orders/ops";
import { stockPicture } from "@/lib/backstage/stock/ops";
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
    // Every area's demo, a few hundred operations: slow on a busy machine.
  }, 60_000);
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
    // And stock's: the labels that are late, and the run getting near its
    // date. Neither is money or a customer waiting, so neither comes first.
    const stock = needs.filter((need) => need.key.startsWith("stock-"));
    expect(stock.map((need) => [need.key, need.urgent])).toEqual([
      ["stock-purchase-overdue", false],
      ["stock-near-best-before", false],
    ]);
  });

  it("show the emails each order would have sent, every one written down and none sent", async () => {
    const said = async (number: string) =>
      (await execute(listOrderEmails, { number }, viewer)).map((email) => [
        email.label,
        email.status,
        email.why,
      ]);
    const invented =
      "This back end is running on invented records, which never sends email.";
    // Shipped: a receipt, then the email that it is on the courier.
    expect(await said("QP-SENT66")).toEqual([
      ["Receipt", "not_sent", invented],
      ["On the courier", "not_sent", invented],
    ]);
    // Cancelled after paying.
    expect(await said("QP-NAHH88")).toEqual([
      ["Receipt", "not_sent", invented],
      ["Cancelled", "not_sent", invented],
    ]);
    // Still waiting to be paid for: there is nothing true to send yet.
    expect(await said("QP-WAYT99")).toEqual([]);
    // The practice checkout's order gets no receipt, and says why.
    expect(await said("QP-TEST22")).toEqual([
      [
        "Receipt",
        "not_sent",
        "A test order: nobody was charged, so there is no receipt to send.",
      ],
    ]);
    // And across every order in the demo, nothing at all has gone anywhere.
    const all = await handle.db
      .select({ status: mailMessages.status, to: mailMessages.toAddresses })
      .from(mailMessages);
    expect(all.length).toBeGreaterThan(10);
    expect(new Set(all.map((row) => row.status))).toEqual(
      new Set(["not_sent"]),
    );
    for (const row of all) {
      expect(row.to.join(",")).toMatch(/@example\.co\.nz$/);
    }
  });

  it("put stock on the shelf, and give every box already packed its batch", async () => {
    const picture = await execute(stockPicture, {}, viewer);
    expect(picture.tracking).toBe(true);
    // Stock goes in after the orders, and writes down which batch each
    // packed or sent one came from: none is left off the recall list.
    expect(picture.noBatchRecorded).toBe(0);
    // What is waiting to be packed is covered, with some left to sell.
    expect(picture.promised).toBeGreaterThan(0);
    expect(picture.available).toBeGreaterThan(0);
    expect(picture.pastDate).toBe(0);
  });
});
