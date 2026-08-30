import Link from "next/link";
import type { ReactNode } from "react";

import {
  clip,
  day as dayWords,
  dayLong,
  plural,
  time,
} from "@/components/admin/data/format";
import type { SocialPostItem } from "@/components/admin/data/queries";
import { Badge, Callout, EmptyState } from "@/components/admin/ui/primitives";
import {
  addDays,
  daysBetween,
  dayOfMonth,
  emptyRuns,
  longestRun,
  monthTitle,
  platformShort,
  platformWord,
  weekdayShort,
  type CalendarEntry,
  type NzDay,
} from "@/lib/social";

/**
 * The diary, drawn.
 *
 * The Social page can already show a post rendered the way each platform will
 * render it, and can approve it, reword it and give it a time. What it could
 * not show was TIME: what is going out, when, and — the thing she actually
 * needs — where the empty weeks are. A queue sorted by date answers "what is
 * next". It does not answer "have I got anything at all going out the week
 * after this one", and that is the question a one-person food company loses
 * momentum on.
 *
 * ## Four decisions in this file
 *
 * **The gaps are said in words, not only left as whitespace.** A hole in a
 * grid reads as a design that has some air in it. "Nothing from Tuesday 1 to
 * Sunday 13 September — thirteen days" reads as a fortnight of silence.
 * {@link GapSummary} is the point of the screen as much as the grid is.
 *
 * **A state is never a colour.** Every entry carries a shape and a word: the
 * shape is drawn, the word is in the link's accessible name and in the legend
 * under the grid. This admin has one accent and one danger colour, and even if
 * it had six, colour alone fails for the founder reading it in sunlight at a
 * market stall as surely as it fails a screen reader.
 *
 * **It is one tree, not a desktop copy and a phone copy.** A seven-column
 * month is unreadable at 390px, so below `sm` the empty cells fold away and
 * the runs between them turn into the sentences above; above `sm` the
 * sentences fold away and the grid stands. Same links, same DOM, no duplicate
 * content for a screen reader to read twice.
 *
 * **Nothing here posts anything, and nothing here is drag-and-drop.** Moving a
 * post is a form with a date field, submitted to the same guarded server action
 * the Social page uses, so it works from a keyboard, works with scripting off,
 * and lands in the audit log with her name on it.
 */

/* --------------------------------------------------------------- vocabulary */

interface StateWords {
  /** What she calls it. */
  readonly word: string;
  /** The shape, so state survives being printed, or read in sunlight. */
  readonly glyph: string;
  readonly tone: "neutral" | "quiet" | "accent" | "danger";
  /** One line for the legend. */
  readonly means: string;
}

/**
 * The six values of `public.social_post_status`, in her words.
 *
 * `archived` is here for completeness and never reaches the grid: a post taken
 * out of the queue is not in the diary, and drawing it would put something on
 * the calendar that is not going to happen.
 */
export const POST_STATES: Readonly<Record<string, StateWords>> = {
  draft: {
    word: "Draft",
    glyph: "○",
    tone: "quiet",
    means: "Written down. Nobody has been asked about it yet.",
  },
  pending_approval: {
    word: "Waiting on you",
    glyph: "◆",
    tone: "accent",
    means: "An agent drafted it and it stops here until you say yes.",
  },
  scheduled: {
    word: "In the diary",
    glyph: "●",
    tone: "neutral",
    means:
      "You said yes and gave it a time. Nothing sends it — no account is connected to this admin.",
  },
  published: {
    word: "Published",
    glyph: "✓",
    tone: "quiet",
    means: "It went out, and the numbers on it came back from the platform.",
  },
  failed: {
    word: "Did not go out",
    glyph: "✕",
    tone: "danger",
    means: "The platform refused it. The reason is on the post.",
  },
  archived: {
    word: "Taken out",
    glyph: "–",
    tone: "quiet",
    means: "Taken out of the queue, with a reason. It is not in the diary.",
  },
};

function stateOf(status: string): StateWords {
  return (
    POST_STATES[status] ?? {
      word: status,
      glyph: "·",
      tone: "quiet",
      means: "A state this screen does not have words for yet.",
    }
  );
}

/* -------------------------------------------------------------- the entries */

/* ------------------------------------------------------------------- links */

export type CalendarView = "month" | "week";

/** Where a link on this page goes. Every control is a plain link or a form. */
export function calendarHref(state: {
  readonly view: CalendarView;
  readonly on: NzDay;
  readonly post?: string | null;
}): string {
  const query = new URLSearchParams({ view: state.view, on: state.on });
  if (state.post !== undefined && state.post !== null) {
    query.set("post", state.post);
    return `/admin/social/calendar?${query.toString()}#chosen`;
  }
  return `/admin/social/calendar?${query.toString()}`;
}

/** A day, written the way she says it: "Tuesday 1 September". */
export function dayInWords(day: NzDay): string {
  return dayLong(`${day}T00:00:00Z`);
}

/** "Tue 1 Sept". */
export function dayInShort(day: NzDay): string {
  return dayWords(`${day}T00:00:00Z`);
}

/**
 * The month on its own: "Sept".
 *
 * Its own formatter rather than the tail of {@link dayInShort}, because the
 * abbreviation is not a fixed width — en-NZ writes September as "Sept" and
 * June as "Jun" — and slicing the last three characters off the first of those
 * produced "ept" on the calendar.
 */
const MONTH_SHORT = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "UTC",
  month: "short",
});

export function monthInShort(day: NzDay): string {
  return MONTH_SHORT.format(new Date(`${day}T00:00:00Z`));
}

/* ------------------------------------------------------------ the grid bits */

const CHIP =
  "block min-h-11 rounded-md border px-2 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current sm:min-h-0";

const CHIP_TONES: Readonly<Record<string, string>> = {
  quiet: "border-hairline bg-surface-page text-primary hover:bg-surface-sunken",
  neutral: "border-strong bg-surface-page text-primary hover:bg-surface-sunken",
  accent:
    "border-accent-edge bg-surface-accent text-on-accent hover:bg-surface-accent/80",
  danger: "border-danger/50 bg-danger/10 text-danger hover:bg-danger/20",
};

/**
 * One post in a day cell.
 *
 * The whole accessible name is written once, in the `sr-only` span, and the
 * visible half is hidden from assistive technology. That way the reading is a
 * sentence — "Instagram, 5:00 pm, waiting on you" — rather than the fragments
 * a truncated caption and a bare glyph would produce.
 */
function EntryChip({
  entry,
  href,
  chosen,
  detail,
}: {
  entry: CalendarEntry;
  href: string;
  chosen: boolean;
  /** `full` shows the state in words as well as in its shape. */
  detail: "compact" | "full";
}) {
  const state = stateOf(entry.status);
  const platform = platformWord(entry.platform);
  const when = time(entry.instant);
  return (
    <Link
      href={href}
      aria-current={chosen ? "true" : undefined}
      className={`${CHIP} ${CHIP_TONES[state.tone] ?? CHIP_TONES["quiet"] ?? ""} ${
        chosen ? "ring-2 ring-current" : ""
      }`}
    >
      <span className="sr-only">
        {`${platform}, ${when}. ${state.word}. ${clip(entry.caption, 80)}${
          chosen ? " — open below." : ""
        }`}
      </span>
      <span aria-hidden="true" className="block">
        <span className="flex items-baseline gap-1.5 text-caption font-medium">
          <span aria-hidden="true">{state.glyph}</span>
          <span className="tabular-nums whitespace-nowrap">{when}</span>
          <span className="truncate">
            {detail === "full" ? platform : platformShort(entry.platform)}
          </span>
        </span>
        {detail === "full" && (
          <span className="mt-0.5 block text-caption">
            {state.word}
            {entry.agentName === null ? "" : ` · drafted by ${entry.agentName}`}
          </span>
        )}
        {/* Clamped only in the month grid, and only where the cell is a
            seventh of the page wide. On a phone the same cell is the full
            width and the caption is the thing she is reading. `max-sm:block`
            rather than a plain `block`: `line-clamp` sets its own display, and
            the two must never be asked to apply at once. */}
        <span
          className={`mt-0.5 text-caption ${
            detail === "compact" ? "max-sm:block sm:line-clamp-2" : "block"
          }`}
        >
          {entry.caption}
        </span>
      </span>
    </Link>
  );
}

/** One day: its date, what is on it, and nothing invented when it is empty. */
function DayCell({
  day,
  entries,
  today,
  inFocus,
  chosenPost,
  view,
  anchor,
  detail,
  className = "",
}: {
  day: NzDay;
  entries: readonly CalendarEntry[];
  today: NzDay;
  /** False for the days of a neighbouring month showing at the edge of a grid. */
  inFocus: boolean;
  chosenPost: string | null;
  view: CalendarView;
  /**
   * The day the page is centred on, carried into every link so that opening a
   * post does not also move the calendar. A post in the trailing week of the
   * grid belongs to next month, and clicking it should show it, not navigate.
   */
  anchor: NzDay;
  detail: "compact" | "full";
  className?: string;
}) {
  const isToday = day === today;
  return (
    <li
      className={`bg-surface-raised p-2 max-sm:rounded-md max-sm:border max-sm:border-hairline ${
        inFocus ? "" : "sm:bg-surface-page"
      } ${className}`}
    >
      <p className="flex items-baseline justify-between gap-2">
        <span
          aria-hidden="true"
          className={`text-caption font-medium ${inFocus ? "text-primary" : "text-muted"}`}
        >
          {`${weekdayShort(day)} ${String(dayOfMonth(day))}`}
          {dayOfMonth(day) === 1 || !inFocus ? ` ${monthInShort(day)}` : ""}
        </span>
        <span className="sr-only">{dayInWords(day)}</span>
        {isToday && (
          <span className="rounded-pill border border-accent-edge bg-surface-accent px-1.5 py-0.5 text-caption leading-none font-medium text-on-accent">
            Today
          </span>
        )}
      </p>
      {entries.length === 0 ? (
        <p className="mt-1 text-caption text-muted">
          <span aria-hidden="true">&mdash;</span>
          <span className="sr-only">Nothing in the diary</span>
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {entries.map((entry) => (
            <li key={entry.id}>
              <EntryChip
                entry={entry}
                href={calendarHref({ view, on: anchor, post: entry.id })}
                chosen={entry.id === chosenPost}
                detail={detail}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The sentence that replaces a run of empty cells on a narrow screen. */
function GapNote({ from, to }: { from: NzDay; to: NzDay }) {
  const days = daysBetween(from, to) + 1;
  return (
    <li className="rounded-md border border-dashed border-hairline px-3 py-2 text-caption text-muted sm:hidden">
      {days === 1
        ? `Nothing on ${dayInWords(from)}.`
        : `Nothing from ${dayInWords(from)} to ${dayInWords(to)} — ${plural(days, "day")}.`}
    </li>
  );
}

/* ------------------------------------------------------------ the two views */

const WEEKDAY_HEADER =
  "hidden grid-cols-7 gap-px border-b border-hairline bg-hairline sm:grid";

/**
 * A month, on whole Monday-first weeks.
 *
 * Above `sm` this is a seven-column grid and every day of it is drawn,
 * including the empty ones, because the shape of an empty fortnight is the
 * thing worth seeing. Below `sm` the empty days fold away and
 * {@link GapNote} says what was there in a sentence, because seven columns at
 * 390px is six columns of nothing and one column of truncation.
 */
export function CalendarMonth({
  days,
  entries,
  today,
  focus,
  chosenPost,
}: {
  days: readonly NzDay[];
  entries: ReadonlyMap<NzDay, readonly CalendarEntry[]>;
  today: NzDay;
  /** A day in the month being shown, for deciding which cells are its own. */
  focus: NzDay;
  chosenPost: string | null;
}) {
  const month = focus.slice(0, 7);
  // A day is kept on a narrow screen when it has something on it, or when it
  // is today — losing today would lose her place in the list entirely.
  const shown = (day: NzDay): boolean =>
    (entries.get(day)?.length ?? 0) > 0 || day === today;
  const cells: ReactNode[] = [];
  let gapFrom: NzDay | null = null;
  for (const day of days) {
    if (!shown(day)) {
      gapFrom ??= day;
    } else if (gapFrom !== null) {
      cells.push(
        <GapNote key={`gap-${gapFrom}`} from={gapFrom} to={addDays(day, -1)} />,
      );
      gapFrom = null;
    }
    cells.push(
      <DayCell
        key={day}
        day={day}
        entries={entries.get(day) ?? []}
        today={today}
        inFocus={day.slice(0, 7) === month}
        chosenPost={chosenPost}
        view="month"
        anchor={focus}
        detail="compact"
        className={`sm:min-h-28 ${shown(day) ? "" : "max-sm:hidden"}`}
      />,
    );
  }
  if (gapFrom !== null) {
    const last = days.at(-1);
    if (last !== undefined) {
      cells.push(<GapNote key={`gap-${gapFrom}`} from={gapFrom} to={last} />);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg sm:border sm:border-hairline">
      <div className={WEEKDAY_HEADER} aria-hidden="true">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => (
          <p
            key={name}
            className="bg-surface-sunken px-2 py-1.5 text-caption font-medium text-muted"
          >
            {name}
          </p>
        ))}
      </div>
      <ol className="grid gap-2 sm:grid-cols-7 sm:gap-px sm:bg-hairline">
        {cells}
      </ol>
    </div>
  );
}

/**
 * A week, as seven rows.
 *
 * Not seven columns: a week is where she goes for the detail, and a row that
 * runs the width of the page can carry the platform in full, the state in
 * words and who drafted it. The month is the shape; the week is the reading.
 */
export function CalendarWeek({
  days,
  entries,
  today,
  anchor,
  chosenPost,
}: {
  days: readonly NzDay[];
  entries: ReadonlyMap<NzDay, readonly CalendarEntry[]>;
  today: NzDay;
  /** The day the page is centred on, carried into every link. */
  anchor: NzDay;
  chosenPost: string | null;
}) {
  return (
    <ol className="overflow-hidden rounded-lg border border-hairline bg-hairline">
      {days.map((day, index) => (
        <DayCell
          key={day}
          day={day}
          entries={entries.get(day) ?? []}
          today={today}
          inFocus
          chosenPost={chosenPost}
          view="week"
          anchor={anchor}
          detail="full"
          className={`px-3 py-2.5 max-sm:rounded-none max-sm:border-0 ${index === 0 ? "" : "border-t border-hairline"}`}
        />
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------------- the words */

/**
 * What is booked, and where the holes are — the sentence version.
 *
 * This sits above the grid on every width, because it is the answer to the
 * question she came with. The grid is how she checks it.
 */
export function GapSummary({
  days,
  entries,
  today,
  periodWords,
}: {
  days: readonly NzDay[];
  entries: ReadonlyMap<NzDay, readonly CalendarEntry[]>;
  today: NzDay;
  /** "September 2026", or "the week of Monday 31 August". */
  periodWords: string;
}) {
  const busy = new Set(
    days.filter((day) => (entries.get(day)?.length ?? 0) > 0),
  );
  const total = days.reduce(
    (sum, day) => sum + (entries.get(day)?.length ?? 0),
    0,
  );
  const ahead = days.filter((day) => day >= today);
  const runs = emptyRuns(ahead, busy);
  const worst = longestRun(runs);
  const next = ahead
    .flatMap((day) => entries.get(day) ?? [])
    .find((entry) => !entry.done);

  return (
    <Callout title={`What is booked in ${periodWords}`}>
      <p>
        {total === 0
          ? `Nothing at all is in the diary for ${periodWords}. That is a normal state for a calendar nobody has filled in yet, not a fault.`
          : `${plural(total, "post")} across ${plural(busy.size, "day")} of the ${String(days.length)} shown.`}
      </p>
      <p className="mt-1.5">
        {next === undefined
          ? "Nothing is booked ahead. The next thing that goes out is the next thing you or Vinnie writes."
          : `Next out: ${dayInWords(next.day)} at ${time(next.instant)} on ${platformWord(next.platform)}.`}
      </p>
      {worst !== null && worst.days > 1 && (
        <p className="mt-1.5">
          {`The longest quiet run still ahead is ${plural(worst.days, "day")}: nothing from ${dayInWords(worst.from)} to ${dayInWords(worst.to)}.`}
        </p>
      )}
    </Callout>
  );
}

/** What each shape on the grid means. Shown once, under the calendar. */
export function StateLegend({ used }: { used: readonly string[] }) {
  const states = Object.entries(POST_STATES).filter(([status]) =>
    used.includes(status),
  );
  if (states.length === 0) return null;
  return (
    <div className="rounded-lg border border-hairline bg-surface-raised px-4 py-3">
      <h3 className="text-eyebrow uppercase text-muted">What the marks mean</h3>
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {states.map(([status, state]) => (
          <div key={status} className="flex gap-2">
            <dt className="shrink-0 text-caption font-medium text-primary">
              <span aria-hidden="true" className="mr-1.5">
                {state.glyph}
              </span>
              {state.word}
            </dt>
            <dd className="min-w-0 text-caption text-muted">{state.means}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Posts that exist and are on no calendar at all. */
export function UndatedPosts({
  posts,
  children,
}: {
  posts: readonly SocialPostItem[];
  /** The control that gives one a time, rendered by the page that owns it. */
  children: (post: SocialPostItem) => ReactNode;
}) {
  if (posts.length === 0) {
    return (
      <EmptyState
        headline="Everything written has a date on it"
        fills="A draft with no time, or a post the platform refused, would appear here so it does not sit in the database unseen."
      >
        Nothing is written down without a day against it.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-hairline">
      {posts.map((post) => {
        const state = stateOf(post.status);
        return (
          <li key={post.id} className="px-4 py-3 first:pt-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="min-w-0 text-body-sm text-primary">
                {clip(post.caption, 120)}
              </p>
              <Badge tone={state.tone}>
                <span aria-hidden="true">{state.glyph}</span>
                {state.word}
              </Badge>
            </div>
            <p className="mt-1 text-caption text-muted">
              {platformWord(post.platform)}
              {post.agentName === null ? "" : ` · drafted by ${post.agentName}`}
              {post.error === null ? "" : ` · ${post.error}`}
            </p>
            <div className="mt-2.5">{children(post)}</div>
          </li>
        );
      })}
    </ul>
  );
}

/** The month and week switch, and the step backwards and forwards. */
export function CalendarControls({
  view,
  on,
  previous,
  next,
  today,
  label,
}: {
  view: CalendarView;
  on: NzDay;
  previous: NzDay;
  next: NzDay;
  today: NzDay;
  /** What the step moves by, in her words: "month" or "week". */
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Month or week" className="flex gap-1.5">
        <ViewLink
          href={calendarHref({ view: "month", on })}
          current={view === "month"}
        >
          Month
        </ViewLink>
        <ViewLink
          href={calendarHref({ view: "week", on })}
          current={view === "week"}
        >
          Week
        </ViewLink>
      </nav>
      <nav aria-label={`Move by a ${label}`} className="flex gap-1.5">
        <ViewLink href={calendarHref({ view, on: previous })} current={false}>
          <span aria-hidden="true">&#8249;</span>
          <span>{`Previous ${label}`}</span>
        </ViewLink>
        <ViewLink
          href={calendarHref({ view, on: today })}
          current={on === today}
        >
          Today
        </ViewLink>
        <ViewLink href={calendarHref({ view, on: next })} current={false}>
          <span>{`Next ${label}`}</span>
          <span aria-hidden="true">&#8250;</span>
        </ViewLink>
      </nav>
    </div>
  );
}

function ViewLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 py-1.5 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current sm:min-h-0 sm:py-1 ${
        current
          ? "border-strong bg-surface-sunken text-primary"
          : "border-hairline text-primary hover:bg-surface-sunken"
      }`}
    >
      {children}
    </Link>
  );
}

/** The title over the grid: "September 2026" or the week it runs across. */
export function periodTitle(
  view: CalendarView,
  days: readonly NzDay[],
  on: NzDay,
): string {
  if (view === "month") return monthTitle(on);
  const first = days[0];
  const last = days.at(-1);
  if (first === undefined || last === undefined) return monthTitle(on);
  return `${dayInShort(first)} to ${dayInShort(last)}`;
}

/** The same period, in the voice the sentences above the grid use. */
export function periodWords(
  view: CalendarView,
  days: readonly NzDay[],
  on: NzDay,
): string {
  return view === "month"
    ? monthTitle(on)
    : `the week of ${dayInWords(days[0] ?? on)}`;
}
