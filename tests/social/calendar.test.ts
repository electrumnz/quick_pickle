import { describe, expect, it } from "vitest";

import { nzDateKey } from "@/components/admin/data/format";
import {
  addDays,
  addMonths,
  daysBetween,
  dayOfMonth,
  emptyRuns,
  entriesByDay,
  instantFromNzWallClock,
  isNzDay,
  longestRun,
  monthDays,
  monthGridDays,
  monthTitle,
  nzDay,
  nzMinuteOfDay,
  nzOffsetMinutes,
  nzWallClock,
  placeOnDiary,
  startOfWeek,
  weekDays,
  weekdayIndex,
  weekdayName,
} from "@/lib/social/calendar";

/**
 * The calendar's arithmetic, including the two mornings a year it is hard.
 *
 * New Zealand's clocks in 2026 go forward at 2am on Sunday 27 September and
 * back at 3am on Sunday 5 April. Both were read off the platform's own
 * timezone database before these cases were written:
 *
 *   2026-09-26T13:00Z is 01:00 +12   2026-09-26T14:00Z is 03:00 +13
 *   2026-04-04T13:00Z is 02:00 +13   2026-04-04T14:00Z is 02:00 +12
 *
 * So on 27 September there is no 2:30am at all, and on 5 April there are two
 * of them an hour apart. A diary that quietly picks one is a diary that puts a
 * post out at the wrong time twice a year, and the second one is the one
 * nobody notices.
 */

const NZST = 720;
const NZDT = 780;

describe("what time it is in New Zealand", () => {
  it("is twelve hours ahead of UTC in winter and thirteen in summer", () => {
    expect(nzOffsetMinutes("2026-06-15T00:00:00Z")).toBe(NZST);
    expect(nzOffsetMinutes("2026-01-15T00:00:00Z")).toBe(NZDT);
  });

  it("changes offset across the September morning, not the calendar day", () => {
    expect(nzOffsetMinutes("2026-09-26T13:00:00Z")).toBe(NZST);
    expect(nzOffsetMinutes("2026-09-26T14:00:00Z")).toBe(NZDT);
  });

  it("puts an instant on the New Zealand day, not the UTC one", () => {
    // 8pm UTC on the 30th is already 8am on the 31st in Auckland. A calendar
    // that bucketed by the UTC date would draw this post on the wrong day.
    expect(nzDay("2026-08-30T20:00:00Z")).toBe("2026-08-31");
    expect(nzDay("2026-08-30T11:00:00Z")).toBe("2026-08-30");
  });

  it("reads the wall clock back as the founder set it", () => {
    expect(nzWallClock("2026-09-03T05:00:00Z")).toBe("2026-09-03T17:00");
    expect(nzMinuteOfDay("2026-09-03T05:00:00Z")).toBe(17 * 60);
  });
});

describe("a wall clock to the instant it names", () => {
  it("resolves an ordinary winter time against NZST", () => {
    const resolved = instantFromNzWallClock("2026-06-15T09:00");
    expect(resolved).not.toBeNull();
    expect(resolved?.kind).toBe("exact");
    expect(resolved?.iso).toBe("2026-06-14T21:00:00.000Z");
    expect(resolved?.offsetMinutes).toBe(NZST);
  });

  it("resolves an ordinary summer time against NZDT", () => {
    const resolved = instantFromNzWallClock("2026-01-15T09:00");
    expect(resolved?.kind).toBe("exact");
    expect(resolved?.iso).toBe("2026-01-14T20:00:00.000Z");
    expect(resolved?.offsetMinutes).toBe(NZDT);
  });

  it("is not the naive reading — 5pm is not 5pm UTC", () => {
    // The bug this function exists to close: `Date.parse('2026-09-03T17:00')`
    // on a UTC server is 17:00Z, which is 5am the next morning in Auckland.
    const resolved = instantFromNzWallClock("2026-09-03T17:00");
    expect(resolved?.iso).toBe("2026-09-03T05:00:00.000Z");
    expect(resolved?.iso).not.toBe("2026-09-03T17:00:00.000Z");
  });

  it("says when a wall clock does not exist at all", () => {
    // 2am to 3am on 27 September 2026 is skipped: the clocks go forward.
    const resolved = instantFromNzWallClock("2026-09-27T02:30");
    expect(resolved?.kind).toBe("skipped");
  });

  it("accepts the hour either side of the gap", () => {
    expect(instantFromNzWallClock("2026-09-27T01:30")?.kind).toBe("exact");
    expect(instantFromNzWallClock("2026-09-27T03:30")?.kind).toBe("exact");
  });

  it("says when a wall clock happens twice, and takes the first", () => {
    // 2am to 3am on 5 April 2026 runs twice: once on NZDT, once on NZST.
    const resolved = instantFromNzWallClock("2026-04-05T02:30");
    expect(resolved?.kind).toBe("twice");
    expect(resolved?.iso).toBe("2026-04-04T13:30:00.000Z");
    expect(resolved?.offsetMinutes).toBe(NZDT);
  });

  it("round-trips every hour of both transition days", () => {
    for (const date of ["2026-09-27", "2026-04-05"]) {
      for (let hour = 0; hour < 24; hour += 1) {
        const wall = `${date}T${String(hour).padStart(2, "0")}:30`;
        const resolved = instantFromNzWallClock(wall);
        expect(resolved, wall).not.toBeNull();
        if (resolved === null) continue;
        // Every reading except the hour that does not exist must come back as
        // the wall clock it was asked for.
        if (resolved.kind !== "skipped") {
          expect(nzWallClock(resolved.iso), wall).toBe(wall);
        }
      }
    }
  });

  it("refuses anything that is not a wall clock", () => {
    expect(instantFromNzWallClock("tomorrow")).toBeNull();
    expect(instantFromNzWallClock("2026-13-01T09:00")).toBeNull();
    expect(instantFromNzWallClock("2026-09-03T25:00")).toBeNull();
    expect(instantFromNzWallClock("")).toBeNull();
  });
});

describe("civil arithmetic", () => {
  it("adds a day across the spring-forward morning", () => {
    // The day after Saturday is Sunday even when that Sunday is 23 hours long.
    expect(addDays("2026-09-26", 1)).toBe("2026-09-27");
    expect(addDays("2026-09-27", 1)).toBe("2026-09-28");
    expect(daysBetween("2026-09-26", "2026-09-28")).toBe(2);
  });

  it("adds a day across the autumn morning and the end of a month", () => {
    expect(addDays("2026-04-04", 1)).toBe("2026-04-05");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts Monday as the first day of the week", () => {
    expect(weekdayIndex("2026-08-31")).toBe(0);
    expect(weekdayName("2026-08-31")).toBe("Monday");
    expect(weekdayIndex("2026-08-30")).toBe(6);
    expect(startOfWeek("2026-09-03")).toBe("2026-08-31");
    expect(weekDays("2026-09-03")[0]).toBe("2026-08-31");
    expect(weekDays("2026-09-03")).toHaveLength(7);
  });

  it("clamps a month step rather than overflowing it", () => {
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-09-15", -1)).toBe("2026-08-15");
  });

  it("knows how long a month is", () => {
    expect(monthDays("2026-09-04")).toHaveLength(30);
    expect(monthDays("2026-02-04")).toHaveLength(28);
    expect(dayOfMonth(monthDays("2026-09-04")[0] ?? "")).toBe(1);
    expect(monthTitle("2026-09-04")).toBe("September 2026");
  });

  it("draws a month on whole Monday-first weeks and no more", () => {
    const grid = monthGridDays("2026-09-04");
    expect(grid[0]).toBe("2026-08-31");
    expect(grid.at(-1)).toBe("2026-10-04");
    expect(grid).toHaveLength(35);
    expect(grid.length % 7).toBe(0);
    // Never a trailing row of nothing: the grid stops at the week holding the
    // last of the month. February 2027 begins on a Monday and ends on a
    // Sunday, so it is exactly four rows and gets four.
    expect(monthGridDays("2027-02-10")).toHaveLength(28);
    // February 2026 begins on a Sunday, so its first row is almost all
    // January and the grid is five.
    expect(monthGridDays("2026-02-10")).toHaveLength(35);
  });

  it("recognises a real date and refuses one that is not", () => {
    expect(isNzDay("2026-09-04")).toBe(true);
    expect(isNzDay("2026-02-30")).toBe(false);
    expect(isNzDay("2026-9-4")).toBe(false);
    expect(isNzDay("yesterday")).toBe(false);
  });
});

describe("where the holes are", () => {
  const week = weekDays("2026-09-03");

  it("finds nothing to say when every day has something on it", () => {
    expect(emptyRuns(week, new Set(week))).toEqual([]);
    expect(longestRun([])).toBeNull();
  });

  it("calls an untouched week one run of seven", () => {
    const runs = emptyRuns(week, new Set());
    expect(runs).toEqual([{ from: "2026-08-31", to: "2026-09-06", days: 7 }]);
  });

  it("splits the week either side of a post", () => {
    const runs = emptyRuns(week, new Set(["2026-09-03"]));
    expect(runs).toEqual([
      { from: "2026-08-31", to: "2026-09-02", days: 3 },
      { from: "2026-09-04", to: "2026-09-06", days: 3 },
    ]);
  });

  it("picks out the longest run for the sentence at the top", () => {
    const runs = emptyRuns(
      monthGridDays("2026-09-04"),
      new Set(["2026-09-01"]),
    );
    const longest = longestRun(runs);
    expect(longest?.from).toBe("2026-09-02");
    expect(longest?.to).toBe("2026-10-04");
    expect(longest?.days).toBe(33);
  });
});

describe("the same day, one answer", () => {
  it("agrees with the admin's own date formatter", () => {
    // `nzDay` and `components/admin/data/format.nzDateKey` compute the same
    // string. They are separate functions because `lib/social` imports nothing
    // — that is the rule the whole directory is built on — so this is what
    // stops the two drifting.
    for (const instant of [
      "2026-08-30T20:00:00Z",
      "2026-08-30T11:00:00Z",
      "2026-09-26T13:59:00Z",
      "2026-09-26T14:01:00Z",
      "2026-04-04T13:30:00Z",
      "2026-01-01T00:00:00Z",
      "2026-12-31T23:59:00Z",
    ]) {
      expect(nzDay(instant), instant).toBe(nzDateKey(instant));
    }
  });
});

describe("placing posts on the diary", () => {
  const post = (
    over: Partial<Parameters<typeof placeOnDiary>[0][number]> & {
      readonly id: string;
    },
  ) => ({
    platform: "instagram",
    status: "scheduled",
    caption: "A caption",
    scheduledFor: null,
    publishedAt: null,
    agentName: null,
    ...over,
  });

  it("puts a published post on the day it went out and a scheduled one on the day it is due", () => {
    const { dated } = placeOnDiary([
      post({
        id: "a",
        status: "published",
        publishedAt: "2026-08-19T06:40:00Z",
      }),
      post({ id: "b", scheduledFor: "2026-09-01T06:40:00Z" }),
    ]);
    expect(dated.map((entry) => [entry.id, entry.day, entry.done])).toEqual([
      ["a", "2026-08-19", true],
      ["b", "2026-09-01", false],
    ]);
  });

  it("hands back the posts with no day rather than dropping them", () => {
    const { dated, undated } = placeOnDiary([
      post({ id: "draft", status: "draft" }),
      post({ id: "failed", status: "failed" }),
      post({ id: "due", scheduledFor: "2026-09-01T06:40:00Z" }),
    ]);
    expect(dated.map((entry) => entry.id)).toEqual(["due"]);
    expect(undated.map((entry) => entry.id)).toEqual(["draft", "failed"]);
  });

  it("leaves an archived post off the calendar entirely", () => {
    const { dated, undated } = placeOnDiary([
      post({
        id: "gone",
        status: "archived",
        scheduledFor: "2026-09-01T06:40:00Z",
      }),
    ]);
    expect(dated).toEqual([]);
    expect(undated).toEqual([]);
  });

  it("orders a day by the New Zealand clock, not the UTC one", () => {
    // 11:00Z is 11pm on the 30th in Auckland; 20:00Z is 8am on the 31st. Sorted
    // by the raw instant these are the right way round already, so the case
    // that matters is that they land on different days at all.
    const { dated } = placeOnDiary([
      post({ id: "late", scheduledFor: "2026-08-30T11:00:00Z" }),
      post({ id: "early", scheduledFor: "2026-08-30T20:00:00Z" }),
      post({ id: "earlier", scheduledFor: "2026-08-30T19:00:00Z" }),
    ]);
    expect(dated.map((entry) => [entry.id, entry.day])).toEqual([
      ["late", "2026-08-30"],
      ["earlier", "2026-08-31"],
      ["early", "2026-08-31"],
    ]);
  });

  it("buckets the entries by day for the grid to read", () => {
    const { dated } = placeOnDiary([
      post({ id: "one", scheduledFor: "2026-08-30T20:00:00Z" }),
      post({ id: "two", scheduledFor: "2026-08-30T21:00:00Z" }),
      post({ id: "three", scheduledFor: "2026-09-01T06:40:00Z" }),
    ]);
    const byDay = entriesByDay(dated);
    expect(byDay.get("2026-08-31")?.map((entry) => entry.id)).toEqual([
      "one",
      "two",
    ]);
    expect(byDay.get("2026-09-01")).toHaveLength(1);
    expect(byDay.get("2026-09-02")).toBeUndefined();
  });
});
