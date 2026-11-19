import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * Starshipit, connected: packed orders out, labels back as shipped orders.
 *
 * Nobody could try this against a real Starshipit account from here, so it
 * is tested against what Starshipit's own documentation says it sends and
 * takes (api-docs.starshipit.com, read 19 November 2026), with a stand-in
 * for the network that records every call.
 */

import {
  auditLog,
  courierHandoffs,
  events,
  orderLines,
  orders,
} from "@/db/schema";
import { systemCaller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  markPacked,
  markShipped,
  updateDelivery,
} from "@/lib/backstage/orders/ops";
import {
  courierNeeds,
  followStarshipit,
  handOver,
  handoffDealtWith,
  handoffFor,
  shippedDetails,
  starshipitCourier,
  starshipitOrderFor,
  takeBack,
  toStarshipit,
  waitingForStarshipit,
} from "@/lib/backstage/orders/starshipit";
import { courierConnection, starshipitOptions } from "@/lib/courier";
import {
  CourierError,
  createOrder,
  findUnshipped,
  listShipped,
  scrubKeys,
  type StarshipitOptions,
} from "@/lib/courier/starshipit";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { FILE_OFFER } from "@/lib/shop/offer";
import type { PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { getStore } from "@/lib/shop/store";

const API_KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SUB_KEY = "0f9e8d7c6b5a49382716f5e4d3c2b1a0";

type Call = {
  readonly method: string;
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly body: unknown;
};

type Reply = { status: number; body: unknown } | "no answer";

/** A stand-in for the network: answers by method and path, keeps every call. */
function fakeStarshipit(answer: (call: Call) => Reply): {
  options: StarshipitOptions;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const reply = answer(call);
    if (reply === "no answer") throw new Error("The operation timed out.");
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch;
  return {
    options: { apiKey: API_KEY, subscriptionKey: SUB_KEY, fetch: fetchImpl },
    calls,
  };
}

describe("which courier Starshipit means", () => {
  it("knows its words for the couriers on our list", () => {
    expect(starshipitCourier("CourierPost", "CourierPost")?.key).toBe("nzpost");
    expect(starshipitCourier("NZPost", "")?.key).toBe("nzpost");
    expect(starshipitCourier("Fastways", "Aramex")?.key).toBe("aramex");
    expect(starshipitCourier("", "Aramex")?.key).toBe("aramex");
    expect(starshipitCourier("PostHaste", "Post Haste")?.key).toBe("posthaste");
    expect(starshipitCourier("NZCouriers", "NZ Couriers")?.key).toBe(
      "nzcouriers",
    );
  });

  it("does not guess at one it does not know", () => {
    expect(starshipitCourier("Mainfreight", "Mainfreight")).toBeNull();
    expect(starshipitCourier("", "")).toBeNull();
  });

  it("writes the order up with the courier's name, the number and a link", () => {
    const base = {
      orderId: "1020304051",
      orderNumber: "QP-7K2M9X",
      shippedAt: null,
    };
    expect(
      shippedDetails({
        ...base,
        carrier: "CourierPost",
        carrierName: "CourierPost",
        trackingNumber: "00794210392673102001",
        trackingUrl: null,
      }),
    ).toEqual({
      carrier: "NZ Post",
      trackingNumber: "00794210392673102001",
      trackingUrl:
        "https://www.nzpost.co.nz/tools/tracking?trackid=00794210392673102001",
    });
    // Starshipit's own page for the parcel wins over ours.
    expect(
      shippedDetails({
        ...base,
        carrier: "CourierPost",
        carrierName: "CourierPost",
        trackingNumber: "00794210392673102001",
        trackingUrl: "https://track.example.com/00794210392673102001",
      }).trackingUrl,
    ).toBe("https://track.example.com/00794210392673102001");
    // A courier we do not know: its name and the number, and no link.
    expect(
      shippedDetails({
        ...base,
        carrier: "Mainfreight",
        carrierName: "Mainfreight",
        trackingNumber: "MF123456789",
        trackingUrl: null,
      }),
    ).toEqual({
      carrier: "Mainfreight",
      trackingNumber: "MF123456789",
      trackingUrl: null,
    });
  });
});

describe("the calls", () => {
  it("hands an order over with both keys, to Starshipit and nowhere else", async () => {
    const { options, calls } = fakeStarshipit(() => ({
      status: 200,
      body: { order: { order_id: 1020304051 }, success: true },
    }));
    const id = await createOrder(
      {
        order_date: "2026-11-19T00:00:00.000Z",
        order_number: "QP-7K2M9X",
        reference: "QP-7K2M9X",
        shipping_method: "Standard delivery",
        signature_required: false,
        currency: "NZD",
        destination: {
          name: "Aroha Ngata",
          street: "12 Sideline Road",
          suburb: "Te Aro",
          city: "Wellington",
          state: "Wellington",
          post_code: "6011",
          country: "New Zealand",
        },
        items: [],
      },
      options,
    );
    expect(id).toBe("1020304051");
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.method).toBe("POST");
    expect(call?.url.origin).toBe("https://api.starshipit.com");
    expect(call?.url.pathname).toBe("/api/orders");
    expect(call?.headers["StarShipIT-Api-Key"]).toBe(API_KEY);
    expect(call?.headers["Ocp-Apim-Subscription-Key"]).toBe(SUB_KEY);
    expect(
      (call?.body as { order: { order_number: string } }).order.order_number,
    ).toBe("QP-7K2M9X");
  });

  it("says what Starshipit refused, and never a key", async () => {
    const { options } = fakeStarshipit(() => ({
      status: 400,
      body: {
        success: false,
        errors: [
          {
            message: "Validation failed",
            details: `Post code is required (key ${API_KEY})`,
          },
        ],
      },
    }));
    const error = await createOrder(
      {} as Parameters<typeof createOrder>[0],
      options,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CourierError);
    const refused = error as CourierError;
    expect(refused.retryable).toBe(false);
    expect(refused.outcome).toBe("refused");
    expect(refused.message).toContain("Post code is required");
    expect(refused.message).not.toContain(API_KEY);
    expect(scrubKeys(`x ${SUB_KEY} y`)).toBe("x [key removed] y");
  });

  it("calls a fault at their end, or no answer, worth another try that may have landed", async () => {
    for (const reply of [{ status: 503, body: {} }, "no answer"] as const) {
      const { options } = fakeStarshipit(() => reply);
      const error = (await createOrder(
        {} as Parameters<typeof createOrder>[0],
        options,
      ).catch((caught: unknown) => caught)) as CourierError;
      expect(error.retryable).toBe(true);
      expect(error.outcome).toBe("unknown");
    }
  });

  it("only finds the very order it was asked about", async () => {
    const { options, calls } = fakeStarshipit((call) =>
      call.url.searchParams.get("order_number") === "QP-7K2M9X"
        ? {
            status: 200,
            body: {
              order: { order_id: 55, order_number: "QP-7K2M9X" },
              success: true,
            },
          }
        : {
            status: 200,
            body: {
              order: { order_id: 56, order_number: "QP-OTHER1" },
              success: true,
            },
          },
    );
    expect(await findUnshipped("QP-7K2M9X", options)).toBe("55");
    expect(await findUnshipped("QP-3B4C5D", options)).toBeNull();
    expect(calls[0]?.url.pathname).toBe("/api/orders");
  });

  it("reads every page of what has shipped", async () => {
    const { options, calls } = fakeStarshipit((call) => {
      const page = call.url.searchParams.get("page");
      return {
        status: 200,
        body: {
          orders: [
            {
              order_id: page === "1" ? 1 : 2,
              order_number: page === "1" ? "QP-7K2M9X" : "QP-3B4C5D",
              carrier: "CourierPost",
              carrier_name: "CourierPost",
              tracking_number: page === "1" ? "TRACK0001" : "TRACK0002",
            },
            // No tracking number: nothing to ship it with.
            { order_id: 3, order_number: "QP-4C5D6F", tracking_number: "" },
          ],
          total_pages: 2,
          success: true,
        },
      };
    });
    const since = new Date("2026-11-18T00:00:00.000Z");
    const found = await listShipped(since, options);
    expect(found.map((order) => order.orderNumber)).toEqual([
      "QP-7K2M9X",
      "QP-3B4C5D",
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url.pathname).toBe("/api/orders/shipped");
    expect(calls[0]?.url.searchParams.get("since_last_updated")).toBe(
      since.toISOString(),
    );
  });
});

describe("whether Starshipit is connected", () => {
  const production = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://shop@db.example/qp",
    STARSHIPIT_API_KEY: API_KEY,
    STARSHIPIT_SUBSCRIPTION_KEY: SUB_KEY,
  };

  it("names what is missing, never a value", () => {
    expect(courierConnection({ NODE_ENV: "production" })).toEqual({
      on: false,
      missing: ["STARSHIPIT_API_KEY", "STARSHIPIT_SUBSCRIPTION_KEY"],
      held: null,
    });
  });

  it("is only ever on in production with a real database", () => {
    expect(courierConnection(production).on).toBe(true);
    expect(
      courierConnection({ ...production, DATABASE_URL: undefined }).held,
    ).toMatch(/invented records/);
    // A preview runs on invented records, unless it is given the database.
    expect(
      courierConnection({ ...production, VERCEL_ENV: "preview" }).held,
    ).toMatch(/invented records/);
    expect(
      courierConnection({
        ...production,
        VERCEL_ENV: "preview",
        QP_PREVIEW_DATABASE: "1",
      }).held,
    ).toMatch(/preview/);
    expect(
      courierConnection({ ...production, NODE_ENV: "development" }).held,
    ).toMatch(/development/);
    expect(courierConnection({ ...production, VITEST: "true" }).held).toMatch(
      /Tests/,
    );
  });

  it("never reaches the network from a test without a stand-in", () => {
    expect(starshipitOptions({ env: production })).toBeNull();
  });
});

describe("Starshipit, with orders", () => {
  let handle: DbHandle;
  let made = 0;
  const staff = systemCaller("Test", "script");

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

  async function buy(
    over: Record<string, unknown> = {},
    status: "test" | "paid" = "paid",
  ): Promise<string> {
    made += 1;
    const result = await placeOrder(
      {
        email: `starship${String(made)}@example.co.nz`,
        phone: "+64 21 123 4567",
        firstName: "Aroha",
        lastName: "Ngata",
        line1: "12 Sideline Road",
        line2: "The Mill",
        suburb: "",
        city: "Wellington",
        region: "Wellington",
        postcode: "6011",
        rural: false,
        notes: "Leave by the blue shed",
        joinCrew: false,
        lines: [
          { sku: "QP-SHOT-12", qty: 2 },
          { sku: "QP-SHOT-06-MCL", qty: 1 },
        ],
        ...over,
      },
      { offer: FILE_OFFER, payments: provider(status), store: getStore() },
    );
    if (!result.ok) throw new Error(`Not placed: ${result.reason}`);
    return result.order.number;
  }
  const pack = (number: string) => execute(markPacked, { number }, staff);
  const handoff = (number: string) => execute(handoffFor, { number }, staff);
  const orderRow = async (number: string) => {
    const [row] = await handle.db
      .select()
      .from(orders)
      .where(eq(orders.number, number));
    if (row === undefined) throw new Error(`No ${number}`);
    return row;
  };

  /** A Starshipit that takes every order, numbering them from 9000. */
  function happyStarshipit(shipped: () => unknown[] = () => []) {
    let next = 9000;
    return fakeStarshipit((call) => {
      if (call.method === "POST" && call.url.pathname === "/api/orders") {
        next += 1;
        return {
          status: 200,
          body: { order: { order_id: next }, success: true },
        };
      }
      if (call.method === "DELETE")
        return { status: 200, body: { success: true } };
      if (call.url.pathname === "/api/orders/shipped") {
        return {
          status: 200,
          body: { orders: shipped(), total_pages: 1, success: true },
        };
      }
      return { status: 404, body: { success: false } };
    });
  }

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes the order up under Starshipit's names, as the courier file does", async () => {
    const number = await buy({ rural: true });
    const order = await orderRow(number);
    const lines = await handle.db
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, order.id));
    const sent = starshipitOrderFor(order, lines);
    expect(sent.order_number).toBe(number);
    expect(sent.reference).toBe(number);
    expect(sent.shipping_method).toBe("Rural delivery");
    expect(sent.currency).toBe("NZD");
    expect(sent.destination).toMatchObject({
      name: "Aroha Ngata",
      building: "The Mill",
      street: "12 Sideline Road",
      // No suburb given: the town stands in, as on the file.
      suburb: "Wellington",
      city: "Wellington",
      state: "Wellington",
      post_code: "6011",
      country: "New Zealand",
      delivery_instructions: "Leave by the blue shed",
    });
    expect(sent.items).toHaveLength(2);
    for (const item of sent.items) {
      expect(item).not.toHaveProperty("weight");
      expect(Number.isInteger(item.value * 100)).toBe(true);
    }
    expect(sent.items.map((item) => item.description).join(" | ")).toMatch(
      /Mango Chilli Lime/,
    );
  });

  it("hands a packed order over once, however often it is asked", async () => {
    const number = await buy();
    await pack(number);
    const raised = await handle.db
      .select()
      .from(events)
      .where(eq(events.type, "order.packed"));
    expect(raised.some((event) => event.payload.number === number)).toBe(true);

    const { options, calls } = happyStarshipit();
    expect(
      await handOver(handle.db, number, false, { starshipit: options }),
    ).toBe("sent");
    expect(
      await handOver(handle.db, number, false, { starshipit: options }),
    ).toBe("already");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    const now = await handoff(number);
    expect(now?.state).toBe("sent");
    expect(now?.reference).toBe("9001");
    expect(now?.sentAt).not.toBeNull();
  });

  it("does nothing while Starshipit is not connected here", async () => {
    const number = await buy();
    await pack(number);
    expect(await handOver(handle.db, number, false, { starshipit: null })).toBe(
      "not connected",
    );
    expect(await handoff(number)).toBeNull();
  });

  it("only sends a test order when somebody asks: a label costs money", async () => {
    const number = await buy({}, "test");
    await pack(number);
    const { options, calls } = happyStarshipit();
    expect(
      await handOver(handle.db, number, false, { starshipit: options }),
    ).toBe("test");
    expect(calls).toHaveLength(0);
    expect(
      await handOver(handle.db, number, true, { starshipit: options }),
    ).toBe("sent");
    const body = calls[0]?.body as { order: { reference: string } };
    expect(body.order.reference).toBe(`TEST ORDER ${number}`);
  });

  it("never hands over an order that is not packed", async () => {
    const number = await buy();
    const { options, calls } = happyStarshipit();
    expect(
      await handOver(handle.db, number, true, { starshipit: options }),
    ).toBe("not packed");
    expect(calls).toHaveLength(0);
  });

  it("writes a refusal down for a person, and puts it on Today", async () => {
    const number = await buy();
    await pack(number);
    const { options } = fakeStarshipit(() => ({
      status: 400,
      body: { success: false, errors: [{ message: "Invalid post code" }] },
    }));
    expect(
      await handOver(handle.db, number, false, { starshipit: options }),
    ).toBe("refused");
    const now = await handoff(number);
    expect(now?.state).toBe("failed");
    expect(now?.trouble).toMatch(/Invalid post code/);
    const needs = await courierNeeds(handle.db, new Date());
    expect(
      needs.find((need) => need.key === `starshipit-${number}`),
    ).toMatchObject({
      urgent: true,
      title: `Starshipit would not take ${number}`,
    });
    // Not tried again by itself; a person sends it again or clears it.
    expect(
      await handOver(handle.db, number, false, { starshipit: options }),
    ).toBe("already");
    await execute(handoffDealtWith, { number }, staff);
    expect((await handoff(number))?.state).toBe("withdrawn");
    expect(
      (await courierNeeds(handle.db, new Date())).some(
        (need) => need.key === `starshipit-${number}`,
      ),
    ).toBe(false);
  });

  it("looks before it tries again after no clear answer, so one order is one box", async () => {
    const number = await buy();
    await pack(number);
    let landed = false;
    const { options, calls } = fakeStarshipit((call) => {
      if (call.method === "POST") {
        landed = true;
        return "no answer";
      }
      return landed
        ? {
            status: 200,
            body: {
              order: { order_id: 777, order_number: number },
              success: true,
            },
          }
        : { status: 404, body: { success: false } };
    });
    await expect(
      handOver(handle.db, number, false, { starshipit: options }),
    ).rejects.toBeInstanceOf(CourierError);
    expect((await handoff(number))?.state).toBe("trying");
    expect(
      await handOver(handle.db, number, false, { starshipit: options }),
    ).toBe("found");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect((await handoff(number))?.reference).toBe("777");
  });

  it("ships an order here once Starshipit prints its label, and only once", async () => {
    const number = await buy();
    await pack(number);
    const printed = [
      {
        order_id: 9101,
        order_number: number,
        carrier: "CourierPost",
        carrier_name: "CourierPost",
        tracking_number: "00794210392673102001",
      },
    ];
    let showLabel = false;
    const { options } = happyStarshipit(() => (showLabel ? printed : []));
    await handOver(handle.db, number, false, { starshipit: options });

    // Before the label: nothing moves.
    let round = await followStarshipit(handle.db, new Date(), {
      starshipit: options,
    });
    expect(round.shipped).toBe(0);
    expect((await orderRow(number)).status).toBe("packed");

    showLabel = true;
    round = await followStarshipit(handle.db, new Date(), {
      starshipit: options,
    });
    expect(round.shipped).toBe(1);
    const order = await orderRow(number);
    expect(order.status).toBe("shipped");
    expect(order.carrier).toBe("NZ Post");
    expect(order.trackingNumber).toBe("00794210392673102001");
    expect(order.trackingUrl).toBe(
      "https://www.nzpost.co.nz/tools/tracking?trackid=00794210392673102001",
    );
    expect((await handoff(number))?.state).toBe("shipped");
    const shippedEvents = await handle.db
      .select()
      .from(events)
      .where(eq(events.type, "order.shipped"));
    expect(
      shippedEvents.filter((event) => event.payload.number === number),
    ).toHaveLength(1);
    const lines = await handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, order.id));
    expect(
      lines.some(
        (line) =>
          line.actorName === "Starshipit" && /^Shipped /.test(line.summary),
      ),
    ).toBe(true);

    // Told again: nothing ships twice, and the listener that takes a
    // hand-shipped order back out leaves Starshipit's own alone.
    round = await followStarshipit(handle.db, new Date(), {
      starshipit: options,
    });
    expect(round.shipped).toBe(0);
    expect(await takeBack(handle.db, number, { starshipit: options })).toBe(
      "nothing",
    );
  });

  it("asks Starshipit nothing while nothing is waiting there", async () => {
    await handle.db.delete(courierHandoffs);
    const { options, calls } = happyStarshipit();
    const round = await followStarshipit(handle.db, new Date(), {
      starshipit: options,
    });
    expect(round).toEqual({ waiting: 0, shipped: 0, stranded: 0 });
    expect(calls).toHaveLength(0);
  });

  it("takes an unpacked order back out, while it has no label", async () => {
    const number = await buy();
    await pack(number);
    const { options, calls } = happyStarshipit();
    await handOver(handle.db, number, false, { starshipit: options });
    const reference = (await handoff(number))?.reference;
    await execute(markPacked, { number, undo: true }, staff);
    const raised = await handle.db
      .select()
      .from(events)
      .where(eq(events.type, "order.unpacked"));
    expect(raised.some((event) => event.payload.number === number)).toBe(true);
    expect(await takeBack(handle.db, number, { starshipit: options })).toBe(
      "withdrawn",
    );
    const deleted = calls.find((call) => call.method === "DELETE");
    expect(deleted?.url.pathname).toBe("/api/orders/delete");
    expect(deleted?.url.searchParams.get("order_id")).toBe(reference);
    expect((await handoff(number))?.state).toBe("withdrawn");
  });

  it("takes a hand-shipped order back out of Starshipit", async () => {
    const number = await buy();
    await pack(number);
    const { options, calls } = happyStarshipit();
    await handOver(handle.db, number, false, { starshipit: options });
    await execute(
      markShipped,
      { number, carrier: "NZ Post", trackingNumber: "00794210392673102099" },
      staff,
    );
    expect(await takeBack(handle.db, number, { starshipit: options })).toBe(
      "withdrawn",
    );
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });

  it("tells a person when Starshipit will not let one go", async () => {
    const number = await buy();
    await pack(number);
    const taking = happyStarshipit();
    await handOver(handle.db, number, false, { starshipit: taking.options });
    await execute(markPacked, { number, undo: true }, staff);
    const { options } = fakeStarshipit(() => ({
      status: 400,
      body: { success: false, errors: [{ message: "Order has been printed" }] },
    }));
    expect(await takeBack(handle.db, number, { starshipit: options })).toBe(
      "stranded",
    );
    const now = await handoff(number);
    expect(now?.state).toBe("stranded");
    expect(now?.trouble).toMatch(/it was unpacked/);
    expect(now?.trouble).toMatch(/Order has been printed/);
    expect(
      (await courierNeeds(handle.db, new Date())).find(
        (need) => need.key === `starshipit-${number}`,
      )?.title,
    ).toBe(`${number} is in Starshipit and should not be`);
  });

  it("does not ship a box that is not packed here, whatever Starshipit printed", async () => {
    const number = await buy();
    await pack(number);
    const printed = [
      {
        order_id: 9301,
        order_number: number,
        carrier: "CourierPost",
        tracking_number: "00794210392673109999",
      },
    ];
    const { options } = happyStarshipit(() => printed);
    await handOver(handle.db, number, false, { starshipit: options });
    // Unpacked here, and the take-back has not run yet.
    await execute(markPacked, { number, undo: true }, staff);
    const round = await followStarshipit(handle.db, new Date(), {
      starshipit: options,
    });
    expect(round.stranded).toBe(1);
    expect((await orderRow(number)).status).toBe("paid");
    expect((await handoff(number))?.trouble).toMatch(/not packed/);
  });

  it("asks a person to change the address in Starshipit too", async () => {
    const number = await buy();
    await pack(number);
    const { options } = happyStarshipit();
    await handOver(handle.db, number, false, { starshipit: options });
    await execute(
      updateDelivery,
      {
        number,
        line1: "40 Cuba Street",
        city: "Wellington",
        region: "Wellington",
        postcode: "6011",
      },
      staff,
    );
    const now = await handoff(number);
    expect(now?.state).toBe("sent");
    expect(now?.trouble).toMatch(/Change it in Starshipit too/);
    expect(
      (await courierNeeds(handle.db, new Date())).find(
        (need) => need.key === `starshipit-${number}`,
      )?.title,
    ).toBe(`Starshipit has an old address for ${number}`);
    await execute(handoffDealtWith, { number }, staff);
    const after = await handoff(number);
    expect(after?.state).toBe("sent");
    expect(after?.trouble).toBeNull();
  });

  it("sends packed orders when a person asks, and only packed ones", async () => {
    const packed = await buy();
    await pack(packed);
    const notPacked = await buy();

    // With no keys there is nowhere to send them.
    await expect(
      execute(toStarshipit, { numbers: [packed] }, staff),
    ).rejects.toBeInstanceOf(OpError);

    vi.stubEnv("STARSHIPIT_API_KEY", API_KEY);
    vi.stubEnv("STARSHIPIT_SUBSCRIPTION_KEY", SUB_KEY);
    expect(await execute(waitingForStarshipit, {}, staff)).toContain(packed);
    await expect(
      execute(toStarshipit, { numbers: [packed, notPacked] }, staff),
    ).rejects.toThrow(/Not packed: /);
    const done = await execute(toStarshipit, { numbers: [packed] }, staff);
    expect(done.asked).toEqual([packed]);
    const asked = await handle.db
      .select()
      .from(events)
      .where(eq(events.type, "courier.send_requested"));
    expect(asked.map((event) => event.payload.number)).toEqual([packed]);
  });

  it("is a person's yes for a bot", async () => {
    vi.stubEnv("STARSHIPIT_API_KEY", API_KEY);
    vi.stubEnv("STARSHIPIT_SUBSCRIPTION_KEY", SUB_KEY);
    const number = await buy();
    await pack(number);
    await expect(
      execute(
        toStarshipit,
        { numbers: [number] },
        { ...staff, confirmed: false },
      ),
    ).rejects.toMatchObject({ code: "needs_confirmation" });
  });
});
