import type { Metadata } from "next";
import Link from "next/link";

import { Empty, Notice, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import {
  BOOKS_MOST_DAYS,
  booksRanges,
  booksSummary,
} from "@/lib/backstage/numbers/books";
import {
  daysBetween,
  formatDateKey,
  isDateKey,
} from "@/lib/backstage/stock/dates";
import { formatNzdExact } from "@/lib/shop/money";
import { nzDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "For the books" };

/**
 * For the books: what was charged and what was given back, by day, for
 * whoever keeps the accounts. The back end does no accounting; this is the
 * figures the accounts need from it.
 */
export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    notice?: string;
    tone?: string;
  }>;
}) {
  await requireStaff();
  const params = await searchParams;
  const today = nzDateKey(new Date());
  const ranges = booksRanges(today);
  const fallback = ranges[0] ?? { from: today, to: today };

  // An address somebody typed dates into is only believed if it makes sense.
  const asked =
    params.from !== undefined &&
    params.to !== undefined &&
    isDateKey(params.from) &&
    isDateKey(params.to) &&
    params.from <= params.to &&
    daysBetween(params.from, params.to) < BOOKS_MOST_DAYS;
  const from = asked ? (params.from ?? fallback.from) : fallback.from;
  const to = asked ? (params.to ?? fallback.to) : fallback.to;
  const refused =
    !asked && (params.from !== undefined || params.to !== undefined);

  const books = await execute(booksSummary, { from, to }, await staffCaller());
  const { total } = books;
  const money = formatNzdExact;
  /** An amount that came off, or a day that ended below nothing. */
  const less = (cents: number) =>
    cents === 0 ? money(0) : `-${money(Math.abs(cents))}`;
  const signed = (cents: number) => (cents < 0 ? less(cents) : money(cents));
  const span =
    from === to
      ? `On ${formatDateKey(from)}`
      : `From ${formatDateKey(from)} to ${formatDateKey(to)}`;

  return (
    <>
      <PageHeader
        title="For the books"
        back={{ href: "/backstage/numbers", label: "Numbers" }}
        lead="What customers were charged and what was given back, by day. For whoever keeps the accounts."
      />

      {params.notice ? (
        <div className="mb-4">
          <Notice tone={params.tone === "bad" ? "bad" : "good"}>
            {params.notice}
          </Notice>
        </div>
      ) : null}
      {refused ? (
        <div className="mb-4">
          <Notice tone="bad">
            Those dates could not be used, so this is this month. The first day
            has to be on or before the last, and a stretch can be{" "}
            {String(BOOKS_MOST_DAYS)} days at most.
          </Notice>
        </div>
      ) : null}

      <nav aria-label="Which days" className="mb-4">
        <ul className="flex flex-wrap gap-2">
          {ranges.map((range) => {
            const current = range.from === from && range.to === to;
            return (
              <li key={range.key}>
                <Link
                  href={`/backstage/numbers/books?from=${range.from}&to=${range.to}`}
                  aria-current={current ? "page" : undefined}
                  className={`bk-btn ${current ? "" : "bk-btn-quiet"}`}
                >
                  <span className="cap-trim">{range.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <form
        action="/backstage/numbers/books"
        method="get"
        className="mb-6 flex flex-wrap items-end gap-3"
      >
        <div>
          <label htmlFor="books-from" className="field-label">
            First day
          </label>
          <input
            id="books-from"
            name="from"
            type="date"
            defaultValue={from}
            max={today}
            required
            className="field"
          />
        </div>
        <div>
          <label htmlFor="books-to" className="field-label">
            Last day
          </label>
          <input
            id="books-to"
            name="to"
            type="date"
            defaultValue={to}
            max={today}
            required
            className="field"
          />
        </div>
        <button type="submit" className="bk-btn bk-btn-quiet">
          <span className="cap-trim">Show</span>
        </button>
      </form>

      <div className="flex flex-col gap-6">
        <Panel>
          <p
            className="text-[1.125rem] leading-snug font-semibold"
            data-testid="books-said"
          >
            {total.orders === 0 && total.refundedCents === 0
              ? `${span}: nothing was charged and nothing was given back.`
              : `${span}: ${money(total.chargedCents)} charged across ${String(total.orders)} order${total.orders === 1 ? "" : "s"}, ${money(total.refundedCents)} given back, ${signed(total.keptCents)} kept.`}
          </p>
          {books.waiting > 0 ? (
            <p className="mt-2 leading-snug">
              {String(books.waiting)} payment
              {books.waiting === 1 ? " is" : "s are"} waiting for somebody to
              look at {books.waiting === 1 ? "it" : "them"}, and{" "}
              {books.waiting === 1 ? "is" : "are"} not in these figures.{" "}
              <Link
                href="/backstage/orders?status=all"
                className="underline decoration-2 underline-offset-4"
              >
                Orders
              </Link>
            </p>
          ) : null}
        </Panel>

        <Panel title="Day by day" flush>
          {books.days.length === 0 ? (
            <Empty title="Nothing in these days">
              A sale shows on the day it was paid for, and a refund on the day
              it was given.
            </Empty>
          ) : (
            <div
              className="bk-table-wrap"
              // A box that scrolls has to be reachable from the keyboard.
              tabIndex={0}
              role="region"
              aria-label="Sales and refunds, day by day"
            >
              <table className="bk-table min-w-[44rem]">
                <caption className="sr-only">
                  Sales and refunds for each day, {span.toLowerCase()}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">
                      Day
                    </th>
                    <th scope="col" className="bk-num">
                      Orders
                    </th>
                    <th scope="col" className="bk-num">
                      Goods
                    </th>
                    <th scope="col" className="bk-num">
                      Discounts
                    </th>
                    <th scope="col" className="bk-num">
                      Delivery
                    </th>
                    <th scope="col" className="bk-num">
                      Charged
                    </th>
                    <th scope="col" className="bk-num">
                      Refunded
                    </th>
                    <th scope="col" className="bk-num">
                      Kept
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {books.days.map((day) => (
                    <tr key={day.day}>
                      <th scope="row" className="text-left font-normal">
                        {formatDateKey(day.day)}
                      </th>
                      <td className="bk-num">{String(day.orders)}</td>
                      <td className="bk-num">{money(day.goodsCents)}</td>
                      <td className="bk-num">{less(day.discountCents)}</td>
                      <td className="bk-num">{money(day.deliveryCents)}</td>
                      <td className="bk-num">{money(day.chargedCents)}</td>
                      <td className="bk-num">{less(day.refundedCents)}</td>
                      <td className="bk-num font-semibold">
                        {signed(day.keptCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="text-left">
                      Total
                    </th>
                    <td className="bk-num">{String(total.orders)}</td>
                    <td className="bk-num">{money(total.goodsCents)}</td>
                    <td className="bk-num">{less(total.discountCents)}</td>
                    <td className="bk-num">{money(total.deliveryCents)}</td>
                    <td className="bk-num">{money(total.chargedCents)}</td>
                    <td className="bk-num">{less(total.refundedCents)}</td>
                    <td className="bk-num font-semibold">
                      {signed(total.keptCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Take it with you">
          <p className="max-w-[44rem] leading-snug">
            Two files that open in a spreadsheet, for these same days.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {(
              [
                { kind: "days", label: "By day" },
                { kind: "orders", label: "By order" },
              ] as const
            ).map((file) => (
              <form
                key={file.kind}
                action="/backstage/numbers/books/file"
                method="post"
              >
                <input type="hidden" name="from" value={from} />
                <input type="hidden" name="to" value={to} />
                <input type="hidden" name="kind" value={file.kind} />
                <button type="submit" className="bk-btn">
                  <span className="cap-trim">Download: {file.label}</span>
                </button>
              </form>
            ))}
          </div>
          <p className="bk-muted mt-3 max-w-[44rem] text-[0.9375rem] leading-snug">
            By day is the table above. By order is a row for each order paid
            for, with the customer, the code used and the payment&apos;s own
            reference, for matching against a statement. It holds
            customers&apos; details, so making it is written in the activity
            log.
          </p>
        </Panel>

        <Panel title="How these are counted">
          <ul className="flex max-w-[46rem] list-disc flex-col gap-2 pl-5 leading-snug">
            <li>
              A sale counts on the day it was paid for, New Zealand time, for
              what the customer was charged. An order cancelled or refunded
              later is still a sale on that day.
            </li>
            <li>
              A refund counts on the day it was given, whenever the order was
              placed, and only once the money has gone back.
            </li>
            <li>Test orders are never counted.</li>
            <li>
              These are the amounts customers paid. If the business is
              registered for GST, three twenty-thirds of each amount is GST.
            </li>
            <li>
              A payment processor takes its fee before it pays out. That fee is
              on its own statement, not here.
            </li>
            <li>
              Nothing here goes to Xero by itself. Key the totals in, or hand
              the files to whoever does the books.
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
