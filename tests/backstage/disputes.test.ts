import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, disputes, events, orders, refunds } from "@/db/schema";
import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { booksSummary } from "@/lib/backstage/numbers/books";
import {
  disputeFromStripe,
  disputeNeeds,
  disputeReason,
  disputeSeen,
  disputeStatusOf,
  needsAnAnswer,
} from "@/lib/backstage/orders/disputes";
import { markPaid } from "@/lib/backstage/orders/payments";
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
import { nzDateKey, nzToInstant } from "@/lib/time";

/**
 * Card disputes. Rare, and each one has a date, so what matters is that it
 * is seen the day it arrives, that the same news twice says nothing twice,
 * and that a lost one leaves the order and the books saying what is true.
 */

const staff = systemCaller("Test", "script");
const stripe = systemCaller("Stripe", "webhook");
const ENV = { STRIPE_SECRET_KEY: "sk_test_abc" };

/** Ten in the morning, Thursday 12 November 2026, New Zealand time. */
const NOW = nzToInstant(2026, 11, 12, 10, 0);
/** Five in the afternoon, Friday 20 November: when an answer is due. */
const DUE = nzToInstant(2026, 11, 20, 17, 0);
const seconds = (at: Date) => Math.floor(at.getTime() / 1000);

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

type Held = {
  id: string;
  amount: number;
  currency?: string;
  payment_intent?: string | null;
  reason?: string | null;
  status?: string;
  created?: number;
  evidence_details?: { due_by?: number | null };
};

/** Stripe, as far as this needs it: disputes, payments and sessions. */
function stripeApi(
  held: Held,
  options: { down?: boolean; whose?: string | null } = {},
) {
  const asked: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    const path = new URL(String(url)).pathname;
    asked.push(path);
    if (options.down === true) throw new Error("connect ETIMEDOUT");
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (path.startsWith("/v1/disputes/")) return json(held);
    if (path.startsWith("/v1/payment_intents/")) {
      const id = path.split("/").at(-1) ?? "";
      const whose =
        options.whose === undefined ? id.replace("pi_", "") : options.whose;
      return json({
        id,
        metadata: whose === null ? {} : { order_number: whose },
      });
    }
    if (path.startsWith("/v1/checkout/sessions/")) {
      const session = path.split("/").at(-1) ?? "";
      return json({
        id: session,
        payment_intent: `pi_${session.replace("cs_test_", "")}`,
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { asked, fetchImpl };
}

describe("a dispute, in our words", () => {
  it("is open until the bank has decided", () => {
    for (const waiting of [
      "needs_response",
      "under_review",
      "warning_needs_response",
      "warning_under_review",
      // A word Stripe has not used yet: open, because open gets looked at.
      "something_new",
    ]) {
      expect(disputeStatusOf(waiting), waiting).toBe("open");
    }
    expect(disputeStatusOf("won")).toBe("won");
    // A bank that asked and then let it go: the money never left.
    expect(disputeStatusOf("warning_closed")).toBe("won");
    expect(disputeStatusOf("lost")).toBe("lost");
  });

  it("knows when it is the shop being waited on", () => {
    expect(needsAnAnswer("needs_response")).toBe(true);
    expect(needsAnAnswer("warning_needs_response")).toBe(true);
    expect(needsAnAnswer("under_review")).toBe(false);
    expect(needsAnAnswer("won")).toBe(false);
  });

  it("says the bank's reason in a sentence, and makes none up", () => {
    expect(disputeReason("product_not_received")).toBe(
      "The cardholder says the order never arrived.",
    );
    expect(disputeReason("fraudulent")).toBe(
      "The cardholder says they did not make the payment.",
    );
    expect(disputeReason("a_reason_we_have_not_met")).toBe("");
  });
});

describe("card disputes", () => {
  let handle: DbHandle;
  let made = 0;

  /** An order paid on Stripe's page: $88.50. */
  async function paidOrder(test = false): Promise<string> {
    made += 1;
    const result = await placeOrder(
      {
        email: `dispute${String(made)}@example.co.nz`,
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
        payments: elsewhere,
        store: getStore({ NODE_ENV: "test" }),
        returnUrls: {
          success: "https://shop.example/order/thanks",
          cancel: "https://shop.example/checkout?payment=cancelled",
        },
      },
    );
    if (!result.ok) throw new Error(`Not placed: ${result.reason}`);
    const number = result.order.number;
    await execute(
      markPaid,
      {
        number,
        provider: "stripe",
        reference: `cs_test_${number}`,
        amountCents: 8850,
        currency: "nzd",
        test,
      },
      stripe,
    );
    return number;
  }

  const orderOf = async (number: string) => {
    const [order] = await handle.db
      .select()
      .from(orders)
      .where(eq(orders.number, number));
    if (order === undefined) throw new Error(`No order ${number}`);
    return order;
  };
  const disputesOf = async (number: string) =>
    handle.db
      .select()
      .from(disputes)
      .where(eq(disputes.orderId, (await orderOf(number)).id));
  const refundsOf = async (number: string) =>
    handle.db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, (await orderOf(number)).id));
  const logOf = async (number: string) =>
    (
      await handle.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, (await orderOf(number)).id))
        .orderBy(asc(auditLog.at), asc(auditLog.id))
    ).map((entry) => entry.summary);
  const eventsOf = async (number: string, type: string) =>
    handle.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.entityId, (await orderOf(number)).id),
          eq(events.type, type),
        ),
      );

  const held = (number: string, over: Partial<Held> = {}): Held => ({
    id: `dp_${number}`,
    amount: 8850,
    currency: "nzd",
    payment_intent: `pi_${number}`,
    reason: "product_not_received",
    status: "needs_response",
    created: seconds(NOW),
    evidence_details: { due_by: seconds(DUE) },
    ...over,
  });
  /** Stripe sends news of the dispute, and this is how it stands there. */
  const news = (
    number: string,
    over: Partial<Held> = {},
    at: Date = NOW,
    options: { down?: boolean; whose?: string | null } = {},
  ) => {
    const api = stripeApi(held(number, over), options);
    return {
      api,
      result: disputeFromStripe(
        { reference: `dp_${number}` },
        { env: ENV, fetchImpl: api.fetchImpl, now: at },
      ),
    };
  };

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  it("writes a new dispute onto its order, with the date to answer by", async () => {
    const number = await paidOrder();
    const { api, result } = news(number);
    expect(await result).toEqual({ number, status: "open" });
    // The dispute as it stands, whose payment it is, and that the payment
    // is the one this order was paid with.
    expect(api.asked).toEqual([
      `/v1/disputes/dp_${number}`,
      `/v1/payment_intents/pi_${number}`,
      `/v1/checkout/sessions/cs_test_${number}`,
    ]);

    expect(await disputesOf(number)).toMatchObject([
      {
        providerReference: `dp_${number}`,
        amountCents: 8850,
        reason: "product_not_received",
        status: "open",
        providerStatus: "needs_response",
        dueAt: DUE,
        openedAt: NOW,
        closedAt: null,
      },
    ]);
    expect(await logOf(number)).toContain(
      `The cardholder's bank has disputed $88.50 on ${number}. The cardholder says the order never arrived. Answer it in Stripe by Friday 20 November.`,
    );
    expect(
      (await eventsOf(number, "order.disputed")).map((event) => event.payload),
    ).toEqual([{ number, amountCents: 8850 }]);
    // Nothing is decided, so the order still reads as paid in full.
    expect(await orderOf(number)).toMatchObject({
      paymentStatus: "paid",
      refundedCents: 0,
    });
  });

  it("is on Today, first, until it is answered", async () => {
    const number = await paidOrder();
    await news(number).result;
    const needs = await disputeNeeds(handle.db, NOW);
    expect(needs.find((need) => need.key === `dispute-${number}`)).toEqual({
      key: `dispute-${number}`,
      urgent: true,
      title: `A card dispute on ${number} needs an answer`,
      detail:
        "$88.50. The cardholder says the order never arrived. Answer it in Stripe by Friday 20 November.",
      href: `/backstage/orders/${number}`,
    });
    // And it is in the list the Today screen reads, among the urgent ones.
    const today = await execute(needsYou, {}, staff, { now: NOW });
    const line = today.findIndex((need) => need.key === `dispute-${number}`);
    expect(line).toBeGreaterThanOrEqual(0);
    expect(today.slice(0, line).every((need) => need.urgent)).toBe(true);

    // Past its date and still unanswered, it says so.
    const late = await disputeNeeds(
      handle.db,
      new Date(DUE.getTime() + 60_000),
    );
    expect(late.find((need) => need.key === `dispute-${number}`)?.detail).toBe(
      "$88.50. The cardholder says the order never arrived. The date to answer by has passed: look in Stripe now.",
    );
  });

  it("says nothing twice when the same news arrives again", async () => {
    const number = await paidOrder();
    await news(number).result;
    const lines = (await logOf(number)).length;
    for (let again = 0; again < 3; again += 1) {
      expect(await news(number).result).toEqual({ number, status: "open" });
    }
    expect(await disputesOf(number)).toHaveLength(1);
    expect((await logOf(number)).length).toBe(lines);
    expect(await eventsOf(number, "order.disputed")).toHaveLength(1);
  });

  it("stops being urgent once it is answered and with the bank", async () => {
    const number = await paidOrder();
    await news(number).result;
    await news(number, { status: "under_review" }).result;
    expect(await disputesOf(number)).toMatchObject([
      { status: "open", providerStatus: "under_review" },
    ]);
    expect(await logOf(number)).toContain(
      `The dispute on ${number} is with the bank now. Nothing to do but wait.`,
    );
    const need = (await disputeNeeds(handle.db, NOW)).find(
      (each) => each.key === `dispute-${number}`,
    );
    expect(need).toMatchObject({
      urgent: false,
      title: `A card dispute on ${number} is with the bank`,
      detail:
        "$88.50. The cardholder says the order never arrived. Nothing to do but wait.",
    });
  });

  it("leaves the order paid when the dispute is won", async () => {
    const number = await paidOrder();
    await news(number).result;
    const won = later(3);
    expect(
      await news(number, { status: "won", evidence_details: {} }, won).result,
    ).toEqual({ number, status: "won" });
    expect(await disputesOf(number)).toMatchObject([
      { status: "won", providerStatus: "won", dueAt: null, closedAt: won },
    ]);
    expect(await logOf(number)).toContain(
      `The dispute on ${number} was decided for the shop. The $88.50 stays.`,
    );
    expect(await orderOf(number)).toMatchObject({
      paymentStatus: "paid",
      refundedCents: 0,
    });
    expect(await refundsOf(number)).toEqual([]);
    expect(
      (await eventsOf(number, "order.dispute_closed")).map(
        (event) => event.payload,
      ),
    ).toEqual([{ number, amountCents: 8850, outcome: "won" }]);
    // Decided, so it is off Today.
    expect(
      (await disputeNeeds(handle.db, won)).some(
        (need) => need.key === `dispute-${number}`,
      ),
    ).toBe(false);
  });

  it("writes the money as given back when the dispute is lost", async () => {
    const number = await paidOrder();
    await news(number).result;
    const lost = later(9);
    expect(await news(number, { status: "lost" }, lost).result).toEqual({
      number,
      status: "lost",
    });
    expect(await disputesOf(number)).toMatchObject([
      { status: "lost", closedAt: lost, dueAt: null },
    ]);
    expect(await orderOf(number)).toMatchObject({
      paymentStatus: "refunded",
      refundedCents: 8850,
    });
    expect(await refundsOf(number)).toMatchObject([
      {
        amountCents: 8850,
        status: "done",
        reason:
          "Card dispute lost. The cardholder says the order never arrived.",
        providerReference: `dp_${number}`,
        createdAt: lost,
      },
    ]);
    expect(await logOf(number)).toContain(
      `The dispute on ${number} was lost. $88.50 went back to the cardholder.`,
    );
    expect(
      (await eventsOf(number, "order.dispute_closed")).map(
        (event) => event.payload,
      ),
    ).toEqual([{ number, amountCents: 8850, outcome: "lost" }]);
    // The cardholder took it back through their bank. Nobody is told a
    // refund is on its way.
    expect(await eventsOf(number, "order.refunded")).toEqual([]);

    // The books count it on the day it was lost.
    const day = nzDateKey(lost);
    const books = await execute(booksSummary, { from: day, to: day }, staff);
    expect(books.days).toMatchObject([
      { day, refundedCents: 8850, keptCents: -8850 },
    ]);
  });

  it("changes nothing once a dispute is decided, whatever arrives after", async () => {
    const number = await paidOrder();
    await news(number, { status: "lost" }).result;
    const lines = (await logOf(number)).length;
    // Old news arriving late, and the same decision again.
    for (const status of ["needs_response", "under_review", "lost", "won"]) {
      expect(await news(number, { status }, later(1)).result).toEqual({
        number,
        status: "lost",
      });
    }
    expect((await orderOf(number)).refundedCents).toBe(8850);
    expect(await refundsOf(number)).toHaveLength(1);
    expect((await logOf(number)).length).toBe(lines);
    expect(await eventsOf(number, "order.dispute_closed")).toHaveLength(1);
  });

  it("can first be heard of when it is already lost", async () => {
    const number = await paidOrder();
    await news(number, { status: "lost", reason: "fraudulent" }).result;
    expect(await logOf(number)).toEqual(
      expect.arrayContaining([
        `The cardholder's bank has disputed $88.50 on ${number}. The cardholder says they did not make the payment.`,
        `The dispute on ${number} was lost. $88.50 went back to the cardholder.`,
      ]),
    );
    expect(await orderOf(number)).toMatchObject({
      paymentStatus: "refunded",
      refundedCents: 8850,
    });
  });

  it("takes a bank's question that went no further as nothing lost", async () => {
    const number = await paidOrder();
    await news(number, { status: "warning_needs_response" }).result;
    expect(
      (await disputeNeeds(handle.db, NOW)).find(
        (need) => need.key === `dispute-${number}`,
      )?.urgent,
    ).toBe(true);
    await news(number, { status: "warning_closed" }).result;
    expect(await disputesOf(number)).toMatchObject([{ status: "won" }]);
    expect((await orderOf(number)).refundedCents).toBe(0);
  });

  it("says no reason when the bank gave one we do not know", async () => {
    const number = await paidOrder();
    await news(number, { reason: "a_reason_we_have_not_met" }).result;
    expect(await logOf(number)).toContain(
      `The cardholder's bank has disputed $88.50 on ${number}. Answer it in Stripe by Friday 20 November.`,
    );
  });

  it("keeps a dispute on a test payment off Today", async () => {
    const number = await paidOrder(true);
    await news(number).result;
    expect(await disputesOf(number)).toHaveLength(1);
    expect(
      (await disputeNeeds(handle.db, NOW)).some(
        (need) => need.key === `dispute-${number}`,
      ),
    ).toBe(false);
  });

  describe("a dispute that is not ours", () => {
    it("is let go by when the payment names no order", async () => {
      const number = await paidOrder();
      const { api, result } = news(number, {}, NOW, { whose: null });
      expect(await result).toEqual({ number: null, status: "" });
      expect(api.asked).toHaveLength(2);
      expect(await disputesOf(number)).toEqual([]);
    });

    it("is let go by when the payment names an order we do not have", async () => {
      const number = await paidOrder();
      expect(
        await news(number, {}, NOW, { whose: "QP-222222" }).result,
      ).toEqual({ number: null, status: "" });
      expect(await disputesOf(number)).toEqual([]);
    });

    it("is let go by when the payment is not the one the order was paid with", async () => {
      const number = await paidOrder();
      const other = await paidOrder();
      // The payment claims to be for `number`, but it is `other`'s.
      const { result } = news(number, { payment_intent: `pi_${other}` }, NOW, {
        whose: number,
      });
      expect(await result).toEqual({ number: null, status: "" });
      expect(await disputesOf(number)).toEqual([]);
      expect(await disputesOf(other)).toEqual([]);
    });

    it("is let go by in another currency, or with no payment or amount", async () => {
      const number = await paidOrder();
      for (const over of [
        { currency: "usd" },
        { payment_intent: null },
        { amount: 0 },
      ]) {
        expect(await news(number, over).result).toEqual({
          number: null,
          status: "",
        });
      }
      expect(await disputesOf(number)).toEqual([]);
    });
  });

  it("throws when Stripe cannot be reached, so the news is brought again", async () => {
    const number = await paidOrder();
    await expect(
      news(number, {}, NOW, { down: true }).result,
    ).rejects.toThrow();
    expect(await disputesOf(number)).toEqual([]);
  });

  it("will not move a dispute from one order to another", async () => {
    const first = await paidOrder();
    const second = await paidOrder();
    const seen = (number: string) =>
      execute(
        disputeSeen,
        {
          number,
          reference: "dp_shared",
          amountCents: 8850,
          reason: "duplicate",
          providerStatus: "needs_response",
          openedAt: NOW,
          dueAt: DUE,
        },
        staff,
        { now: NOW },
      );
    expect(await seen(first)).toEqual({ status: "open", changed: true });
    expect(await seen(second)).toEqual({ status: "open", changed: false });
    expect(await disputesOf(first)).toHaveLength(1);
    expect(await disputesOf(second)).toEqual([]);
  });

  function later(days: number): Date {
    return new Date(NOW.getTime() + days * 24 * 60 * 60_000);
  }
});
