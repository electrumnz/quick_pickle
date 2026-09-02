/**
 * The admin's pure parts, pinned.
 *
 * The screens themselves are proved by the evidence screenshots in
 * `components/admin/evidence`. What is worth a unit test is the handful of
 * functions that decide what she *reads*: where the sidebar says she is, how a
 * date is spoken in New Zealand, and whether the sentence at the top of Today
 * describes the day it was given.
 */

import { describe, expect, it } from "vitest";

import {
  ago,
  dayAndYear,
  dayLong,
  deviceName,
  money,
  nzDateKey,
  plural,
  settingLabel,
  until,
} from "@/components/admin/data/format";
import { summariseDay, type TodayData } from "@/components/admin/data/today";
import {
  DESTINATIONS,
  destinationFor,
} from "@/components/admin/shell/destinations";

describe("the nine destinations", () => {
  it("is exactly nine, in the order the admin map names them", () => {
    expect(DESTINATIONS.map((destination) => destination.label)).toEqual([
      "Today",
      "Orders & Delivery",
      "Stock & Batches",
      "Social",
      "Customers & Marketing",
      "Money",
      "Brand & Plan",
      "The Team",
      "Settings",
    ]);
  });

  it("gives every destination a sentence a non-technical reader can use", () => {
    for (const destination of DESTINATIONS) {
      expect(destination.blurb.length).toBeGreaterThan(40);
      expect(destination.blurb.endsWith(".")).toBe(true);
    }
  });

  it("marks the section a path belongs to, including its sub-pages", () => {
    expect(destinationFor("/admin")?.id).toBe("today");
    expect(destinationFor("/admin/orders")?.id).toBe("orders");
    expect(destinationFor("/admin/orders/HS-01092")?.id).toBe("orders");
    expect(destinationFor("/admin/brand")?.id).toBe("brand");
    expect(destinationFor("/admin/team")?.id).toBe("team");
  });

  it("does not treat the old chat path as a destination", () => {
    expect(destinationFor("/admin/chat")).toBeNull();
  });

  it("marks nothing current on a page that is not one of the nine", () => {
    // Today is /admin exactly. A 404 under /admin must not light it up.
    expect(destinationFor("/admin/no-such-page")).toBeNull();
    expect(destinationFor("/admin/search")).toBeNull();
    // Activity is a reader, not a sidebar destination.
    expect(destinationFor("/admin/activity")).toBeNull();
  });
});

describe("words for numbers", () => {
  it("formats integer cents as New Zealand money", () => {
    expect(money(291700)).toBe("$2,917.00");
    expect(money(0)).toBe("$0.00");
    expect(money(150)).toBe("$1.50");
  });

  it("pluralises with the count in front", () => {
    expect(plural(1, "order")).toBe("1 order");
    expect(plural(3, "order")).toBe("3 orders");
  });

  it("turns a setting key into words", () => {
    expect(settingLabel("company.trading_name")).toBe("Trading name");
  });
});

describe("a device, as a person would name it", () => {
  it("reads a browser user-agent as a short device name", () => {
    expect(
      deviceName(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe("Safari on a Mac");
    expect(deviceName("curl/8.5.0")).toBe("A command line tool");
    expect(deviceName(null)).toBe("Unrecorded device");
  });
});

describe("dates, in New Zealand", () => {
  // 2026-08-29T20:00:00Z is already Sunday 30 August in Auckland.
  const utcEvening = "2026-08-29T20:00:00.000Z";

  it("uses her calendar day, not the server's", () => {
    expect(nzDateKey(utcEvening)).toBe("2026-08-30");
    expect(dayLong(utcEvening)).toBe("Sunday 30 August");
  });

  it("keeps the year on a date far enough away to matter", () => {
    expect(dayAndYear("2028-02-09T00:00:00.000Z")).toBe("9 Feb 2028");
  });

  it("speaks about the past and the future in the same voice", () => {
    const now = new Date("2026-08-30T09:00:00+12:00");
    expect(ago("2026-08-30T08:00:00+12:00", now)).toBe("an hour ago");
    expect(ago("2026-08-28T09:00:00+12:00", now)).toBe("2 days ago");
    expect(until("2026-08-31T09:00:00+12:00", now)).toBe("tomorrow");
    expect(until("2026-09-02T09:00:00+12:00", now)).toBe("in 3 days");
  });
});

function todayWith(counts: {
  toPack: number;
  failures: number;
  repliesOwed: number;
  awaitingPayment?: number;
}): TodayData {
  const empty = {
    orders: 0,
    takingsCents: 0,
    gstCents: 0,
    averageOrderCents: 0,
    units: 0,
  };
  return {
    now: "2026-08-30T09:00:00+12:00",
    actions: [],
    failures: counts.failures,
    repliesOwed: counts.repliesOwed,
    toPack: Array.from({ length: counts.toPack }, (_, index) => ({
      id: String(index),
      number: `HS-0${String(index)}`,
      customer: "A customer",
      destination: "Auckland",
      items: "1 × No 01 HOUSE",
      totalCents: 1800,
      placedAt: "2026-08-29T09:00:00+12:00",
      paid: true,
      shippingMethod: null,
    })),
    awaitingPayment: counts.awaitingPayment ?? 0,
    stock: [],
    lowIngredients: [],
    batches: [],
    week: empty,
    previousWeek: empty,
    days: [],
    activity: [],
    upcoming: [],
  };
}

describe("the sentence at the top of Today", () => {
  it("says nothing is waiting when the day is quiet", () => {
    expect(
      summariseDay(todayWith({ toPack: 0, failures: 0, repliesOwed: 0 })),
    ).toBe(
      "Nothing is waiting on you. Every order is packed and nothing has failed.",
    );
  });

  it("names orders to pack when there are some", () => {
    expect(
      summariseDay(todayWith({ toPack: 2, failures: 0, repliesOwed: 0 })),
    ).toContain("2 orders to pack");
  });

  it("names failures and replies when they exist", () => {
    const sentence = summariseDay(
      todayWith({ toPack: 0, failures: 1, repliesOwed: 2 }),
    );
    expect(sentence).toContain("1 thing is not working");
    expect(sentence).toContain("2 reviews owed a reply");
  });
});
