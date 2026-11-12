import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mailMessages } from "@/db/schema";
import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { seedDemoData } from "@/lib/backstage/demo";
import {
  countConversations,
  getConversation,
  listConversations,
  listTemplates,
  type InboxTab,
} from "@/lib/backstage/mail/ops";
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
    // And across every email of ours in the demo, nothing at all has gone
    // anywhere. (A draft has not been sent either: it is not a message yet.)
    const ours = await handle.db
      .select({ status: mailMessages.status, to: mailMessages.toAddresses })
      .from(mailMessages)
      .where(eq(mailMessages.direction, "out"));
    expect(ours.length).toBeGreaterThan(10);
    expect(new Set(ours.map((row) => row.status))).toEqual(
      new Set(["not_sent", "draft"]),
    );
    for (const row of ours) {
      expect(row.to.join(",")).toMatch(/@example\.co\.nz$/);
    }
  });

  it("put something in every pile of the inbox, from people who are made up", async () => {
    const pile = async (tab: InboxTab) =>
      (await execute(listConversations, { tab, limit: 200 }, viewer)).map(
        (row) => row.subject,
      );
    expect((await pile("needs-reply")).sort()).toEqual([
      "Change of address",
      "Delivery for the club",
      "Where is my order?",
      "Wholesale for our club",
    ]);
    expect(await pile("done")).toEqual(["Has my order left yet?"]);
    expect(await pile("spam")).toEqual(["A new website for half the price"]);
    // A courier's notice, and the emails the orders themselves wrote.
    const notices = await pile("notices");
    expect(notices).toContain("Your parcel LZ8011558011NZ is on its way");
    expect(notices.length).toBeGreaterThan(5);
    expect(await execute(countConversations, {}, viewer)).toMatchObject({
      "needs-reply": 4,
      waiting: 0,
      trouble: 0,
      snoozed: 0,
      done: 1,
      spam: 1,
    });

    // Everybody who wrote in is invented.
    const received = await handle.db
      .select({ from: mailMessages.fromAddress })
      .from(mailMessages)
      .where(eq(mailMessages.direction, "in"));
    expect(received).toHaveLength(8);
    for (const row of received) {
      expect(row.from).toMatch(/@(?:[a-z]+\.)?example\.co\.nz$/);
    }
    // The starter replies are there to try, and today says mail is waiting
    // without calling it urgent: none of it is two working days old.
    expect(await execute(listTemplates, {}, viewer)).toHaveLength(5);
    const needs = await execute(needsYou, {}, viewer);
    expect(
      needs.find((need) => need.key === "inbox-needs-reply"),
    ).toMatchObject({
      urgent: false,
      title: "4 emails are waiting for a reply",
      href: "/backstage/inbox",
    });
  });

  it("show each way an email finds its conversation", async () => {
    const open = async (subject: string) => {
      const [row] = (
        await execute(listConversations, { tab: "all", limit: 200 }, viewer)
      ).filter((each) => each.subject === subject);
      if (row === undefined) throw new Error(`no conversation "${subject}"`);
      return execute(getConversation, { id: row.id }, viewer);
    };

    // A follow-up joins what it answers.
    const priya = await open("Has my order left yet?");
    expect(priya.messages.map((message) => message.threadedBy)).toEqual([
      "new",
      "headers",
    ]);
    expect(priya.contact?.customer?.name).toBe("Priya Nair");

    // The customer who placed the order is tied to it and to themselves.
    const liam = await open("Where is my order?");
    expect(
      liam.links.map((link) => `${link.kind} ${link.label}`).sort(),
    ).toEqual(["Customer Liam Carter", "Order QP-SENT66"]);
    expect(liam.orders).toMatchObject([{ number: "QP-SENT66", theirs: true }]);

    // Somebody else quoting that order is linked to it and kept apart.
    const moana = await open("Delivery for the club");
    expect(moana.id).not.toBe(liam.id);
    expect(moana.contact?.customer).toBeNull();
    expect(moana.links.map((link) => `${link.kind} ${link.label}`)).toEqual([
      "Order QP-SENT66",
    ]);
    expect(moana.orders).toMatchObject([{ theirs: false }]);
    expect(moana.messages[0]?.threadedReason).toContain(
      "which is not this sender's own, so it was linked and kept apart",
    );

    // A courier's notice finds the order by its tracking number.
    const courier = await open("Your parcel LZ8011558011NZ is on its way");
    expect(courier.status).toBe("done");
    expect(courier.messages[0]).toMatchObject({
      kind: "bulk",
      automated: true,
    });
    expect(courier.links.map((link) => link.label)).toEqual(["QP-SENT66"]);

    // A reply started from a saved one, with the name filled in, not sent.
    const kahu = await open("Wholesale for our club");
    expect(kahu.messages).toHaveLength(1);
    expect(kahu.draft?.body).toMatch(/^Hi Kahu,/);
    expect(kahu.draft?.body).not.toContain("{{");

    // The email that came as markup is words, and only words.
    const aroha = await open("Change of address");
    expect(aroha.messages[0]).toMatchObject({ fromHtml: true });
    const words = aroha.messages[0]?.text.map((part) => part.text).join("\n");
    expect(words).toContain("can I change the address on QP-PACK44?");
    expect(JSON.stringify(aroha)).not.toMatch(
      /<\/?[a-z]|pixel\.example|changed by an email/i,
    );
    expect(aroha.links.map((link) => link.label)).toContain("QP-PACK44");
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
