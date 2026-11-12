import { describe, expect, it } from "vitest";

import { getPaymentProvider, checkoutMode } from "@/lib/shop/payments";
import type { ChargeRequest } from "@/lib/shop/payments";
import {
  createCheckoutSession,
  createRefund,
  isStripeTestKey,
  paymentPageLook,
  sessionExtras,
  sessionParams,
  signForTest,
  StripeError,
  stripeForm,
  stripeProvider,
  verifyStripeSignature,
} from "@/lib/shop/payments/stripe";
import {
  handleStripeEvent,
  type OrderBook,
} from "@/lib/shop/payments/stripe-events";

const request = (over: Partial<ChargeRequest> = {}): ChargeRequest => ({
  orderNumber: "QP-7K2M9X",
  amountCents: 8850,
  currency: "NZD",
  email: "sam@example.co.nz",
  lines: [{ name: "The Squad", qty: 1, unitCents: 8400 }],
  shippingCents: 450,
  successUrl: "https://shop.example/order/thanks",
  cancelUrl: "https://shop.example/checkout?payment=cancelled",
  ...over,
});

const NOW = new Date("2026-11-12T09:00:00Z");

/** A stand-in for fetch that records what it was asked and answers as told. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, impl };
}

describe("stripeForm", () => {
  it("writes nesting the way Stripe reads it", () => {
    const encoded = stripeForm({
      mode: "payment",
      line_items: [
        { quantity: 2, price_data: { currency: "nzd", unit_amount: 2700 } },
      ],
      metadata: { order_number: "QP-7K2M9X" },
      skipped: undefined,
      alsoSkipped: null,
    });
    const params = new URLSearchParams(encoded);
    expect(params.get("mode")).toBe("payment");
    expect(params.get("line_items[0][quantity]")).toBe("2");
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("2700");
    expect(params.get("metadata[order_number]")).toBe("QP-7K2M9X");
    expect([...params.keys()]).not.toContain("skipped");
    expect([...params.keys()]).not.toContain("alsoSkipped");
  });
});

describe("sessionParams", () => {
  it("asks for exactly the order's lines and delivery, in cents", () => {
    const params = sessionParams(request(), NOW) as {
      line_items: { quantity: number; price_data: { unit_amount: number } }[];
      client_reference_id: string;
      expires_at: number;
      customer_email: string;
    };
    expect(params.client_reference_id).toBe("QP-7K2M9X");
    expect(params.customer_email).toBe("sam@example.co.nz");
    expect(params.line_items).toHaveLength(2);
    const total = params.line_items.reduce(
      (sum, item) => sum + item.quantity * item.price_data.unit_amount,
      0,
    );
    expect(total).toBe(8850);
    // Half an hour and a bit: the shortest Stripe allows.
    expect(params.expires_at).toBe(Math.floor(NOW.getTime() / 1000) + 31 * 60);
  });

  it("leaves delivery off when it is free", () => {
    const params = sessionParams(
      request({ shippingCents: 0, amountCents: 8400 }),
      NOW,
    ) as { line_items: unknown[] };
    expect(params.line_items).toHaveLength(1);
  });
});

describe("talking to Stripe", () => {
  it("makes one payment page per order number", async () => {
    const { calls, impl } = fakeFetch(200, {
      id: "cs_test_123",
      url: "https://checkout.stripe.example/pay/cs_test_123",
    });
    const session = await createCheckoutSession(
      "sk_test_abc",
      request(),
      NOW,
      impl,
    );
    expect(session.id).toBe("cs_test_123");
    expect(calls).toHaveLength(1);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(calls[0]?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(headers.Authorization).toBe("Bearer sk_test_abc");
    expect(headers["Idempotency-Key"]).toBe("checkout-QP-7K2M9X");
    expect(String(calls[0]?.init.body)).toContain(
      "client_reference_id=QP-7K2M9X",
    );
  });

  it("asks for New Zealand dollars only, and the shop's own colours", async () => {
    const { calls, impl } = fakeFetch(200, {
      id: "cs_test_1",
      url: "https://x",
    });
    const look = paymentPageLook(
      (token) => (token === "cream" ? "#fcf0d6" : "#22235c"),
      "Quick Pickle",
    );
    await createCheckoutSession("sk_test_abc", request(), NOW, impl, look);
    const body = new URLSearchParams(String(calls[0]?.init.body));
    expect(body.get("adaptive_pricing[enabled]")).toBe("false");
    expect(body.get("branding_settings[display_name]")).toBe("Quick Pickle");
    expect(body.get("branding_settings[background_color]")).toBe("#fcf0d6");
    expect(body.get("branding_settings[button_color]")).toBe("#22235c");
    // The niceties never touch what is charged.
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("8400");
    expect(Object.keys(sessionExtras(look))).toEqual([
      "adaptive_pricing",
      "branding_settings",
    ]);
    expect(Object.keys(sessionExtras())).toEqual(["adaptive_pricing"]);
  });

  it("asks again without a nicety Stripe will not take, rather than lose the sale", async () => {
    const calls: { key: string; body: URLSearchParams }[] = [];
    const impl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      const headers = init?.headers as Record<string, string>;
      calls.push({ key: headers["Idempotency-Key"] ?? "", body });
      if (body.has("branding_settings[display_name]")) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Received unknown parameter: branding_settings",
              code: "parameter_unknown",
              param: "branding_settings",
            },
          }),
          { status: 400 },
        );
      }
      return new Response(
        JSON.stringify({ id: "cs_test_2", url: "https://x" }),
        {
          status: 200,
        },
      );
    }) as typeof fetch;
    const look = paymentPageLook(() => "#000000", "Quick Pickle");

    const session = await createCheckoutSession(
      "sk_test_abc",
      request(),
      NOW,
      impl,
      look,
    );
    expect(session.id).toBe("cs_test_2");
    expect(calls.map((call) => call.key)).toEqual([
      "checkout-QP-7K2M9X",
      "checkout-QP-7K2M9X-no-branding_settings",
    ]);
    // Only the refused one is left out. The rest of the order is untouched.
    expect(calls[1]?.body.has("branding_settings[display_name]")).toBe(false);
    expect(calls[1]?.body.get("adaptive_pricing[enabled]")).toBe("false");
    expect(calls[1]?.body.get("client_reference_id")).toBe("QP-7K2M9X");
    expect(calls[1]?.body.get("line_items[0][price_data][unit_amount]")).toBe(
      "8400",
    );
  });

  it("drops every nicety when Stripe will not say which one it minds", async () => {
    const keys: string[] = [];
    const impl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      keys.push(
        (init?.headers as Record<string, string>)["Idempotency-Key"] ?? "",
      );
      if (body.has("adaptive_pricing[enabled]")) {
        return new Response(
          JSON.stringify({
            error: { message: "Something about this request." },
          }),
          { status: 400 },
        );
      }
      return new Response(
        JSON.stringify({ id: "cs_test_3", url: "https://x" }),
        {
          status: 200,
        },
      );
    }) as typeof fetch;
    const look = paymentPageLook(() => "#000000", "Quick Pickle");
    const session = await createCheckoutSession(
      "sk_test_abc",
      request(),
      NOW,
      impl,
      look,
    );
    expect(session.id).toBe("cs_test_3");
    expect(keys).toEqual([
      "checkout-QP-7K2M9X",
      "checkout-QP-7K2M9X-no-adaptive_pricing-branding_settings",
    ]);
  });

  it("gives up when even the plain order is refused, and only asks for that once", async () => {
    const { calls, impl } = fakeFetch(400, {
      error: {
        message: "Invalid integer",
        code: "parameter_invalid_integer",
        param: "line_items[0][price_data][unit_amount]",
      },
    });
    await expect(
      createCheckoutSession("sk_test_abc", request(), NOW, impl),
    ).rejects.toMatchObject({ status: 400 });
    // Once with the nicety, once plain. Not a third time.
    expect(calls).toHaveLength(2);
    expect(String(calls[1]?.init.body)).not.toContain("adaptive_pricing");
  });

  it("does not ask again when Stripe is down or the key is wrong", async () => {
    for (const status of [401, 429, 500]) {
      const { calls, impl } = fakeFetch(status, { error: { message: "No." } });
      await expect(
        createCheckoutSession("sk_test_abc", request(), NOW, impl),
      ).rejects.toMatchObject({ status });
      expect(calls).toHaveLength(1);
    }
  });

  it("turns a refusal into an error that does not carry the key", async () => {
    const { impl } = fakeFetch(402, {
      error: { message: "Your card was declined.", code: "card_declined" },
    });
    const failure = await createCheckoutSession(
      "sk_test_secretsecret",
      request(),
      NOW,
      impl,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StripeError);
    const error = failure as StripeError;
    expect(error.status).toBe(402);
    expect(error.code).toBe("card_declined");
    expect(error.message).not.toContain("sk_test_secretsecret");
  });

  it("refunds by our own refund id, so asking twice refunds once", async () => {
    const { calls, impl } = fakeFetch(200, {
      id: "re_1",
      status: "succeeded",
      amount: 2700,
    });
    await createRefund(
      "sk_test_abc",
      {
        paymentIntent: "pi_1",
        amountCents: 2700,
        refundId: "rfd_abc",
        orderNumber: "QP-7K2M9X",
      },
      impl,
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("refund-rfd_abc");
    const body = new URLSearchParams(String(calls[0]?.init.body));
    expect(body.get("payment_intent")).toBe("pi_1");
    expect(body.get("amount")).toBe("2700");
  });
});

describe("the provider", () => {
  it("is picked by name and needs its key", () => {
    expect(() => getPaymentProvider({ PAYMENT_PROVIDER: "stripe" })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
    const provider = getPaymentProvider({
      PAYMENT_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk_test_abc",
    });
    expect(provider.name).toBe("stripe");
    expect(provider.savesFirst).toBe(true);
    expect(provider.isTest).toBe(true);
  });

  it("knows a test key from a live one", () => {
    expect(isStripeTestKey("sk_test_abc")).toBe(true);
    expect(isStripeTestKey("rk_test_abc")).toBe(true);
    expect(isStripeTestKey("sk_live_abc")).toBe(false);
  });

  it("tells the checkout which of three things paying means", () => {
    expect(checkoutMode({})).toBe("practice");
    expect(
      checkoutMode({
        PAYMENT_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_test_abc",
      }),
    ).toBe("sandbox");
    expect(
      checkoutMode({
        PAYMENT_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_live_abc",
      }),
    ).toBe("live");
    // A broken setting never reads as "live".
    expect(checkoutMode({ PAYMENT_PROVIDER: "strpie" })).toBe("practice");
  });

  it("sends the buyer to the page Stripe gives back", async () => {
    const { impl } = fakeFetch(200, {
      id: "cs_test_9",
      url: "https://checkout.stripe.example/pay/cs_test_9",
    });
    const provider = stripeProvider({ STRIPE_SECRET_KEY: "sk_test_abc" }, impl);
    const started = await provider.begin(request(), NOW);
    expect(started).toEqual({
      kind: "redirect",
      url: "https://checkout.stripe.example/pay/cs_test_9",
      payment: {
        provider: "stripe",
        status: "pending",
        reference: "cs_test_9",
      },
    });
  });

  it("fails rather than send the buyer nowhere", async () => {
    const { impl } = fakeFetch(200, { id: "cs_test_9", url: null });
    const provider = stripeProvider({ STRIPE_SECRET_KEY: "sk_test_abc" }, impl);
    await expect(provider.begin(request(), NOW)).rejects.toBeInstanceOf(
      StripeError,
    );
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
  });
  const at = 1_800_000_000;
  const nowMs = at * 1000;

  it("accepts a body Stripe signed", () => {
    expect(
      verifyStripeSignature(body, signForTest(body, secret, at), secret, nowMs),
    ).toBe(true);
  });

  it("refuses a different secret", () => {
    expect(
      verifyStripeSignature(
        body,
        signForTest(body, "whsec_other", at),
        secret,
        nowMs,
      ),
    ).toBe(false);
  });

  it("refuses a body that was changed after signing", () => {
    const header = signForTest(body, secret, at);
    expect(
      verifyStripeSignature(
        body.replace("evt_1", "evt_2"),
        header,
        secret,
        nowMs,
      ),
    ).toBe(false);
  });

  it("refuses a signature older than five minutes, or from the future", () => {
    const header = signForTest(body, secret, at);
    expect(verifyStripeSignature(body, header, secret, (at + 301) * 1000)).toBe(
      false,
    );
    expect(verifyStripeSignature(body, header, secret, (at - 301) * 1000)).toBe(
      false,
    );
    expect(verifyStripeSignature(body, header, secret, (at + 299) * 1000)).toBe(
      true,
    );
  });

  it("accepts when any one of several signatures matches", () => {
    const good = signForTest(body, secret, at);
    const header = `${good.split(",")[0]},v1=${"0".repeat(64)},${good.split(",")[1]}`;
    expect(verifyStripeSignature(body, header, secret, nowMs)).toBe(true);
  });

  it("refuses a missing or malformed header, and an empty secret", () => {
    expect(verifyStripeSignature(body, null, secret, nowMs)).toBe(false);
    expect(verifyStripeSignature(body, "", secret, nowMs)).toBe(false);
    expect(verifyStripeSignature(body, "t=abc,v1=zz", secret, nowMs)).toBe(
      false,
    );
    expect(verifyStripeSignature(body, `t=${String(at)}`, secret, nowMs)).toBe(
      false,
    );
    expect(
      verifyStripeSignature(body, signForTest(body, "", at), "", nowMs),
    ).toBe(false);
  });
});

describe("handleStripeEvent", () => {
  function book() {
    const paid: Parameters<OrderBook["markPaid"]>[0][] = [];
    const closed: Parameters<OrderBook["closeUnpaid"]>[0][] = [];
    const impl: OrderBook = {
      async markPaid(input) {
        paid.push(input);
        return { outcome: "paid" };
      },
      async closeUnpaid(input) {
        closed.push(input);
      },
    };
    return { paid, closed, impl };
  }

  const session = (over: Record<string, unknown> = {}) => ({
    id: "cs_test_1",
    client_reference_id: "QP-7K2M9X",
    payment_status: "paid",
    amount_total: 8850,
    currency: "nzd",
    ...over,
  });

  it("marks the order paid with what Stripe says was paid", async () => {
    const b = book();
    const outcome = await handleStripeEvent(
      {
        type: "checkout.session.completed",
        livemode: false,
        data: { object: session() },
      },
      b.impl,
    );
    expect(outcome).toEqual({
      action: "paid",
      number: "QP-7K2M9X",
      outcome: "paid",
    });
    expect(b.paid).toEqual([
      {
        number: "QP-7K2M9X",
        provider: "stripe",
        reference: "cs_test_1",
        amountCents: 8850,
        currency: "nzd",
        test: true,
      },
    ]);
  });

  it("only calls it real money when Stripe says the event is live", async () => {
    const b = book();
    await handleStripeEvent(
      {
        type: "checkout.session.completed",
        livemode: true,
        data: { object: session() },
      },
      b.impl,
    );
    expect(b.paid[0]?.test).toBe(false);
  });

  it("waits when the session is complete but the money is not in", async () => {
    const b = book();
    const outcome = await handleStripeEvent(
      {
        type: "checkout.session.completed",
        data: { object: session({ payment_status: "unpaid" }) },
      },
      b.impl,
    );
    expect(outcome).toEqual({ action: "waiting", number: "QP-7K2M9X" });
    expect(b.paid).toHaveLength(0);
  });

  it("closes the order when the page runs out or the payment fails", async () => {
    const b = book();
    await handleStripeEvent(
      { type: "checkout.session.expired", data: { object: session() } },
      b.impl,
    );
    await handleStripeEvent(
      {
        type: "checkout.session.async_payment_failed",
        data: { object: session() },
      },
      b.impl,
    );
    expect(b.closed.map((item) => item.number)).toEqual([
      "QP-7K2M9X",
      "QP-7K2M9X",
    ]);
    expect(b.paid).toHaveLength(0);
  });

  it("finds the order number in the metadata if the reference is missing", async () => {
    const b = book();
    await handleStripeEvent(
      {
        type: "checkout.session.completed",
        data: {
          object: session({
            client_reference_id: null,
            metadata: { order_number: "QP-7K2M9X" },
          }),
        },
      },
      b.impl,
    );
    expect(b.paid).toHaveLength(1);
  });

  it("ignores events that are not ours to act on", async () => {
    const b = book();
    const cases = [
      { type: "customer.created", data: { object: session() } },
      {
        type: "checkout.session.completed",
        data: { object: session({ client_reference_id: "someone-elses" }) },
      },
      { type: "checkout.session.completed", data: null },
      {
        type: "checkout.session.completed",
        data: { object: session({ amount_total: "8850" }) },
      },
      {},
    ];
    for (const event of cases) {
      const outcome = await handleStripeEvent(event, b.impl);
      expect(outcome.action).toBe("ignored");
    }
    expect(b.paid).toHaveLength(0);
    expect(b.closed).toHaveLength(0);
  });
});
