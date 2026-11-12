import Link from "next/link";
import type { ReactNode } from "react";

import type { Takings } from "@/lib/backstage/marketing/collab-sums";
import type { CollabRow } from "@/lib/backstage/marketing/collabs";
import { plural } from "@/lib/backstage/marketing/shared";
import { formatNzd, formatNzdExact } from "@/lib/shop/money";

/**
 * Small parts for showing what a code, a link or a partner has brought in.
 * Server components, no state. The sums themselves are in
 * lib/backstage/marketing/collab-sums.ts.
 */

/** "$3.79" from 379: sales back for each dollar spent. */
export function perDollar(cents: number): string {
  return formatNzdExact(cents);
}

/** One figure with its name over it, for a row of three or four. */
export function Figure({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly note?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="label bk-muted text-[0.95rem] leading-none">
        <span className="cap-trim">{label}</span>
      </p>
      <p className="varsity mt-1.5 text-[1.6rem] leading-none tabular-nums">
        {value}
      </p>
      {note ? (
        <p className="bk-muted mt-1 text-[0.875rem] leading-snug">{note}</p>
      ) : null}
    </div>
  );
}

/**
 * What a set of sales adds up to, as a short list. `brief` leaves out the
 * orders and the sales, for where they are already the headline above it.
 */
export function TakingsList({
  takings,
  discountLabel = "Taken off by promo codes",
  brief = false,
}: {
  readonly takings: Takings;
  readonly discountLabel?: string;
  readonly brief?: boolean;
}) {
  return (
    <dl className="bk-kv">
      {brief ? null : (
        <>
          <dt>Paid orders</dt>
          <dd>{takings.orders}</dd>
          <dt>Sales</dt>
          <dd>{formatNzdExact(takings.salesCents)}</dd>
        </>
      )}
      <dt>{discountLabel}</dt>
      <dd>{formatNzdExact(takings.discountCents)}</dd>
      <dt>New customers</dt>
      <dd>
        {takings.orders === 0
          ? "None yet"
          : `${String(takings.newCustomers)} of ${plural(takings.orders, "order")}`}
      </dd>
    </dl>
  );
}

/** The small print under any of these figures. Always the same. */
export function SalesSmallPrint({
  children,
}: {
  readonly children?: ReactNode;
}) {
  return (
    <p className="bk-muted mt-4 text-[0.9375rem] leading-snug">
      Sales are what customers paid, delivery included, less anything refunded.
      Test orders and cancelled ones are left out. {children}
    </p>
  );
}

/**
 * Every collab side by side, biggest sales first: one line each, saying what
 * came in, what it cost and what came back.
 */
export function CollabBoard({ rows }: { readonly rows: readonly CollabRow[] }) {
  return (
    <ul className="bk-rows">
      {rows.map((row) => (
        <li key={row.partnerId}>
          <Link
            href={`/backstage/marketing/partners/${row.partnerId}`}
            className="bk-row grid-cols-[1fr_auto]"
          >
            <span className="min-w-0">
              <span className="block font-semibold [overflow-wrap:anywhere]">
                {row.name}
              </span>
              <span className="bk-muted block text-[0.9375rem]">
                {row.orders === 0
                  ? "No paid orders yet"
                  : `${plural(row.orders, "paid order")}, ${formatNzd(row.salesCents)} in sales`}
                {row.spendCents === 0
                  ? ", nothing spent"
                  : `, cost ${formatNzd(row.spendCents)}`}
                {row.cutOwingCents > 0
                  ? `, ${formatNzdExact(row.cutOwingCents)} of their cut still to pay`
                  : ""}
              </span>
            </span>
            <span className="bk-num text-right">
              {row.backPerDollarCents === null ? (
                <span className="bk-muted">No return yet</span>
              ) : (
                <>
                  <span className="block font-semibold">
                    {perDollar(row.backPerDollarCents)}
                  </span>
                  <span className="bk-muted block text-[0.875rem]">
                    back per $1
                  </span>
                </>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
