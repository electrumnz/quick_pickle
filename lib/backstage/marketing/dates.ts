/**
 * Calendar helpers for the planner, on top of lib/time.ts.
 *
 * A "date key" is a New Zealand calendar date as "2026-11-12". Weeks run
 * Monday to Sunday. Every step between a wall-clock reading and an instant
 * goes through lib/time.ts; this file only does calendar arithmetic on keys
 * and turns form fields into the numbers lib/time.ts wants.
 */

import {
  addDays,
  nzDateKey,
  nzParts,
  nzToInstant,
  startOfNzDay,
} from "@/lib/time";

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^(\d{1,2}):(\d{2})$/;

function parts(dateKey: string): [number, number, number] | null {
  const match = DATE_KEY.exec(dateKey);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // 31 February rolls over into March. A real date survives the round trip.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

/** True for a real calendar date written as "2026-11-12". */
export function isDateKey(value: string): boolean {
  return parts(value) !== null;
}

/** 0 for Monday through 6 for Sunday. */
export function weekdayOf(dateKey: string): number {
  const found = parts(dateKey);
  if (found === null) throw new Error(`"${dateKey}" is not a date`);
  const [year, month, day] = found;
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** The Monday of the week a date falls in. */
export function weekStartKey(dateKey: string): string {
  return addDays(dateKey, -weekdayOf(dateKey));
}

/** The instants a New Zealand week starts and ends at (end not included). */
export function weekBounds(startKey: string): {
  readonly from: Date;
  readonly to: Date;
} {
  return {
    from: startOfNzDay(startKey),
    to: startOfNzDay(addDays(startKey, 7)),
  };
}

const dayFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const shortFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

function noonUtc(dateKey: string): Date {
  const found = parts(dateKey);
  if (found === null) throw new Error(`"${dateKey}" is not a date`);
  const [year, month, day] = found;
  // The key already is the New Zealand date, so it is formatted as written.
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** "Thu 12 Nov" */
export function dayLabel(dateKey: string): string {
  return dayFormat.format(noonUtc(dateKey)).replace(",", "");
}

/** "12 Nov" */
export function shortDateLabel(dateKey: string): string {
  return shortFormat.format(noonUtc(dateKey));
}

/** "This week", "Next week", "Last week", or "Week of 23 Nov". */
export function weekLabel(startKey: string, todayKey: string): string {
  const thisWeek = weekStartKey(todayKey);
  if (startKey === thisWeek) return "This week";
  if (startKey === addDays(thisWeek, 7)) return "Next week";
  if (startKey === addDays(thisWeek, -7)) return "Last week";
  return `Week of ${shortDateLabel(startKey)}`;
}

/** The value for an `<input type="date">`: the New Zealand date. */
export function dateInputValue(instant: Date): string {
  return nzDateKey(instant);
}

/** The value for an `<input type="time">`: the New Zealand clock, "09:05". */
export function timeInputValue(instant: Date): string {
  const read = nzParts(instant);
  return `${String(read.hour).padStart(2, "0")}:${String(read.minute).padStart(2, "0")}`;
}

/**
 * The instant a date field and a time field mean, read as New Zealand time.
 * Null when either is not filled in properly. No time means nine in the
 * morning.
 */
export function instantFromFields(date: string, time: string): Date | null {
  const day = parts(date.trim());
  if (day === null) return null;
  const clock = CLOCK.exec(time.trim() === "" ? "09:00" : time.trim());
  if (clock === null) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) return null;
  return nzToInstant(day[0], day[1], day[2], hour, minute);
}
