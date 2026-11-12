import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  auditLog,
  events,
  mailMessages,
  mailSuppressions,
  orders,
  settings,
  users,
} from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  emailCustomer,
  listOrderEmails,
  shipDatesSaid,
} from "@/lib/backstage/orders/emails";
import {
  cancelOrder,
  markPacked,
  markShipped,
} from "@/lib/backstage/orders/ops";
import {
  shipDateNeeds,
  shipDateOwed,
  shipDateStanding,
} from "@/lib/backstage/orders/ship-date";
import { changeShop, SHOP_OFFER_KEY } from "@/lib/backstage/shop/ops";
import { needsYou } from "@/lib/backstage/today/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { offerNow } from "@/lib/shop/offer-now";
import type { PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { getStore } from "@/lib/shop/store";

/**
 * The site tells a pre-order's customer "we'll email you the ship date".
 * These hold that promise: who is still owed it, that each is told once for
 * each date and again when it moves, and what the email says.
 */

const desk = systemCaller("Order emails", "automation");
const NOW = new Date("2026-11-12T01:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe("telling pre-order customers the ship date", () => {
  let handle: DbHandle;
  let owner: Caller;
  let counter = 0;

  const provider = (status: "paid" | "test"): PaymentProvider => ({
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

  /** A paid order, placed the way the checkout places one. */
  const buy = async (
    who: string,
    pay: "paid" | "test" = "paid",
  ): Promise<string> => {
    counter += 1;
    const result = await placeOrder(
      {
        email: `${who}@example.co.nz`,
        phone: "",
        firstName: who,
        lastName: "Tester",
        line1: `${String(counter)} Sideline Road`,
        line2: "",
        suburb: "",
        city: "Levin",
        region: "Manawatū-Whanganui",
        postcode: "5510",
        rural: false,
        notes: "",
        joinCrew: false,
        lines: [{ sku: "QP-SHOT-06", qty: 1 }],
      },
      {
        offer: await offerNow(),
        payments: provider(pay),
        store: getStore({ NODE_ENV: "test" }),
        now: () => later(counter),
      },
    );
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.order.number;
  };

  const tell = (number: string, when = later(60)) =>
    execute(emailCustomer, { number, about: "ship_date" }, desk, {
      db: handle.db,
      now: when,
    });
  const receipt = (number: string) =>
    execute(emailCustomer, { number, about: "receipt" }, desk, {
      db: handle.db,
      now: later(30),
    });
  const message = async (id: string) => {
    const [row] = await handle.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, id));
    if (row === undefined) throw new Error(`no message ${id}`);
    return row;
  };
  const setDate = (date: string | null, more: Record<string, unknown> = {}) =>
    execute(changeShop, { preorderShipsFrom: date, ...more }, owner, {
      db: handle.db,
      now: NOW,
    });
  const owedNow = async (when = later(60)) =>
    (await shipDateOwed(handle.db, when)).owed.map((one) => one.number);

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
    await handle.db.delete(mailMessages);
    await handle.db.delete(mailSuppressions);
    await handle.db.delete(events);
    await handle.db.delete(auditLog);
    await handle.db.delete(orders);
    await handle.db.delete(settings).where(eq(settings.key, SHOP_OFFER_KEY));
  });

  it("owes nobody anything until a date is set, and says how many are waiting", async () => {
    await buy("mere");
    await buy("tama");
    const standing = await execute(shipDateStanding, {}, owner, {
      db: handle.db,
      now: later(60),
    });
    expect(standing).toMatchObject({
      date: null,
      cannot: "No ship date is set.",
      waiting: 2,
      owed: [],
    });
    expect(await shipDateNeeds(handle.db, later(60))).toEqual([]);
    // And there is no email to write yet.
    const none = await tell(await buy("ana"));
    expect(none).toMatchObject({ written: false });
    expect(await handle.db.select().from(mailMessages)).toEqual([]);
  });

  it("owes it to every paid pre-order that has not been sent, and to nobody else", async () => {
    const mere = await buy("mere");
    const tama = await buy("tama");
    const packed = await buy("packed");
    const shipped = await buy("shipped");
    const cancelled = await buy("cancelled");
    await buy("practice", "test");
    await execute(markPacked, { number: packed }, owner, { db: handle.db });
    await execute(markPacked, { number: shipped }, owner, { db: handle.db });
    await execute(
      markShipped,
      { number: shipped, carrier: "NZ Post", trackingNumber: "AB123456789NZ" },
      owner,
      { db: handle.db },
    );
    await execute(
      cancelOrder,
      { number: cancelled, reason: "Changed their mind" },
      owner,
      { db: handle.db },
    );
    await setDate("2026-12-01");

    const standing = await shipDateOwed(handle.db, later(60));
    expect(standing.dateSaid).toBe("1 December 2026");
    expect(standing.cannot).toBeNull();
    // Paid and waiting: three. Shipped, cancelled and the practice order
    // are not waiting on anything.
    expect(standing.waiting).toBe(3);
    expect(standing.owed.map((one) => one.number)).toEqual([
      mere,
      tama,
      packed,
    ]);
    expect(standing.owed[0]).toMatchObject({
      name: "mere Tester",
      blocked: false,
    });
    for (const number of [shipped, cancelled]) {
      expect(await tell(number)).toMatchObject({ written: false });
    }

    // Today says so, first.
    const today = await execute(needsYou, {}, owner, {
      db: handle.db,
      now: later(60),
    });
    expect(today[0]).toMatchObject({
      key: "ship-date-untold",
      urgent: true,
      title: "3 people with a pre-order have not been told when it ships",
    });
    expect(today[0]?.detail).toContain("1 December 2026");
  });

  it("writes one email for a date, however often it is asked, and then owes nothing", async () => {
    const mere = await buy("mere");
    await setDate("2026-12-01", { contactEmail: "hello@example.co.nz" });

    const first = await tell(mere);
    if (!first.written) throw new Error(first.why);
    expect(first.already).toBe(false);
    const email = await message(first.messageId);
    expect(email.subject).toBe(
      `Your Quick Pickle order ${mere} has a ship date`,
    );
    expect(email.toAddresses).toEqual(["mere@example.co.nz"]);
    expect(email.textBody).toContain(
      "Your pre-order has a ship date. It ships from 1 December 2026.",
    );
    expect(email.textBody).toContain(
      "We'll email you again when it's on the courier.",
    );
    expect(email.textBody).toContain("hello@example.co.nz");
    expect(email.status).toBe("queued");
    // Nothing promotional rides along, and no promise about money.
    expect(email.textBody.toLowerCase()).not.toMatch(
      /refund|code|special|% off/,
    );

    const again = await tell(mere);
    expect(again).toMatchObject({
      written: true,
      already: true,
      messageId: first.messageId,
    });
    expect(await handle.db.select().from(mailMessages)).toHaveLength(1);
    expect(await owedNow()).toEqual([]);
    expect(await shipDateNeeds(handle.db, later(60))).toEqual([]);

    // It is listed with the order's other emails, by what it is.
    const listed = await execute(listOrderEmails, { number: mere }, owner, {
      db: handle.db,
    });
    expect(listed.map((one) => one.label)).toEqual(["Ship date"]);
  });

  it("tells them again when the date moves, and says that it moved", async () => {
    const mere = await buy("mere");
    await setDate("2026-12-01");
    await tell(mere);
    expect(await owedNow()).toEqual([]);

    await setDate("2026-12-08");
    expect(await owedNow()).toEqual([mere]);
    const moved = await tell(mere);
    if (!moved.written) throw new Error(moved.why);
    const email = await message(moved.messageId);
    expect(email.subject).toBe(
      `Your Quick Pickle order ${mere} has a new ship date`,
    );
    expect(email.textBody).toContain(
      "The ship date for your pre-order has changed. It now ships from 8 December 2026.",
    );
    expect(await owedNow()).toEqual([]);
    expect(
      (await shipDatesSaid(handle.db, (await orderRow(mere)).id)).map((one) => [
        one.kind,
        one.date,
        one.told,
      ]),
    ).toEqual([
      ["ship_date", "2026-12-01", true],
      ["ship_date", "2026-12-08", true],
    ]);
  });

  it("owes nothing to somebody whose receipt already said the date", async () => {
    await setDate("2026-12-01");
    const late = await buy("late");
    const written = await receipt(late);
    if (!written.written) throw new Error(written.why);
    expect((await message(written.messageId)).textBody).toContain(
      "It ships from 1 December 2026.",
    );
    expect(await owedNow()).toEqual([]);
    expect(await tell(late)).toMatchObject({ written: false });
    expect(await handle.db.select().from(mailMessages)).toHaveLength(1);

    // The date moves: the receipt told them the old one, so now they are
    // owed the new one, and it says it has changed.
    await setDate("2026-12-08");
    expect(await owedNow()).toEqual([late]);
    const moved = await tell(late);
    if (!moved.written) throw new Error(moved.why);
    expect((await message(moved.messageId)).textBody).toContain(
      "has changed. It now ships from 8 December 2026.",
    );
  });

  it("does not count an email that was written down and never sent", async () => {
    const mere = await buy("mere");
    await setDate("2026-12-01");
    const first = await tell(mere);
    if (!first.written) throw new Error(first.why);
    // What the sender does when email is not connected: written down, not
    // sent, and that is the end of that message.
    await handle.db
      .update(mailMessages)
      .set({ status: "not_sent", error: "Email is not connected." })
      .where(eq(mailMessages.id, first.messageId));

    expect(await owedNow()).toEqual([mere]);
    // Once email is connected they can still be told: a new email, not a
    // dead end on the first one.
    const second = await tell(mere);
    if (!second.written) throw new Error(second.why);
    expect(second.already).toBe(false);
    expect(second.messageId).not.toBe(first.messageId);
    expect((await message(second.messageId)).textBody).toContain(
      "Your pre-order has a ship date.",
    );
    expect(await owedNow()).toEqual([]);
  });

  it("names the people who cannot be emailed, so they are told another way", async () => {
    const mere = await buy("mere");
    const tama = await buy("tama");
    await handle.db.insert(mailSuppressions).values({
      email: "tama@example.co.nz",
      reason: "bounce",
      detail: "550 no such user",
    });
    await setDate("2026-12-01");
    const standing = await shipDateOwed(handle.db, later(60));
    expect(
      standing.owed.map((one) => [one.number, one.blocked] as const),
    ).toEqual([
      [mere, false],
      [tama, true],
    ]);
  });

  it("tells nobody a date that has gone by", async () => {
    const mere = await buy("mere");
    await setDate("2026-12-01");
    const after = new Date("2026-12-02T01:00:00Z");
    const standing = await shipDateOwed(handle.db, after);
    expect(standing.cannot).toBe(
      "The ship date that is set has gone by. Set the new one first.",
    );
    expect(standing.owed).toEqual([]);
    expect(await shipDateNeeds(handle.db, after)).toEqual([]);
    expect(await tell(mere, after)).toMatchObject({ written: false });
    // On the day itself it is still news.
    const onTheDay = new Date("2026-11-30T12:00:00Z");
    expect((await shipDateOwed(handle.db, onTheDay)).owed).toHaveLength(1);
  });

  const orderRow = async (number: string) => {
    const [row] = await handle.db
      .select()
      .from(orders)
      .where(eq(orders.number, number));
    if (row === undefined) throw new Error(`no order ${number}`);
    return row;
  };
});
