import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CODES } from "@/content/site";
import { auditLog, orders, promoCodes, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  collabReturn,
  cutOn,
  NO_SPEND,
  NO_TAKINGS,
} from "@/lib/backstage/marketing/collab-sums";
import {
  addPartnerCost,
  collabBoard,
  partnerResults,
  promoCodeResults,
  removePartnerCost,
} from "@/lib/backstage/marketing/collabs";
import { tidySource } from "@/lib/backstage/marketing/credit";
import {
  createLink,
  getLink,
  listLinks,
  resolveLink,
  updateLink,
} from "@/lib/backstage/marketing/links";
import {
  addPartner,
  getPartner,
  setPartnerCut,
} from "@/lib/backstage/marketing/partners";
import {
  checkPromoCode,
  createPromoCode,
  getPromoCode,
  listPromoCodes,
  peekPromoCode,
  setPromoCodeActive,
  updatePromoCode,
} from "@/lib/backstage/marketing/promo-codes";
import {
  cancelOrder,
  getOrder,
  recordRefund,
} from "@/lib/backstage/orders/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import type { PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { getStore } from "@/lib/shop/store";

/**
 * Collabs: a promo code or a short link that belongs to a club or a creator,
 * who gets the credit for a sale, what the partnership has cost, and what
 * came back. Everything here goes through the same checkout path a real
 * order does.
 */

const shop = systemCaller("The shop", "storefront");

let buyer = 0;
const form = (over: Record<string, unknown> = {}) => ({
  // A fresh customer each time unless the test says who.
  email: `buyer${String((buyer += 1))}@example.co.nz`,
  phone: "",
  firstName: "Sam",
  lastName: "Tester",
  line1: "12 Sideline Road",
  line2: "",
  suburb: "",
  city: "Wellington",
  region: "Wellington",
  postcode: "6011",
  rural: false,
  notes: "",
  joinCrew: false,
  // One box of twelve: $48.00, with $7.00 standard delivery.
  lines: [{ sku: "QP-SHOT-12", qty: 1 }],
  ...over,
});

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

describe("the sums", () => {
  it("works a cut out on the goods as paid for, to the nearest cent", () => {
    // $48.00 of goods with $4.80 off: 10% of $43.20.
    expect(
      cutOn({ subtotalCents: 4800, discountCents: 480, refundedCents: 0 }, 10),
    ).toBe(432);
    // Half a cent goes up.
    expect(
      cutOn({ subtotalCents: 4325, discountCents: 0, refundedCents: 0 }, 10),
    ).toBe(433);
    expect(
      cutOn({ subtotalCents: 4324, discountCents: 0, refundedCents: 0 }, 10),
    ).toBe(432);
    // A refund comes off the goods first, and never takes it below nothing.
    expect(
      cutOn({ subtotalCents: 4800, discountCents: 0, refundedCents: 1800 }, 10),
    ).toBe(300);
    expect(
      cutOn({ subtotalCents: 4800, discountCents: 0, refundedCents: 9999 }, 10),
    ).toBe(0);
    expect(
      cutOn({ subtotalCents: 4800, discountCents: 0, refundedCents: 0 }, 0),
    ).toBe(0);
  });

  it("adds up what a partnership cost, counting the cut once", () => {
    const takings = {
      ...NO_TAKINGS,
      orders: 3,
      salesCents: 16_790,
      commissionCents: 1539,
    };
    // Product given away, and a cut that has been earned but not paid.
    expect(collabReturn(takings, { ...NO_SPEND, product: 4800 })).toEqual({
      flatCents: 4800,
      cutCents: 1539,
      spendCents: 6339,
      cutOwingCents: 1539,
      afterCostsCents: 10_451,
      backPerDollarCents: 265,
    });
    // Paying the cut does not make it cost twice.
    expect(
      collabReturn(takings, { ...NO_SPEND, product: 4800, commission: 1539 }),
    ).toMatchObject({ spendCents: 6339, cutOwingCents: 0 });
    // Paid more than has been earned: what was paid is what it cost.
    expect(
      collabReturn(takings, { ...NO_SPEND, commission: 2000 }),
    ).toMatchObject({ cutCents: 2000, spendCents: 2000, cutOwingCents: 0 });
  });

  it("has no return to give when nothing has been spent", () => {
    expect(
      collabReturn({ ...NO_TAKINGS, orders: 1, salesCents: 5500 }, NO_SPEND),
    ).toMatchObject({
      spendCents: 0,
      afterCostsCents: 5500,
      backPerDollarCents: null,
    });
    // Money out and nothing back is a return of nothing, not no return.
    expect(
      collabReturn(NO_TAKINGS, { ...NO_SPEND, fee: 15_000 }),
    ).toMatchObject({ afterCostsCents: -15_000, backPerDollarCents: 0 });
  });

  it("keeps only the labels it knows from what a browser says", () => {
    expect(
      tidySource({
        via: " Rovers ",
        utm_source: "Instagram",
        utm_medium: "two words",
        utm_campaign: "x".repeat(61),
        price: "1",
        admin: "true",
      }),
    ).toEqual({ via: "rovers", utm_source: "instagram" });
    expect(tidySource({ via: "../../etc", utm_source: 7 })).toEqual({});
    expect(tidySource(null)).toEqual({});
  });
});

describe("collabs, from a code at the checkout to what came back", () => {
  let handle: DbHandle;
  let owner: Caller;
  let staff: Caller;
  let viewer: Caller;
  let rovers: string;
  let kai: string;
  let roversCode: string;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const make = async (
      role: "owner" | "staff" | "viewer",
    ): Promise<Caller> => {
      const id = newId("usr");
      await handle.db
        .insert(users)
        .values({ id, email: `${role}@example.co.nz`, name: role, role });
      return {
        actor: { type: "human", userId: id, name: role, role },
        via: "ui",
        confirmed: true,
      };
    };
    owner = await make("owner");
    staff = await make("staff");
    viewer = await make("viewer");
    rovers = (
      await execute(addPartner, { name: "Rovers FC", kind: "club" }, staff)
    ).id;
    kai = (
      await execute(
        addPartner,
        { name: "Kai Kicks", kind: "ambassador" },
        staff,
      )
    ).id;
  });
  afterAll(async () => {
    await closeDb();
  });

  const buy = async (
    over: Record<string, unknown> = {},
    pay: "test" | "paid" = "paid",
  ) => {
    const result = await placeOrder(form(over), {
      payments: provider(pay),
      store: getStore({ NODE_ENV: "test" }),
    });
    if (!result.ok) throw new Error(`order failed: ${JSON.stringify(result)}`);
    return result.order.number;
  };
  const order = (number: string) => execute(getOrder, { number }, viewer);
  const results = (partnerId: string) =>
    execute(partnerResults, { partnerId }, viewer);
  const history = async (partnerId: string) =>
    (
      await handle.db
        .select({ summary: auditLog.summary })
        .from(auditLog)
        .where(eq(auditLog.entityId, partnerId))
    ).map((row) => row.summary);

  it("gives a partner a cut, and says so in the log", async () => {
    expect(
      (await execute(getPartner, { id: rovers }, viewer)).commissionPercent,
    ).toBe(0);
    await execute(setPartnerCut, { id: rovers, commissionPercent: 10 }, staff);
    expect(
      (await execute(getPartner, { id: rovers }, viewer)).commissionPercent,
    ).toBe(10);
    expect(await history(rovers)).toContain(
      "Rovers FC now get 10% of each sale they bring in (was no cut). Orders already placed keep the cut they had.",
    );
    // The same again changes nothing and says nothing.
    const before = (await history(rovers)).length;
    await execute(setPartnerCut, { id: rovers, commissionPercent: 10 }, staff);
    expect((await history(rovers)).length).toBe(before);

    for (const commissionPercent of [-1, 101, 2.5, Number.NaN]) {
      await expect(
        execute(setPartnerCut, { id: rovers, commissionPercent }, staff),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(
      execute(setPartnerCut, { id: rovers, commissionPercent: 5 }, viewer),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("makes a code that is a partner's, and refuses a partner who is not there", async () => {
    roversCode = (
      await execute(
        createPromoCode,
        { code: "rovers10", kind: "percent", value: 10, partnerId: rovers },
        staff,
      )
    ).id;
    expect(
      await execute(getPromoCode, { id: roversCode }, viewer),
    ).toMatchObject({
      code: "ROVERS10",
      partnerId: rovers,
      partnerName: "Rovers FC",
    });
    expect(
      (await execute(listPromoCodes, { partnerId: rovers }, viewer)).map(
        (row) => row.code,
      ),
    ).toEqual(["ROVERS10"]);
    await expect(
      execute(
        createPromoCode,
        { code: "GHOST", kind: "delivery", partnerId: "prt_nobody" },
        staff,
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { partnerId: expect.stringContaining("not on the list") },
    });
  });

  it("credits an order placed with their code, at the cut they were on", async () => {
    const number = await buy({ promoCode: "rovers10" });
    expect(await order(number)).toMatchObject({
      promoCode: "ROVERS10",
      subtotalCents: 4800,
      discountCents: 480,
      deliveryDiscountCents: 0,
      shippingCents: 700,
      totalCents: 5020,
      partnerId: rovers,
      partnerName: "Rovers FC",
      commissionPercent: 10,
      // 10% of the $43.20 the goods came to.
      cutCents: 432,
    });
    expect((await results(rovers)).takings).toEqual({
      orders: 1,
      salesCents: 5020,
      discountCents: 480,
      commissionCents: 432,
      newCustomers: 1,
    });
    expect(await execute(promoCodeResults, { id: roversCode }, viewer)).toEqual(
      {
        code: "ROVERS10",
        orders: 1,
        salesCents: 5020,
        discountCents: 480,
        commissionCents: 432,
        newCustomers: 1,
      },
    );
  });

  it("leaves earlier orders alone when the deal changes or the code moves", async () => {
    await execute(setPartnerCut, { id: rovers, commissionPercent: 20 }, staff);
    const later = await buy({ promoCode: "ROVERS10" });
    expect(await order(later)).toMatchObject({
      partnerId: rovers,
      commissionPercent: 20,
      cutCents: 864,
    });
    // The first order still earns the 10% it was placed on.
    expect((await results(rovers)).takings).toMatchObject({
      orders: 2,
      commissionCents: 432 + 864,
    });

    // Hand the code to somebody else: what came before stays where it was.
    await execute(updatePromoCode, { id: roversCode, partnerId: kai }, staff);
    const moved = await buy({ promoCode: "ROVERS10" });
    expect(await order(moved)).toMatchObject({
      partnerId: kai,
      commissionPercent: 0,
      cutCents: 0,
    });
    expect((await results(rovers)).takings.orders).toBe(2);
    expect((await results(kai)).takings.orders).toBe(1);
    // The code's own figures do not care whose it is.
    expect(
      (await execute(promoCodeResults, { id: roversCode }, viewer)).orders,
    ).toBe(3);

    await execute(
      updatePromoCode,
      { id: roversCode, partnerId: rovers },
      staff,
    );
    await execute(setPartnerCut, { id: rovers, commissionPercent: 10 }, staff);
  });

  it("credits an order by the link it came through, when no code says otherwise", async () => {
    const link = await execute(
      createLink,
      {
        slug: "kai",
        target: "/",
        utm: { source: "instagram", medium: "social" },
        partnerId: kai,
      },
      staff,
    );

    // The browser says where it came from. Only what we recognise is kept.
    const through = await buy({
      source: { via: "KAI", utm_source: "Instagram", price: "0", junk: "x" },
    });
    const kept = await order(through);
    expect(kept.source).toEqual({ via: "kai", utm_source: "instagram" });
    expect(kept).toMatchObject({ partnerId: kai, partnerName: "Kai Kicks" });

    // A code is the firmer claim: it wins over the link.
    const both = await buy({
      promoCode: "ROVERS10",
      source: { via: "kai" },
    });
    expect(await order(both)).toMatchObject({
      partnerId: rovers,
      commissionPercent: 10,
      source: { via: "kai" },
    });

    // A link we have never made is dropped, and credits nobody.
    const madeUp = await buy({ source: { via: "not-a-link" } });
    expect(await order(madeUp)).toMatchObject({
      partnerId: null,
      source: null,
      commissionPercent: 0,
    });
    // Rubbish in the field never stops an order.
    const rubbish = await buy({ source: "not an object" });
    expect((await order(rubbish)).source).toBeNull();

    // The link's own count is of orders that came through it, whoever was
    // credited: two here.
    expect(await execute(getLink, { id: link.id }, viewer)).toMatchObject({
      slug: "kai",
      partnerId: kai,
      partnerName: "Kai Kicks",
      orders: 2,
      salesCents: 5500 + 5020,
    });
    const theirs = await results(kai);
    expect(theirs.links).toEqual([
      expect.objectContaining({
        slug: "kai",
        path: "/go/kai",
        code: null,
        orders: 2,
      }),
    ]);
  });

  it("counts only real sales: not tests, not cancelled, less refunds", async () => {
    const before = (await results(rovers)).takings;

    // A test order is not a sale.
    await buy({ promoCode: "ROVERS10" }, "test");
    expect((await results(rovers)).takings).toEqual(before);

    // Nor is one that was called off.
    const calledOff = await buy({ promoCode: "ROVERS10" });
    expect((await results(rovers)).takings.orders).toBe(before.orders + 1);
    await execute(
      cancelOrder,
      { number: calledOff, reason: "Ordered twice by mistake" },
      staff,
    );
    expect((await results(rovers)).takings).toEqual(before);
    expect((await order(calledOff)).cutCents).toBe(0);

    // Part of an order given back comes off the sales and off the cut.
    const partBack = await buy({ promoCode: "ROVERS10" });
    await execute(
      recordRefund,
      { number: partBack, amountCents: 1320, reason: "Two bottles leaked" },
      staff,
    );
    const after = (await results(rovers)).takings;
    expect(after.orders).toBe(before.orders + 1);
    expect(after.salesCents).toBe(before.salesCents + 5020 - 1320);
    // 10% of ($43.20 less the $13.20 given back).
    expect(after.commissionCents).toBe(before.commissionCents + 300);
    expect((await order(partBack)).cutCents).toBe(300);

    // All of it given back: no longer a sale at all.
    const allBack = await buy({ promoCode: "ROVERS10" });
    await execute(
      recordRefund,
      { number: allBack, amountCents: 5020, reason: "Changed their mind" },
      staff,
    );
    expect((await results(rovers)).takings).toEqual(after);
  });

  it("knows a new customer from one who has bought before", async () => {
    const before = (await results(rovers)).takings;
    const email = "regular@example.co.nz";
    await buy({ email });
    // Their second order is with the club's code: a sale, not a new customer.
    await buy({ email, promoCode: "ROVERS10" });
    const after = (await results(rovers)).takings;
    expect(after.orders).toBe(before.orders + 1);
    expect(after.newCustomers).toBe(before.newCustomers);
    // Somebody new is counted.
    await buy({ promoCode: "ROVERS10" });
    expect((await results(rovers)).takings.newCustomers).toBe(
      before.newCustomers + 1,
    );
  });

  it("writes down what a partnership cost, and takes a mistake back off", async () => {
    const fee = await execute(
      addPartnerCost,
      {
        partnerId: kai,
        kind: "fee",
        amountCents: 15_000,
        paidOn: "2026-11-02",
        note: "One reel and two stories",
      },
      staff,
    );
    await execute(
      addPartnerCost,
      { partnerId: kai, kind: "product", amountCents: 2700 },
      staff,
    );
    const theirs = await results(kai);
    expect(theirs.spend).toEqual({
      fee: 15_000,
      product: 2700,
      commission: 0,
      other: 0,
    });
    expect(theirs.costs.map((cost) => [cost.kind, cost.amountCents])).toEqual(
      expect.arrayContaining([
        ["fee", 15_000],
        ["product", 2700],
      ]),
    );
    expect(theirs.result).toMatchObject({
      flatCents: 17_700,
      cutCents: 0,
      spendCents: 17_700,
      afterCostsCents: theirs.takings.salesCents - 17_700,
      backPerDollarCents: Math.round(
        (theirs.takings.salesCents * 100) / 17_700,
      ),
    });
    expect(await history(kai)).toContain(
      "Wrote down $150.00 for Kai Kicks: a flat payment, Mon 2 Nov (One reel and two stories)",
    );

    // Not for a day that has not come, not for nothing, not by a viewer.
    await expect(
      execute(
        addPartnerCost,
        { partnerId: kai, kind: "fee", amountCents: 100, paidOn: "2999-01-01" },
        staff,
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { paidOn: expect.stringContaining("has not come yet") },
    });
    for (const amountCents of [0, -5, 12.5, Number.NaN]) {
      await expect(
        execute(
          addPartnerCost,
          { partnerId: kai, kind: "fee", amountCents },
          staff,
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(
      execute(
        addPartnerCost,
        { partnerId: kai, kind: "fee", amountCents: 100, paidOn: "02/11/2026" },
        staff,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      execute(
        addPartnerCost,
        { partnerId: "prt_nobody", kind: "fee", amountCents: 100 },
        staff,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      execute(
        addPartnerCost,
        { partnerId: kai, kind: "fee", amountCents: 100 },
        viewer,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    // A mistake comes off, and the log keeps what it was.
    const wrong = await execute(
      addPartnerCost,
      { partnerId: kai, kind: "other", amountCents: 99_900 },
      staff,
    );
    expect((await results(kai)).result.spendCents).toBe(17_700 + 99_900);
    await execute(removePartnerCost, { id: wrong.id }, staff);
    expect((await results(kai)).result.spendCents).toBe(17_700);
    expect(
      (await history(kai)).some((line) =>
        line.includes("Took off the $999.00"),
      ),
    ).toBe(true);
    await expect(
      execute(removePartnerCost, { id: wrong.id }, staff),
    ).rejects.toMatchObject({ code: "not_found" });
    // Taking one off cannot be undone, so a bot has to ask first.
    await expect(
      execute(
        removePartnerCost,
        { id: fee.id },
        { ...staff, via: "mcp", confirmed: false },
      ),
    ).rejects.toMatchObject({ code: "needs_confirmation" });
  });

  it("says what of a cut is still to pay", async () => {
    const earned = (await results(rovers)).takings.commissionCents;
    expect(earned).toBeGreaterThan(1000);
    expect((await results(rovers)).result).toMatchObject({
      cutCents: earned,
      cutOwingCents: earned,
      spendCents: earned,
    });
    await execute(
      addPartnerCost,
      { partnerId: rovers, kind: "commission", amountCents: 1000 },
      staff,
    );
    // Paying part of it does not change what the partnership cost.
    expect((await results(rovers)).result).toMatchObject({
      cutCents: earned,
      cutOwingCents: earned - 1000,
      spendCents: earned,
    });
  });

  it("puts every collab side by side, biggest sales first", async () => {
    const quiet = (
      await execute(addPartner, { name: "Sevens Day", kind: "event" }, staff)
    ).id;
    // Somebody with nothing of their own is not a collab yet.
    expect(
      (await execute(collabBoard, {}, viewer)).map((row) => row.partnerId),
    ).not.toContain(quiet);
    await execute(
      createLink,
      { slug: "sevens", target: "/", partnerId: quiet },
      staff,
    );

    const board = await execute(collabBoard, {}, viewer);
    expect(board.map((row) => row.name)).toEqual([
      "Rovers FC",
      "Kai Kicks",
      "Sevens Day",
    ]);
    const [first, second, third] = board;
    const theirs = await results(rovers);
    expect(first).toMatchObject({
      orders: theirs.takings.orders,
      salesCents: theirs.takings.salesCents,
      spendCents: theirs.result.spendCents,
      cutOwingCents: theirs.result.cutOwingCents,
      backPerDollarCents: theirs.result.backPerDollarCents,
    });
    expect(second?.spendCents).toBe(17_700);
    expect(third).toMatchObject({
      orders: 0,
      salesCents: 0,
      spendCents: 0,
      backPerDollarCents: null,
    });
  });

  it("lets a code work once for each customer", async () => {
    const welcome = await execute(
      createPromoCode,
      { code: "WELCOME", kind: "percent", value: 10, oncePerCustomer: true },
      staff,
    );
    const uses = async () =>
      (
        await handle.db
          .select({ uses: promoCodes.uses })
          .from(promoCodes)
          .where(eq(promoCodes.id, welcome.id))
      )[0]?.uses;

    const first = await buy({
      email: "once@example.co.nz",
      promoCode: "WELCOME",
    });
    expect(await uses()).toBe(1);

    // The same person, however they type their address.
    const again = await placeOrder(
      form({ email: " Once@Example.co.nz ", promoCode: "welcome" }),
      { payments: provider("paid"), store: getStore({ NODE_ENV: "test" }) },
    );
    expect(again).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { promoCode: CODES.alreadyUsed },
    });
    // Nothing was counted and no order was left behind.
    expect(await uses()).toBe(1);
    const theirs = await handle.db
      .select({ number: orders.number })
      .from(orders)
      .where(eq(orders.email, "once@example.co.nz"));
    expect(theirs.map((row) => row.number)).toEqual([first]);

    // Somebody else can still use it.
    await buy({ email: "other@example.co.nz", promoCode: "WELCOME" });
    expect(await uses()).toBe(2);

    // The checkout can say so as soon as it knows who is asking.
    const ask = (email?: string) =>
      execute(
        checkPromoCode,
        { code: "WELCOME", subtotalCents: 4800, deliveryCents: 700, email },
        shop,
      );
    expect(await ask()).toMatchObject({ ok: true, discountCents: 480 });
    expect(await ask("new@example.co.nz")).toMatchObject({ ok: true });
    expect(await ask("ONCE@example.co.nz")).toEqual({
      ok: false,
      reason: CODES.alreadyUsed,
    });

    // An order that was called off did not use anything up.
    await execute(
      cancelOrder,
      { number: first, reason: "Wrong address, starting again" },
      staff,
    );
    expect(await ask("once@example.co.nz")).toMatchObject({ ok: true });
    await buy({ email: "once@example.co.nz", promoCode: "WELCOME" });
  });

  it("has a link carry a code into the checkout, and keeps it to our own pages", async () => {
    const link = await execute(
      createLink,
      {
        slug: "rovers",
        target: "/",
        utm: { source: "rovers", medium: "print" },
        promoCodeId: roversCode,
      },
      staff,
    );
    // A link that carries a partner's code is that partner's link.
    expect(await execute(getLink, { id: link.id }, viewer)).toMatchObject({
      partnerId: rovers,
      partnerName: "Rovers FC",
      promoCodeId: roversCode,
      code: "ROVERS10",
    });
    expect(await execute(resolveLink, { slug: "rovers" }, shop)).toEqual({
      found: true,
      slug: "rovers",
      kind: "path",
      url: "/?utm_source=rovers&utm_medium=print&via=rovers&code=ROVERS10",
    });

    // A code that has been switched off is not carried.
    await execute(setPromoCodeActive, { id: roversCode, active: false }, staff);
    expect(
      await execute(resolveLink, { slug: "rovers", count: false }, shop),
    ).toMatchObject({
      url: "/?utm_source=rovers&utm_medium=print&via=rovers",
    });
    await execute(setPromoCodeActive, { id: roversCode, active: true }, staff);

    // Nothing of ours rides along to somebody else's website.
    const away = await execute(
      createLink,
      {
        slug: "club-site",
        target: "https://example.co.nz/rovers",
        partnerId: rovers,
      },
      owner,
    );
    expect(
      await execute(resolveLink, { slug: "club-site" }, shop),
    ).toMatchObject({
      kind: "https",
      url: "https://example.co.nz/rovers",
    });
    for (const attempt of [
      execute(
        createLink,
        {
          slug: "leak",
          target: "https://example.co.nz/",
          promoCodeId: roversCode,
        },
        owner,
      ),
      execute(updateLink, { id: away.id, promoCodeId: roversCode }, owner),
      execute(
        updateLink,
        { id: link.id, target: "https://example.co.nz/" },
        owner,
      ),
    ]) {
      await expect(attempt).rejects.toMatchObject({
        code: "invalid_input",
        fields: { promoCodeId: expect.stringContaining("cannot carry") },
      });
    }
    for (const bad of [
      { promoCodeId: "pro_nothing" },
      { partnerId: "prt_nobody" },
    ]) {
      await expect(
        execute(createLink, { slug: "ghost", target: "/", ...bad }, staff),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }

    // Take the code off again, and the partner stays.
    await execute(updateLink, { id: link.id, promoCodeId: null }, staff);
    expect(await execute(getLink, { id: link.id }, viewer)).toMatchObject({
      partnerId: rovers,
      promoCodeId: null,
      code: null,
    });
    expect(
      (await execute(listLinks, { partnerId: rovers }, viewer))
        .map((row) => row.slug)
        .sort(),
    ).toEqual(["club-site", "rovers"]);
  });

  it("tells a visitor what a carried code gives only when it could be used", async () => {
    const peek = (code: string) => execute(peekPromoCode, { code }, shop);
    expect(await peek(" rovers10 ")).toEqual({
      ok: true,
      code: "ROVERS10",
      label: "10% off",
    });
    await execute(
      createPromoCode,
      {
        code: "LASTWEEK",
        kind: "amount",
        value: 500,
        endsAt: new Date(Date.now() - 60_000),
      },
      staff,
    );
    await execute(
      createPromoCode,
      { code: "ASLEEP", kind: "delivery", active: false },
      staff,
    );
    for (const code of ["LASTWEEK", "ASLEEP", "NOSUCHCODE", "", "<script>"]) {
      expect(await peek(code), code).toEqual({ ok: false });
    }
  });
});
