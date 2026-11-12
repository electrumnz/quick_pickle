/**
 * Time, as New Zealand reads it.
 *
 * The database stores instants (UTC). People in the back end read and type
 * New Zealand wall-clock time. Every conversion between the two goes through
 * this file, because the server runs on UTC and New Zealand is twelve hours
 * ahead in winter and thirteen in summer: `new Date("2026-11-12T09:00")` on
 * the server is not nine in the morning in Auckland.
 */

export const NZ_TIME_ZONE = "Pacific/Auckland";

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partsFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The New Zealand calendar and clock reading of an instant. */
export function nzParts(instant: Date): Parts {
  const out: Record<string, number> = {};
  for (const part of partsFormat.formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** "2026-11-12": the New Zealand calendar date an instant falls on. */
export function nzDateKey(instant: Date): string {
  const p = nzParts(instant);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * The instant a New Zealand wall-clock reading refers to.
 *
 * On the night the clocks go forward an hour does not exist (02:30 becomes
 * 03:30); on the night they go back an hour happens twice (the first one is
 * returned). Both are handled, neither throws.
 */
export function nzToInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  // Start from "as if it were UTC" and correct by the zone's offset there.
  // Two passes settle it either side of a daylight-saving change.
  let guess = wanted;
  for (let pass = 0; pass < 3; pass += 1) {
    const p = nzParts(new Date(guess));
    const shown = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    const drift = shown - wanted;
    if (drift === 0) break;
    guess -= drift;
  }
  return new Date(guess);
}

/** Midnight at the start of a New Zealand date ("2026-11-12"), as an instant. */
export function startOfNzDay(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    Number.isNaN(year + month + day)
  ) {
    throw new Error(`"${dateKey}" is not a date like 2026-11-12`);
  }
  return nzToInstant(year, month, day);
}

/** The date key `days` after (or before, if negative) another. */
export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days, 12),
  );
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

const dateFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dayFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const timeFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "12 Nov 2026" */
export function formatNzDate(instant: Date): string {
  return dateFormat.format(instant);
}

/** "9:05 pm" */
export function formatNzTime(instant: Date): string {
  return timeFormat.format(instant).replace(/ | /g, " ");
}

/** "12 Nov 2026, 9:05 pm" */
export function formatNzDateTime(instant: Date): string {
  return `${formatNzDate(instant)}, ${formatNzTime(instant)}`;
}

/**
 * How a person would say it: "just now", "5 min ago", "today, 9:05 pm",
 * "yesterday, 4:30 pm", "Tue 10 Nov", then the full date for older things.
 */
export function formatNzRelative(
  instant: Date,
  now: Date = new Date(),
): string {
  const seconds = Math.round((now.getTime() - instant.getTime()) / 1000);
  if (seconds >= 0 && seconds < 45) return "just now";
  if (seconds >= 0 && seconds < 3600) {
    return `${String(Math.max(1, Math.round(seconds / 60)))} min ago`;
  }
  const today = nzDateKey(now);
  const that = nzDateKey(instant);
  if (that === today) return `today, ${formatNzTime(instant)}`;
  if (that === addDays(today, -1)) return `yesterday, ${formatNzTime(instant)}`;
  if (that === addDays(today, 1)) return `tomorrow, ${formatNzTime(instant)}`;
  const days = Math.abs(
    (startOfNzDay(today).getTime() - startOfNzDay(that).getTime()) / 86_400_000,
  );
  if (days < 7) {
    return dayFormat.format(instant).replace(",", "");
  }
  return formatNzDate(instant);
}
