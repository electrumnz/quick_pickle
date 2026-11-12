/**
 * Calendar dates for stock: the day a batch was made, its best-before date,
 * the day a purchase order is due.
 *
 * These are New Zealand calendar dates with no time of day, kept as
 * "2026-11-12" (what a date field in a form sends and what the database's
 * `date` columns hold). Anything that needs "today" or a readable date goes
 * through lib/time.ts, so the server's own clock (UTC) never leaks in.
 */

import { z } from "zod";

import { addDays, formatNzDate, nzDateKey, startOfNzDay } from "@/lib/time";

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as "2026-11-12". */
export function isDateKey(value: string): boolean {
  const match = DATE_KEY.exec(value);
  if (match === null) return false;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  if (year < 2000 || year > 2100) return false;
  const made = new Date(Date.UTC(year, month - 1, day));
  return (
    made.getUTCFullYear() === year &&
    made.getUTCMonth() === month - 1 &&
    made.getUTCDate() === day
  );
}

/** A date as an operation takes it: "2026-11-12". */
export const dateKeySchema = z
  .string({ error: "Give a date, like 2026-11-12" })
  .trim()
  .refine(isDateKey, "Give a real date, like 2026-11-12");

/** The New Zealand calendar date of an instant. */
export function todayKey(now: Date): string {
  return nzDateKey(now);
}

/**
 * Is a batch with this best-before date still good on this day?
 *
 * The one place that decides it. A batch is good through the END of its
 * best-before day: on the day itself it can still go out, the day after it
 * cannot. A batch with no date is not good: nothing shows that it is.
 *
 * `today` is the New Zealand date of the request in hand (todayKey(ctx.now)),
 * worked out each time. Never one kept from an earlier request, or the
 * answer goes stale at midnight.
 */
export function isGoodOn(bestBefore: string | null, today: string): boolean {
  return bestBefore !== null && bestBefore >= today;
}

function utcNoon(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 12);
}

/** Whole days from one date to another. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcNoon(to) - utcNoon(from)) / 86_400_000);
}

/**
 * The date `days` working days after another, counting Monday to Friday.
 * Public holidays are not known here, so around them a supplier's date can
 * be a day or two out.
 */
export function addWorkingDays(dateKey: string, days: number): string {
  let key = dateKey;
  let left = Math.max(0, Math.trunc(days));
  while (left > 0) {
    key = addDays(key, 1);
    const weekday = new Date(utcNoon(key)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return key;
}

/** "12 Nov 2026" */
export function formatDateKey(dateKey: string): string {
  return formatNzDate(startOfNzDay(dateKey));
}

/** "in 12 days", "tomorrow", "today", "3 days ago". */
export function daysAwayText(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0
    ? `in ${String(days)} days`
    : `${String(Math.abs(days))} days ago`;
}
