import type { Metadata } from "next";
import Link from "next/link";

import { ActivityList } from "@/components/backstage/ActivityList";
import { TestPill } from "@/components/backstage/orders";
import {
  Empty,
  PageHeader,
  Panel,
  Pill,
  Stat,
  When,
} from "@/components/backstage/ui";
import { UNCONFIRMED } from "@/content/offer";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { countCrew } from "@/lib/backstage/crew/ops";
import { numbersToday, type DayNumbers } from "@/lib/backstage/numbers/ops";
import { countOrders, listOrders } from "@/lib/backstage/orders/ops";
import { needsYou } from "@/lib/backstage/today/ops";
import { formatNzdExact } from "@/lib/shop/money";
import { nzParts } from "@/lib/time";

export const metadata: Metadata = { title: "Today" };

function greeting(now: Date): string {
  const hour = nzParts(now).hour;
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

/**
 * A day's sales and visits as a few words: "3 orders worth $156.00 and 41
 * visits". Visits are left out until the shop has counted its first one, so
 * a counter that is not running yet never reads as an empty shop.
 */
function dayInWords(
  day: DayNumbers,
  options: { readonly soFar: boolean; readonly countVisits: boolean },
): string {
  const sold =
    day.orders === 0
      ? options.soFar
        ? "no orders yet"
        : "no orders"
      : `${String(day.orders)} ${day.orders === 1 ? "order" : "orders"} worth ${formatNzdExact(day.salesCents)}`;
  if (!options.countVisits) return sold;
  return `${sold} and ${String(day.visits)} ${day.visits === 1 ? "visit" : "visits"}`;
}

/**
 * Today: what needs a person now, and what happened while they were away.
 * Each area of the back end adds its own "waiting on you" block here as it
 * is built.
 */
export default async function TodayPage() {
  const staff = await requireStaff("/backstage");
  const now = new Date();
  const caller = await staffCaller();
  const [lines, counts, toPack, crew, needs, soFar] = await Promise.all([
    execute(listActivity, { limit: 12 }, caller),
    execute(countOrders, {}, caller),
    execute(listOrders, { status: "paid", limit: 8 }, caller),
    execute(countCrew, {}, caller),
    execute(needsYou, {}, caller),
    execute(numbersToday, {}, caller),
  ]);
  const countVisits = !soFar.noVisitsYet;
  const firstName = staff.name.split(" ")[0] ?? staff.name;

  return (
    <>
      <PageHeader
        title={`${greeting(now)}, ${firstName}.`}
        lead="What needs you, and what has been happening."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Stat
          label="To pack"
          value={counts.paid}
          note={counts.paid === 0 ? "All caught up" : "Paid and waiting"}
        />
        <Stat
          label="Packed"
          value={counts.packed}
          note="Waiting for the courier"
        />
        <Stat
          label="On the way"
          value={counts.shipped}
          note="With the courier"
        />
        <Stat
          label="Pickle Crew"
          value={crew.subscribed}
          note="On the mailing list"
        />
      </div>

      {/* The pulse, in two lines. Sales are paid orders less refunds; visits
          are the shop's own count. The working is on the Numbers screen. */}
      <div className="mb-6">
        <Panel>
          <p className="leading-snug" data-testid="today-so-far">
            <strong>Today so far:</strong>{" "}
            {dayInWords(soFar.today, { soFar: true, countVisits })}.
          </p>
          <p className="bk-muted mt-1 text-[0.9375rem] leading-snug">
            Yesterday:{" "}
            {dayInWords(soFar.yesterday, { soFar: false, countVisits })}.{" "}
            <Link href="/backstage/numbers" className="link">
              All the numbers
            </Link>
          </p>
        </Panel>
      </div>

      {/* Only there when something is: the things that will not sort
          themselves out. Packing, the ordinary work, has its own block. */}
      {needs.length > 0 ? (
        <div className="mb-6">
          <Panel title="Needs you" flush>
            <ul className="bk-rows">
              {needs.map((need) => (
                <li key={need.key}>
                  <Link href={need.href} className="bk-row grid-cols-1">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {need.title}
                      {need.urgent ? <Pill tone="todo">Now</Pill> : null}
                    </span>
                    <span className="bk-muted text-[0.9375rem] leading-snug">
                      {need.detail}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel
            title="To pack"
            flush
            aside={
              <Link href="/backstage/orders" className="link text-[0.9375rem]">
                All orders
              </Link>
            }
          >
            {toPack.length === 0 ? (
              <Empty title="Nothing to pack">
                When someone orders, it lands here.
              </Empty>
            ) : (
              <ul className="bk-rows">
                {toPack.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/backstage/orders/${order.number}`}
                      className="bk-row grid-cols-[1fr_auto]"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
                          {order.number}
                          <TestPill show={order.isTest} />
                        </span>
                        <span className="bk-muted block truncate text-[0.9375rem]">
                          {order.name}, {order.city} · {order.items}
                        </span>
                      </span>
                      <span className="bk-muted text-[0.9375rem] whitespace-nowrap">
                        <When at={order.placedAt} now={now} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="While you were away" flush>
            <ActivityList
              lines={lines}
              now={now}
              empty="Nothing has been done in the back end yet. Every change anyone makes will show up here."
            />
            <p className="border-navy-line border-t px-4 py-3">
              <Link href="/backstage/settings/activity" className="link">
                The whole activity log
              </Link>
            </p>
          </Panel>
        </div>

        <Panel title="Before launch">
          <p className="leading-snug">
            {UNCONFIRMED.length === 0
              ? "Every fact on the site is confirmed."
              : `${String(UNCONFIRMED.length)} fact${UNCONFIRMED.length === 1 ? "" : "s"} on the site ${UNCONFIRMED.length === 1 ? "is" : "are"} still a stand-in. Until they are confirmed the shop stays out of search.`}
          </p>
          <p className="mt-4">
            <Link
              href="/backstage/settings/go-live"
              className="bk-btn bk-btn-quiet"
            >
              <span className="cap-trim">Open the go-live list</span>
            </Link>
          </p>
        </Panel>
      </div>
    </>
  );
}
