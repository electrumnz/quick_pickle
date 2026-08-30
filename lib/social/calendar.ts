/**
 * The diary, in New Zealand time.
 *
 * `public.social_posts.scheduled_for` is a `timestamptz` — an instant, stored
 * in UTC. The founder does not think in instants. She thinks in "Thursday
 * afternoon", and Thursday afternoon in Auckland is a different instant in
 * February than it is in July because the clocks move. Every function here
 * exists to keep those two ideas apart and to convert between them without
 * ever guessing.
 *
 * ## The three things that go wrong, and what is done about each
 *
 * **A `datetime-local` field hands over a wall clock, not an instant.** The
 * browser sends `2026-09-03T17:00` and says nothing about a zone. Reading that
 * with `Date.parse` interprets it in the *server's* zone, and Vercel's servers
 * run UTC, so "5pm" became 5am the next morning in Auckland. That is the exact
 * bug {@link instantFromNzWallClock} exists to close: the string is resolved
 * against Pacific/Auckland explicitly, by asking the platform's own timezone
 * database rather than by adding twelve hours.
 *
 * **Twice a year a wall clock is not a single instant.** On the morning the
 * clocks go forward — 27 September 2026, 2am becomes 3am — there is no 2:30am
 * at all, and a diary entry for it is not a time that will ever arrive. On the
 * morning they go back — 5 April 2026, 3am becomes 2am — 2:30am happens twice.
 * {@link instantFromNzWallClock} says which case it is in
 * {@link ResolvedWallClock.kind} instead of silently picking one, so the screen
 * above it can refuse the first and be explicit about the second.
 *
 * **A calendar grid is civil arithmetic, not elapsed time.** "The day after
 * Saturday" is Sunday even when that Sunday is 23 hours long. So every grid
 * function below works on `YYYY-MM-DD` strings — a civil date with no zone and
 * no time in it — and never on a `Date` plus 86,400,000 milliseconds, which is
 * the other way this goes wrong twice a year.
 *
 * Nothing here imports anything. It is plain data and pure functions, the same
 * rule the rest of `lib/social` follows, so it runs identically in a server
 * component, a client component and a test.
 */

/** The one zone this company runs on. */
export const NZ_ZONE = "Pacific/Auckland";

/**
 * A civil date in New Zealand, `YYYY-MM-DD`.
 *
 * Deliberately a string rather than a `Date`. A `Date` is an instant, and an
 * instant that stands for a day is a day that changes which day it is when it
 * crosses a zone. These are the keys the calendar grid is built from and the
 * keys posts are bucketed by, and they mean the same thing everywhere.
 */
export type NzDay = string;

const DAY_MS = 86_400_000;

/** Monday first. New Zealand weeks start on Monday, and so does this grid. */
export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const WEEKDAY_SHORT = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

/**
 * The New Zealand wall clock at a given instant, field by field.
 *
 * `hourCycle: "h23"` is not decoration: without it some ICU builds render
 * midnight as hour 24, which turns into the wrong day when it is fed back
 * through `Date.UTC`.
 */
const NZ_FIELDS = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const NZ_MONTH_TITLE = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

interface Fields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function toMs(instant: Date | string | number): number {
  if (typeof instant === "number") return instant;
  if (instant instanceof Date) return instant.getTime();
  return new Date(instant).getTime();
}

function partsOf(ms: number): Fields {
  const found: Record<string, number> = {};
  for (const part of NZ_FIELDS.formatToParts(new Date(ms))) {
    if (part.type !== "literal") {
      found[part.type] = Number.parseInt(part.value, 10);
    }
  }
  return {
    year: found["year"] ?? 1970,
    month: found["month"] ?? 1,
    day: found["day"] ?? 1,
    hour: found["hour"] ?? 0,
    minute: found["minute"] ?? 0,
    second: found["second"] ?? 0,
  };
}

/** The same fields read as if they were UTC — the trick every offset uses. */
function fieldsAsUtcMs(fields: Fields): number {
  return Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * How far ahead of UTC New Zealand is at that instant, in minutes.
 *
 * +720 in winter (NZST), +780 in summer (NZDT). Read from the platform's own
 * timezone database, never assumed, because the rule for when it changes has
 * been amended before and will be again.
 */
export function nzOffsetMinutes(instant: Date | string | number): number {
  const ms = toMs(instant);
  return (fieldsAsUtcMs(partsOf(ms)) - ms) / 60_000;
}

/** The New Zealand calendar date an instant falls on. */
export function nzDay(instant: Date | string | number): NzDay {
  const fields = partsOf(toMs(instant));
  return `${pad(fields.year, 4)}-${pad(fields.month)}-${pad(fields.day)}`;
}

/** Today, in New Zealand. Takes `now` so a test is not at the mercy of one. */
export function nzToday(now: Date | string | number = new Date()): NzDay {
  return nzDay(now);
}

/**
 * The New Zealand wall clock at an instant, as `<input type="datetime-local">`
 * spells it: `2026-09-03T17:00`.
 *
 * This is what prefills the reschedule field, so what she sees in the box is
 * the time she was already told the post goes out.
 */
export function nzWallClock(instant: Date | string | number): string {
  const fields = partsOf(toMs(instant));
  return `${pad(fields.year, 4)}-${pad(fields.month)}-${pad(fields.day)}T${pad(fields.hour)}:${pad(fields.minute)}`;
}

/** The minutes past midnight, in New Zealand. Used to sort a day's posts. */
export function nzMinuteOfDay(instant: Date | string | number): number {
  const fields = partsOf(toMs(instant));
  return fields.hour * 60 + fields.minute;
}

/**
 * What a wall clock turned out to mean.
 *
 * `exact` — one instant, the ordinary case.
 * `twice` — the clocks went back, so this wall clock happens two hours apart.
 *   `iso` is the first of the two, which is the one a person means when they
 *   write it down the day before.
 * `skipped` — the clocks went forward over it, so this wall clock never
 *   happens. `iso` is where it lands if it is shoved forward past the gap, and
 *   a screen that cares should refuse rather than use it.
 */
export type WallClockKind = "exact" | "twice" | "skipped";

export interface ResolvedWallClock {
  readonly kind: WallClockKind;
  /** The instant, in UTC, ready for a `timestamptz`. */
  readonly iso: string;
  /** The offset in force at that instant: 720 in winter, 780 in summer. */
  readonly offsetMinutes: number;
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * A New Zealand wall clock to the instant it names.
 *
 * The method, because it is the part that is easy to get subtly wrong: the
 * wall clock is first read as though it were UTC, which gives a number in the
 * right neighbourhood. The zone's offset is then sampled a day either side of
 * it — a day is enough to straddle any transition and not enough to hit the
 * next one — giving at most two candidate instants. Each candidate is
 * converted back to a New Zealand wall clock and compared with what was asked
 * for. The candidates that survive are the answers: two means the hour repeats,
 * one means the ordinary case, none means the hour does not exist.
 *
 * @returns `null` when the string is not a wall clock at all.
 */
export function instantFromNzWallClock(wall: string): ResolvedWallClock | null {
  const match = WALL_CLOCK.exec(wall.trim());
  if (match === null) return null;
  const asked: Fields = {
    year: Number.parseInt(match[1] ?? "", 10),
    month: Number.parseInt(match[2] ?? "", 10),
    day: Number.parseInt(match[3] ?? "", 10),
    hour: Number.parseInt(match[4] ?? "", 10),
    minute: Number.parseInt(match[5] ?? "", 10),
    second: Number.parseInt(match[6] ?? "0", 10),
  };
  if (asked.month < 1 || asked.month > 12) return null;
  if (asked.day < 1 || asked.day > 31) return null;
  if (asked.hour > 23 || asked.minute > 59 || asked.second > 59) return null;

  const naive = fieldsAsUtcMs(asked);
  const candidates = [
    naive - nzOffsetMinutes(naive - DAY_MS) * 60_000,
    naive - nzOffsetMinutes(naive + DAY_MS) * 60_000,
  ].filter((value, index, all) => all.indexOf(value) === index);

  const valid = candidates
    .filter((ms) => fieldsAsUtcMs(partsOf(ms)) === naive)
    .sort((a, b) => a - b);

  if (valid.length === 0) {
    // The hour does not exist. The later candidate is where a shove forward
    // past the gap lands, which is what a lenient reading would have produced.
    const shoved = Math.max(...candidates);
    return {
      kind: "skipped",
      iso: new Date(shoved).toISOString(),
      offsetMinutes: nzOffsetMinutes(shoved),
    };
  }
  const chosen = valid[0] ?? naive;
  return {
    kind: valid.length > 1 ? "twice" : "exact",
    iso: new Date(chosen).toISOString(),
    offsetMinutes: nzOffsetMinutes(chosen),
  };
}

/* --------------------------------------------------------- civil calendar */

function dayToMs(day: NzDay): number {
  const [year, month, date] = day.split("-").map((part) => Number(part));
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

function msToDay(ms: number): NzDay {
  const at = new Date(ms);
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** True for a well-formed, real calendar date: `2026-02-30` is not one. */
export function isNzDay(value: string): value is NzDay {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && msToDay(dayToMs(value)) === value;
}

/** Civil arithmetic: the day n days after this one, whatever the clocks did. */
export function addDays(day: NzDay, delta: number): NzDay {
  return msToDay(dayToMs(day) + delta * DAY_MS);
}

/** How many days from one to the other. Negative when `to` is earlier. */
export function daysBetween(from: NzDay, to: NzDay): number {
  return Math.round((dayToMs(to) - dayToMs(from)) / DAY_MS);
}

/** 0 for Monday through 6 for Sunday. */
export function weekdayIndex(day: NzDay): number {
  return (new Date(dayToMs(day)).getUTCDay() + 6) % 7;
}

export function weekdayName(day: NzDay): string {
  return WEEKDAY_NAMES[weekdayIndex(day)] ?? "";
}

export function weekdayShort(day: NzDay): string {
  return WEEKDAY_SHORT[weekdayIndex(day)] ?? "";
}

export function dayOfMonth(day: NzDay): number {
  return Number(day.slice(8, 10));
}

/** `2026-09` — the month a day belongs to, for comparing two days. */
export function monthKey(day: NzDay): string {
  return day.slice(0, 7);
}

export function startOfWeek(day: NzDay): NzDay {
  return addDays(day, -weekdayIndex(day));
}

export function startOfMonth(day: NzDay): NzDay {
  return `${day.slice(0, 8)}01`;
}

/**
 * The same day n months away, clamped to the length of the month it lands in
 * so that the 31st of a month never becomes the 1st of the month after.
 */
export function addMonths(day: NzDay, delta: number): NzDay {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1 + delta;
  const target = new Date(Date.UTC(year, month, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return msToDay(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(dayOfMonth(day), last),
    ),
  );
}

/** "September 2026". */
export function monthTitle(day: NzDay): string {
  return NZ_MONTH_TITLE.format(new Date(dayToMs(day)));
}

/** Every day in the week containing this one, Monday first. */
export function weekDays(day: NzDay): readonly NzDay[] {
  const monday = startOfWeek(day);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** Every day of this day's month, the 1st to the last. */
export function monthDays(day: NzDay): readonly NzDay[] {
  const first = startOfMonth(day);
  const length = daysBetween(first, addMonths(first, 1));
  return Array.from({ length }, (_, index) => addDays(first, index));
}

/**
 * The grid a month is drawn on: whole weeks, Monday first, running from the
 * Monday on or before the 1st to the Sunday on or after the last.
 *
 * Five or six rows depending on the month — never a fixed six, because a
 * trailing row of greyed-out days is a row of nothing that pushes the thing she
 * came to see off the screen.
 */
export function monthGridDays(day: NzDay): readonly NzDay[] {
  const first = startOfMonth(day);
  const start = startOfWeek(first);
  const lastOfMonth = addDays(addMonths(first, 1), -1);
  const end = addDays(startOfWeek(lastOfMonth), 6);
  const length = daysBetween(start, end) + 1;
  return Array.from({ length }, (_, index) => addDays(start, index));
}

/* -------------------------------------------------------- placing the posts */

/**
 * The part of a social post a diary needs.
 *
 * Deliberately structural rather than an import of `SocialPostItem`: this
 * module imports nothing, and the admin's row type carries twenty fields of
 * metrics a calendar has no opinion about.
 */
export interface DiaryPost {
  readonly id: string;
  readonly platform: string;
  readonly status: string;
  readonly caption: string;
  /** When it is due to go out, as a UTC instant. */
  readonly scheduledFor: string | null;
  /** When it went out, as a UTC instant. */
  readonly publishedAt: string | null;
  readonly agentName: string | null;
}

/** One post, placed on a New Zealand day. */
export interface CalendarEntry {
  readonly id: string;
  /** The New Zealand calendar date it sits on. */
  readonly day: NzDay;
  /** Minutes past midnight in New Zealand, for ordering within the day. */
  readonly minute: number;
  /** The instant it is placed by: when it went out, or when it is due. */
  readonly instant: string;
  readonly platform: string;
  readonly status: string;
  readonly caption: string;
  readonly agentName: string | null;
  /** True when this date is a record of what happened, not a plan. */
  readonly done: boolean;
}

/**
 * Split the posts into the ones with a date and the ones without.
 *
 * A published post is placed on the day it went out; everything else on the
 * day it is due. A draft with no time and a failure that never got one have no
 * day at all, and they are handed back separately rather than dropped: a post
 * that exists and is on no calendar is exactly the thing that goes missing.
 *
 * `archived` is left out of both. A post taken out of the queue is not in the
 * diary, and drawing it would put something on the calendar that is not going
 * to happen.
 */
export function placeOnDiary<T extends DiaryPost>(
  posts: readonly T[],
): {
  readonly dated: readonly CalendarEntry[];
  readonly undated: readonly T[];
} {
  const dated: CalendarEntry[] = [];
  const undated: T[] = [];
  for (const post of posts) {
    if (post.status === "archived") continue;
    const instant = post.publishedAt ?? post.scheduledFor;
    if (instant === null) {
      undated.push(post);
      continue;
    }
    dated.push({
      id: post.id,
      day: nzDay(instant),
      minute: nzMinuteOfDay(instant),
      instant,
      platform: post.platform,
      status: post.status,
      caption: post.caption,
      agentName: post.agentName,
      done: post.publishedAt !== null,
    });
  }
  dated.sort((a, b) =>
    a.day === b.day ? a.minute - b.minute : a.day < b.day ? -1 : 1,
  );
  return { dated, undated };
}

/** The entries of each day, keyed by the New Zealand date. */
export function entriesByDay(
  entries: readonly CalendarEntry[],
): ReadonlyMap<NzDay, readonly CalendarEntry[]> {
  const map = new Map<NzDay, CalendarEntry[]>();
  for (const entry of entries) {
    const existing = map.get(entry.day);
    if (existing === undefined) map.set(entry.day, [entry]);
    else existing.push(entry);
  }
  return map;
}

/* ------------------------------------------------------------------- gaps */

/**
 * A run of consecutive days with nothing in the diary.
 *
 * The reason this is computed rather than left to the eye: a hole in a month
 * grid reads as "the design has some white space in it" and not as "you have
 * eleven days with nothing going out". The screen says it in words, and this
 * is where the words get their numbers.
 */
export interface EmptyRun {
  readonly from: NzDay;
  readonly to: NzDay;
  readonly days: number;
}

/**
 * Every run of empty days in `days`, in order.
 *
 * `days` is expected to be consecutive and ascending — the output of
 * {@link monthGridDays} or {@link weekDays}, or a slice of one.
 */
export function emptyRuns(
  days: readonly NzDay[],
  busy: ReadonlySet<NzDay>,
): readonly EmptyRun[] {
  const runs: EmptyRun[] = [];
  let start: NzDay | null = null;
  let previous: NzDay | null = null;
  for (const day of days) {
    if (busy.has(day)) {
      if (start !== null && previous !== null) {
        runs.push({
          from: start,
          to: previous,
          days: daysBetween(start, previous) + 1,
        });
      }
      start = null;
      previous = null;
      continue;
    }
    start ??= day;
    previous = day;
  }
  if (start !== null && previous !== null) {
    runs.push({
      from: start,
      to: previous,
      days: daysBetween(start, previous) + 1,
    });
  }
  return runs;
}

/** The longest empty run, or null when every day has something on it. */
export function longestRun(runs: readonly EmptyRun[]): EmptyRun | null {
  return runs.reduce<EmptyRun | null>(
    (longest, run) =>
      longest === null || run.days > longest.days ? run : longest,
    null,
  );
}
