import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SPECIAL } from "@/content/site";
import { auditLog, events, promoCodes, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { addPartner, setPartnerCut } from "@/lib/backstage/marketing/partners";
import {
  createPromoCode,
  crewWelcomeCode,
  getPromoCode,
  listPromoCodes,
  setCrewWelcomeCode,
  setPromoCodeActive,
  updatePromoCode,
} from "@/lib/backstage/marketing/promo-codes";
import {
  createSpecial,
  currentSpecial,
  getSpecial,
  listSpecials,
  specialSentence,
  specialWorth,
  switchSpecialOff,
  switchSpecialOn,
  updateSpecial,
} from "@/lib/backstage/marketing/specials";
import { getOrder } from "@/lib/backstage/orders/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import type { PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { receiptFor } from "@/lib/shop/receipt";
import { getStore } from "@/lib/shop/store";

/**
 * Specials: a saving that comes off by itself. What matters most is what
 * does NOT happen: setting one up changes nothing for anybody, and nothing a
 * person typed reaches a customer without the copy rules reading it first.
 */

const shop = systemCaller("The shop", "storefront");
const DAY = 24 * 60 * 60_000;

const paysAtOnce: PaymentProvider = {
  name: "fake",
  isTest: false,
  savesFirst: false,
  begin: async (request) => ({
    kind: "done",
    payment: {
      provider: "fake",
      status: "paid",
      reference: `REF-${request.orderNumber}`,
    },
  }),
};

describe("what a special says", () => {
  const said = (over: Partial<Parameters<typeof specialSentence>[0]> = {}) =>
    specialSentence({
      kind: "percent",
      value: 10,
      minSubtotalCents: 0,
      endsAt: null,
      maxUses: null,
      ...over,
    });

  it("is one sentence built from the terms, never typed", () => {
    expect(said()).toBe("10% off every pack.");
    expect(said({ kind: "amount", value: 500, minSubtotalCents: 4000 })).toBe(
      "$5 off when you spend $40 or more on packs.",
    );
    expect(said({ kind: "delivery", value: 0 })).toBe(
      "Free standard delivery.",
    );
    expect(said({ kind: "delivery", value: 0, minSubtotalCents: 4000 })).toBe(
      "Free standard delivery when you spend $40 or more on packs.",
    );
    expect(said({ minSubtotalCents: 5000 })).toBe(
      "10% off when you spend $50 or more on packs.",
    );
    expect(said({ maxUses: 50 })).toBe(
      "10% off every pack, for the first 50 orders.",
    );
  });

  it("names the last day it works, as a New Zealand day", () => {
    // Stored as the midnight after its last day: Sunday 15 November 2026
    // ends at 11:00 UTC that day, New Zealand being thirteen hours ahead.
    const endsAt = new Date("2026-11-15T11:00:00Z");
    expect(said({ endsAt })).toBe(
      "10% off every pack, until Sunday 15 November.",
    );
    expect(said({ endsAt, maxUses: 20, minSubtotalCents: 4000 })).toBe(
      "10% off when you spend $40 or more on packs, for the first 20 orders, until Sunday 15 November.",
    );
  });
});

describe("specials", () => {
  let handle: DbHandle;
  let staff: Caller;
  let viewer: Caller;

  const buy = async (
    over: Record<string, unknown> = {},
    lines: readonly { sku: string; qty: number }[] = [
      { sku: "QP-SHOT-12", qty: 1 },
    ],
  ) =>
    placeOrder(
      {
        email: `special${newId("cus").slice(4, 12)}@example.co.nz`,
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
        lines,
        ...over,
      },
      { payments: paysAtOnce, store: getStore({ NODE_ENV: "test" }) },
    );
  const bought = async (...args: Parameters<typeof buy>) => {
    const result = await buy(...args);
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.order;
  };
  const refusal = async (work: Promise<unknown>) =>
    work.then(
      () => null,
      (caught: unknown) =>
        caught as {
          code: string;
          message: string;
          fields: Record<string, string>;
        },
    );
  const now = () => execute(currentSpecial, {}, shop);
  const worth = (subtotalCents = 4800, deliveryCents = 700) =>
    execute(specialWorth, { subtotalCents, deliveryCents }, shop);
  const history = async (id: string) =>
    (
      await handle.db
        .select({ summary: auditLog.summary })
        .from(auditLog)
        .where(eq(auditLog.entityId, id))
    ).map((line) => line.summary);
  const off = async (id: string) => {
    await execute(switchSpecialOff, { id }, staff);
  };

  let launch: string;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const make = async (role: "staff" | "viewer"): Promise<Caller> => {
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
    staff = await make("staff");
    viewer = await make("viewer");
  });
  afterAll(async () => {
    await closeDb();
  });

  it("is set up switched off, and changes nothing for anybody", async () => {
    const made = await execute(
      createSpecial,
      {
        code: " launch ",
        name: "  Launch   week ",
        kind: "percent",
        value: 10,
      },
      staff,
    );
    launch = made.id;
    expect(made.code).toBe("LAUNCH");

    const row = await execute(getSpecial, { id: launch }, viewer);
    expect(row).toMatchObject({
      code: "LAUNCH",
      name: "Launch week",
      active: false,
      state: "off",
      label: "10% off",
      sentence: "10% off every pack.",
      uses: 0,
      nameVerdict: "clean",
    });
    expect(await now()).toBeNull();
    expect(await worth()).toEqual({ ok: false });

    // An order placed now is the usual price, with nothing about a special.
    const order = await bought();
    expect(order).toMatchObject({
      promo: null,
      discountCents: 0,
      totalCents: 5500,
    });
    expect(await history(launch)).toEqual([
      'Set up the special LAUNCH ("Launch week"): 10% off every pack. It is switched off',
    ]);
  });

  it("refuses terms that would give the shop away, or give nothing", async () => {
    const no = (over: Record<string, unknown>) =>
      refusal(
        execute(
          createSpecial,
          { code: "NOPE", kind: "percent", value: 10, ...over },
          staff,
        ),
      );
    expect(await no({ value: 91 })).toMatchObject({
      code: "invalid_input",
      fields: { value: "A percentage is a whole number from 1 to 90" },
    });
    expect(await no({ value: 0 })).toMatchObject({ code: "invalid_input" });
    // Money off with no smallest order would take a small order to nothing.
    expect(await no({ kind: "amount", value: 500 })).toMatchObject({
      fields: {
        minSubtotalCents: expect.stringContaining("smallest order"),
      },
    });
    expect(
      await no({ kind: "amount", value: 500, minSubtotalCents: 500 }),
    ).toMatchObject({ code: "invalid_input" });
    // Delivery is already free from $60, so this would give nothing.
    expect(
      await no({ kind: "delivery", minSubtotalCents: 6000 }),
    ).toMatchObject({
      fields: { minSubtotalCents: expect.stringContaining("already free") },
    });
    expect(
      await no({
        startsAt: new Date("2026-12-02T11:00:00Z"),
        endsAt: new Date("2026-12-01T11:00:00Z"),
      }),
    ).toMatchObject({
      fields: { endsAt: expect.stringContaining("last day") },
    });
    expect(await no({ name: "x".repeat(29) })).toMatchObject({
      fields: { name: expect.stringContaining("28") },
    });
    expect(await no({ code: "no" })).toMatchObject({ code: "invalid_input" });
    // The word it goes by is one word across codes and specials alike.
    expect(await no({ code: "launch" })).toMatchObject({
      code: "conflict",
      fields: { code: expect.stringContaining("LAUNCH is already") },
    });
    // A viewer can look, and nothing else.
    expect(
      await refusal(
        execute(
          createSpecial,
          { code: "VIEWER", kind: "percent", value: 5 },
          viewer,
        ),
      ),
    ).toMatchObject({ code: "forbidden" });
    expect(
      (await execute(listSpecials, {}, viewer)).map((s) => s.code),
    ).toEqual(["LAUNCH"]);
  });

  it("is switched on with a yes, and then comes off by itself", async () => {
    // Telling every visitor is an outward step: a bot has to ask first.
    expect(
      await refusal(
        execute(
          switchSpecialOn,
          { id: launch },
          { ...staff, via: "mcp", confirmed: false },
        ),
      ),
    ).toMatchObject({ code: "needs_confirmation" });
    expect(await now()).toBeNull();

    const out = await execute(switchSpecialOn, { id: launch }, staff);
    expect(out).toEqual({ state: "live", sentence: "10% off every pack." });
    expect(await now()).toEqual({
      code: "LAUNCH",
      name: "Launch week",
      sentence: "10% off every pack.",
      endsAt: null,
    });
    expect(await worth()).toEqual({
      ok: true,
      code: "LAUNCH",
      name: "Launch week",
      label: "10% off",
      discountCents: 480,
      deliveryDiscountCents: 0,
    });

    // Nobody typed anything, and nothing about a special was on the form.
    const order = await bought();
    expect(order).toMatchObject({
      subtotalCents: 4800,
      discountCents: 480,
      shippingCents: 700,
      totalCents: 5020,
      promo: {
        code: "LAUNCH",
        deliveryDiscountCents: 0,
        special: "Launch week",
      },
    });
    expect(receiptFor(order)).toMatchObject({
      promoCode: "LAUNCH",
      special: "Launch week",
      discountCents: 480,
    });
    // Recorded, counted and added up exactly like an order with a code.
    const saved = await execute(getOrder, { number: order.number }, viewer);
    expect(saved).toMatchObject({ promoCode: "LAUNCH", discountCents: 480 });
    expect((await execute(getSpecial, { id: launch }, viewer)).uses).toBe(1);

    // Switching on twice is nothing, and says nothing.
    const before = (await history(launch)).length;
    await execute(switchSpecialOn, { id: launch }, staff);
    expect((await history(launch)).length).toBe(before);
    expect(await history(launch)).toContain(
      "Switched the special LAUNCH on: 10% off every pack",
    );
    const told = await handle.db
      .select({ payload: events.payload })
      .from(events)
      .where(eq(events.type, "special.changed"));
    expect(told.map((event) => event.payload)).toEqual([
      { promoId: launch, code: "LAUNCH", on: true },
    ]);
  });

  it("can only be changed while it is off, and never round the side", async () => {
    expect(
      await refusal(execute(updateSpecial, { id: launch, value: 50 }, staff)),
    ).toMatchObject({
      code: "conflict",
      message: expect.stringContaining("while it is switched off"),
    });
    // A special is not a code: a code's operations will not touch it, so it
    // cannot be switched on without its name being read.
    for (const work of [
      execute(updatePromoCode, { id: launch, value: 50 }, staff),
      execute(setPromoCodeActive, { id: launch, active: false }, staff),
      execute(setCrewWelcomeCode, { id: launch, on: true }, staff),
    ]) {
      expect(await refusal(work)).toMatchObject({
        code: "conflict",
        message: expect.stringContaining("is a special, not a code"),
      });
    }
    expect((await execute(getSpecial, { id: launch }, viewer)).value).toBe(10);
    // And it is not in the list of codes.
    expect(
      (await execute(listPromoCodes, {}, viewer)).map((code) => code.code),
    ).not.toContain("LAUNCH");
    expect(await execute(getPromoCode, { id: launch }, viewer)).toMatchObject({
      automatic: true,
    });

    await off(launch);
    expect(await now()).toBeNull();
    // An order has had it, so what kind of special it is stays put.
    expect(
      await refusal(
        execute(updateSpecial, { id: launch, kind: "delivery" }, staff),
      ),
    ).toMatchObject({ code: "conflict" });
    await execute(updateSpecial, { id: launch, value: 15, name: "" }, staff);
    expect(await execute(getSpecial, { id: launch }, viewer)).toMatchObject({
      value: 15,
      name: "",
      sentence: "15% off every pack.",
      active: false,
    });
  });

  it("has its name read by the copy rules before the shop says it", async () => {
    /* copy-audit-ignore-start: wording that breaks the rules on purpose, to prove a special cannot be switched on under it. */
    await execute(updateSpecial, { id: launch, name: "No more cramps" }, staff);
    /* copy-audit-ignore-end */
    expect(await execute(getSpecial, { id: launch }, viewer)).toMatchObject({
      nameVerdict: "banned",
    });
    for (const acknowledgeRestricted of [false, true]) {
      expect(
        await refusal(
          execute(
            switchSpecialOn,
            { id: launch, acknowledgeRestricted },
            staff,
          ),
        ),
      ).toMatchObject({
        code: "conflict",
        message: expect.stringContaining("cannot be switched on"),
      });
    }
    expect(await now()).toBeNull();

    // A phrase the rules want a person to have looked at.
    await execute(updateSpecial, { id: launch, name: "Free delivery" }, staff);
    expect(await execute(getSpecial, { id: launch }, viewer)).toMatchObject({
      nameVerdict: "restricted",
    });
    expect(
      await refusal(execute(switchSpecialOn, { id: launch }, staff)),
    ).toMatchObject({
      code: "invalid_input",
      fields: { acknowledgeRestricted: expect.stringContaining("second look") },
    });
    expect(await now()).toBeNull();
    await execute(
      switchSpecialOn,
      { id: launch, acknowledgeRestricted: true },
      staff,
    );
    expect(await history(launch)).toContain(
      "Switched the special LAUNCH on: 15% off every pack, having read the warnings (FTA-06)",
    );
    await off(launch);

    // A long dash is refused like anywhere else words go out.
    await execute(updateSpecial, { id: launch, name: "Launch — week" }, staff);
    expect(
      await refusal(
        execute(
          switchSpecialOn,
          { id: launch, acknowledgeRestricted: true },
          staff,
        ),
      ),
    ).not.toBeNull();
    await execute(updateSpecial, { id: launch, name: "Launch week" }, staff);
  });

  it("is one at a time", async () => {
    await execute(switchSpecialOn, { id: launch }, staff);
    const other = await execute(
      createSpecial,
      { code: "FREIGHT", kind: "delivery" },
      staff,
    );
    expect(
      await refusal(execute(switchSpecialOn, { id: other.id }, staff)),
    ).toMatchObject({
      code: "conflict",
      message: expect.stringContaining(
        "LAUNCH is switched on over the same days",
      ),
    });

    // Days that do not overlap are fine: one can be lined up behind another.
    await off(launch);
    const soon = new Date(Date.now() + 7 * DAY);
    await execute(updateSpecial, { id: launch, endsAt: soon }, staff);
    await execute(
      updateSpecial,
      {
        id: other.id,
        startsAt: soon,
        endsAt: new Date(soon.getTime() + 7 * DAY),
      },
      staff,
    );
    await execute(switchSpecialOn, { id: launch }, staff);
    expect(
      await execute(switchSpecialOn, { id: other.id }, staff),
    ).toMatchObject({ state: "not-started" });
    // Only the one that has started is said, or taken off.
    expect((await now())?.code).toBe("LAUNCH");
    expect(await worth()).toMatchObject({ code: "LAUNCH", discountCents: 720 });
    await off(other.id);

    // One that has finished cannot be switched on as it stands.
    await handle.db
      .update(promoCodes)
      .set({ startsAt: null, endsAt: new Date(Date.now() - DAY) })
      .where(eq(promoCodes.id, other.id));
    expect(
      await refusal(execute(switchSpecialOn, { id: other.id }, staff)),
    ).toMatchObject({
      code: "conflict",
      message: expect.stringContaining("finished"),
    });
  });

  it("gives the buyer whichever takes more off, their code or the special", async () => {
    // LAUNCH is on at 15%. A club's code is 10% and earns the club a cut.
    const club = await execute(
      addPartner,
      { name: "Sideline Rovers", kind: "club" },
      staff,
    );
    await execute(setPartnerCut, { id: club.id, commissionPercent: 10 }, staff);
    await execute(
      createPromoCode,
      { code: "SIDE10", kind: "percent", value: 10, partnerId: club.id },
      staff,
    );
    await execute(
      createPromoCode,
      { code: "BIG20", kind: "percent", value: 20 },
      staff,
    );
    await execute(
      createPromoCode,
      { code: "EVEN15", kind: "percent", value: 15 },
      staff,
    );

    // The special beats the club's code. The buyer gets the special; the
    // code's use is not counted; and the club still brought the order in.
    const beaten = await bought({ promoCode: "side10" });
    expect(beaten).toMatchObject({
      discountCents: 720,
      promo: { code: "LAUNCH", special: "Launch week" },
      creditCode: "SIDE10",
    });
    expect((await execute(getPromoCode, { code: "SIDE10" }, viewer)).uses).toBe(
      0,
    );
    expect(
      await execute(getOrder, { number: beaten.number }, viewer),
    ).toMatchObject({
      promoCode: "LAUNCH",
      partnerName: "Sideline Rovers",
      // The cut is on what was paid for the goods: 10% of $48 less $7.20.
      cutCents: 408,
    });

    // The activity log says how it went, for whoever asks the club later.
    const said = (
      await handle.db.select({ summary: auditLog.summary }).from(auditLog)
    ).map((line) => line.summary);
    expect(
      said.some((line) =>
        line.includes(
          `order ${beaten.number}: 1 × The Starter, $47.80 with the special LAUNCH (the code SIDE10 was typed, and the special took more off)`,
        ),
      ),
      said.filter((line) => line.includes(beaten.number)).join(" | "),
    ).toBe(true);

    // A code that takes more off wins, and is counted as a code always is.
    const better = await bought({ promoCode: "BIG20" });
    expect(better).toMatchObject({
      discountCents: 960,
      promo: { code: "BIG20" },
    });
    expect(better.promo?.special).toBeUndefined();
    expect(better.creditCode).toBeUndefined();

    // Level pegging goes to the code: they asked for it.
    expect((await bought({ promoCode: "EVEN15" })).promo?.code).toBe("EVEN15");

    // A code that cannot be used is still said so, special or no special.
    const wrong = await buy({ promoCode: "NOSUCH" });
    expect(wrong).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { promoCode: expect.stringContaining("don't know that code") },
    });
  });

  it("tells a buyer the total has changed when the special they were shown has gone", async () => {
    // Shown, and still what comes off: the order goes through.
    expect((await bought({ special: "launch" })).promo?.code).toBe("LAUNCH");

    // Shown a special, typed a better code since: the code is what comes
    // off now, which is not what they were shown, so they look again.
    expect(await buy({ special: "LAUNCH", promoCode: "BIG20" })).toMatchObject({
      ok: false,
      errors: { special: SPECIAL.gone },
    });

    await off(launch);
    const stale = await buy({ special: "LAUNCH" });
    expect(stale).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { special: SPECIAL.gone },
    });
    // The same order with nothing shown is simply the usual price.
    expect(await bought()).toMatchObject({ promo: null, totalCents: 5500 });
    expect(await history(launch)).toContain("Switched the special LAUNCH off");
  });

  it("stops when the last order it allows has had it", async () => {
    const few = await execute(
      createSpecial,
      {
        code: "FIRST2",
        kind: "delivery",
        maxUses: 2,
      },
      staff,
    );
    await execute(switchSpecialOn, { id: few.id }, staff);
    expect((await now())?.sentence).toBe(
      "Free standard delivery, for the first 2 orders.",
    );
    const first = await bought();
    expect(first).toMatchObject({
      discountCents: 0,
      shippingCents: 0,
      totalCents: 4800,
      promo: {
        code: "FIRST2",
        deliveryDiscountCents: 700,
        special: "Free standard delivery",
      },
    });
    // A rural extra still stands, and so does an order already over the
    // free delivery line, which the special has nothing to give.
    expect((await bought({ rural: true })).shippingCents).toBe(450);
    expect(
      (await bought({}, [{ sku: "QP-SHOT-24", qty: 1 }])).promo,
    ).toBeNull();

    // Two have had it. It is no longer said, and no longer comes off.
    expect(await execute(getSpecial, { id: few.id }, viewer)).toMatchObject({
      uses: 2,
      state: "used-up",
    });
    expect(await now()).toBeNull();
    expect(await bought()).toMatchObject({ promo: null, totalCents: 5500 });
    expect(
      await refusal(execute(switchSpecialOn, { id: few.id }, staff)),
    ).toBeNull();
    await off(few.id);
    expect(
      await refusal(execute(switchSpecialOn, { id: few.id }, staff)),
    ).toMatchObject({
      code: "conflict",
      message: expect.stringContaining("all the orders it allows"),
    });
  });
});

describe("the Pickle Crew's welcome code", () => {
  let handle: DbHandle;
  let staff: Caller;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const id = newId("usr");
    await handle.db.insert(users).values({
      id,
      email: "welcome@example.co.nz",
      name: "staff",
      role: "staff",
    });
    staff = {
      actor: { type: "human", userId: id, name: "staff", role: "staff" },
      via: "ui",
      confirmed: true,
    };
  });
  afterAll(async () => {
    await closeDb();
  });

  const handedOut = () => execute(crewWelcomeCode, {}, shop);
  const code = (word: string) => execute(getPromoCode, { code: word }, staff);

  it("is nothing until one is chosen", async () => {
    expect(await handedOut()).toEqual({ ok: false });
    expect(await getStore({ NODE_ENV: "test" }).welcomeCode?.()).toEqual({
      ok: false,
    });
  });

  it("is one code at a time, the shop's own, and works once each", async () => {
    const crew = await execute(
      createPromoCode,
      { code: "CREW10", kind: "percent", value: 10 },
      staff,
    );
    expect(await code("CREW10")).toMatchObject({
      crewWelcome: false,
      oncePerCustomer: false,
    });
    expect(
      await execute(setCrewWelcomeCode, { id: crew.id, on: true }, staff),
    ).toEqual({ code: "CREW10", on: true });
    expect(await code("CREW10")).toMatchObject({
      crewWelcome: true,
      oncePerCustomer: true,
    });
    expect(await handedOut()).toEqual({
      ok: true,
      code: "CREW10",
      label: "10% off",
    });

    // Choosing another takes over from it.
    const hello = await execute(
      createPromoCode,
      { code: "HELLO5", kind: "amount", value: 500 },
      staff,
    );
    await execute(setCrewWelcomeCode, { id: hello.id, on: true }, staff);
    expect((await code("CREW10")).crewWelcome).toBe(false);
    expect(await handedOut()).toMatchObject({
      code: "HELLO5",
      label: "$5 off",
    });
    const lines = (
      await handle.db
        .select({ summary: auditLog.summary })
        .from(auditLog)
        .where(eq(auditLog.entityId, hello.id))
    ).map((line) => line.summary);
    expect(lines).toContain(
      "Made HELLO5 the Pickle Crew's welcome code ($5 off, once for each customer), in place of CREW10",
    );

    // A partner's code credits the partner for every order: not this one.
    const club = await execute(
      addPartner,
      { name: "Harbour Hockey", kind: "club" },
      staff,
    );
    const theirs = await execute(
      createPromoCode,
      { code: "HARBOUR", kind: "percent", value: 10, partnerId: club.id },
      staff,
    );
    await expect(
      execute(setCrewWelcomeCode, { id: theirs.id, on: true }, staff),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("belongs to a partner"),
    });
    // And the welcome code cannot be handed to a partner afterwards.
    await expect(
      execute(updatePromoCode, { id: hello.id, partnerId: club.id }, staff),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await handedOut()).toMatchObject({ code: "HELLO5" });
  });

  it("is only handed out while it could be used", async () => {
    const hello = await code("HELLO5");
    await execute(setPromoCodeActive, { id: hello.id, active: false }, staff);
    expect(await handedOut()).toEqual({ ok: false });
    await execute(setPromoCodeActive, { id: hello.id, active: true }, staff);
    expect(await handedOut()).toMatchObject({ ok: true, code: "HELLO5" });

    expect(
      await execute(setCrewWelcomeCode, { id: hello.id, on: false }, staff),
    ).toEqual({ code: "HELLO5", on: false });
    expect(await handedOut()).toEqual({ ok: false });
  });
});
