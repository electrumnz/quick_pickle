import type { Metadata } from "next";
import Link from "next/link";

import { Notice, PageHeader, Panel, Stat } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { dayLabel, shortDateLabel } from "@/lib/backstage/marketing/dates";
import {
  numbersSummary,
  type DayRow,
  type Funnel,
} from "@/lib/backstage/numbers/ops";
import { formatNzd, formatNzdExact } from "@/lib/shop/money";

export const metadata: Metadata = { title: "Numbers" };

/**
 * Numbers: what came in, how many came by, and how far they got.
 *
 * Every figure on this page comes from one read (numbers.summary) for one
 * stretch of days, so they always agree with each other. The range is chosen
 * once, at the top, and everything under it follows.
 *
 * The charts are drawn by the server as plain boxes: no script, and the same
 * with scripting off. Each has its numbers as a table underneath, so nothing
 * is only readable by hovering or by telling colours apart. One colour of
 * mark throughout (the brand pink, checked against the paper it sits on);
 * the words stay in ink.
 */

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

const count = (value: number) => value.toLocaleString("en-NZ");

/** "up 18% on the 30 days before", in words, or why there is nothing to say. */
function against(now: number, before: number, days: number): string {
  const span = `the ${String(days)} days before`;
  if (before === 0) {
    return now === 0 ? `None in ${span} either.` : `None in ${span}.`;
  }
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return `About the same as ${span}.`;
  // Past a few hundred percent a figure says nothing a person can use.
  if (change > 400) return `Many times ${span}.`;
  return `${change > 0 ? "Up" : "Down"} ${String(Math.abs(change))}% on ${span}.`;
}

/** How many of every hundred. Whole numbers: this is a tally, not a science. */
const per100 = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

function funnelInWords(funnel: Funnel): string {
  if (funnel.visits === 0) return "No visits were counted in this time.";
  return `Of every 100 visits, ${String(per100(funnel.added, funnel.visits))} put something in the jar, ${String(per100(funnel.checkout, funnel.visits))} opened the checkout and ${String(per100(funnel.ordered, funnel.visits))} placed an order.`;
}

/** One step of the funnel: its name, a bar against all visits, its figure. */
function Step({
  name,
  value,
  of,
  share,
}: {
  readonly name: string;
  readonly value: number;
  /** All visits: what the bar is drawn against. */
  readonly of: number;
  /** "52% of the step before", or nothing for the first step. */
  readonly share?: string;
}) {
  const width =
    of === 0 ? 0 : Math.max(value === 0 ? 0 : 1, (value / of) * 100);
  return (
    <li className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1.5">
      <span className="font-semibold">{name}</span>
      <span className="text-right tabular-nums">
        <span className="font-semibold">{count(value)}</span>
        {share ? (
          <span className="bk-muted ml-2 text-[0.875rem]">{share}</span>
        ) : null}
      </span>
      {/* The track is a lighter step of the bar's own colour. */}
      <span
        aria-hidden="true"
        className="bg-blush col-span-2 block h-3 overflow-hidden rounded-r-[4px]"
      >
        <span
          className="bg-pink block h-full rounded-r-[4px]"
          style={{ width: `${String(width)}%` }}
        />
      </span>
    </li>
  );
}

type Column = {
  readonly key: string;
  /** What it covers, said in full: "Thu 12 Nov", "Week of 2 Nov". */
  readonly name: string;
  readonly visits: number;
  readonly orders: number;
  readonly salesCents: number;
};

/** A day each, or a week each once there are too many days to read. */
function columnsOf(daily: readonly DayRow[]): Column[] {
  if (daily.length <= 31) {
    return daily.map((day) => ({
      key: day.day,
      name: dayLabel(day.day),
      visits: day.visits,
      orders: day.orders,
      salesCents: day.salesCents,
    }));
  }
  const weeks: Column[] = [];
  for (let from = 0; from < daily.length; from += 7) {
    const days = daily.slice(from, from + 7);
    const first = days[0];
    if (first === undefined) continue;
    weeks.push({
      key: first.day,
      name: `Week of ${shortDateLabel(first.day)}`,
      visits: days.reduce((sum, day) => sum + day.visits, 0),
      orders: days.reduce((sum, day) => sum + day.orders, 0),
      salesCents: days.reduce((sum, day) => sum + day.salesCents, 0),
    });
  }
  return weeks;
}

/**
 * A round number at or above the biggest value, for the top of the scale,
 * and always one whose half is a whole number: these are counts, and a line
 * marked 2.5 orders would be nonsense.
 */
function ceiling(max: number): number {
  if (max <= 2) return 2;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [2, 4, 10, 20]) {
    if (max <= step * power) return step * power;
  }
  return 20 * power;
}

/**
 * Columns over time, one series. Thin bars from one baseline, rounded at the
 * data end, with air between them. The scale says the top and the half-way
 * mark; hovering a column names it and gives its value; the table under the
 * charts has every figure.
 */
function Columns({
  title,
  columns,
  value,
  unit,
  total,
}: {
  readonly title: string;
  readonly columns: readonly Column[];
  readonly value: (column: Column) => number;
  /** "visits", "paid orders": for the hover line and the summary. */
  readonly unit: string;
  /**
   * The figure for the whole stretch, as the top of the page gives it. Not
   * added up from the columns: a visit that runs past midnight is in two
   * days and is still one visit.
   */
  readonly total: number;
}) {
  const values = columns.map(value);
  const top = ceiling(Math.max(...values, 0));
  const first = columns[0];
  const last = columns[columns.length - 1];
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="label text-[1.05rem]">
          <span className="cap-trim">{title}</span>
        </span>
        <span className="bk-muted text-[0.9375rem] tabular-nums">
          {count(total)} in all
        </span>
      </figcaption>
      <div
        role="img"
        aria-label={`${title}: ${count(total)} ${unit} from ${first?.name ?? ""} to ${last?.name ?? ""}. The table below has each figure.`}
        className="mt-3 grid grid-cols-[2.25rem_1fr] gap-x-2"
      >
        <div
          aria-hidden="true"
          className="bk-muted relative h-28 text-right text-[0.75rem] tabular-nums"
        >
          <span className="absolute top-0 right-0 -translate-y-1/2">
            {count(top)}
          </span>
          <span className="absolute top-1/2 right-0 -translate-y-1/2">
            {count(top / 2)}
          </span>
          <span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
        </div>
        <div className="relative h-28">
          {/* Hairlines at the top, half way and the baseline. */}
          <span
            aria-hidden="true"
            className="border-navy-line absolute inset-x-0 top-0 border-t"
          />
          <span
            aria-hidden="true"
            className="border-navy-line absolute inset-x-0 top-1/2 border-t"
          />
          <span
            aria-hidden="true"
            className="border-navy-line absolute inset-x-0 bottom-0 border-t"
          />
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {columns.map((column) => {
              const each = value(column);
              return (
                <div
                  key={column.key}
                  title={`${column.name}: ${count(each)} ${unit}`}
                  className="flex h-full min-w-0 flex-1 items-end justify-center"
                >
                  <span
                    className="bg-pink block w-full max-w-6 rounded-t-[4px]"
                    style={{
                      height: `${String(each === 0 ? 0 : Math.max(2, (each / top) * 100))}%`,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <span aria-hidden="true" />
        <div
          aria-hidden="true"
          className="bk-muted mt-1.5 flex justify-between text-[0.75rem]"
        >
          <span>{first?.name}</span>
          <span>{last?.name}</span>
        </div>
      </div>
    </figure>
  );
}

const SOURCE_NAME: Readonly<Record<string, string>> = {
  direct: "Typed in, or a bookmark",
};

export default async function NumbersPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireStaff();
  const { days: asked } = await searchParams;
  const days: Range = RANGES.find((range) => String(range) === asked) ?? 30;
  const numbers = await execute(numbersSummary, { days }, await staffCaller());
  const { sales, funnel, before } = numbers;
  const columns = columnsOf(numbers.daily);
  const phone = numbers.devices.find((row) => row.device === "phone");
  const desk = numbers.devices.find((row) => row.device === "desk");

  return (
    <>
      <PageHeader
        title="Numbers"
        lead={`What came in, how many came by and how far they got, from ${dayLabel(numbers.firstDay)} to ${dayLabel(numbers.lastDay)}.`}
      />

      <nav aria-label="How far back" className="mb-5">
        <ul className="flex flex-wrap gap-2">
          {RANGES.map((range) => (
            <li key={range}>
              <Link
                href={`/backstage/numbers?days=${String(range)}`}
                aria-current={range === days ? "page" : undefined}
                className={`bk-btn ${range === days ? "" : "bk-btn-quiet"}`}
              >
                <span className="cap-trim">Last {range} days</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {numbers.noVisitsYet ? (
        <div className="mb-5">
          <Notice>
            No visits have been counted yet. The counter is new: the visit
            figures fill in as people come by. Sales are from the orders
            themselves, so those are complete.
          </Notice>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Stat
          label="Sales"
          value={formatNzd(sales.salesCents)}
          note={against(sales.salesCents, before.salesCents, days)}
        />
        <Stat
          label="Paid orders"
          value={count(sales.orders)}
          note={
            sales.orders === 0
              ? against(0, before.orders, days)
              : `${count(sales.newCustomers)} from new customers, ${count(sales.returningCustomers)} from people who had bought before.`
          }
        />
        <Stat
          label="Average order"
          value={
            sales.orders === 0 ? "n/a" : formatNzdExact(sales.averageCents)
          }
          note="Sales over paid orders."
        />
        <Stat
          label="Visits"
          value={count(funnel.visits)}
          note={against(funnel.visits, before.visits, days)}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr] [&>*]:min-w-0">
        <Panel title="From a visit to an order">
          <p className="leading-snug">{funnelInWords(funnel)}</p>
          <ol className="mt-5 flex flex-col gap-4">
            <Step name="Saw a page" value={funnel.visits} of={funnel.visits} />
            <Step
              name="Put something in the jar"
              value={funnel.added}
              of={funnel.visits}
              share={`${String(per100(funnel.added, funnel.visits))}% of visits`}
            />
            <Step
              name="Opened the checkout"
              value={funnel.checkout}
              of={funnel.visits}
              share={`${String(per100(funnel.checkout, funnel.added))}% of those`}
            />
            <Step
              name="Placed an order"
              value={funnel.ordered}
              of={funnel.visits}
              share={`${String(per100(funnel.ordered, funnel.checkout))}% of those`}
            />
          </ol>
          <p className="bk-muted mt-5 text-[0.9375rem] leading-snug">
            A visit is one look at the shop, not one person: nobody is
            recognised from one visit to the next, there are no cookies, and a
            browser that asks not to be tracked is not counted. So these run a
            little low, and they count orders placed, where Sales above counts
            orders paid for.
          </p>
        </Panel>

        <Panel
          title={
            columns.length === numbers.daily.length
              ? "Day by day"
              : "Week by week"
          }
        >
          <div className="flex flex-col gap-7">
            <Columns
              title="Visits"
              columns={columns}
              value={(column) => column.visits}
              unit="visits"
              total={funnel.visits}
            />
            <Columns
              title="Paid orders"
              columns={columns}
              value={(column) => column.orders}
              unit="paid orders"
              total={sales.orders}
            />
          </div>
          <details className="mt-5">
            <summary className="label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]">
              <span className="cap-trim">The same as a table</span>
            </summary>
            <div
              className="bk-table-wrap mt-2"
              role="region"
              aria-label="Visits, paid orders and sales over time"
              tabIndex={0}
            >
              <table className="bk-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col" className="bk-num">
                      Visits
                    </th>
                    <th scope="col" className="bk-num">
                      Paid orders
                    </th>
                    <th scope="col" className="bk-num">
                      Sales
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((column) => (
                    <tr key={column.key}>
                      <th scope="row" className="font-normal">
                        {column.name}
                      </th>
                      <td className="bk-num">{count(column.visits)}</td>
                      <td className="bk-num">{count(column.orders)}</td>
                      <td className="bk-num">
                        {formatNzdExact(column.salesCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Panel>
      </div>

      <Panel title="Where visits came from" flush className="mt-6">
        {numbers.sources.length === 0 ? (
          <p className="bk-muted bk-panel-pad leading-snug">
            Nothing to show for this time.
          </p>
        ) : (
          <div
            className="bk-table-wrap"
            role="region"
            aria-label="Where visits came from"
            tabIndex={0}
          >
            <table className="bk-table">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col" className="bk-num">
                    Visits
                  </th>
                  <th scope="col" className="bk-num">
                    Paid orders
                  </th>
                  <th scope="col" className="bk-num">
                    Sales
                  </th>
                </tr>
              </thead>
              <tbody>
                {numbers.sources.map((source) => (
                  <tr key={source.label}>
                    <th
                      scope="row"
                      className="font-normal [overflow-wrap:anywhere]"
                    >
                      {source.label.startsWith("/go/") ? (
                        <>
                          <span className="font-mono font-semibold">
                            {source.label}
                          </span>
                          <span className="bk-muted block text-[0.875rem]">
                            One of our short links
                          </span>
                        </>
                      ) : (
                        (SOURCE_NAME[source.label] ?? source.label)
                      )}
                    </th>
                    <td className="bk-num">{count(source.visits)}</td>
                    <td className="bk-num">{count(source.orders)}</td>
                    <td className="bk-num">
                      {formatNzdExact(source.salesCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="bk-muted border-navy-line border-t-2 px-4 py-3 text-[0.9375rem] leading-snug md:px-6">
          Each visit is filed under the short link it followed or, failing that,
          the label on the advert it came from, or the website, or nothing at
          all. Biggest sales first.{" "}
          <Link href="/backstage/marketing/links" className="underline">
            Short links
          </Link>{" "}
          has the clicks on each link.
        </p>
      </Panel>

      {numbers.pages.length > 1 ? (
        <Panel title="Page by page" flush className="mt-6">
          <div
            className="bk-table-wrap"
            role="region"
            aria-label="Page by page"
            tabIndex={0}
          >
            <table className="bk-table">
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col" className="bk-num">
                    Visits
                  </th>
                  <th scope="col" className="bk-num">
                    Orders placed
                  </th>
                  <th scope="col" className="bk-num">
                    Per 100 visits
                  </th>
                  <th scope="col" className="bk-num">
                    Sales
                  </th>
                </tr>
              </thead>
              <tbody>
                {numbers.pages.map((page) => (
                  <tr key={page.page}>
                    <th scope="row" className="font-normal">
                      {page.page === "home" ? "The standard page" : page.page}
                    </th>
                    <td className="bk-num">{count(page.visits)}</td>
                    <td className="bk-num">{count(page.ordered)}</td>
                    <td className="bk-num">
                      {per100(page.ordered, page.visits)}
                    </td>
                    <td className="bk-num">
                      {formatNzdExact(page.salesCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr] [&>*]:min-w-0">
        <Panel title="Phones and desktops">
          {phone === undefined && desk === undefined ? (
            <p className="bk-muted leading-snug">
              Nothing to show for this time.
            </p>
          ) : (
            <dl className="bk-kv">
              <dt>On a phone</dt>
              <dd>
                {count(phone?.visits ?? 0)} visits, {count(phone?.ordered ?? 0)}{" "}
                orders placed
                <span className="bk-muted block text-[0.875rem]">
                  {per100(phone?.ordered ?? 0, phone?.visits ?? 0)} orders for
                  every 100 visits
                </span>
              </dd>
              <dt>On a bigger screen</dt>
              <dd>
                {count(desk?.visits ?? 0)} visits, {count(desk?.ordered ?? 0)}{" "}
                orders placed
                <span className="bk-muted block text-[0.875rem]">
                  {per100(desk?.ordered ?? 0, desk?.visits ?? 0)} orders for
                  every 100 visits
                </span>
              </dd>
            </dl>
          )}
        </Panel>

        <Panel title="The Pickle Crew">
          <dl className="bk-kv">
            <dt>Joined</dt>
            <dd>{count(numbers.crew.joined)}</dd>
            <dt>Left</dt>
            <dd>{count(numbers.crew.left)}</dd>
            <dt>On the list now</dt>
            <dd className="font-semibold">{count(numbers.crew.total)}</dd>
          </dl>
          <p className="mt-4">
            <Link href="/backstage/customers" className="underline">
              Customers and the crew list
            </Link>
          </p>
        </Panel>
      </div>
    </>
  );
}
