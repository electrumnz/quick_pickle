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
    async charge(request) {
      charges.push(request);
      return {
        provider: "spy",
        status: "test",
        reference: `SPY-${request.orderNumber}`,
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
  return { charges, orders, signups, deps: { payments, store } };
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
        async charge() {
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
