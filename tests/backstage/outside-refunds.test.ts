import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, events, orders, refunds } from "@/db/schema";
import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { booksSummary } from "@/lib/backstage/numbers/books";
import { recordRefund } from "@/lib/backstage/orders/ops";
import {
  refundsFromStripe,
  refundsSeen,
} from "@/lib/backstage/orders/outside-refunds";
import { markPaid } from "@/lib/backstage/orders/payments";
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
 * Refunds made from Stripe's own dashboard, written back onto the order.
 * Stripe's list of refunds is the record and its news only the nudge, so
 * most of what matters here is that being told twice writes nothing twice,
 * and that a refund the back end started itself is never counted again.
 */

const staff = systemCaller("Test", "script");
const stripe = systemCaller("Stripe", "webhook");
const ENV = { STRIPE_SECRET_KEY: "sk_test_abc" };

/** Ten in the morning, Thursday 12 November 2026, New Zealand time. */
const WHEN = nzToInstant(2026, 11, 12, 10, 0);
const seconds = (at: Date) => Math.floor(at.getTime() / 1000);

/** A processor that sends the buyer away, like Stripe's hosted page. */
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
  status: string;
  amount: number;
  currency?: string;
  created?: number;
  reason?: string | null;
  metadata?: Record<string, string>;
};

/** Stripe, as far as this needs it: a session, a payment and its refunds. */
function stripeApi(
  held: readonly Held[],
  options: { down?: boolean; whose?: Record<string, string> } = {},
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
    if (path.startsWith("/v1/checkout/sessions/")) {
      const session = path.split("/").at(-1) ?? "";
      return json({
        id: session,
        payment_intent: `pi_${session.replace("cs_test_", "")}`,
      });
    }
    if (path.startsWith("/v1/payment_intents/")) {
      const id = path.split("/").at(-1) ?? "";
      return json({
        id,
        metadata:
          options.whose?.[id] === undefined
            ? {}
            : { order_number: options.whose[id] },
      });
    }
    if (path === "/v1/refunds") return json({ data: held });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { asked, fetchImpl };
}

describe("refunds that were not started here", () => {
  let handle: DbHandle;
  let made = 0;

  /** An order paid on Stripe's page: $88.50, the Squad to a rural address. */
  async function paidOrder(): Promise<string> {
    made += 1;
    const result = await placeOrder(
      {
        email: `outside${String(made)}@example.co.nz`,
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
        test: false,
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
  const refundsOf = async (number: string) =>
    handle.db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, (await orderOf(number)).id))
      .orderBy(asc(refunds.createdAt));
  const logOf = async (number: string) =>
    (
      await handle.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, (await orderOf(number)).id))
        .orderBy(asc(auditLog.at), asc(auditLog.id))
    ).map((entry) => entry.summary);
  const refundedEvents = async (number: string) =>
    handle.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.entityId, (await orderOf(number)).id),
          eq(events.type, "order.refunded"),
        ),
      );
  const told = (
    number: string | null,
    paymentIntent: string | null,
    api: ReturnType<typeof stripeApi>,
  ) =>
    refundsFromStripe(
      { number, paymentIntent },
      { env: ENV, fetchImpl: api.fetchImpl },
    );
  const dashboard = (over: Partial<Held> = {}): Held => ({
    id: "re_dash_1",
    status: "succeeded",
    amount: 2000,
    currency: "nzd",
    created: seconds(WHEN),
    reason: "requested_by_customer",
    ...over,
  });

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  it("writes a refund made in Stripe's dashboard onto the order", async () => {
    const number = await paidOrder();
    const api = stripeApi([dashboard()]);
    expect(await told(number, `pi_${number}`, api)).toEqual({
      number,
      written: 1,
    });
    // Stripe was asked which payment the order was paid with, then what
    // refunds it holds for it. Nothing was sent.
    expect(api.asked).toEqual([
      `/v1/checkout/sessions/cs_test_${number}`,
      "/v1/refunds",
    ]);

    expect(await orderOf(number)).toMatchObject({
      refundedCents: 2000,
      paymentStatus: "part_refunded",
    });
    expect(await refundsOf(number)).toMatchObject([
      {
        amountCents: 2000,
        status: "done",
        providerReference: "re_dash_1",
        reason: "Refunded from Stripe's dashboard: the customer asked",
        createdBy: null,
        // Dated when Stripe made it, not when we heard.
        createdAt: WHEN,
      },
    ]);
    expect(await logOf(number)).toContain(
      `$20 was refunded on ${number} from Stripe's dashboard. Written onto the order.`,
    );
    // The same event as any other refund, so whatever tells the customer
    // tells them about this one too.
    expect(
      (await refundedEvents(number)).map((event) => event.payload),
    ).toEqual([{ number, amountCents: 2000, test: false }]);
  });

  it("writes nothing twice, however often the news arrives", async () => {
    const number = await paidOrder();
    const api = stripeApi([dashboard({ id: "re_dash_2" })]);
    await told(number, `pi_${number}`, api);
    const lines = (await logOf(number)).length;
    for (let again = 0; again < 3; again += 1) {
      expect(await told(number, `pi_${number}`, api)).toEqual({
        number,
        written: 0,
      });
    }
    expect((await orderOf(number)).refundedCents).toBe(2000);
    expect(await refundsOf(number)).toHaveLength(1);
    expect(await refundedEvents(number)).toHaveLength(1);
    // A repeat that did nothing leaves no line in the activity log.
    expect((await logOf(number)).length).toBe(lines);
  });

  it("leaves a refund the back end started itself alone", async () => {
    const number = await paidOrder();
    await execute(
      recordRefund,
      { number, amountCents: 1500, reason: "Arrived damaged" },
      staff,
    );
    const [ours] = await refundsOf(number);
    expect(ours).toMatchObject({ status: "pending", providerReference: null });

    // Stripe sends the same news for our own refund. It carries our id.
    const api = stripeApi([
      dashboard({
        id: "re_ours",
        amount: 1500,
        metadata: { refund_id: ours?.id ?? "", order_number: number },
      }),
    ]);
    expect(await told(number, `pi_${number}`, api)).toEqual({
      number,
      written: 0,
    });
    expect((await orderOf(number)).refundedCents).toBe(1500);
    expect(await refundsOf(number)).toHaveLength(1);

    // With a dashboard refund beside it, only that one is news.
    const both = stripeApi([
      dashboard({
        id: "re_ours",
        amount: 1500,
        metadata: { refund_id: ours?.id ?? "" },
      }),
      dashboard({ id: "re_dash_3", amount: 1000, reason: "duplicate" }),
    ]);
    expect(await told(number, `pi_${number}`, both)).toEqual({
      number,
      written: 1,
    });
    expect(await orderOf(number)).toMatchObject({
      refundedCents: 2500,
      paymentStatus: "part_refunded",
    });
    expect((await refundsOf(number)).map((row) => row.reason).sort()).toEqual([
      "Arrived damaged",
      "Refunded from Stripe's dashboard: it was paid twice",
    ]);
  });

  it("reads several at once, oldest first, and knows a full refund", async () => {
    const number = await paidOrder();
    const api = stripeApi([
      dashboard({
        id: "re_later",
        amount: 6850,
        created: seconds(WHEN) + 3600,
        reason: null,
      }),
      dashboard({ id: "re_first", amount: 2000 }),
      // The same one listed twice is one refund.
      dashboard({ id: "re_first", amount: 2000 }),
    ]);
    expect(await told(number, `pi_${number}`, api)).toEqual({
      number,
      written: 2,
    });
    expect(await orderOf(number)).toMatchObject({
      refundedCents: 8850,
      paymentStatus: "refunded",
    });
    expect(
      (await refundsOf(number)).map((row) => [
        row.providerReference,
        row.amountCents,
        row.reason,
      ]),
    ).toEqual([
      [
        "re_first",
        2000,
        "Refunded from Stripe's dashboard: the customer asked",
      ],
      // No reason given at Stripe: none made up here.
      ["re_later", 6850, "Refunded from Stripe's dashboard"],
    ]);
  });

  it("counts only money that has gone, in New Zealand dollars", async () => {
    const number = await paidOrder();
    const api = stripeApi([
      dashboard({ id: "re_failed", status: "failed" }),
      dashboard({ id: "re_cancelled", status: "canceled" }),
      dashboard({ id: "re_needs", status: "requires_action" }),
      dashboard({ id: "re_usd", currency: "usd" }),
      dashboard({ id: "re_nothing", amount: 0 }),
      // On its way to a bank that takes its time: it has left us.
      dashboard({ id: "re_pending", status: "pending", amount: 500 }),
    ]);
    expect(await told(number, `pi_${number}`, api)).toEqual({
      number,
      written: 1,
    });
    expect(
      (await refundsOf(number)).map((row) => row.providerReference),
    ).toEqual(["re_pending"]);
    expect((await orderOf(number)).refundedCents).toBe(500);
  });

  it("says so when more went back than was paid", async () => {
    const number = await paidOrder();
    await execute(
      recordRefund,
      { number, amountCents: 8850, reason: "Order cancelled" },
      staff,
    );
    // Somebody refunded it in the dashboard as well.
    const api = stripeApi([dashboard({ id: "re_twice", amount: 8850 })]);
    await told(number, `pi_${number}`, api);
    expect(await orderOf(number)).toMatchObject({
      refundedCents: 17700,
      paymentStatus: "refunded",
    });
    expect(await logOf(number)).toContain(
      `$88.50 was refunded on ${number} from Stripe's dashboard. Written onto the order. That makes more given back than the $88.50 that was paid: have a look in Stripe.`,
    );
  });

  describe("finding the order", () => {
    it("asks Stripe whose payment it is when the news does not say", async () => {
      const number = await paidOrder();
      const api = stripeApi([dashboard({ id: "re_found" })], {
        whose: { [`pi_${number}`]: number },
      });
      expect(await told(null, `pi_${number}`, api)).toEqual({
        number,
        written: 1,
      });
      expect(api.asked).toEqual([
        `/v1/payment_intents/pi_${number}`,
        `/v1/checkout/sessions/cs_test_${number}`,
        "/v1/refunds",
      ]);
    });

    it("lets a payment that is nobody's here go by", async () => {
      const api = stripeApi([dashboard()], { whose: {} });
      expect(await told(null, "pi_somebody_elses", api)).toEqual({
        number: null,
        written: 0,
      });
      // It was asked about and that is all: no refunds were read.
      expect(api.asked).toEqual(["/v1/payment_intents/pi_somebody_elses"]);
      expect(await told(null, null, stripeApi([]))).toEqual({
        number: null,
        written: 0,
      });
    });

    it("writes nothing for an order number that is not one of ours", async () => {
      const api = stripeApi([dashboard()]);
      expect(await told("QP-222222", "pi_x", api)).toEqual({
        number: null,
        written: 0,
      });
      expect(api.asked).toEqual([]);
    });

    it("writes nothing when the payment is not the one the order was paid with", async () => {
      const number = await paidOrder();
      const api = stripeApi([dashboard({ id: "re_wrong_payment" })]);
      expect(await told(number, "pi_another_payment", api)).toEqual({
        number: null,
        written: 0,
      });
      expect((await orderOf(number)).refundedCents).toBe(0);
      // The refunds were never read.
      expect(api.asked).toEqual([`/v1/checkout/sessions/cs_test_${number}`]);
    });

    it("writes nothing for an order that was not paid on Stripe's page", async () => {
      // The practice checkout: nothing at Stripe to ask about.
      const result = await placeOrder(
        {
          email: "practice@example.co.nz",
          phone: "",
          firstName: "Sam",
          lastName: "Tester",
          line1: "12 Sideline Road",
          line2: "",
          suburb: "",
          city: "Ōtaki",
          region: "Wellington",
          postcode: "5512",
          rural: false,
          notes: "",
          joinCrew: false,
          lines: [{ sku: "QP-SHOT-12", qty: 1 }],
        },
        {
          payments: {
            name: "test",
            isTest: true,
            savesFirst: false,
            begin: async (request) => ({
              kind: "done",
              payment: {
                provider: "test",
                status: "test",
                reference: `TEST-${request.orderNumber}`,
              },
            }),
          },
          store: getStore({ NODE_ENV: "test" }),
        },
      );
      if (!result.ok) throw new Error("Not placed");
      const api = stripeApi([dashboard()]);
      expect(await told(result.order.number, "pi_x", api)).toEqual({
        number: null,
        written: 0,
      });
      expect(api.asked).toEqual([]);
    });
  });

  it("throws when Stripe cannot be reached, so the news is brought again", async () => {
    const number = await paidOrder();
    await expect(
      told(number, `pi_${number}`, stripeApi([], { down: true })),
    ).rejects.toThrow();
    expect((await orderOf(number)).refundedCents).toBe(0);
    // And without a key there is nobody to ask.
    await expect(
      refundsFromStripe({ number, paymentIntent: null }, { env: {} }),
    ).rejects.toThrow("STRIPE_SECRET_KEY");
  });

  it("shows in the books on the day Stripe gave the money back", async () => {
    const number = await paidOrder();
    // Paid today; refunded at Stripe three days from now.
    const gave = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    await told(
      number,
      `pi_${number}`,
      stripeApi([
        dashboard({ id: "re_books", amount: 1234, created: seconds(gave) }),
      ]),
    );
    const day = nzDateKey(gave);
    const books = await execute(booksSummary, { from: day, to: day }, staff);
    expect(books.days).toMatchObject([
      { day, orders: 0, refundedCents: 1234, keptCents: -1234 },
    ]);
  });

  it("is the same operation whoever brings the list", async () => {
    // A bot, or a person with a list read off Stripe's dashboard, can hand
    // the same thing straight to the operation.
    const number = await paidOrder();
    const first = await execute(
      refundsSeen,
      {
        number,
        refunds: [{ reference: "re_by_hand", amountCents: 700, at: WHEN }],
      },
      staff,
    );
    expect(first).toEqual({ written: 1, refundedCents: 700 });
    const again = await execute(
      refundsSeen,
      {
        number,
        refunds: [{ reference: "re_by_hand", amountCents: 700, at: WHEN }],
      },
      staff,
    );
    expect(again).toEqual({ written: 0, refundedCents: 700 });
    await expect(
      execute(refundsSeen, { number: "QP-222222", refunds: [] }, staff),
    ).rejects.toThrow();
  });
});
