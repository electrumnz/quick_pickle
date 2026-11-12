import type { Metadata } from "next";
import Link from "next/link";

import { ActivityList } from "@/components/backstage/ActivityList";
import { TestPill } from "@/components/backstage/orders";
import {
  Empty,
  PageHeader,
  Panel,
  Stat,
  When,
} from "@/components/backstage/ui";
import { UNCONFIRMED } from "@/content/offer";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { countCrew } from "@/lib/backstage/crew/ops";
import { countOrders, listOrders } from "@/lib/backstage/orders/ops";
import { nzParts } from "@/lib/time";

export const metadata: Metadata = { title: "Today" };

function greeting(now: Date): string {
  const hour = nzParts(now).hour;
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
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
  const [lines, counts, toPack, crew] = await Promise.all([
    execute(listActivity, { limit: 12 }, caller),
    execute(countOrders, {}, caller),
    execute(listOrders, { status: "paid", limit: 8 }, caller),
    execute(countCrew, {}, caller),
  ]);
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
