import type { Metadata } from "next";
import Link from "next/link";

import { ActivityList } from "@/components/backstage/ActivityList";
import { PageHeader, Panel } from "@/components/backstage/ui";
import { UNCONFIRMED } from "@/content/offer";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
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
  const lines = await execute(listActivity, { limit: 12 }, await staffCaller());
  const firstName = staff.name.split(" ")[0] ?? staff.name;

  return (
    <>
      <PageHeader
        title={`${greeting(now)}, ${firstName}.`}
        lead="What needs you, and what has been happening."
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
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
