import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, orders, refunds, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  BOOKS_MOST_DAYS,
  booksFile,
  booksRanges,
  booksSummary,
} from "@/lib/backstage/numbers/books";
import { csvLine } from "@/lib/backstage/orders/csv";
import { cancelOrder, recordRefund } from "@/lib/backstage/orders/ops";
import { createPromoCode } from "@/lib/backstage/marketing/promo-codes";
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
import { nzToInstant } from "@/lib/time";

/**
 * Sales for the books. The figures are for a ledger, so what matters is
 * that they add up to the money that moved, on the day it moved.
 */

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

describe("the ready-made stretches", () => {
  it("are this month, last month and since 1 April", () => {
    expect(booksRanges("2026-11-12")).toEqual([
      {
        key: "this-month",
        label: "This month",
        from: "2026-11-01",
        to: "2026-11-12",
      },
      {
        key: "last-month",
        label: "Last month",
        from: "2026-10-01",
        to: "2026-10-31",
      },
      {
        key: "since-april",
        label: "Since 1 April",
        from: "2026-04-01",
        to: "2026-11-12",
      },
    ]);
  });

  it("cross a new year, and a February, the right way", () => {
    const january = booksRanges("2027-01-05");
    expect(january[1]).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
    expect(january[2]).toMatchObject({ from: "2026-04-01" });
    const march = booksRanges("2028-03-31");
    expect(march[1]).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
    expect(march[2]).toMatchObject({ from: "2027-04-01" });
    expect(booksRanges("2028-04-01")[2]).toMatchObject({ from: "2028-04-01" });
  });
});

describe("sales for the books", () => {
  let handle: DbHandle;
  let viewer: Caller;
  let made = 0;

  /** An order paid for at a moment of our choosing, New Zealand time. */
  async function sale(
    paid: Date,
    over: Record<string, unknown> = {},
    status: "test" | "paid" = "paid",
  ): Promise<string> {
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
        lines: [{ sku: "QP-SHOT-12", qty: 1 }],
        ...over,
      },
      { payments: provider(status), store: getStore() },
    );
    if (!result.ok) throw new Error(`Not placed: ${result.reason}`);
    await handle.db
      .update(orders)
      .set({ paidAt: status === "paid" ? paid : null, placedAt: paid })
      .where(eq(orders.number, result.order.number));
    return result.order.number;
  }

  /** A refund, given on a day of our choosing. */
  async function refund(number: string, cents: number, on: Date) {
    await execute(
      recordRefund,
      { number, amountCents: cents, reason: "Arrived damaged" },
      staff,
    );
    const [order] = await handle.db
      .select()
      .from(orders)
      .where(eq(orders.number, number));
    await handle.db
      .update(refunds)
      .set({ createdAt: on })
      .where(eq(refunds.orderId, order?.id ?? ""));
  }

  const november = { from: "2026-11-01", to: "2026-11-30" };
  let plain: string;
  let rural: string;
  let coded: string;
  let refundedLater: string;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const id = newId("usr");
    await handle.db.insert(users).values({
      id,
      email: "viewer@example.co.nz",
      name: "viewer",
      role: "viewer",
    });
    viewer = {
      actor: { type: "human", userId: id, name: "viewer", role: "viewer" },
      via: "ui",
      confirmed: true,
    };
    await execute(
      createPromoCode,
      { code: "CREW10", kind: "percent", value: 10 },
      staff,
    );

    // Tuesday 10 November: two sales. $48 + $7 delivery, and the same to a
    // rural address, which is $4.50 more.
    plain = await sale(nzToInstant(2026, 11, 10, 9, 0));
    rural = await sale(nzToInstant(2026, 11, 10, 16, 30), { rural: true });
    // Wednesday 11: one sale with a code, 10% off the $48.
    coded = await sale(nzToInstant(2026, 11, 11, 12, 0), {
      promoCode: "CREW10",
    });
    // Late on the 30th in New Zealand, which is still the 30th in UTC but
    // only just: the day it counts on is New Zealand's.
    refundedLater = await sale(nzToInstant(2026, 11, 30, 23, 30));
    // Just after midnight on 1 December: not November's.
    await sale(nzToInstant(2026, 12, 1, 0, 10));

    // Money back. $10 of the first order on the 12th, and all of the last
    // November order in December, when it was cancelled.
    await refund(plain, 1000, nzToInstant(2026, 11, 12, 10, 0));
    await execute(
      cancelOrder,
      { number: refundedLater, reason: "Changed their mind" },
      staff,
    );
    await refund(refundedLater, 5500, nzToInstant(2026, 12, 2, 10, 0));

    // And what must never show: a test order, and one nobody paid for.
    await sale(nzToInstant(2026, 11, 10, 10, 0), {}, "test");
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  it("puts each sale on the day it was paid for, and each refund on the day it was given", async () => {
    const books = await execute(booksSummary, november, staff);
    expect(books.days).toEqual([
      {
        day: "2026-11-10",
        orders: 2,
        goodsCents: 9600,
        discountCents: 0,
        deliveryCents: 700 + 1150,
        chargedCents: 5500 + 5950,
        refundedCents: 0,
        keptCents: 5500 + 5950,
      },
      {
        day: "2026-11-11",
        orders: 1,
        goodsCents: 4800,
        discountCents: 480,
        deliveryCents: 700,
        chargedCents: 5020,
        refundedCents: 0,
        keptCents: 5020,
      },
      // A day with a refund and no sale ends below nothing.
      {
        day: "2026-11-12",
        orders: 0,
        goodsCents: 0,
        discountCents: 0,
        deliveryCents: 0,
        chargedCents: 0,
        refundedCents: 1000,
        keptCents: -1000,
      },
      // Cancelled and refunded in December. It was still a sale in November.
      {
        day: "2026-11-30",
        orders: 1,
        goodsCents: 4800,
        discountCents: 0,
        deliveryCents: 700,
        chargedCents: 5500,
        refundedCents: 0,
        keptCents: 5500,
      },
    ]);
    expect(books.total).toEqual({
      orders: 4,
      goodsCents: 19200,
      discountCents: 480,
      deliveryCents: 3250,
      chargedCents: 21970,
      refundedCents: 1000,
      keptCents: 20970,
    });
    expect(books.waiting).toBe(0);
  });

  it("adds up: goods, less discounts, plus delivery is what was charged", async () => {
    for (const span of [
      november,
      { from: "2026-12-01", to: "2026-12-31" },
      { from: "2026-04-01", to: "2027-03-31" },
    ]) {
      const { days, total } = await execute(booksSummary, span, staff);
      for (const sums of [...days, total]) {
        expect(sums.goodsCents - sums.discountCents + sums.deliveryCents).toBe(
          sums.chargedCents,
        );
        expect(sums.chargedCents - sums.refundedCents).toBe(sums.keptCents);
      }
    }
  });

  it("puts the December sale and the December refund in December", async () => {
    const books = await execute(
      booksSummary,
      { from: "2026-12-01", to: "2026-12-31" },
      staff,
    );
    expect(
      books.days.map((day) => [day.day, day.orders, day.refundedCents]),
    ).toEqual([
      ["2026-12-01", 1, 0],
      ["2026-12-02", 0, 5500],
    ]);
  });

  it("agrees with the money that actually moved, over the whole year", async () => {
    const books = await execute(
      booksSummary,
      { from: "2026-04-01", to: "2027-03-31" },
      staff,
    );
    const real = await handle.db
      .select()
      .from(orders)
      .where(eq(orders.isTest, false));
    const charged = real.reduce((sum, order) => sum + order.totalCents, 0);
    const back = real.reduce((sum, order) => sum + order.refundedCents, 0);
    expect(books.total.chargedCents).toBe(charged);
    expect(books.total.refundedCents).toBe(back);
    expect(books.total.orders).toBe(real.length);
    // A day with nothing on it is not in the list.
    expect(
      books.days.every((day) => day.orders > 0 || day.refundedCents > 0),
    ).toBe(true);
  });

  it("leaves a payment that is waiting for a person out, and says how many", async () => {
    const odd = await sale(nzToInstant(2026, 10, 5, 12, 0));
    await handle.db
      .update(orders)
      .set({ paymentStatus: "review" })
      .where(eq(orders.number, odd));
    const books = await execute(
      booksSummary,
      { from: "2026-10-01", to: "2026-10-31" },
      staff,
    );
    expect(books.days).toEqual([]);
    expect(books.total.chargedCents).toBe(0);
    expect(books.waiting).toBe(1);
    await handle.db.delete(orders).where(eq(orders.number, odd));
  });

  it("refuses a stretch that makes no sense", async () => {
    for (const span of [
      { from: "2026-11-30", to: "2026-11-01" },
      { from: "November", to: "2026-11-30" },
      { from: "2026-11-01", to: "2026-13-01" },
      { from: "2024-01-01", to: "2026-11-30" },
    ]) {
      await expect(execute(booksSummary, span, staff)).rejects.toThrow();
    }
    // Right at the limit is fine.
    expect(BOOKS_MOST_DAYS).toBe(400);
    await expect(
      execute(booksSummary, { from: "2026-01-01", to: "2027-02-04" }, staff),
    ).resolves.toBeDefined();
  });

  describe("the files", () => {
    const table = (file: string) =>
      file
        .replace(/^﻿/, "")
        .trimEnd()
        .split("\r\n")
        .map((line) => csvLine(line));

    it("by day is the table, with a total, and nobody's name", async () => {
      const before = (await handle.db.select().from(auditLog)).length;
      const made = await execute(
        booksFile,
        { ...november, kind: "days" },
        staff,
      );
      expect(made.name).toBe(
        "quick-pickle-sales-by-day-2026-11-01-to-2026-11-30.csv",
      );
      expect(table(made.file)).toEqual([
        [
          "Day",
          "Orders",
          "Goods",
          "Discounts",
          "Delivery",
          "Charged",
          "Refunded",
          "Kept",
        ],
        [
          "2026-11-10",
          "2",
          "96.00",
          "0.00",
          "18.50",
          "114.50",
          "0.00",
          "114.50",
        ],
        ["2026-11-11", "1", "48.00", "-4.80", "7.00", "50.20", "0.00", "50.20"],
        ["2026-11-12", "0", "0.00", "0.00", "0.00", "0.00", "-10.00", "-10.00"],
        ["2026-11-30", "1", "48.00", "0.00", "7.00", "55.00", "0.00", "55.00"],
        [
          "Total",
          "4",
          "192.00",
          "-4.80",
          "32.50",
          "219.70",
          "-10.00",
          "209.70",
        ],
      ]);
      expect(made.file).not.toContain("Aroha");
      expect(made.file).not.toContain("@");
      // Sums only: nothing to write down.
      expect((await handle.db.select().from(auditLog)).length).toBe(before);
    });

    it("by order is a row an order, and is written down", async () => {
      const made = await execute(
        booksFile,
        { ...november, kind: "orders" },
        staff,
      );
      expect(made.name).toBe(
        "quick-pickle-sales-by-order-2026-11-01-to-2026-11-30.csv",
      );
      const rows = table(made.file);
      expect(rows[0]).toEqual([
        "Day paid",
        "Order",
        "Customer",
        "Email",
        "Goods",
        "Discount",
        "Code",
        "Delivery",
        "Charged",
        "Refunded to date",
        "Paid by",
        "Payment reference",
        "Payment",
      ]);
      expect(rows.slice(1).map((row) => row[1])).toEqual([
        plain,
        rural,
        coded,
        refundedLater,
      ]);
      expect(rows[1]).toEqual([
        "2026-11-10",
        plain,
        "Aroha Ngata",
        expect.stringMatching(/^books\d+@example\.co\.nz$/),
        "48.00",
        "0.00",
        "",
        "7.00",
        "55.00",
        "-10.00",
        "fake",
        `REF-${plain}`,
        "Part refunded",
      ]);
      expect(rows[3]?.slice(4, 9)).toEqual([
        "48.00",
        "-4.80",
        "CREW10",
        "7.00",
        "50.20",
      ]);
      // Refunded in December: the row says so, though the day is November.
      expect(rows[4]?.[9]).toBe("-55.00");
      expect(rows[4]?.[12]).toBe("Refunded");

      const log = await handle.db.select().from(auditLog);
      expect(log.map((entry) => entry.summary)).toContain(
        "Made a file of 4 orders for the books, 2026-11-01 to 2026-11-30",
      );
    });

    it("is not made for somebody who can only look, who can still read the totals", async () => {
      await expect(
        execute(booksFile, { ...november, kind: "orders" }, viewer),
      ).rejects.toThrow("Your account can look but not change things.");
      expect((await execute(booksSummary, november, viewer)).total.orders).toBe(
        4,
      );
    });

    it("refuses dates that make no sense", async () => {
      await expect(
        execute(
          booksFile,
          { from: "2026-11-30", to: "2026-11-01", kind: "days" },
          staff,
        ),
      ).rejects.toThrow();
    });
  });
});
