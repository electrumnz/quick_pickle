import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { SHOP } from "@/content/site";
import { mailMessages, orderLines, orders, settings, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { emailCustomer } from "@/lib/backstage/orders/emails";
import { recordOrder } from "@/lib/backstage/orders/ops";
import { createSpecial } from "@/lib/backstage/marketing/specials";
import { changeShop, readShop, SHOP_OFFER_KEY } from "@/lib/backstage/shop/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { FILE_OFFER } from "@/lib/shop/offer";
import { offerForPage, offerNow } from "@/lib/shop/offer-now";
import type { ChargeRequest, PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { quote } from "@/lib/shop/pricing";
import { getStore } from "@/lib/shop/store";

/**
 * What changing the shop does to an order.
 *
 * A price can move while somebody is at the checkout. These hold the one
 * promise that matters then: nobody is charged anything but the total they
 * were shown, and the server never takes a page's word for a price.
 */

const shop = systemCaller("The shop", "storefront");
const TRIAL = "QP-SHOT-06";

const form = (over: Record<string, unknown> = {}) => ({
  email: "mere@example.co.nz",
  phone: "",
  firstName: "Mere",
  lastName: "Tane",
  line1: "4 Halfway Line",
  line2: "",
  suburb: "",
  city: "Levin",
  region: "Manawatū-Whanganui",
  postcode: "5510",
  rural: false,
  notes: "",
  joinCrew: false,
  lines: [{ sku: TRIAL, qty: 1 }],
  ...over,
});

describe("an order, while the shop is being changed", () => {
  let handle: DbHandle;
  let owner: Caller;
  let charges: ChargeRequest[];

  const payments = (): PaymentProvider => ({
    name: "fake",
    isTest: false,
    savesFirst: false,
    begin: async (request) => {
      charges.push(request);
      return {
        kind: "done",
        payment: {
          provider: "fake",
          status: "paid",
          reference: `REF-${request.orderNumber}`,
        },
      };
    },
  });

  /** Place an order the way the checkout's own action does. */
  const buy = async (over: Record<string, unknown> = {}) =>
    placeOrder(form(over), {
      offer: await offerNow(),
      offerAgain: offerNow,
      payments: payments(),
      store: getStore({ NODE_ENV: "test" }),
    });

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const id = newId("usr");
    await handle.db
      .insert(users)
      .values({ id, email: "owner@example.co.nz", name: "Ash", role: "owner" });
    owner = {
      actor: { type: "human", userId: id, name: "Ash", role: "owner" },
      via: "ui",
      confirmed: true,
    };
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    charges = [];
    await handle.db.delete(settings).where(eq(settings.key, SHOP_OFFER_KEY));
  });

  it("is priced from the back end's prices, not the file's", async () => {
    await execute(changeShop, { prices: { [TRIAL]: 3000 } }, owner);
    const now = await offerNow();
    expect(now.packs[0]?.priceCents).toBe(3000);
    expect(now.version).not.toBe(FILE_OFFER.version);

    const result = await buy({ offer: now.version });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.order.lines[0]?.unitCents).toBe(3000);
    expect(result.order.totalCents).toBe(3000 + 700);
    expect(charges).toHaveLength(1);
    expect(charges[0]?.amountCents).toBe(3700);
    const [saved] = await handle.db
      .select()
      .from(orders)
      .where(eq(orders.number, result.order.number));
    expect(saved?.totalCents).toBe(3700);
  });

  it("hands back an order whose page was drawn before a price moved, and charges nobody", async () => {
    // The buyer opens the checkout: $27 on the button.
    const shown = await offerNow();
    expect(quote(shown, { lines: [{ sku: TRIAL, qty: 1 }] }).totalCents).toBe(
      3400,
    );
    // The price goes up while they are typing their address.
    await execute(changeShop, { prices: { [TRIAL]: 3000 } }, owner);

    const before = (await handle.db.select().from(orders)).length;
    const result = await buy({ offer: shown.version });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { offer: SHOP.moved },
    });
    expect(charges).toEqual([]);
    expect((await handle.db.select().from(orders)).length).toBe(before);

    // They are handed the offer as it stands, to see the new total with.
    if (result.ok || result.reason !== "invalid") throw new Error("no");
    expect(result.offer?.packs[0]?.priceCents).toBe(3000);
    expect(result.offer?.version).toBe((await offerNow()).version);
    // Nothing about the business rides along with it.
    expect(JSON.stringify(result.offer)).not.toContain("stand-in");

    // Pressing again, now on the page that shows $30, goes through at $30.
    const again = await buy({ offer: result.offer?.version });
    if (!again.ok) throw new Error(JSON.stringify(again));
    expect(again.order.totalCents).toBe(3700);
    expect(charges.map((charge) => charge.amountCents)).toEqual([3700]);
  });

  it("hands it back for a price that went down as well: the total on the button is always the one charged", async () => {
    const shown = await offerNow();
    await execute(changeShop, { prices: { [TRIAL]: 2500 } }, owner);
    const result = await buy({ offer: shown.version });
    expect(result).toMatchObject({ ok: false, errors: { offer: SHOP.moved } });
    expect(charges).toEqual([]);
  });

  it("hands it back when delivery or pre-order-or-live changed, and not for a thing that moves no total", async () => {
    const shown = await offerNow();
    // The contact address and the ship date change nothing a buyer pays.
    await execute(
      changeShop,
      {
        contactEmail: "hello@example.co.nz",
        preorderShipsFrom: "2026-12-01",
        batchName: "Batch 002",
      },
      owner,
    );
    expect((await offerNow()).version).toBe(shown.version);
    expect((await buy({ offer: shown.version })).ok).toBe(true);

    await execute(changeShop, { shipping: { standardCents: 900 } }, owner);
    expect(await buy({ offer: shown.version })).toMatchObject({
      ok: false,
      errors: { offer: SHOP.moved },
    });
    const dearer = await offerNow();
    await execute(changeShop, { launchMode: "live" }, owner);
    expect(await buy({ offer: dearer.version })).toMatchObject({
      ok: false,
      errors: { offer: SHOP.moved },
    });
    // On the page as it stands now: a live order, with $9 delivery.
    const live = await buy({ offer: (await offerNow()).version });
    if (!live.ok) throw new Error(JSON.stringify(live));
    expect(live.order.mode).toBe("live");
    expect(live.order.shippingCents).toBe(900);
  });

  it("takes no orders while the shop is shut, whatever the page said", async () => {
    const shown = await offerNow();
    await execute(changeShop, { open: false }, owner);
    for (const offer of [shown.version, (await offerNow()).version, ""]) {
      const result = await buy({ offer });
      expect(result).toMatchObject({
        ok: false,
        reason: "invalid",
        errors: { offer: SHOP.closed },
      });
      if (!result.ok && result.reason === "invalid") {
        expect(result.offer?.open).toBe(false);
      }
    }
    expect(charges).toEqual([]);
    await execute(changeShop, { open: true }, owner);
    expect((await buy({ offer: (await offerNow()).version })).ok).toBe(true);
  });

  it("prices a form that names no offer from the server's own, and never from the form", async () => {
    await execute(changeShop, { prices: { [TRIAL]: 3000 } }, owner);
    // A hand-built request: no word for an offer, and a price of its own
    // that nothing reads.
    const result = await buy({
      lines: [{ sku: TRIAL, qty: 1, priceCents: 1, unitCents: 1 }],
      totalCents: 1,
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.order.totalCents).toBe(3700);
  });

  it("refuses to save an order priced from an offer that moved in the instant between", async () => {
    // The checkout read the offer and priced the order...
    const priced = await offerNow();
    const stale = {
      number: "QP-STAXE2",
      placedAt: new Date(),
      mode: "preorder" as const,
      customer: {
        email: "mere@example.co.nz",
        phone: null,
        firstName: "Mere",
        lastName: "Tane",
      },
      delivery: {
        line1: "4 Halfway Line",
        line2: null,
        suburb: null,
        city: "Levin",
        region: "Manawatū-Whanganui" as const,
        postcode: "5510",
        rural: false,
        notes: null,
      },
      lines: [
        {
          sku: TRIAL,
          name: "The Trial",
          shots: 6,
          qty: 1,
          unitCents: 2700,
          lineCents: 2700,
        },
      ],
      subtotalCents: 2700,
      discountCents: 0,
      shippingCents: 700,
      totalCents: 3400,
      currency: "NZD" as const,
      promo: null,
      payment: { provider: "fake", status: "paid" as const, reference: "R1" },
      joinCrew: false,
      offerVersion: priced.version,
    };
    // ...and the price moved before the order reached the database.
    await execute(changeShop, { prices: { [TRIAL]: 3000 } }, owner);
    await expect(execute(recordOrder, stale, shop)).rejects.toMatchObject({
      code: "conflict",
      message: SHOP.moved,
    });
    expect(
      await handle.db
        .select()
        .from(orders)
        .where(eq(orders.number, "QP-STAXE2")),
    ).toEqual([]);
    // The same order with the word for the offer as it stands is taken.
    await execute(
      recordOrder,
      {
        ...stale,
        lines: [{ ...stale.lines[0]!, unitCents: 3000, lineCents: 3000 }],
        subtotalCents: 3000,
        totalCents: 3700,
        offerVersion: (await offerNow()).version,
      },
      shop,
    );
    // And shut, nothing is saved either.
    await execute(changeShop, { open: false }, owner);
    await expect(
      execute(
        recordOrder,
        {
          ...stale,
          number: "QP-SHXT22",
          offerVersion: (await offerNow()).version,
        },
        shop,
      ),
    ).rejects.toMatchObject({ code: "conflict", message: SHOP.closed });
  });

  it("tells the buyer the shop moved when the save itself is what found out", async () => {
    // The offer the action read, then a change, then the save refusing it:
    // the buyer is told what happened, not that something went wrong.
    const read = await offerNow();
    await execute(changeShop, { prices: { [TRIAL]: 3000 } }, owner);
    const result = await placeOrder(form({ offer: read.version }), {
      offer: read,
      offerAgain: offerNow,
      payments: payments(),
      store: getStore({ NODE_ENV: "test" }),
    });
    expect(result).toMatchObject({ ok: false, errors: { offer: SHOP.moved } });
    if (!result.ok && result.reason === "invalid") {
      expect(result.offer?.packs[0]?.priceCents).toBe(3000);
    }
  });

  it("works out a code's worth from the delivery rate as the back end has it", async () => {
    // Free delivery for everybody: a delivery special would give nothing.
    await execute(changeShop, { shipping: { standardCents: 0 } }, owner);
    await expect(
      execute(
        createSpecial,
        {
          code: "FREERIDE",
          name: "Free ride",
          kind: "delivery",
          value: 0,
          minSubtotalCents: 0,
        },
        owner,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    // A flat rate with no free delivery to earn: any smallest order is fine.
    await execute(
      changeShop,
      { shipping: { standardCents: 700, freeOverCents: null } },
      owner,
    );
    const made = await execute(
      createSpecial,
      {
        code: "FREERIDE",
        name: "Free ride",
        kind: "delivery",
        value: 0,
        minSubtotalCents: 9000,
      },
      owner,
    );
    expect(made.id).toMatch(/^pro_/);
  });

  it("writes the receipt with the batch, the date and the address as the back end has them", async () => {
    await execute(
      changeShop,
      {
        batchName: "Batch 002",
        preorderShipsFrom: "2026-12-01",
        contactEmail: "hello@example.co.nz",
      },
      owner,
    );
    const result = await buy({ offer: (await offerNow()).version });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const [order] = await handle.db
      .select()
      .from(orders)
      .where(eq(orders.number, result.order.number));
    expect(order).toBeDefined();
    expect(
      await handle.db
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, order?.id ?? "")),
    ).toHaveLength(1);
    const written = await execute(
      emailCustomer,
      { number: result.order.number, about: "receipt" },
      { ...shop, confirmed: true },
    );
    if (!written.written) throw new Error("no receipt was written");
    const [message] = await handle.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, written.messageId));
    const text = message?.textBody ?? "";
    expect(text).toContain("This is a Batch 002 pre-order. It ships from");
    expect(text).toContain("1 December 2026");
    expect(text).toContain("hello@example.co.nz");
    expect(text).not.toContain("Batch 001");
  });
});

describe("the offer a page is drawn with", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
  }, 60_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDb();
  });

  it("is the file's while the site is being built, and the database is never asked", async () => {
    await handle.db
      .insert(settings)
      .values({
        key: SHOP_OFFER_KEY,
        value: { prices: { [TRIAL]: 3000 } },
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: { prices: { [TRIAL]: 3000 } } },
      });
    expect((await readShop(handle.db)).offer.packs[0]?.priceCents).toBe(3000);
    expect((await offerForPage()).packs[0]?.priceCents).toBe(3000);

    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(await offerForPage()).toBe(FILE_OFFER);
    vi.unstubAllEnvs();
  });

  it("is the last one it had when the database cannot be reached, and never a failed page", async () => {
    expect((await offerForPage()).packs[0]?.priceCents).toBe(3000);
    // A store that does not exist: asking it throws.
    vi.stubEnv("ORDER_STORE", "nowhere");
    await expect(offerNow()).rejects.toThrow();
    const drawn = await offerForPage();
    expect(drawn.packs[0]?.priceCents).toBe(3000);
    vi.unstubAllEnvs();
  });
});
