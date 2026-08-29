import { day, money, plural } from "../data/format";

/**
 * Fourteen days of takings, as one strip.
 *
 * One series, so there is no legend — the caption names it. The bars carry
 * magnitude and nothing else: no second axis, no colour coding, no number on
 * every bar. The best day is labelled and the rest are read against it, which
 * is the only comparison this strip is for.
 *
 * A day with no orders is drawn as a baseline tick rather than as nothing, so
 * "quiet Tuesday" and "no data" cannot be confused. When *every* day is quiet
 * the chart is replaced by a sentence, because an empty chart says nothing
 * twice.
 */
export function TakingsStrip({
  days,
  granularity = "day",
  className = "",
}: {
  days: readonly {
    readonly date: string;
    readonly takingsCents: number;
    readonly orders: number;
  }[];
  /** Whether one bar is a day or a week. Only the words change. */
  granularity?: "day" | "week";
  className?: string;
}) {
  const unit = granularity === "week" ? "week" : "day";
  const peak = days.reduce(
    (max, entry) => Math.max(max, entry.takingsCents),
    0,
  );
  const total = days.reduce((sum, entry) => sum + entry.takingsCents, 0);
  const busiest = days.reduce(
    (best, entry) => (entry.takingsCents > best.takingsCents ? entry : best),
    days[0] ?? { date: "", takingsCents: 0, orders: 0 },
  );

  if (peak === 0) {
    return (
      <div className={className}>
        <p className="text-body-sm text-primary">No orders in this period.</p>
        <p className="mt-1 text-caption text-muted">
          This fills in on its own: every order placed through the shop appears
          here the moment it is paid for.
        </p>
      </div>
    );
  }

  return (
    <figure className={className}>
      <div className="flex h-16 items-end gap-[2px]" role="presentation">
        {days.map((entry) => {
          const height =
            entry.takingsCents === 0
              ? 2
              : Math.max(4, Math.round((entry.takingsCents / peak) * 64));
          const quiet = entry.takingsCents === 0;
          return (
            <div
              key={entry.date}
              title={`${granularity === "week" ? `Week of ${day(entry.date)}` : day(entry.date)}: ${money(entry.takingsCents)} from ${plural(entry.orders, "order")}`}
              className={`min-w-0 flex-1 rounded-t-sm ${
                quiet ? "bg-strong/40" : "bg-accent-secondary"
              }`}
              style={{ blockSize: `${String(height)}px` }}
            />
          );
        })}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-caption text-muted">
        <span>
          {day(days[0]?.date ?? "")} to {day(days[days.length - 1]?.date ?? "")}
        </span>
        <span>
          Best {unit} {day(busiest.date)}, {money(busiest.takingsCents)}
        </span>
      </figcaption>
      <p className="sr-only">
        Takings by {unit} across {String(days.length)} {unit}s, totalling{" "}
        {money(total)}.
      </p>
    </figure>
  );
}
