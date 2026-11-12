import { describe, expect, it } from "vitest";

import {
  addDays,
  formatNzDate,
  formatNzDateTime,
  formatNzRelative,
  nzDateKey,
  nzToInstant,
  startOfNzDay,
} from "@/lib/time";

describe("New Zealand time", () => {
  it("knows summer is thirteen hours ahead and winter twelve", () => {
    // 12 Nov 2026, 9:00 am NZDT is 8:00 pm UTC the day before.
    expect(nzToInstant(2026, 11, 12, 9).toISOString()).toBe(
      "2026-11-11T20:00:00.000Z",
    );
    // 12 Jun 2026, 9:00 am NZST is 9:00 pm UTC the day before.
    expect(nzToInstant(2026, 6, 12, 9).toISOString()).toBe(
      "2026-06-11T21:00:00.000Z",
    );
  });

  it("puts an instant on the right New Zealand date", () => {
    // 11:30 pm UTC on the 11th is already the 12th in Auckland.
    expect(nzDateKey(new Date("2026-11-11T23:30:00Z"))).toBe("2026-11-12");
    expect(nzDateKey(new Date("2026-11-11T10:30:00Z"))).toBe("2026-11-11");
  });

  it("starts the day at local midnight on both daylight-saving mornings", () => {
    // Clocks go forward on Sunday 27 September 2026 (2 am becomes 3 am).
    expect(startOfNzDay("2026-09-27").toISOString()).toBe(
      "2026-09-26T12:00:00.000Z",
    );
    expect(startOfNzDay("2026-09-28").toISOString()).toBe(
      "2026-09-27T11:00:00.000Z",
    );
    // And back on Sunday 5 April 2026 (3 am becomes 2 am).
    expect(startOfNzDay("2026-04-05").toISOString()).toBe(
      "2026-04-04T11:00:00.000Z",
    );
    expect(startOfNzDay("2026-04-06").toISOString()).toBe(
      "2026-04-05T12:00:00.000Z",
    );
  });

  it("does not throw for the hour that does not exist", () => {
    // 2:30 am on 27 September 2026 is skipped. Any sane answer will do, as
    // long as it is an instant on that morning.
    const instant = nzToInstant(2026, 9, 27, 2, 30);
    expect(nzDateKey(instant)).toBe("2026-09-27");
  });

  it("moves between dates across a month end", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("reads the way a person would say it", () => {
    const now = new Date("2026-11-12T08:05:00Z"); // 9:05 pm on the 12th
    expect(formatNzDate(now)).toBe("12 Nov 2026");
    expect(formatNzDateTime(now)).toBe("12 Nov 2026, 9:05 pm");
    expect(formatNzRelative(new Date("2026-11-12T08:04:40Z"), now)).toBe(
      "just now",
    );
    expect(formatNzRelative(new Date("2026-11-12T07:35:00Z"), now)).toBe(
      "30 min ago",
    );
    expect(formatNzRelative(new Date("2026-11-11T22:00:00Z"), now)).toBe(
      "today, 11:00 am",
    );
    expect(formatNzRelative(new Date("2026-11-11T03:30:00Z"), now)).toBe(
      "yesterday, 4:30 pm",
    );
    expect(formatNzRelative(new Date("2026-10-01T03:30:00Z"), now)).toBe(
      "1 Oct 2026",
    );
  });
});
