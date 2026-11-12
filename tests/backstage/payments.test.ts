import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, events, orders } from "@/db/schema";
import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { cancelOrder, getOrder } from "@/lib/backstage/orders/ops";
import {
  attachPayment,
  markPaid,
  paymentExpired,
  paymentState,
} from "@/lib/backstage/orders/payments";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import type { PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { getStore } from "@/lib/shop/store";

const shop = systemCaller("The shop", "storefront");
const stripe = systemCaller("Stripe", "webhook");

const form = (over: Record<string, unknown> = {}) => ({
  email: "sam@example.co.nz",
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
  joinCrew: false,
  lines: [{ sku: "QP-SHOT-24", qty: 1 }],
  ...over,
});

const URLS = {
  success: "https://shop.example/order/thanks",
  cancel: "https://shop.example/checkout?payment=cancelled",
};

/** A processor that sends the buyer away, like Stripe's hosted page. */
function elsewhere(options: { fail?: boolean } = {}): PaymentProvider {
  return {
    name: "stripe",
    isTest: true,
    savesFirst: true,
    async begin(request) {
      if (options.fail) throw new Error("Stripe is down");
      return {
        kind: "redirect",
        url: `https://pay.example/${request.orderNumber}`,
        payment: {
          provider: "stripe",
          status: "pending",
          reference: `cs_test_${request.orderNumber}`,
        },
      };
    },
  };
}

describe("an order that is paid for somewhere else", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
  });
  afterAll(async () => {
    await closeDb();
  });

  const begin = async (over: Record<string, unknown> = {}) => {
    const result = await placeOrder(form(over), {
      payments: elsewhere(),
      store: getStore({ NODE_ENV: "test" }),
      returnUrls: URLS,
    });
    if (!result.ok) throw new Error(`order failed: ${JSON.stringify(result)}`);
    return result;
  };

  const paid = (number: string, over: Record<string, unknown> = {}) =>
    execute(
      markPaid,
      {
        number,
        provider: "stripe",
        reference: `cs_test_${number}`,
        amountCents: 8850,
        currency: "nzd",
        test: false,
        ...over,
      },
      stripe,
    );

  const eventsOf = async (number: string, type: string) => {
    const [order] = await handle.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.number, number));
    return handle.db
      .select()
      .from(events)
      .where(and(eq(events.entityId, order?.id ?? ""), eq(events.type, type)));
  };

  it("is written down first, awaiting payment, and the buyer is sent to pay", async () => {
    const result = await begin();
    const number = result.order.number;
    expect(result.payAt).toBe(`https://pay.example/${number}`);
    expect(result.order.payment).toEqual({
      provider: "stripe",
      status: "pending",
      reference: `cs_test_${number}`,
    });

    const state = await execute(paymentState, { number }, shop);
    expect(state).toMatchObject({
      status: "pending",
      paymentStatus: "unpaid",
      provider: "stripe",
      reference: `cs_test_${number}`,
      totalCents: 8850,
    });
    // Nothing to pack until it is paid.
    expect(await eventsOf(number, "order.paid")).toHaveLength(0);
    expect(await eventsOf(number, "order.placed")).toHaveLength(1);
  });

  it("becomes something to pack when the processor says it is paid", async () => {
    const { order } = await begin({ email: "paid@example.co.nz" });
    const result = await paid(order.number);
    expect(result).toEqual({ outcome: "paid", alreadyPaid: false });

    const after = await execute(getOrder, { number: order.number }, shop);
    expect(after).toMatchObject({
      status: "paid",
      paymentStatus: "paid",
      isTest: false,
    });
    expect(after.paidAt).not.toBeNull();
    expect(await eventsOf(order.number, "order.paid")).toHaveLength(1);
  });

  it("is only marked once, however many times the word arrives", async () => {
    const { order } = await begin({ email: "twice@example.co.nz" });
    const [a, b] = await Promise.all([paid(order.number), paid(order.number)]);
    expect([a.alreadyPaid, b.alreadyPaid].sort()).toEqual([false, true]);
    const again = await paid(order.number);
    expect(again).toEqual({ outcome: "paid", alreadyPaid: true });
    expect(await eventsOf(order.number, "order.paid")).toHaveLength(1);
  });

  it("is not marked paid when the amount or the currency is wrong", async () => {
    const { order } = await begin({ email: "short@example.co.nz" });
    const short = await paid(order.number, { amountCents: 100 });
    expect(short).toEqual({ outcome: "mismatch", alreadyPaid: false });
    const wrong = await paid(order.number, { currency: "usd" });
    expect(wrong.outcome).toBe("mismatch");

    const state = await execute(paymentState, { number: order.number }, shop);
    expect(state).toMatchObject({ status: "pending", paymentStatus: "unpaid" });
    expect(await eventsOf(order.number, "order.paid")).toHaveLength(0);
    expect(await eventsOf(order.number, "order.payment_mismatch")).toHaveLength(
      2,
    );
    const lines = await handle.db
      .select({ summary: auditLog.summary })
      .from(auditLog)
      .where(eq(auditLog.operation, "orders.markPaid"));
    expect(
      lines.some((line) => line.summary.includes("Not marked as paid")),
    ).toBe(true);

    // The right amount still settles it afterwards.
    expect((await paid(order.number)).outcome).toBe("paid");
  });

  it("keeps a test payment apart from real money", async () => {
    const { order } = await begin({ email: "sandbox@example.co.nz" });
    await paid(order.number, { test: true });
    const after = await execute(getOrder, { number: order.number }, shop);
    expect(after).toMatchObject({
      status: "paid",
      paymentStatus: "test",
      isTest: true,
    });
  });

  it("is closed, unpaid, when the payment page runs out", async () => {
    const { order } = await begin({ email: "late@example.co.nz" });
    const closed = await execute(
      paymentExpired,
      { number: order.number, reason: "The payment page ran out" },
      stripe,
    );
    expect(closed).toEqual({ status: "cancelled" });
    const state = await execute(paymentState, { number: order.number }, shop);
    expect(state).toMatchObject({
      status: "cancelled",
      paymentStatus: "failed",
    });
    // Saying so twice changes nothing.
    await execute(
      paymentExpired,
      { number: order.number, reason: "The payment page ran out" },
      stripe,
    );
    expect(await eventsOf(order.number, "order.payment_expired")).toHaveLength(
      1,
    );
  });

  it("is left alone by a late 'ran out' once it has been paid", async () => {
    const { order } = await begin({ email: "justintime@example.co.nz" });
    await paid(order.number);
    const result = await execute(
      paymentExpired,
      { number: order.number, reason: "The payment page ran out" },
      stripe,
    );
    expect(result).toEqual({ status: "paid" });
  });

  it("flags money that arrives after the order was cancelled", async () => {
    const { order } = await begin({ email: "cancelled@example.co.nz" });
    await execute(
      cancelOrder,
      { number: order.number, reason: "Customer changed their mind" },
      { ...shop, confirmed: true },
    );
    const result = await paid(order.number);
    expect(result).toEqual({ outcome: "cancelled", alreadyPaid: false });

    const state = await execute(paymentState, { number: order.number }, shop);
    expect(state).toMatchObject({ status: "cancelled", paymentStatus: "paid" });
    expect(await eventsOf(order.number, "order.paid")).toHaveLength(0);
    expect(
      await eventsOf(order.number, "order.paid_after_cancel"),
    ).toHaveLength(1);
    // And saying it again does not flag it twice.
    expect(await paid(order.number)).toEqual({
      outcome: "cancelled",
      alreadyPaid: true,
    });
  });

  it("notes the payment page once and ignores a stale one", async () => {
    const { order } = await begin({ email: "attach@example.co.nz" });
    const same = await execute(
      attachPayment,
      {
        number: order.number,
        provider: "stripe",
        reference: `cs_test_${order.number}`,
      },
      shop,
    );
    expect(same).toEqual({ attached: true });
    await paid(order.number);
    const stale = await execute(
      attachPayment,
      { number: order.number, provider: "stripe", reference: "cs_test_other" },
      shop,
    );
    expect(stale).toEqual({ attached: false });
    const state = await execute(paymentState, { number: order.number }, shop);
    expect(state.reference).toBe(`cs_test_${order.number}`);
  });

  it("closes the order again if the payment page cannot be made", async () => {
    const before = await handle.db.select({ id: orders.id }).from(orders);
    const result = await placeOrder(form({ email: "down@example.co.nz" }), {
      payments: elsewhere({ fail: true }),
      store: getStore({ NODE_ENV: "test" }),
      returnUrls: URLS,
    });
    expect(result).toEqual({ ok: false, reason: "failed" });
    const after = await handle.db
      .select({ status: orders.status, reason: orders.cancelReason })
      .from(orders)
      .where(eq(orders.email, "down@example.co.nz"));
    expect(after).toEqual([
      {
        status: "cancelled",
        reason: "The payment page could not be opened",
      },
    ]);
    expect(
      (await handle.db.select({ id: orders.id }).from(orders)).length,
    ).toBe(before.length + 1);
  });

  it("will not start without somewhere to send the buyer back to", async () => {
    const result = await placeOrder(form({ email: "nowhere@example.co.nz" }), {
      payments: elsewhere(),
      store: getStore({ NODE_ENV: "test" }),
    });
    expect(result).toEqual({ ok: false, reason: "failed" });
    const saved = await handle.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.email, "nowhere@example.co.nz"));
    expect(saved).toHaveLength(0);
  });

  it("will not start with a store that cannot find the order again", async () => {
    const savedOrders: string[] = [];
    const result = await placeOrder(form(), {
      payments: elsewhere(),
      store: {
        async saveOrder(order) {
          savedOrders.push(order.number);
        },
        async saveSignup() {},
      },
      returnUrls: URLS,
    });
    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(savedOrders).toHaveLength(0);
  });

  it("says no such order rather than inventing one", async () => {
    await expect(paid("QP-ZZZZZZ")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
