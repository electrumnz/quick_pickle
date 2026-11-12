/**
 * Calendar dates in Plans: a task's due date, a compliance item's review
 * date. They are New Zealand calendar dates with no time of day, stored as
 * "2026-11-12", and "today" is always today in New Zealand (lib/time.ts),
 * whatever clock the server keeps.
 */

import { formatNzDate, nzDateKey, startOfNzDay } from "@/lib/time";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function parts(dateKey: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  return [year, month, day];
}

/** True for a real calendar date written as 2026-11-12. */
export function isDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const [year, month, day] = parts(value);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Whole days from today (in New Zealand) to a date: 0 today, 1 tomorrow,
 * negative once it has passed.
 */
export function daysFromToday(dateKey: string, now: Date): number {
  const [year, month, day] = parts(dateKey);
  const [todayYear, todayMonth, todayDay] = parts(nzDateKey(now));
  return Math.round(
    (Date.UTC(year, month - 1, day) -
      Date.UTC(todayYear, todayMonth - 1, todayDay)) /
      86_400_000,
  );
}

/**
 * A task is overdue from the first moment of the day after its due date, in
 * New Zealand. One due "today" is not overdue at 11.59 at night.
 */
export function isOverdue(
  dueOn: string | null,
  done: boolean,
  now: Date,
): boolean {
  return dueOn !== null && !done && dueOn < nzDateKey(now);
}

/** "12 Nov 2026" */
export function formatDateKey(dateKey: string): string {
  return formatNzDate(startOfNzDay(dateKey));
}

/** How a person would say when something is due. */
export function describeDue(dateKey: string, now: Date): string {
  const days = daysFromToday(dateKey, now);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const date = formatDateKey(dateKey);
  if (days > 1 && days <= 14) return `in ${String(days)} days, ${date}`;
  if (days < -1) return `${String(-days)} days ago, ${date}`;
  return date;
}
