import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET, maxDuration, POST } from "@/app/api/tick/route";
import { events, orders, settings } from "@/db/schema";
import { clockStatus, dropStep, retryStep } from "@/lib/backstage/clock/ops";
import {
  campaignBudget,
  CAMPAIGNS_BY_MS,
  lastTick,
  tick,
  UNPAID_AFTER_MINUTES,
} from "@/lib/backstage/clock/tick";
import { systemCaller } from "@/lib/backstage/core/actor";
import { clearHandlers, on } from "@/lib/backstage/core/events";
import { execute } from "@/lib/backstage/core/op";
import { registerHandlers } from "@/lib/backstage/handlers";
import { markPaid, paymentState } from "@/lib/backstage/orders/payments";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import type { PaymentProvider } from "@/lib/shop/payments";
import type { Settlement } from "@/lib/shop/payments/settle";
import { placeOrder } from "@/lib/shop/place-order";
import { getStore } from "@/lib/shop/store";
import { FILE_OFFER } from "@/lib/shop/offer";

const shop = systemCaller("The shop", "storefront");

const T0 = new Date("2026-11-12T09:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

const form = (email: string) => ({
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
});

const URLS = {
  success: "https://shop.example/order/thanks",
  cancel: "https://shop.example/checkout?payment=cancelled",
};

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

describe("the clock", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    // The real listeners are registered once, then put aside: each test
    // says who is listening.
    registerHandlers();
  });
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    clearHandlers();
    await handle.db.delete(events);
    await handle.db.delete(orders);
    await handle.db.delete(settings);
  });

  /** An order sent off to pay, placed at `at`. */
  const sentToPay = async (email: string, at: Date) => {
    const result = await placeOrder(form(email), {
      offer: FILE_OFFER,
      payments: elsewhere,
      store: getStore({ NODE_ENV: "test" }),
      returnUrls: URLS,
      now: () => at,
    });
    if (!result.ok) throw new Error("order failed");
    // The row's own clock is the database's; set it to the story's.
    await handle.db
      .update(orders)
      .set({ createdAt: at })
      .where(eq(orders.number, result.order.number));
    return result.order.number;
  };

  /** An order saved just before the request died: no payment page at all. */
  const orphan = async (email: string, at: Date) => {
    const store = getStore({ NODE_ENV: "test" });
    await placeOrder(form(email), {
      offer: FILE_OFFER,
      payments: {
        ...elsewhere,
        async begin() {
          throw new Error("the function was killed here");
        },
      },
      // The tidy-up that would normally close it never got to run either.
      store: { ...store, closeUnpaid: async () => {} },
      returnUrls: URLS,
      now: () => at,
    });
    const [row] = await handle.db
      .select({ number: orders.number })
      .from(orders)
      .where(eq(orders.email, email));
    if (row === undefined) throw new Error("no orphan");
    await handle.db
      .update(orders)
      .set({ createdAt: at })
      .where(eq(orders.number, row.number));
    return row.number;
  };

  const stateOf = (number: string) => execute(paymentState, { number }, shop);

  it("gives a listener that failed its next try", async () => {
    let calls = 0;
    on("order.placed", "flaky", async () => {
      calls += 1;
      if (calls === 1) throw new Error("the mail server was down");
    });
    await sentToPay("flaky@example.co.nz", T0);

    // Nothing ran when the order was placed: tests leave the dispatcher off,
    // which is also what a process dying straight after the save looks like.
    const first = await tick({
      now: minutes(1),
      settle: async () => ({ state: "awaiting" }),
    });
    expect(first.events).toEqual({ handled: 0, failed: 1, gaveUp: 0 });

    // Too soon for another go.
    const tooSoon = await tick({ now: new Date(minutes(1).getTime() + 5_000) });
    expect(tooSoon.events).toEqual({ handled: 0, failed: 0, gaveUp: 0 });

    const later = await tick({ now: minutes(2) });
    expect(later.events).toEqual({ handled: 1, failed: 0, gaveUp: 0 });
    expect(calls).toBe(2);
  });

  it("settles an order whose payment page ran out without a word", async () => {
    const paidLate = await sentToPay("paid@example.co.nz", T0);
    const ranOut = await sentToPay("ranout@example.co.nz", T0);
    const onItsWay = await sentToPay("transfer@example.co.nz", T0);
    const fresh = await sentToPay("fresh@example.co.nz", minutes(40));

    const asked: string[] = [];
    const settle = async (number: string): Promise<Settlement> => {
      asked.push(number);
      if (number === paidLate) return { state: "paid" };
      if (number === ranOut) return { state: "closed" };
      return { state: "awaiting" };
    };

    const summary = await tick({
      now: minutes(UNPAID_AFTER_MINUTES + 1),
      settle,
    });
    // The fresh one is left alone: its buyer may still be typing a card in.
    expect(asked.sort()).toEqual([paidLate, ranOut, onItsWay].sort());
    expect(asked).not.toContain(fresh);
    expect(summary.orders).toEqual({ looked: 3, paid: 1, closed: 1, left: 1 });
  });

  it("closes an order that never got a payment page", async () => {
    const number = await orphan("orphan@example.co.nz", T0);
    expect(await stateOf(number)).toMatchObject({
      status: "pending",
      reference: "",
    });

    const asked: string[] = [];
    const summary = await tick({
      now: minutes(UNPAID_AFTER_MINUTES + 1),
      settle: async (n) => {
        asked.push(n);
        return { state: "awaiting" };
      },
    });
    // There is no payment page to ask about, so nobody is asked.
    expect(asked).toHaveLength(0);
    expect(summary.orders).toEqual({ looked: 1, paid: 0, closed: 1, left: 0 });
    expect(await stateOf(number)).toMatchObject({
      status: "cancelled",
      paymentStatus: "failed",
    });

    // And the next tick finds nothing to do.
    const again = await tick({ now: minutes(UNPAID_AFTER_MINUTES + 6) });
    expect(again.orders.looked).toBe(0);
  });

  it("leaves an order alone when the money is in but in question", async () => {
    const number = await sentToPay("short@example.co.nz", T0);
    await execute(
      markPaid,
      {
        number,
        provider: "stripe",
        reference: `cs_test_${number}`,
        amountCents: 100,
        currency: "nzd",
        test: true,
      },
      systemCaller("Stripe", "webhook"),
    );
    const summary = await tick({
      now: minutes(UNPAID_AFTER_MINUTES + 1),
      settle: async () => {
        throw new Error("should not be asked");
      },
    });
    expect(summary.orders.looked).toBe(0);
    expect(await stateOf(number)).toMatchObject({
      status: "pending",
      paymentStatus: "review",
    });
  });

  it("carries on with the rest when one order cannot be checked", async () => {
    const broken = await sentToPay("broken@example.co.nz", T0);
    const fine = await sentToPay("fine@example.co.nz", minutes(1));
    const summary = await tick({
      now: minutes(UNPAID_AFTER_MINUTES + 2),
      settle: async (number) => {
        if (number === broken) throw new Error("Stripe is down");
        return { state: "closed" };
      },
    });
    expect(summary.orders).toEqual({ looked: 2, paid: 0, closed: 1, left: 1 });
    expect(fine).not.toBe(broken);
  });

  it("writes down when it last ran, for the back end to show", async () => {
    expect(await lastTick(handle.db)).toBeNull();
    await tick({ now: minutes(3) });
    const first = await lastTick(handle.db);
    expect(first?.at).toBe(minutes(3).toISOString());
    await tick({ now: minutes(8) });
    expect((await lastTick(handle.db))?.at).toBe(minutes(8).toISOString());
  });

  it("says how its campaign round went in the pulse, in counts", async () => {
    const summary = await tick({ now: minutes(3) });
    expect(summary.campaigns).toEqual({ sent: 0, failed: 0, stopped: false });
    expect((await lastTick(handle.db))?.campaigns).toEqual(summary.campaigns);
  });

  it("gives campaign emails only the time that is left, and none when that is too little", () => {
    const round = 25_000;
    expect(campaignBudget(0, round)).toBe(round);
    expect(campaignBudget(4_000, round)).toBe(round);
    // A tick that was already slow: the round gets what is left.
    expect(campaignBudget(20_000, round)).toBe(CAMPAIGNS_BY_MS - 20_000);
    expect(campaignBudget(CAMPAIGNS_BY_MS - 3_000, round)).toBe(3_000);
    // Too little to be worth starting: it waits for the next tick.
    expect(campaignBudget(CAMPAIGNS_BY_MS - 2_999, round)).toBeNull();
    expect(campaignBudget(90_000, round)).toBeNull();
    // The last email may start as late as that, and one call to the mail
    // provider can hang for twenty seconds before it is given up on. Both
    // have to fit inside what the request itself is allowed.
    expect(CAMPAIGNS_BY_MS + 20_000).toBeLessThan(maxDuration * 1000);
  });

  describe("a step that failed", () => {
    const ash = { ...systemCaller("Ashleigh", "ui"), confirmed: true };

    /** A listener that fails until told to stop, and an event for it. */
    const failing = async () => {
      const state = { broken: true, calls: 0 };
      on("order.placed", "always down", async () => {
        state.calls += 1;
        if (state.broken) throw new Error("the courier's site is down");
      });
      await sentToPay("stuck@example.co.nz", T0);
      await tick({ now: minutes(1) });
      return state;
    };

    it("shows up with what it was, how many tries, and why", async () => {
      await failing();
      const { stuck, last } = await execute(clockStatus, {}, shop);
      expect(last?.at).toBe(minutes(1).toISOString());
      expect(stuck).toHaveLength(1);
      expect(stuck[0]).toMatchObject({
        type: "order.placed",
        attempts: 1,
        gaveUp: false,
        lastError: "always down: the courier's site is down",
      });
      expect(stuck[0]?.nextTry?.getTime()).toBeGreaterThan(
        minutes(1).getTime(),
      );
      expect(typeof stuck[0]?.payload.number).toBe("string");
    });

    it("can be sent round again by a person, with a line in the log", async () => {
      const state = await failing();
      const [step] = (await execute(clockStatus, {}, shop)).stuck;
      const id = step?.id ?? "";

      state.broken = false;
      await execute(retryStep, { id }, ash);
      // It no longer waits out its delay: the very next round takes it.
      const round = await tick({ now: new Date(minutes(1).getTime() + 1000) });
      expect(round.events).toEqual({ handled: 1, failed: 0, gaveUp: 0 });
      expect((await execute(clockStatus, {}, shop)).stuck).toHaveLength(0);

      // A step that has finished cannot be sent round again.
      await expect(execute(retryStep, { id }, ash)).rejects.toMatchObject({
        code: "conflict",
      });
    });

    it("can be given up on, by an owner, who has to say why", async () => {
      const state = await failing();
      const [step] = (await execute(clockStatus, {}, shop)).stuck;
      const id = step?.id ?? "";

      const staffOnly = {
        actor: {
          type: "human" as const,
          userId: "usr_staff",
          name: "Sam",
          role: "staff" as const,
        },
        via: "ui" as const,
        confirmed: true,
      };
      await expect(
        execute(dropStep, { id, reason: "No longer needed" }, staffOnly),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        execute(dropStep, { id, reason: "" }, ash),
      ).rejects.toMatchObject({ code: "invalid_input" });
      // And never without a yes.
      await expect(
        execute(
          dropStep,
          { id, reason: "No longer needed" },
          { ...ash, confirmed: false },
        ),
      ).rejects.toMatchObject({ code: "needs_confirmation" });

      await execute(dropStep, { id, reason: "No longer needed" }, ash);
      expect((await execute(clockStatus, {}, shop)).stuck).toHaveLength(0);

      // Gone for good: nothing tries it again, however long it waits.
      const calls = state.calls;
      await tick({ now: minutes(600) });
      expect(state.calls).toBe(calls);
      const [row] = await handle.db
        .select({ lastError: events.lastError })
        .from(events)
        .where(eq(events.id, id));
      expect(row?.lastError).toBe("Dropped by Ashleigh: No longer needed");
    });

    it("refuses an id that is not a step's", async () => {
      await expect(
        execute(retryStep, { id: "ord_123456" }, ash),
      ).rejects.toMatchObject({ code: "invalid_input" });
    });
  });

  describe("the request that arrives on a timer", () => {
    const call = (
      handler: (request: Request) => Promise<Response>,
      authorization?: string,
    ) =>
      handler(
        new Request("https://shop.example/api/tick", {
          headers: authorization === undefined ? {} : { authorization },
        }),
      );

    const withSecret = async <T>(
      secret: string | undefined,
      run: () => Promise<T>,
    ) => {
      const before = process.env.CRON_SECRET;
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
      try {
        return await run();
      } finally {
        if (before === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = before;
      }
    };

    it("lets nobody in until a secret has been set", async () => {
      await withSecret(undefined, async () => {
        expect((await call(GET)).status).toBe(503);
        expect((await call(GET, "Bearer anything")).status).toBe(503);
      });
      // Nor with one too short to be a secret.
      await withSecret("short", async () => {
        expect((await call(GET, "Bearer short")).status).toBe(503);
      });
    });

    it("runs for the right secret and nothing else", async () => {
      const secret = "left boot first, then the right, then the cape";
      await withSecret(secret, async () => {
        expect((await call(GET)).status).toBe(401);
        expect((await call(GET, `Bearer ${secret}x`)).status).toBe(401);
        expect((await call(GET, secret)).status).toBe(401);
        expect((await call(POST, "Bearer ")).status).toBe(401);

        const ok = await call(GET, `Bearer ${secret}`);
        expect(ok.status).toBe(200);
        expect(ok.headers.get("cache-control")).toBe("no-store");
        const body = (await ok.json()) as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual([
          "at",
          "campaigns",
          "events",
          "orders",
          "tookMs",
        ]);
        // Counts only, like the rest of it: never an address.
        expect(body.campaigns).toEqual({ sent: 0, failed: 0, stopped: false });
        expect((await call(POST, `Bearer ${secret}`)).status).toBe(200);
      });
    });
  });
});
