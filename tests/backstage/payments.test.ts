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
import { closePaymentPage } from "@/lib/backstage/orders/listeners";
import { settleOnReturn } from "@/lib/shop/payments/settle";
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

    // And the activity log has one line for it, not three: a repeat that
    // changed nothing leaves nothing behind.
    const lines = await handle.db
      .select({ summary: auditLog.summary })
      .from(auditLog)
      .where(eq(auditLog.operation, "orders.markPaid"));
    expect(
      lines.filter((line) => line.summary.includes(order.number)),
    ).toHaveLength(1);
    expect(
      lines.filter(
        (line) => line.summary === "Record that an order has been paid",
      ),
    ).toHaveLength(0);
  });

  it("is not marked paid when the amount or the currency is wrong", async () => {
    const { order } = await begin({ email: "short@example.co.nz" });
    const short = await paid(order.number, { amountCents: 100 });
    expect(short).toEqual({ outcome: "mismatch", alreadyPaid: false });

    // It is not paid, and it is marked as needing a person.
    const state = await execute(paymentState, { number: order.number }, shop);
    expect(state).toMatchObject({ status: "pending", paymentStatus: "review" });
    expect(await eventsOf(order.number, "order.paid")).toHaveLength(0);
    expect(await eventsOf(order.number, "order.payment_mismatch")).toHaveLength(
      1,
    );

    // The buyer's page asks again every few seconds, and a webhook can
    // repeat. The same payment does not raise the alarm twice.
    const sameAgain = await paid(order.number, { amountCents: 100 });
    expect(sameAgain).toEqual({ outcome: "mismatch", alreadyPaid: false });
    expect(await eventsOf(order.number, "order.payment_mismatch")).toHaveLength(
      1,
    );

    // A clock does not close it either: it is waiting for a person.
    const expired = await execute(
      paymentExpired,
      { number: order.number, reason: "The payment page ran out" },
      stripe,
    );
    expect(expired).toEqual({ status: "pending" });

    // A different payment that is also wrong is a new thing to look at.
    const wrong = await paid(order.number, {
      currency: "usd",
      reference: "cs_test_another",
    });
    expect(wrong.outcome).toBe("mismatch");
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

  describe("when an order is cancelled before it is paid", () => {
    const ENV = { STRIPE_SECRET_KEY: "sk_test_abc" };
    const owner = systemCaller("Ashleigh", "ui");

    const stripeAnswers = (status: number | "down") => {
      const asked: { url: string; method: string }[] = [];
      const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
        asked.push({ url: String(url), method: init?.method ?? "GET" });
        if (status === "down") throw new Error("network");
        return new Response(
          JSON.stringify(
            status === 200
              ? { id: "cs_test_x", status: "expired" }
              : { error: { message: "Only open sessions can be expired." } },
          ),
          { status },
        );
      }) as typeof fetch;
      return { asked, fetchImpl };
    };

    const cancelled = async (number: string) => {
      await execute(
        cancelOrder,
        { number, reason: "Asked us to stop" },
        { ...owner, confirmed: true },
      );
      const [event] = await eventsOf(number, "order.cancelled");
      if (event === undefined) throw new Error("no cancelled event");
      return {
        id: event.id,
        at: event.at,
        type: event.type,
        entityType: event.entityType,
        entityId: event.entityId,
        payload: event.payload,
        attempt: 1,
      };
    };

    it("closes the buyer's payment page, so they cannot pay for it after", async () => {
      const { order } = await begin();
      const event = await cancelled(order.number);
      const stripeApi = stripeAnswers(200);
      await closePaymentPage({ env: ENV, fetchImpl: stripeApi.fetchImpl })(
        event,
        { db: handle.db, now: new Date() },
      );
      expect(stripeApi.asked).toEqual([
        {
          url: `https://api.stripe.com/v1/checkout/sessions/cs_test_${order.number}/expire`,
          method: "POST",
        },
      ]);
    });

    it("takes Stripe's no for an answer, and tries again if Stripe cannot be reached", async () => {
      const { order } = await begin();
      const event = await cancelled(order.number);
      const ctx = { db: handle.db, now: new Date() };
      // Already closed, or already paid: nothing more to do.
      await expect(
        closePaymentPage({ env: ENV, fetchImpl: stripeAnswers(400).fetchImpl })(
          event,
          ctx,
        ),
      ).resolves.toBeUndefined();
      // Unreachable, or having a bad moment: worth another try.
      await expect(
        closePaymentPage({
          env: ENV,
          fetchImpl: stripeAnswers("down").fetchImpl,
        })(event, ctx),
      ).rejects.toThrow();
      await expect(
        closePaymentPage({ env: ENV, fetchImpl: stripeAnswers(500).fetchImpl })(
          event,
          ctx,
        ),
      ).rejects.toThrow();
    });

    it("leaves Stripe alone for an order that was paid", async () => {
      const { order } = await begin();
      await paid(order.number);
      const event = await cancelled(order.number);
      const stripeApi = stripeAnswers(200);
      await closePaymentPage({ env: ENV, fetchImpl: stripeApi.fetchImpl })(
        event,
        { db: handle.db, now: new Date() },
      );
      expect(stripeApi.asked).toHaveLength(0);
    });
  });

  describe("when the buyer comes back to the site", () => {
    const ENV = { STRIPE_SECRET_KEY: "sk_test_abc" };

    /** Stripe's answer when asked about a payment page. */
    const stripeSays = (session: Record<string, unknown> | "down") => {
      const asked: string[] = [];
      const fetchImpl = (async (url: RequestInfo | URL) => {
        asked.push(String(url));
        if (session === "down") throw new Error("network");
        return new Response(JSON.stringify(session), { status: 200 });
      }) as typeof fetch;
      return { asked, fetchImpl };
    };

    const session = (number: string, over: Record<string, unknown> = {}) => ({
      id: `cs_test_${number}`,
      url: `https://checkout.stripe.com/c/pay/cs_test_${number}`,
      status: "open",
      payment_status: "unpaid",
      amount_total: 8850,
      currency: "nzd",
      client_reference_id: number,
      payment_intent: null,
      ...over,
    });

    it("asks Stripe, and marks the order paid if Stripe says it is", async () => {
      const { order } = await begin();
      const stripeAnswer = stripeSays(
        session(order.number, {
          status: "complete",
          payment_status: "paid",
          url: null,
        }),
      );
      const settled = await settleOnReturn(order.number, {
        env: ENV,
        fetchImpl: stripeAnswer.fetchImpl,
      });
      expect(settled).toEqual({ state: "paid" });
      expect(stripeAnswer.asked).toEqual([
        `https://api.stripe.com/v1/checkout/sessions/cs_test_${order.number}`,
      ]);
      const state = await execute(paymentState, { number: order.number }, shop);
      // A test key: the order is kept as a test payment, never as real money.
      expect(state).toMatchObject({ status: "paid", paymentStatus: "test" });

      // Asked again (a refresh), it does not go back to Stripe at all.
      const again = stripeSays("down");
      expect(
        await settleOnReturn(order.number, {
          env: ENV,
          fetchImpl: again.fetchImpl,
        }),
      ).toEqual({ state: "paid" });
      expect(again.asked).toHaveLength(0);
    });

    it("shows the way back to a payment page that is still open", async () => {
      const { order } = await begin();
      const settled = await settleOnReturn(order.number, {
        env: ENV,
        fetchImpl: stripeSays(session(order.number)).fetchImpl,
      });
      expect(settled).toEqual({
        state: "awaiting",
        payAt: `https://checkout.stripe.com/c/pay/cs_test_${order.number}`,
      });
      const state = await execute(paymentState, { number: order.number }, shop);
      expect(state.status).toBe("pending");
    });

    it("never links to a payment page that is not Stripe's", async () => {
      const { order } = await begin();
      for (const url of [
        "https://checkout.stripe.com.evil.example/pay",
        "http://checkout.stripe.com/c/pay/x",
        "javascript:alert(1)",
        "not a url",
        null,
      ]) {
        const settled = await settleOnReturn(order.number, {
          env: ENV,
          fetchImpl: stripeSays(session(order.number, { url })).fetchImpl,
        });
        expect(settled).toEqual({ state: "awaiting", payAt: undefined });
      }
    });

    it("waits, with no link, for a payment that is still on its way", async () => {
      const { order } = await begin();
      const settled = await settleOnReturn(order.number, {
        env: ENV,
        fetchImpl: stripeSays(
          session(order.number, { status: "complete", url: null }),
        ).fetchImpl,
      });
      expect(settled).toEqual({ state: "awaiting" });
    });

    it("closes the order when the payment page has run out", async () => {
      const { order } = await begin();
      const settled = await settleOnReturn(order.number, {
        env: ENV,
        fetchImpl: stripeSays(
          session(order.number, { status: "expired", url: null }),
        ).fetchImpl,
      });
      expect(settled).toEqual({ state: "closed" });
      const state = await execute(paymentState, { number: order.number }, shop);
      expect(state).toMatchObject({
        status: "cancelled",
        paymentStatus: "failed",
      });
      // And it stays closed, without asking Stripe again.
      const again = stripeSays("down");
      expect(
        await settleOnReturn(order.number, {
          env: ENV,
          fetchImpl: again.fetchImpl,
        }),
      ).toEqual({ state: "closed" });
      expect(again.asked).toHaveLength(0);
    });

    it("hands a payment of the wrong amount to a person", async () => {
      const { order } = await begin();
      const settled = await settleOnReturn(order.number, {
        env: ENV,
        fetchImpl: stripeSays(
          session(order.number, {
            status: "complete",
            payment_status: "paid",
            amount_total: 100,
          }),
        ).fetchImpl,
      });
      expect(settled).toEqual({ state: "review" });
      const state = await execute(paymentState, { number: order.number }, shop);
      expect(state.status).toBe("pending");
    });

    it("ignores a payment page that belongs to a different order", async () => {
      const { order } = await begin();
      const settled = await settleOnReturn(order.number, {
        env: ENV,
        fetchImpl: stripeSays(
          session(order.number, {
            status: "complete",
            payment_status: "paid",
            client_reference_id: "QP-ZZZZZZ",
          }),
        ).fetchImpl,
      });
      expect(settled).toEqual({ state: "awaiting" });
      const state = await execute(paymentState, { number: order.number }, shop);
      expect(state.status).toBe("pending");
    });

    it("says it cannot tell when Stripe cannot be reached, or the order is unknown", async () => {
      const { order } = await begin();
      expect(
        await settleOnReturn(order.number, {
          env: ENV,
          fetchImpl: stripeSays("down").fetchImpl,
        }),
      ).toEqual({ state: "unknown" });
      expect(
        await settleOnReturn("QP-ZZZZZZ", {
          env: ENV,
          fetchImpl: stripeSays("down").fetchImpl,
        }),
      ).toEqual({ state: "unknown" });
    });
  });
});
