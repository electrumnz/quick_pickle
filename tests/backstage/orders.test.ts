import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditLog,
  crewMembers,
  customers,
  events,
  orders,
  users,
} from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { joinCrew, leaveCrew, listCrew } from "@/lib/backstage/crew/ops";
import {
  getCustomer,
  listCustomers,
  updateCustomer,
} from "@/lib/backstage/customers/ops";
import {
  addOrderNote,
  cancelOrder,
  countOrders,
  getOrder,
  listOrders,
  markDelivered,
  markPacked,
  markShipped,
  recordOrder,
  recordRefund,
  updateDelivery,
} from "@/lib/backstage/orders/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import type { PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { getStore } from "@/lib/shop/store";

const shop = systemCaller("The shop", "storefront");

const form = (over: Record<string, unknown> = {}) => ({
  email: "Sam@Example.co.nz",
  phone: "",
  firstName: "Sam",
  lastName: "Tester",
  line1: "12 Sideline Road",
  line2: "",
  suburb: "",
  city: "Ōtaki",
  region: "Wellington",
  postcode: "5512",
  rural: true,
  notes: "",
  joinCrew: true,
  lines: [{ sku: "QP-SHOT-24", qty: 1 }],
  ...over,
});

const provider = (status: "test" | "paid"): PaymentProvider => ({
  name: status === "test" ? "test" : "fake",
  isTest: status === "test",
  savesFirst: false,
  begin: async (request) => ({
    kind: "done",
    payment: {
      provider: status === "test" ? "test" : "fake",
      status,
      reference: `REF-${request.orderNumber}`,
    },
  }),
});

describe("orders, from the checkout to the doorstep", () => {
  let handle: DbHandle;
  let staff: Caller;
  let viewer: Caller;
  let first: string;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const make = async (role: "staff" | "viewer"): Promise<Caller> => {
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
    staff = await make("staff");
    viewer = await make("viewer");
  });
  afterAll(async () => {
    await closeDb();
  });

  const buy = async (
    over: Record<string, unknown> = {},
    pay: "test" | "paid" = "paid",
  ) => {
    const result = await placeOrder(form(over), {
      payments: provider(pay),
      store: getStore({ NODE_ENV: "test" }),
    });
    if (!result.ok) throw new Error(`order failed: ${JSON.stringify(result)}`);
    return result.order.number;
  };

  it("an order placed in the shop lands in the back end, whole", async () => {
    first = await buy();
    const order = await execute(getOrder, { number: first }, viewer);

    expect(order).toMatchObject({
      number: first,
      status: "paid",
      paymentStatus: "paid",
      isTest: false,
      email: "sam@example.co.nz",
      city: "Ōtaki",
      rural: true,
      subtotalCents: 8400,
      // Over the free-delivery line, so only the rural extra.
      shippingCents: 450,
      totalCents: 8850,
      shots: 24,
      next: ["packed", "shipped", "cancelled"],
    });
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({
      sku: "QP-SHOT-24",
      name: "The Squad",
      qty: 1,
    });

    // A customer was made, and they joined the crew with their consent on file.
    const [customer] = await handle.db.select().from(customers);
    expect(customer).toMatchObject({
      email: "sam@example.co.nz",
      firstName: "Sam",
    });
    expect(order.customerId).toBe(customer?.id);
    const [member] = await handle.db.select().from(crewMembers);
    expect(member).toMatchObject({
      email: "sam@example.co.nz",
      status: "subscribed",
      source: "checkout",
      customerId: customer?.id,
    });
    expect(member?.consentText).toMatch(/Pickle Crew/);
    expect(member?.unsubscribeToken.length).toBeGreaterThan(20);

    // It is in the activity log as the shop's doing, and two events wait.
    const [line] = await handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, order.id));
    expect(line).toMatchObject({
      actorType: "system",
      actorName: "The shop",
      via: "storefront",
    });
    expect(line?.summary).toBe(
      `New order ${first}: 1 × The Squad, $88.50, for Sam Tester in Ōtaki`,
    );
    const types = (
      await handle.db.select().from(events).where(eq(events.entityId, order.id))
    ).map((event) => event.type);
    expect(types.sort()).toEqual(["order.paid", "order.placed"]);
  });

  it("a second order from the same address is the same customer", async () => {
    await buy({
      lines: [{ sku: "QP-SHOT-06", qty: 2 }],
      rural: false,
      joinCrew: false,
    });
    expect(await handle.db.select().from(customers)).toHaveLength(1);
    const [customer] = await execute(listCustomers, {}, viewer);
    expect(customer).toMatchObject({ orders: 2, name: "Sam Tester" });
    // $88.50 + (2 × $27 + $7 delivery)
    expect(customer?.spentCents).toBe(8850 + 6100);
  });

  it("a test order is kept apart from real money", async () => {
    const number = await buy(
      { email: "tess@example.co.nz", firstName: "Tess" },
      "test",
    );
    const order = await execute(getOrder, { number }, viewer);
    expect(order).toMatchObject({
      isTest: true,
      paymentStatus: "test",
      status: "paid",
    });
    const tess = await execute(
      getCustomer,
      { email: "tess@example.co.nz" },
      viewer,
    );
    expect(tess).toMatchObject({
      orders: 1,
      spentCents: 0,
      crew: "subscribed",
    });
  });

  it("refuses an order whose sums do not add up", async () => {
    await expect(
      execute(
        recordOrder,
        {
          number: "QP-ABCDEF",
          placedAt: new Date(),
          mode: "preorder",
          customer: {
            email: "x@example.co.nz",
            phone: null,
            firstName: "X",
            lastName: "Y",
          },
          delivery: {
            line1: "1 Road",
            line2: null,
            suburb: null,
            city: "Levin",
            region: "Manawatū-Whanganui",
            postcode: "5510",
            rural: false,
            notes: null,
          },
          lines: [
            {
              sku: "QP-SHOT-06",
              name: "The Trial",
              shots: 6,
              qty: 1,
              unitCents: 2700,
              lineCents: 2700,
            },
          ],
          subtotalCents: 2700,
          shippingCents: 700,
          totalCents: 100,
          currency: "NZD",
          payment: { provider: "fake", status: "paid", reference: "R" },
          joinCrew: false,
        },
        shop,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("finds orders by number, name, email and town, macrons and all", async () => {
    for (const q of [
      first,
      first.toLowerCase(),
      "sam tester",
      "SAM@EXAMPLE",
      "ōtaki",
    ]) {
      const found = await execute(listOrders, { q }, viewer);
      expect(
        found.map((row) => row.number),
        q,
      ).toContain(first);
    }
    expect(await execute(listOrders, { q: "nobody at all" }, viewer)).toEqual(
      [],
    );
    // A percent sign is a character, not a wildcard.
    expect(await execute(listOrders, { q: "%" }, viewer)).toEqual([]);

    const open = await execute(listOrders, { status: "open" }, viewer);
    expect(open).toHaveLength(3);
    expect(open[0]?.items).toMatch(/×/);
    expect(await execute(countOrders, {}, viewer)).toMatchObject({
      paid: 3,
      open: 3,
      shipped: 0,
    });
  });

  it("moves along one stage at a time and refuses to skip backwards", async () => {
    await expect(
      execute(markDelivered, { number: first }, staff),
    ).rejects.toMatchObject({ code: "conflict" });

    expect(await execute(markPacked, { number: first }, staff)).toEqual({
      status: "packed",
    });
    // Packing twice is not an error and does not write a second line.
    await execute(markPacked, { number: first }, staff);
    expect(
      await execute(markPacked, { number: first, undo: true }, staff),
    ).toEqual({ status: "paid" });
    await execute(markPacked, { number: first }, staff);

    // The address can still be corrected before it leaves.
    await execute(
      updateDelivery,
      {
        number: first,
        line1: "14 Sideline Road",
        city: "Ōtaki",
        region: "Wellington",
        postcode: "5512",
      },
      staff,
    );

    // Shipping tells the customer, so it needs a yes.
    await expect(
      execute(markShipped, { number: first }, { ...staff, confirmed: false }),
    ).rejects.toMatchObject({
      code: "needs_confirmation",
      message: expect.stringContaining("tells the customer"),
    });
    await expect(
      execute(
        markShipped,
        { number: first, trackingUrl: "javascript:alert(1)" },
        staff,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await execute(
      markShipped,
      {
        number: first,
        carrier: "NZ Post",
        trackingNumber: "LZ123456789NZ",
        trackingUrl:
          "https://www.nzpost.co.nz/tools/tracking?trackid=LZ123456789NZ",
      },
      staff,
    );
    const shipped = await execute(getOrder, { number: first }, viewer);
    expect(shipped).toMatchObject({
      status: "shipped",
      carrier: "NZ Post",
      line1: "14 Sideline Road",
      next: ["delivered"],
    });
    expect(shipped.shippedAt).toBeInstanceOf(Date);

    // Once it has gone it cannot be cancelled, unpacked or re-addressed.
    await expect(
      execute(
        cancelOrder,
        { number: first, reason: "changed their mind" },
        staff,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      execute(markPacked, { number: first, undo: true }, staff),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      execute(
        updateDelivery,
        {
          number: first,
          line1: "1 Elsewhere",
          city: "Levin",
          region: "Wellington",
          postcode: "5510",
        },
        staff,
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    await execute(markDelivered, { number: first }, staff);
    expect((await execute(getOrder, { number: first }, viewer)).next).toEqual(
      [],
    );

    const history = await handle.db
      .select({ summary: auditLog.summary })
      .from(auditLog)
      .where(eq(auditLog.entityId, shipped.id))
      .orderBy(desc(auditLog.at), desc(auditLog.id));
    const summaries = history.map((row) => row.summary);
    expect(summaries).toContain(
      `Shipped ${first} with NZ Post, tracking LZ123456789NZ`,
    );
    expect(summaries).toContain(`${first} was delivered`);
    expect(
      summaries.filter((summary) => summary === `Packed ${first}`),
    ).toHaveLength(2);
  });

  it("a viewer can read every order and change none", async () => {
    for (const attempt of [
      execute(markPacked, { number: first }, viewer),
      execute(addOrderNote, { number: first, note: "hello" }, viewer),
      execute(cancelOrder, { number: first, reason: "no reason" }, viewer),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("gives back no more than was paid", async () => {
    const number = await buy({
      email: "rae@example.co.nz",
      firstName: "Rae",
      joinCrew: false,
    });
    await expect(
      execute(
        recordRefund,
        { number, amountCents: 99_999, reason: "too much" },
        staff,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await execute(
      recordRefund,
      { number, amountCents: 2000, reason: "one bottle leaked" },
      staff,
    );
    expect(await execute(getOrder, { number }, viewer)).toMatchObject({
      refundedCents: 2000,
      paymentStatus: "part_refunded",
    });
    await execute(
      recordRefund,
      { number, amountCents: 6850, reason: "the rest" },
      staff,
    );
    const order = await execute(getOrder, { number }, viewer);
    expect(order).toMatchObject({
      refundedCents: 8850,
      paymentStatus: "refunded",
    });
    expect(order.refunds).toHaveLength(2);
    await expect(
      execute(
        recordRefund,
        { number, amountCents: 1, reason: "one more cent" },
        staff,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });

    // What they spent goes down with it.
    const rae = await execute(
      getCustomer,
      { email: "rae@example.co.nz" },
      viewer,
    );
    expect(rae.spentCents).toBe(0);
  });

  it("cancelling takes an order out of the queue and out of the takings", async () => {
    const number = await buy({
      email: "cal@example.co.nz",
      firstName: "Cal",
      joinCrew: false,
    });
    await expect(
      execute(cancelOrder, { number, reason: "x" }, staff),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await execute(
      cancelOrder,
      { number, reason: "ordered twice by mistake" },
      staff,
    );
    const order = await execute(getOrder, { number }, viewer);
    expect(order).toMatchObject({
      status: "cancelled",
      cancelReason: "ordered twice by mistake",
    });
    const open = await execute(listOrders, { status: "open" }, viewer);
    expect(open.map((row) => row.number)).not.toContain(number);
    expect(
      (await execute(getCustomer, { email: "cal@example.co.nz" }, viewer))
        .spentCents,
    ).toBe(0);
  });

  it("keeps notes and tags on a customer tidy", async () => {
    const sam = await execute(
      getCustomer,
      { email: "sam@example.co.nz" },
      viewer,
    );
    await execute(
      updateCustomer,
      {
        id: sam.id,
        tags: ["Club Captain", "wholesale lead", "club captain"],
        notes: "Buys for the whole side.",
      },
      staff,
    );
    const after = await execute(getCustomer, { id: sam.id }, viewer);
    expect(after.tags).toEqual(["club captain", "wholesale lead"]);
    expect(after.notes).toBe("Buys for the whole side.");
    expect(
      (await execute(listCustomers, { tag: "club captain" }, viewer)).map(
        (row) => row.email,
      ),
    ).toEqual(["sam@example.co.nz"]);
    expect(
      (await execute(listCustomers, { q: "wholesale" }, viewer)).map(
        (row) => row.email,
      ),
    ).toEqual(["sam@example.co.nz"]);
    await expect(
      execute(updateCustomer, { id: sam.id, tags: ["<script>"] }, staff),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("lets people leave the crew at once and only come back by their own hand", async () => {
    const [member] = await handle.db
      .select()
      .from(crewMembers)
      .where(eq(crewMembers.email, "sam@example.co.nz"));
    if (member === undefined) throw new Error("no member");

    await execute(leaveCrew, { token: member.unsubscribeToken }, shop);
    expect(
      (await execute(listCrew, { status: "unsubscribed" }, viewer)).map(
        (row) => row.email,
      ),
    ).toEqual(["sam@example.co.nz"]);
    // Leaving twice is fine.
    await execute(leaveCrew, { token: member.unsubscribeToken }, shop);
    await expect(
      execute(leaveCrew, { token: "not-a-real-token-at-all" }, shop),
    ).rejects.toMatchObject({ code: "not_found" });

    // Staff cannot put them back.
    expect(
      await execute(
        joinCrew,
        { email: "sam@example.co.nz", source: "manual" },
        staff,
      ),
    ).toEqual({ result: "kept-out" });
    expect(
      (await execute(listCrew, {}, viewer)).map((row) => row.email),
    ).not.toContain("sam@example.co.nz");

    // They can, by signing up again themselves, and the consent is re-dated.
    expect(
      await execute(
        joinCrew,
        { email: "Sam@example.co.nz", source: "crew-form" },
        shop,
      ),
    ).toEqual({ result: "rejoined" });
    const [again] = await handle.db
      .select()
      .from(crewMembers)
      .where(eq(crewMembers.email, "sam@example.co.nz"));
    expect(again).toMatchObject({
      status: "subscribed",
      source: "crew-form",
      unsubscribedAt: null,
    });

    // An address that bounced stays out whoever asks.
    await handle.db
      .update(crewMembers)
      .set({ status: "bounced" })
      .where(eq(crewMembers.email, "sam@example.co.nz"));
    expect(
      await execute(
        joinCrew,
        { email: "sam@example.co.nz", source: "crew-form" },
        shop,
      ),
    ).toEqual({ result: "kept-out" });
  });

  it("the count of orders matches what is on the shelf", async () => {
    const counts = await execute(countOrders, {}, viewer);
    const all = await handle.db.select().from(orders);
    expect(
      counts.paid +
        counts.packed +
        counts.shipped +
        counts.delivered +
        counts.cancelled +
        counts.pending,
    ).toBe(all.length);
    expect(counts.delivered).toBe(1);
    expect(counts.cancelled).toBe(1);
  });
});
