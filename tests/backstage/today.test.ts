import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { events, orders, refunds, settings } from "@/db/schema";
import { tick } from "@/lib/backstage/clock/tick";
import { systemCaller } from "@/lib/backstage/core/actor";
import { clearHandlers, MAX_ATTEMPTS, on } from "@/lib/backstage/core/events";
import { execute } from "@/lib/backstage/core/op";
import { registerHandlers } from "@/lib/backstage/handlers";
import { cancelOrder, recordRefund } from "@/lib/backstage/orders/ops";
import { refundsSeen } from "@/lib/backstage/orders/outside-refunds";
import { markPaid } from "@/lib/backstage/orders/payments";
import { refundSettled } from "@/lib/backstage/orders/refunds";
import { needsYou } from "@/lib/backstage/today/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import type { PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { getStore } from "@/lib/shop/store";
import { FILE_OFFER } from "@/lib/shop/offer";

const shop = systemCaller("The shop", "storefront");
const stripe = systemCaller("Stripe", "webhook");
const ash = { ...systemCaller("Ashleigh", "ui"), confirmed: true };

const T0 = new Date("2026-11-12T09:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

const elsewhere: PaymentProvider = {
  name: "stripe",
  isTest: true,
  savesFirst: true,
  async begin(request) {
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

describe("what needs a person now", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    registerHandlers();
  });
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    clearHandlers();
    await handle.db.delete(events);
    await handle.db.delete(refunds);
    await handle.db.delete(orders);
    await handle.db.delete(settings);
  });

  const sentToPay = async (email: string) => {
    const result = await placeOrder(
      {
        email,
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
      },
      {
        offer: FILE_OFFER,
        payments: elsewhere,
        store: getStore({ NODE_ENV: "test" }),
        returnUrls: {
          success: "https://shop.example/order/thanks",
          cancel: "https://shop.example/checkout",
        },
      },
    );
    if (!result.ok) throw new Error("order failed");
    return result.order.number;
  };

  const pay = (number: string, amountCents = 8850) =>
    execute(
      markPaid,
      {
        number,
        provider: "stripe",
        reference: `cs_test_${number}`,
        amountCents,
        currency: "nzd",
        test: false,
      },
      stripe,
    );

  const needs = (now: Date = new Date()) =>
    execute(needsYou, {}, shop, { now });

  it("is empty when everything is in hand", async () => {
    const number = await sentToPay("fine@example.co.nz");
    await pay(number);
    expect(await needs()).toEqual([]);
  });

  it("lists a payment that does not match its order", async () => {
    const number = await sentToPay("short@example.co.nz");
    await pay(number, 100);
    const list = await needs();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      key: `payment-review:${number}`,
      urgent: true,
      href: `/backstage/orders/${number}`,
    });
    // Settled with the right amount, it drops off.
    await pay(number);
    expect(await needs()).toEqual([]);
  });

  it("lists an order paid for after it was cancelled, until the money is back", async () => {
    const number = await sentToPay("late@example.co.nz");
    await execute(cancelOrder, { number, reason: "Changed their mind" }, ash);
    await pay(number);
    const list = await needs();
    expect(list.map((need) => need.key)).toEqual([
      `paid-after-cancel:${number}`,
    ]);
    expect(list[0]?.detail).toContain("$88.50");

    const refund = await execute(
      recordRefund,
      { number, amountCents: 8850, reason: "Paid after cancelling" },
      ash,
    );
    expect(refund.sent).toBe("by-stripe");
    // On its way counts: nobody needs to do anything more.
    expect(await needs()).toEqual([]);
  });

  it("lists a refund Stripe refused, and drops it once one goes through", async () => {
    const number = await sentToPay("refund@example.co.nz");
    await pay(number);
    await execute(
      recordRefund,
      { number, amountCents: 2000, reason: "One leaked" },
      ash,
    );
    const [row] = await handle.db.select({ id: refunds.id }).from(refunds);
    await execute(
      refundSettled,
      { refundId: row?.id ?? "", outcome: "failed", reason: "Card closed" },
      stripe,
    );
    const list = await needs();
    expect(list.map((need) => need.key)).toEqual([`refund-failed:${number}`]);
    expect(list[0]?.detail).toContain("$20");

    // Tried again, and this one is on its way.
    await execute(
      recordRefund,
      { number, amountCents: 2000, reason: "One leaked, second go" },
      ash,
    );
    expect(await needs()).toEqual([]);
  });

  it("lists a refund that left and came back, until the money goes another way", async () => {
    const number = await sentToPay("back@example.co.nz");
    await pay(number);
    await execute(
      recordRefund,
      { number, amountCents: 2000, reason: "One leaked" },
      ash,
    );
    const [row] = await handle.db.select({ id: refunds.id }).from(refunds);
    await execute(
      refundSettled,
      {
        refundId: row?.id ?? "",
        outcome: "done",
        providerReference: "re_left_1",
      },
      stripe,
    );
    // Gone, as far as anybody knows.
    expect(await needs()).toEqual([]);

    // Later the bank says the card it was going to has been closed.
    const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
    await execute(
      refundsSeen,
      {
        number,
        refunds: [],
        returned: [{ reference: "re_left_1", why: "expired_or_canceled_card" }],
      },
      stripe,
      { now: later(1) },
    );
    const list = await needs(later(2));
    expect(list.map((need) => need.key)).toEqual([`refund-returned:${number}`]);
    expect(list[0]).toMatchObject({
      urgent: true,
      title: `A refund on ${number} came back`,
      href: `/backstage/orders/${number}`,
    });
    expect(list[0]?.detail).toContain("$20");
    expect(list[0]?.detail).toContain("they have not had it");

    // Sending it to the same card again would only come back again. It is
    // sent by bank transfer and written down, and that is the end of it.
    const byHand = await execute(
      recordRefund,
      {
        number,
        amountCents: 2000,
        reason: "Bank transfer: their card was closed",
        byHand: true,
      },
      ash,
      { now: later(3) },
    );
    expect(byHand.sent).toBe("by-hand");
    expect(await needs(later(4))).toEqual([]);
  });

  it("lists steps that have run out of tries, and a clock that has stopped", async () => {
    on("order.placed", "always down", async () => {
      throw new Error("down");
    });
    await sentToPay("stuck@example.co.nz");
    let at = minutes(1);
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await tick({ now: at, settle: async () => ({ state: "awaiting" }) });
      at = new Date(at.getTime() + 61 * 60_000);
    }
    // Asked a few minutes after the last round: the clock is fine, the step
    // is not.
    const soonAfter = new Date(at.getTime() - 58 * 60_000);
    expect((await needs(soonAfter)).map((need) => need.key)).toEqual([
      "steps-out-of-tries",
    ]);

    // Asked an hour later with no round since: the clock is on the list too,
    // after anything where money or a customer is waiting.
    const muchLater = new Date(at.getTime() + 60 * 60_000);
    const list = await needs(muchLater);
    expect(list.map((need) => need.key)).toEqual([
      "steps-out-of-tries",
      "clock-stopped",
    ]);
    expect(list.map((need) => need.urgent)).toEqual([true, false]);
  });

  it("does not nag about a clock that has never been set up", async () => {
    expect(await needs(minutes(10_000))).toEqual([]);
    expect(
      await handle.db
        .select()
        .from(settings)
        .where(eq(settings.key, "clock.last_tick")),
    ).toHaveLength(0);
  });
});
