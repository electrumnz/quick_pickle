import { describe, expect, it } from "vitest";

import { PACKS, SHIPPING, STORE } from "@/content/offer";
import {
  newOrderNumber,
  ORDER_NUMBER_PATTERN,
  type Order,
} from "@/lib/shop/order";
import type { ChargeRequest, PaymentProvider } from "@/lib/shop/payments";
import { getPaymentProvider, paymentsAreTest } from "@/lib/shop/payments";
import { placeOrder, type OrderSink } from "@/lib/shop/place-order";
import { parseReceipt, receiptFor } from "@/lib/shop/receipt";
import { FILE_OFFER } from "@/lib/shop/offer";

const small = PACKS[0]!;
const big = PACKS[PACKS.length - 1]!;

function good(overrides: Record<string, unknown> = {}) {
  return {
    email: "  Sam@Example.CO.NZ ",
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
    lines: [{ sku: small.sku, qty: 1 }],
    ...overrides,
  };
}

function harness() {
  const charges: ChargeRequest[] = [];
  const orders: Order[] = [];
  const signups: string[] = [];
  const payments: PaymentProvider = {
    name: "spy",
    isTest: true,
    savesFirst: false,
    async begin(request) {
      charges.push(request);
      return {
        kind: "done",
        payment: {
          provider: "spy",
          status: "test",
          reference: `SPY-${request.orderNumber}`,
        },
      };
    },
  };
  const store: OrderSink = {
    async saveOrder(order) {
      orders.push(order);
    },
    async saveSignup(signup) {
      signups.push(signup.email);
    },
  };
  return {
    charges,
    orders,
    signups,
    deps: { offer: FILE_OFFER, payments, store },
  };
}

describe("placing an order", () => {
  it("records a valid order, priced from the offer", async () => {
    const h = harness();
    const result = await placeOrder(good(), h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.number).toMatch(ORDER_NUMBER_PATTERN);
    expect(result.order.mode).toBe(STORE.launchMode);
    expect(result.order.customer.email).toBe("sam@example.co.nz");
    expect(result.order.subtotalCents).toBe(small.priceCents);
    expect(result.order.totalCents).toBe(
      result.order.subtotalCents + result.order.shippingCents,
    );
    expect(h.orders).toEqual([result.order]);
  });

  it("charges exactly the total it worked out, once", async () => {
    const h = harness();
    const result = await placeOrder(
      good({ lines: [{ sku: big.sku, qty: 2 }], rural: true }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]?.amountCents).toBe(result.order.totalCents);
    expect(h.charges[0]?.currency).toBe("NZD");
    expect(result.order.shippingCents).toBeGreaterThanOrEqual(
      SHIPPING.ruralSurchargeCents,
    );
  });

  it("names each line by its pack and its flavour, on the order and the payment page", async () => {
    const h = harness();
    const result = await placeOrder(
      good({
        lines: [
          { sku: `${big.sku}-MCL`, qty: 1 },
          { sku: small.sku, qty: 2 },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.lines).toMatchObject([
      { sku: small.sku, name: `${small.name}, Original`, qty: 2 },
      {
        sku: `${big.sku}-MCL`,
        name: `${big.name}, Mango Chilli Lime`,
        unitCents: big.priceCents,
        qty: 1,
      },
    ]);
    expect(h.charges[0]?.lines.map((line) => line.name)).toEqual([
      `${small.name}, Original`,
      `${big.name}, Mango Chilli Lime`,
    ]);
  });

  it("cannot be talked into a different price", async () => {
    const h = harness();
    const result = await placeOrder(
      good({
        lines: [
          { sku: big.sku, qty: 1, priceCents: 1, unitCents: 1, lineCents: 1 },
        ],
        totalCents: 1,
        subtotalCents: 1,
        shippingCents: 0,
      }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.subtotalCents).toBe(big.priceCents);
    expect(h.charges[0]?.amountCents).toBe(result.order.totalCents);
    expect(result.order.totalCents).toBeGreaterThanOrEqual(big.priceCents);
  });

  it("refuses a pack that is not on the shelf", async () => {
    const h = harness();
    const result = await placeOrder(
      good({ lines: [{ sku: "FREE-STUFF", qty: 1 }] }),
      h.deps,
    );
    expect(result.ok).toBe(false);
    expect(h.charges).toHaveLength(0);
    expect(h.orders).toHaveLength(0);
  });

  it("refuses an empty jar, a zero quantity and a silly quantity", async () => {
    for (const lines of [
      [],
      [{ sku: small.sku, qty: 0 }],
      [{ sku: small.sku, qty: -3 }],
      [{ sku: small.sku, qty: 1.5 }],
      [{ sku: small.sku, qty: 9999 }],
      "not-an-array",
    ]) {
      const h = harness();
      const result = await placeOrder(good({ lines }), h.deps);
      expect(result.ok).toBe(false);
      expect(h.charges).toHaveLength(0);
      expect(h.orders).toHaveLength(0);
    }
  });

  it("says which fields are wrong, and takes no money", async () => {
    const h = harness();
    const result = await placeOrder(
      good({ email: "nope", firstName: " ", postcode: "12", region: "Narnia" }),
      h.deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "invalid")
      throw new Error("expected invalid");
    expect(Object.keys(result.errors).sort()).toEqual([
      "email",
      "firstName",
      "postcode",
      "region",
    ]);
    expect(h.charges).toHaveLength(0);
  });

  it("accepts a macron in a place name and keeps it", async () => {
    const h = harness();
    const result = await placeOrder(good({ city: "Whangārei" }), h.deps);
    expect(result.ok && result.order.delivery.city).toBe("Whangārei");
  });

  it("writes nothing down when the payment fails", async () => {
    const h = harness();
    const result = await placeOrder(good(), {
      ...h.deps,
      payments: {
        name: "broken",
        isTest: true,
        savesFirst: false,
        async begin() {
          throw new Error("declined");
        },
      },
    });
    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(h.orders).toHaveLength(0);
  });

  it("joins the crew only when asked, and never loses the order over it", async () => {
    const yes = harness();
    await placeOrder(good({ joinCrew: true }), yes.deps);
    expect(yes.signups).toEqual(["sam@example.co.nz"]);

    const no = harness();
    await placeOrder(good(), no.deps);
    expect(no.signups).toEqual([]);

    const flaky = harness();
    const result = await placeOrder(good({ joinCrew: true }), {
      ...flaky.deps,
      store: {
        saveOrder: flaky.deps.store.saveOrder,
        async saveSignup() {
          throw new Error("list is down");
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(flaky.orders).toHaveLength(1);
  });
});

describe("where a visit came from, and who is asking about a code", () => {
  it("hands the visit's labels on with the order, and nothing when there are none", async () => {
    const h = harness();
    await placeOrder(
      good({ source: { via: "rovers", utm_source: "rovers" } }),
      h.deps,
    );
    await placeOrder(good(), h.deps);
    expect(h.orders[0]?.source).toEqual({
      via: "rovers",
      utm_source: "rovers",
    });
    expect(h.orders[1]).not.toHaveProperty("source");
  });

  it("never loses an order over a label it cannot read", async () => {
    for (const source of [
      "not an object",
      42,
      ["via", "rovers"],
      { via: 7 },
      { via: "x".repeat(500) },
      Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [`k${String(index)}`, "v"]),
      ),
    ]) {
      const h = harness();
      const result = await placeOrder(good({ source }), h.deps);
      expect(result.ok, JSON.stringify(source).slice(0, 40)).toBe(true);
      expect(h.orders[0]).not.toHaveProperty("source");
    }
  });

  it("tells the code check who the buyer is, tidied, both times it asks", async () => {
    const h = harness();
    const asked: (string | undefined)[] = [];
    let refuseSave = false;
    const store: OrderSink = {
      ...h.deps.store,
      async saveOrder(order) {
        if (refuseSave) throw new Error("the code's last use just went");
        await h.deps.store.saveOrder(order);
      },
      async checkCode(_code, order) {
        asked.push(order.email);
        return {
          ok: true,
          code: "CREW10",
          label: "10% off",
          discountCents: 270,
          deliveryDiscountCents: 0,
        };
      },
    };
    const deps = { ...h.deps, store };
    expect((await placeOrder(good({ promoCode: "crew10" }), deps)).ok).toBe(
      true,
    );
    expect(asked).toEqual(["sam@example.co.nz"]);

    // When saving refuses, the code is asked about again, for the same buyer.
    refuseSave = true;
    await placeOrder(good({ promoCode: "crew10" }), deps);
    expect(asked).toEqual([
      "sam@example.co.nz",
      "sam@example.co.nz",
      "sam@example.co.nz",
    ]);
  });
});

describe("a special, which comes off with nothing typed", () => {
  type Special = Awaited<ReturnType<NonNullable<OrderSink["special"]>>>;
  const LAUNCH: Special = {
    ok: true,
    code: "LAUNCH",
    name: "Launch week",
    label: "10% off",
    discountCents: 270,
    deliveryDiscountCents: 0,
  };
  const code = (discountCents: number) => ({
    ok: true as const,
    code: "CREW10",
    label: "a code",
    discountCents,
    deliveryDiscountCents: 0,
  });

  function withSpecial(special: () => Special | Promise<Special>) {
    const h = harness();
    const store: OrderSink = {
      ...h.deps.store,
      special: async () => special(),
    };
    return { ...h, deps: { ...h.deps, store } };
  }

  it("is taken off, named on the order, and said on the payment page", async () => {
    const h = withSpecial(() => LAUNCH);
    const result = await placeOrder(good(), h.deps);
    expect(result.ok).toBe(true);
    expect(h.orders[0]).toMatchObject({
      discountCents: 270,
      totalCents: small.priceCents - 270 + SHIPPING.standardCents,
      promo: {
        code: "LAUNCH",
        deliveryDiscountCents: 0,
        special: "Launch week",
      },
    });
    expect(h.orders[0]?.creditCode).toBeUndefined();
    expect(h.charges[0]).toMatchObject({
      amountCents: small.priceCents - 270 + SHIPPING.standardCents,
      discountCents: 270,
      discountLabel: "Special: Launch week",
    });
    // One with no name of its own goes by what it gives.
    const plain = withSpecial(() => ({ ...LAUNCH, name: "" }));
    await placeOrder(good(), plain.deps);
    expect(plain.orders[0]?.promo?.special).toBe("10% off");
    expect(plain.charges[0]?.discountLabel).toBe("Special: 10% off");
  });

  it("is asked about the jar as priced here, never as the browser says", async () => {
    const seen: unknown[] = [];
    const h = withSpecial(() => ({ ok: false }));
    const store: OrderSink = {
      ...h.deps.store,
      special: async (order) => {
        seen.push(order);
        return { ok: false };
      },
    };
    await placeOrder(
      good({ lines: [{ sku: small.sku, qty: 2 }], subtotalCents: 1 }),
      { ...h.deps, store },
    );
    expect(seen).toEqual([
      {
        subtotalCents: small.priceCents * 2,
        deliveryCents:
          small.priceCents * 2 >= SHIPPING.freeOverCents
            ? 0
            : SHIPPING.standardCents,
      },
    ]);
  });

  it("is one saving an order: the bigger wins, and a tie goes to the code", async () => {
    for (const [codeCents, wins, credit] of [
      [200, "LAUNCH", "CREW10"],
      [270, "CREW10", undefined],
      [400, "CREW10", undefined],
    ] as const) {
      const h = withSpecial(() => LAUNCH);
      const store: OrderSink = {
        ...h.deps.store,
        checkCode: async () => code(codeCents),
      };
      const result = await placeOrder(good({ promoCode: "crew10" }), {
        ...h.deps,
        store,
      });
      expect(result.ok, String(codeCents)).toBe(true);
      expect(h.orders[0]?.promo?.code, String(codeCents)).toBe(wins);
      expect(h.orders[0]?.discountCents).toBe(Math.max(codeCents, 270));
      // A code the special beat still says whose order it was.
      expect(h.orders[0]?.creditCode, String(codeCents)).toBe(credit);
    }
  });

  it("still refuses a code that cannot be used, whatever the special gives", async () => {
    const h = withSpecial(() => LAUNCH);
    const store: OrderSink = {
      ...h.deps.store,
      checkCode: async () => ({ ok: false, reason: "That code has finished." }),
    };
    const result = await placeOrder(good({ promoCode: "OLD" }), {
      ...h.deps,
      store,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { promoCode: "That code has finished." },
    });
    expect(h.orders).toHaveLength(0);
    expect(h.charges).toHaveLength(0);
  });

  it("never takes more than the buyer was shown: a special that has gone stops the order", async () => {
    for (const now of [
      () => ({ ok: false }) as Special,
      () => ({ ...LAUNCH, code: "OTHER" }) as Special,
      () => Promise.reject(new Error("the database blinked")),
    ]) {
      const h = withSpecial(now);
      const result = await placeOrder(good({ special: "launch" }), h.deps);
      expect(result).toMatchObject({
        ok: false,
        reason: "invalid",
        errors: { special: expect.stringContaining("total is different") },
      });
      expect(h.orders).toHaveLength(0);
      expect(h.charges).toHaveLength(0);
    }
    // Shown, and still what comes off.
    const h = withSpecial(() => LAUNCH);
    expect((await placeOrder(good({ special: " launch " }), h.deps)).ok).toBe(
      true,
    );
  });

  it("gives a special nobody was shown: paying less needs nobody's leave", async () => {
    const h = withSpecial(() => LAUNCH);
    expect((await placeOrder(good({ special: "" }), h.deps)).ok).toBe(true);
    expect(h.orders[0]?.promo?.code).toBe("LAUNCH");
    // And one that cannot be read is simply no special.
    const blind = withSpecial(() => Promise.reject(new Error("down")));
    expect((await placeOrder(good(), blind.deps)).ok).toBe(true);
    expect(blind.orders[0]).toMatchObject({ promo: null, discountCents: 0 });
  });

  it("says the total changed when saving refuses a special that was fine a moment ago", async () => {
    let calls = 0;
    const h = withSpecial(() => {
      calls += 1;
      return calls === 1 ? LAUNCH : { ok: false };
    });
    const store: OrderSink = {
      ...h.deps.store,
      async saveOrder() {
        throw new Error("its last use just went");
      },
    };
    const result = await placeOrder(good(), { ...h.deps, store });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { special: expect.stringContaining("total is different") },
    });
    // Still there and unchanged: then it was something else that failed.
    const steady = withSpecial(() => LAUNCH);
    const failing: OrderSink = {
      ...steady.deps.store,
      async saveOrder() {
        throw new Error("the disk is full");
      },
    };
    expect(
      await placeOrder(good(), { ...steady.deps, store: failing }),
    ).toEqual({ ok: false, reason: "failed" });
  });
});

describe("order numbers", () => {
  it("are QP- and six unambiguous characters", () => {
    for (let i = 0; i < 200; i += 1) {
      const number = newOrderNumber();
      expect(number).toMatch(ORDER_NUMBER_PATTERN);
      expect(number).not.toMatch(/[01ILOU]/);
    }
  });
});

describe("the receipt", () => {
  it("round-trips an order's summary", async () => {
    const h = harness();
    const result = await placeOrder(good(), h.deps);
    if (!result.ok) throw new Error("expected ok");
    const receipt = receiptFor(result.order);
    expect(parseReceipt(JSON.stringify(receipt))).toEqual(receipt);
    expect(receipt.test).toBe(true);
  });

  it("rejects anything that is not a well-formed receipt", () => {
    for (const raw of [
      undefined,
      "",
      "not json",
      "{}",
      JSON.stringify({ number: "QP-AAAAAA" }),
      JSON.stringify({ number: "<script>", lines: [] }),
    ]) {
      expect(parseReceipt(raw)).toBeNull();
    }
  });
});

describe("the payment seam", () => {
  it("defaults to the test provider, which moves no money", () => {
    expect(getPaymentProvider({}).isTest).toBe(true);
    expect(paymentsAreTest({})).toBe(true);
  });

  it("refuses an unknown provider instead of quietly going to test mode", () => {
    expect(() => getPaymentProvider({ PAYMENT_PROVIDER: "strpie" })).toThrow(
      /not a payment provider/,
    );
  });
});
