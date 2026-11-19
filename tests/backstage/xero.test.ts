import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The books, sent to Xero: sales as paid invoices, refunds as credit notes
 * paid out.
 *
 * Nobody could try this against a real Xero organisation from here, so it is
 * tested against what Xero's own published descriptions say it takes and
 * gives back (its OpenID description and its OpenAPI file for the Accounting
 * API), with a stand-in for the network that records every call.
 */

import { settings, xeroLink, xeroPostings } from "@/db/schema";
import {
  chooseOrganisation,
  connectXero,
  creditNoteFor,
  creditNoteNumber,
  invoiceFor,
  liveKey,
  sendToXero,
  setUpXero,
  tryXeroAgain,
  xeroNeeds,
  xeroStatus,
} from "@/lib/backstage/books/xero";
import { systemCaller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { recordRefund } from "@/lib/backstage/orders/ops";
import { SHOP_OFFER_KEY } from "@/lib/backstage/shop/ops";
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
import { xeroApp, xeroSetting } from "@/lib/xero";
import {
  authorizeUrl,
  exchangeCode,
  listOrganisations,
  XERO_SCOPES,
  XeroError,
  type XeroApp,
} from "@/lib/xero/client";
import { seal, unseal } from "@/lib/xero/seal";

const SECRET = "xero-app-secret-for-tests-0123456789";

type Call = {
  readonly method: string;
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly body: string | null;
};
type Reply = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

function fakeXero(answer: (call: Call) => Reply): {
  app: XeroApp;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);
    const reply = answer(call);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: reply.headers,
    });
  }) as typeof fetch;
  return {
    app: { clientId: "CLIENTID", clientSecret: SECRET, fetch: fetchImpl },
    calls,
  };
}

describe("keeping Xero's keys", () => {
  it("seals them so only the app's secret opens them", () => {
    const sealed = seal("a-renewal-key", SECRET);
    expect(sealed).not.toContain("a-renewal-key");
    expect(unseal(sealed, SECRET)).toBe("a-renewal-key");
    expect(unseal(sealed, "another-secret-entirely-00000000")).toBeNull();
    const [v, iv, body, tag] = sealed.split(".");
    expect(unseal([v, iv, `${body ?? ""}x`, tag].join("."), SECRET)).toBeNull();
    expect(unseal("not sealed", SECRET)).toBeNull();
  });
});

describe("signing in to Xero", () => {
  it("sends the owner to Xero's own page, asking for what the books need", () => {
    const url = new URL(
      authorizeUrl(
        { clientId: "CLIENTID" },
        "https://quickpickle.co.nz/backstage/xero/callback",
        "the-state",
      ),
    );
    expect(url.origin).toBe("https://login.xero.com");
    expect(url.pathname).toBe("/identity/connect/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("CLIENTID");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://quickpickle.co.nz/backstage/xero/callback",
    );
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...XERO_SCOPES]);
    expect(url.toString()).not.toContain(SECRET);
  });

  it("swaps the code for keys with the app's secret, sent the way Xero asks", async () => {
    const { app, calls } = fakeXero(() => ({
      status: 200,
      body: {
        access_token: "ACCESS",
        refresh_token: "REFRESH",
        expires_in: 1800,
        token_type: "Bearer",
      },
    }));
    const now = new Date("2026-11-19T00:00:00.000Z");
    const tokens = await exchangeCode(
      app,
      "THE-CODE",
      "https://x.example/cb",
      now,
    );
    expect(tokens).toEqual({
      accessToken: "ACCESS",
      refreshToken: "REFRESH",
      expiresAt: new Date("2026-11-19T00:30:00.000Z"),
    });
    const [call] = calls;
    expect(call?.url.toString()).toBe(
      "https://identity.xero.com/connect/token",
    );
    expect(call?.headers.Authorization).toBe(
      `Basic ${Buffer.from(`CLIENTID:${SECRET}`).toString("base64")}`,
    );
    const form = new URLSearchParams(call?.body ?? "");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("THE-CODE");
    expect(form.get("redirect_uri")).toBe("https://x.example/cb");
  });

  it("says when a renewal key is spent, without the key", async () => {
    const { app } = fakeXero(() => ({
      status: 400,
      body: { error: "invalid_grant" },
    }));
    const error = (await exchangeCode(
      app,
      "SECRET-CODE",
      "https://x",
      new Date(),
    ).catch((caught: unknown) => caught)) as XeroError;
    expect(error).toBeInstanceOf(XeroError);
    expect(error.reconnect).toBe(true);
    expect(error.message).not.toContain("SECRET-CODE");
    expect(error.message).not.toContain(SECRET);
  });

  it("only counts organisations among what a sign-in let in", async () => {
    const { app } = fakeXero(() => ({
      status: 200,
      body: [
        {
          tenantId: "t-1",
          tenantType: "ORGANISATION",
          tenantName: "Quick Pickle Ltd",
        },
        {
          tenantId: "p-1",
          tenantType: "PRACTICE",
          tenantName: "An accountant",
        },
      ],
    }));
    expect(await listOrganisations(app, "ACCESS")).toEqual([
      { id: "t-1", name: "Quick Pickle Ltd" },
    ]);
  });
});

describe("whether Xero can be reached from here", () => {
  const production = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://shop@db.example/qp",
    XERO_CLIENT_ID: "CLIENTID",
    XERO_CLIENT_SECRET: SECRET,
  };

  it("names what is missing, never a value", () => {
    expect(xeroSetting({ NODE_ENV: "production" })).toEqual({
      on: false,
      missing: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"],
      held: null,
    });
  });

  it("is only on in production with a real database, and never in a test", () => {
    expect(xeroSetting(production).on).toBe(true);
    expect(
      xeroSetting({ ...production, DATABASE_URL: undefined }).held,
    ).toMatch(/invented records/);
    expect(
      xeroSetting({ ...production, NODE_ENV: "development" }).held,
    ).toMatch(/development/);
    expect(xeroApp({ env: production })).toBeNull();
  });
});

describe("Xero, with sales", () => {
  let handle: DbHandle;
  let made = 0;
  const staff = systemCaller("Test", "script");
  const NOW = new Date("2026-11-20T00:00:00.000Z");

  const provider: PaymentProvider = {
    name: "fake",
    isTest: false,
    savesFirst: false,
    begin: async (request) => ({
      kind: "done",
      payment: {
        provider: "fake",
        status: "paid",
        reference: `pi_${request.orderNumber}`,
      },
    }),
  };
  const testProvider: PaymentProvider = {
    name: "test",
    isTest: true,
    savesFirst: false,
    begin: async (request) => ({
      kind: "done",
      payment: {
        provider: "test",
        status: "test",
        reference: `REF-${request.orderNumber}`,
      },
    }),
  };

  async function buy(test = false): Promise<string> {
    made += 1;
    const result = await placeOrder(
      {
        email: `books${String(made)}@example.co.nz`,
        phone: "",
        firstName: "Aroha",
        lastName: "Ngata",
        line1: "12 Sideline Road",
        line2: "",
        suburb: "",
        city: "Wellington",
        region: "Wellington",
        postcode: "6011",
        rural: false,
        notes: "",
        joinCrew: false,
        lines: [
          { sku: "QP-SHOT-12", qty: 1 },
          { sku: "QP-SHOT-06-MCL", qty: 1 },
        ],
      },
      {
        offer: FILE_OFFER,
        payments: test ? testProvider : provider,
        store: getStore(),
      },
    );
    if (!result.ok) throw new Error(`Not placed: ${result.reason}`);
    return result.order.number;
  }

  /** A Xero that takes everything, and remembers what it was given. */
  function happyXero() {
    const invoices = new Map<string, { id: string; left: number }>();
    const notes = new Map<string, { id: string; left: number }>();
    let next = 0;
    const made = fakeXero((call) => {
      const path = call.url.pathname;
      if (path === "/api.xro/2.0/Invoices" && call.method === "GET") {
        const number = call.url.searchParams.get("InvoiceNumbers") ?? "";
        const held = invoices.get(number);
        return {
          status: 200,
          body: {
            Invoices: held
              ? [
                  {
                    InvoiceID: held.id,
                    InvoiceNumber: number,
                    Status: "AUTHORISED",
                    AmountDue: held.left,
                  },
                ]
              : [],
          },
        };
      }
      if (path === "/api.xro/2.0/Invoices" && call.method === "PUT") {
        const body = JSON.parse(call.body ?? "{}") as {
          Invoices: {
            InvoiceNumber: string;
            LineItems: { UnitAmount: number; Quantity: number }[];
          }[];
        };
        const invoice = body.Invoices[0];
        next += 1;
        const total =
          invoice?.LineItems.reduce(
            (sum, line) => sum + line.UnitAmount * line.Quantity,
            0,
          ) ?? 0;
        const held = { id: `inv-${String(next)}`, left: total };
        invoices.set(invoice?.InvoiceNumber ?? "", held);
        return {
          status: 200,
          body: { Invoices: [{ InvoiceID: held.id, AmountDue: total }] },
        };
      }
      if (path === "/api.xro/2.0/CreditNotes" && call.method === "GET") {
        const where = call.url.searchParams.get("where") ?? "";
        const number = /"(.+)"/.exec(where)?.[1] ?? "";
        const held = notes.get(number);
        return {
          status: 200,
          body: {
            CreditNotes: held
              ? [
                  {
                    CreditNoteID: held.id,
                    CreditNoteNumber: number,
                    Status: "AUTHORISED",
                    RemainingCredit: held.left,
                  },
                ]
              : [],
          },
        };
      }
      if (path === "/api.xro/2.0/CreditNotes" && call.method === "PUT") {
        const body = JSON.parse(call.body ?? "{}") as {
          CreditNotes: {
            CreditNoteNumber: string;
            LineItems: { UnitAmount: number }[];
          }[];
        };
        const note = body.CreditNotes[0];
        next += 1;
        const held = {
          id: `cn-${String(next)}`,
          left: note?.LineItems[0]?.UnitAmount ?? 0,
        };
        notes.set(note?.CreditNoteNumber ?? "", held);
        return {
          status: 200,
          body: {
            CreditNotes: [
              { CreditNoteID: held.id, RemainingCredit: held.left },
            ],
          },
        };
      }
      if (path === "/api.xro/2.0/Payments" && call.method === "PUT") {
        next += 1;
        return {
          status: 200,
          body: { Payments: [{ PaymentID: `pay-${String(next)}` }] },
        };
      }
      return { status: 404, body: {} };
    });
    return { ...made, invoices, notes };
  }

  async function connected(gst: boolean | null = true) {
    await handle.db.delete(xeroLink);
    await handle.db.delete(xeroPostings);
    await handle.db.delete(settings).where(eq(settings.key, SHOP_OFFER_KEY));
    if (gst !== null) {
      await handle.db
        .insert(settings)
        .values({ key: SHOP_OFFER_KEY, value: { gstRegistered: gst } });
    }
    await execute(
      connectXero,
      {
        organisations: [{ id: "tenant-1", name: "Quick Pickle Ltd" }],
        accessToken: seal("ACCESS", SECRET),
        refreshToken: seal("REFRESH", SECRET),
        expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      },
      staff,
    );
  }

  async function setUp(startDay = "2026-01-01") {
    await execute(
      setUpXero,
      {
        salesAccount: "200",
        deliveryAccount: "260",
        bankAccountId: "bank-1",
        bankAccountName: "Stripe",
        taxType: "OUTPUT2",
        contactName: "Quick Pickle online shop",
        startDay,
      },
      staff,
    );
  }

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    await handle.db.delete(xeroPostings);
  });

  it("sends a sale once: an invoice, then its payment, into the chosen account", async () => {
    await connected();
    await setUp();
    const number = await buy();
    const xero = happyXero();
    const round = await sendToXero(handle.db, NOW, { app: xero.app });
    expect(round.sales).toBeGreaterThanOrEqual(1);
    const put = xero.calls.find(
      (call) =>
        call.method === "PUT" &&
        call.url.pathname.endsWith("/Invoices") &&
        call.body?.includes(number),
    );
    expect(put).toBeDefined();
    expect(put?.headers["xero-tenant-id"]).toBe("tenant-1");
    expect(put?.headers.Authorization).toBe("Bearer ACCESS");
    expect(put?.headers["Idempotency-Key"]).toMatch(/^qp-ord_.+-invoice$/);
    const invoice = (
      JSON.parse(put?.body ?? "{}") as { Invoices: Record<string, unknown>[] }
    ).Invoices[0];
    expect(invoice).toMatchObject({
      Type: "ACCREC",
      Contact: { Name: "Quick Pickle online shop" },
      InvoiceNumber: number,
      Reference: `pi_${number}`,
      LineAmountTypes: "Inclusive",
      Status: "AUTHORISED",
      CurrencyCode: "NZD",
    });
    // No customer's name, email or address goes to Xero.
    expect(put?.body).not.toContain("Aroha");
    expect(put?.body).not.toContain("example.co.nz");
    expect(put?.body).not.toContain("Sideline");
    const payment = xero.calls.find(
      (call) =>
        call.method === "PUT" && call.url.pathname.endsWith("/Payments"),
    );
    expect(JSON.parse(payment?.body ?? "{}")).toMatchObject({
      Payments: [
        { Account: { AccountID: "bank-1" }, Reference: `pi_${number}` },
      ],
    });

    // The next round asks Xero nothing: nothing is waiting.
    const before = xero.calls.length;
    const again = await sendToXero(handle.db, NOW, { app: xero.app });
    expect(again).toEqual({ sales: 0, refunds: 0, stopped: null });
    expect(xero.calls.length).toBe(before);
  });

  it("finds a sale already in Xero instead of making it twice", async () => {
    await connected();
    await setUp();
    const number = await buy();
    const xero = happyXero();
    xero.invoices.set(number, { id: "inv-existing", left: 0 });
    await sendToXero(handle.db, NOW, { app: xero.app });
    const puts = xero.calls.filter(
      (call) => call.method === "PUT" && call.body?.includes(number),
    );
    expect(puts).toHaveLength(0);
    const [posting] = await handle.db
      .select()
      .from(xeroPostings)
      .where(eq(xeroPostings.xeroId, "inv-existing"));
    expect(posting?.state).toBe("sent");
  });

  it("never sends a test order, or a sale from before the first day", async () => {
    await connected();
    await setUp("2099-01-01");
    await buy(true);
    await buy();
    const xero = happyXero();
    const round = await sendToXero(handle.db, NOW, { app: xero.app });
    expect(round).toEqual({ sales: 0, refunds: 0, stopped: null });
    expect(xero.calls).toHaveLength(0);
  });

  it("sends a refund as a credit note paid out, after its sale", async () => {
    await connected();
    await setUp();
    const number = await buy();
    await execute(
      recordRefund,
      { number, amountCents: 500, reason: "One bottle leaked" },
      staff,
    );
    const xero = happyXero();
    await sendToXero(handle.db, NOW, { app: xero.app });
    const put = xero.calls.find(
      (call) =>
        call.method === "PUT" && call.url.pathname.endsWith("/CreditNotes"),
    );
    const note = (
      JSON.parse(put?.body ?? "{}") as {
        CreditNotes: Record<string, unknown>[];
      }
    ).CreditNotes[0];
    expect(note).toMatchObject({
      Type: "ACCRECCREDIT",
      CreditNoteNumber: `${number}-R1`,
      LineItems: [{ UnitAmount: 5, AccountCode: "200", TaxType: "OUTPUT2" }],
    });
    const payout = xero.calls.filter(
      (call) =>
        call.method === "PUT" && call.url.pathname.endsWith("/Payments"),
    );
    expect(payout.some((call) => call.body?.includes('"CreditNote"'))).toBe(
      true,
    );
    const status = await execute(xeroStatus, {}, staff);
    expect(status.sent).toBeGreaterThanOrEqual(2);
  });

  it("writes a refusal down with what Xero said, and sends it again when asked", async () => {
    await connected();
    await setUp();
    const number = await buy();
    let refuse = true;
    const happy = happyXero();
    const xero = fakeXero((call) => {
      if (
        refuse &&
        call.method === "PUT" &&
        call.url.pathname.endsWith("/Invoices")
      ) {
        return {
          status: 400,
          body: {
            Type: "ValidationException",
            Elements: [
              {
                ValidationErrors: [
                  {
                    Message:
                      "Account code '200' is not a valid code for this document.",
                  },
                ],
              },
            ],
          },
        };
      }
      return { status: 200, body: { Invoices: [] } };
    });
    await sendToXero(handle.db, NOW, { app: xero.app });
    const status = await execute(xeroStatus, {}, staff);
    const failed = status.failed.find((item) => item.number === number);
    expect(failed?.trouble).toMatch(/Account code '200' is not a valid code/);
    expect((await xeroNeeds(handle.db)).map((need) => need.key)).toContain(
      "xero-failed",
    );

    refuse = false;
    await execute(tryXeroAgain, { key: failed?.key ?? "" }, staff);
    await sendToXero(handle.db, NOW, { app: happy.app });
    expect(happy.invoices.has(number)).toBe(true);
  });

  it("renews the key when it is about to run out, and keeps the new pair sealed", async () => {
    await connected();
    await handle.db
      .update(xeroLink)
      .set({ accessExpiresAt: new Date(NOW.getTime() + 30_000) });
    const { app, calls } = fakeXero(() => ({
      status: 200,
      body: {
        access_token: "ACCESS-2",
        refresh_token: "REFRESH-2",
        expires_in: 1800,
      },
    }));
    const key = await liveKey(handle.db, app, NOW);
    expect(key.accessToken).toBe("ACCESS-2");
    expect(new URLSearchParams(calls[0]?.body ?? "").get("refresh_token")).toBe(
      "REFRESH",
    );
    const [row] = await handle.db.select().from(xeroLink);
    expect(row?.refreshToken).not.toContain("REFRESH-2");
    expect(unseal(row?.refreshToken ?? "", SECRET)).toBe("REFRESH-2");
  });

  it("asks for Xero to be connected again when it stops taking the key", async () => {
    await connected();
    await setUp();
    await buy();
    await handle.db
      .update(xeroLink)
      .set({ accessExpiresAt: new Date(NOW.getTime() - 60_000) });
    const { app } = fakeXero(() => ({
      status: 400,
      body: { error: "invalid_grant" },
    }));
    const round = await sendToXero(handle.db, NOW, { app });
    expect(round.stopped).toMatch(/Connect Xero again/);
    const status = await execute(xeroStatus, {}, staff);
    expect(status.lost).not.toBeNull();
    expect(status.sending).toBe(false);
    expect((await xeroNeeds(handle.db)).map((need) => need.key)).toContain(
      "xero-lost",
    );
  });

  it("will not start until it is known whether the business is registered for GST", async () => {
    await connected(null);
    await expect(setUp()).rejects.toBeInstanceOf(OpError);
    await connected(false);
    await execute(
      setUpXero,
      {
        salesAccount: "200",
        deliveryAccount: "200",
        bankAccountId: "bank-1",
        contactName: "Shop sales",
        startDay: "2026-01-01",
      },
      staff,
    );
    const status = await execute(xeroStatus, {}, staff);
    expect(status.sending).toBe(true);
    expect(status.setUp.taxType).toBeNull();
  });

  it("lets the owner choose when a sign-in let in more than one organisation", async () => {
    await handle.db.delete(xeroLink);
    await execute(
      connectXero,
      {
        organisations: [
          { id: "t-a", name: "Quick Pickle Ltd" },
          { id: "t-b", name: "Another business" },
        ],
        accessToken: seal("ACCESS", SECRET),
        refreshToken: seal("REFRESH", SECRET),
        expiresAt: NOW,
      },
      staff,
    );
    let status = await execute(xeroStatus, {}, staff);
    expect(status.choose).toHaveLength(2);
    await expect(
      execute(chooseOrganisation, { tenantId: "t-somebody-else" }, staff),
    ).rejects.toBeInstanceOf(OpError);
    await execute(chooseOrganisation, { tenantId: "t-a" }, staff);
    status = await execute(xeroStatus, {}, staff);
    expect(status.organisation).toBe("Quick Pickle Ltd");
    expect(status.choose).toHaveLength(0);
  });
});

describe("what goes on an invoice", () => {
  const ready = {
    tenantId: "t",
    salesAccount: "200",
    deliveryAccount: "260",
    bankAccountId: "b",
    contactName: "Shop sales",
    startDay: "2026-01-01",
    taxType: "OUTPUT2",
  };
  const order = {
    number: "QP-7K2M9X",
    paidAt: new Date("2026-11-19T22:00:00.000Z"),
    placedAt: new Date("2026-11-19T21:59:00.000Z"),
    discountCents: 500,
    promoCode: "KAI10",
    shippingCents: 700,
    rural: false,
    totalCents: 2 * 2400 + 1300 - 500 + 700,
    paymentReference: "pi_123",
  } as unknown as Parameters<typeof invoiceFor>[0];
  const lines = [
    {
      name: "The Starter, Original",
      shots: 12,
      qty: 2,
      unitCents: 2400,
      sku: "QP-SHOT-12",
    },
    {
      name: "The Trial, Mango Chilli Lime",
      shots: 6,
      qty: 1,
      unitCents: 1300,
      sku: "QP-SHOT-06-MCL",
    },
  ] as unknown as Parameters<typeof invoiceFor>[1];

  it("has a line for each pack, the discount and delivery, on the New Zealand day it was paid", () => {
    const invoice = invoiceFor(order, lines, ready);
    if ("why" in invoice) throw new Error(invoice.why);
    // 22:00 UTC on the 19th is the 20th in New Zealand.
    expect(invoice.Date).toBe("2026-11-20");
    expect(
      invoice.LineItems.map((line) => [
        line.Description,
        line.Quantity,
        line.UnitAmount,
        line.AccountCode,
      ]),
    ).toEqual([
      ["The Starter, Original (12 shots)", 2, 24, "200"],
      ["The Trial, Mango Chilli Lime (6 shots)", 1, 13, "200"],
      ["Discount (KAI10)", 1, -5, "200"],
      ["Delivery", 1, 7, "260"],
    ]);
  });

  it("carries no GST when the business is not registered", () => {
    const invoice = invoiceFor(order, lines, { ...ready, taxType: null });
    if ("why" in invoice) throw new Error(invoice.why);
    expect(invoice.LineAmountTypes).toBe("NoTax");
    expect(invoice.LineItems.every((line) => line.TaxType === "NONE")).toBe(
      true,
    );
  });

  it("sends nothing when the lines do not come to what was charged", () => {
    const wrong = invoiceFor(
      { ...order, totalCents: order.totalCents + 1 },
      lines,
      ready,
    );
    expect("why" in wrong ? wrong.why : "").toMatch(/Put it in Xero by hand/);
  });

  it("numbers a credit note after its order", () => {
    expect(creditNoteNumber("QP-7K2M9X", 2)).toBe("QP-7K2M9X-R2");
    const note = creditNoteFor(
      order,
      {
        amountCents: 1250,
        createdAt: new Date("2026-11-21T01:00:00.000Z"),
      } as unknown as Parameters<typeof creditNoteFor>[1],
      1,
      ready,
    );
    expect(note).toMatchObject({
      CreditNoteNumber: "QP-7K2M9X-R1",
      Date: "2026-11-21",
      LineItems: [{ UnitAmount: 12.5 }],
    });
  });
});
