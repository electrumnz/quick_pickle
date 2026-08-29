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
  it("is exactly nine, in the order the brief names them", () => {
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
  });

  it("marks nothing current on a page that is not one of the nine", () => {
    // Today is /admin exactly. A 404 under /admin must not light it up.
    expect(destinationFor("/admin/no-such-page")).toBeNull();
    expect(destinationFor("/admin/search")).toBeNull();
  });
});

describe("words for numbers", () => {
  it("formats integer cents as New Zealand money", () => {
    expect(money(291700)).toBe("$2,917.00");
    expect(money(0)).toBe("$0.00");
    expect(money(150)).toBe("$1.50");
  });

  it("pluralises the way a person speaks", () => {
    expect(plural(1, "order")).toBe("1 order");
    expect(plural(6, "order")).toBe("6 orders");
    expect(plural(2, "thing")).toBe("2 things");
  });

  it("turns a settings key into a phrase", () => {
    expect(settingLabel("tax.gst_rate_bp")).toBe("GST rate in basis points");
    expect(settingLabel("shipping.free_threshold_cents")).toBe(
      "Free threshold in cents",
    );
  });

  it("names the device behind a user agent", () => {
    expect(
      deviceName(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on an iPhone");
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
  decisions: number;
  toPack: number;
  failures: number;
  repliesOwed: number;
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
    decisions: counts.decisions,
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
    awaitingPayment: 0,
    stock: [],
    lowIngredients: [],
    batches: [],
    week: empty,
    previousWeek: empty,
    days: [],
    activity: [],
    spend: {
      todayCents: 0,
      monthCents: 0,
      dailyCapCents: 0,
      killSwitchOn: false,
      runsToday: 0,
      runningNow: 0,
      waitingOnHer: 0,
    },
    upcoming: [],
    team: [],
  };
}

describe("the sentence at the top of Today", () => {
  it("describes a busy morning as a list, in her order of concern", () => {
    expect(
      summariseDay(
        todayWith({ decisions: 4, toPack: 6, failures: 4, repliesOwed: 1 }),
      ),
    ).toBe(
      "4 decisions are waiting on you, 6 orders to pack, 4 things are not working, and 1 review owed a reply.",
    );
  });

  it("agrees with itself about number", () => {
    expect(
      summariseDay(
        todayWith({ decisions: 1, toPack: 0, failures: 1, repliesOwed: 0 }),
      ),
    ).toBe("1 decision is waiting on you, and 1 thing is not working.");
  });

  it("says a quiet day is quiet, rather than showing nothing", () => {
    expect(
      summariseDay(
        todayWith({ decisions: 0, toPack: 0, failures: 0, repliesOwed: 0 }),
      ),
    ).toBe(
      "Nothing is waiting on you. The team has everything it needs, every order is packed and nothing has failed.",
    );
  });
});
