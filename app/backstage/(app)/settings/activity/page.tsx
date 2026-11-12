import type { Metadata } from "next";

import { ActivityList } from "@/components/backstage/ActivityList";
import { PageHeader, Panel } from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";

export const metadata: Metadata = { title: "Activity log" };

const PAGE = 60;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; signins?: string }>;
}) {
  await requireStaff("/backstage/settings/activity");
  const { before, signins } = await searchParams;
  const now = new Date();
  const showSignIns = signins === "1";
  const beforeDate =
    before !== undefined && !Number.isNaN(Date.parse(before))
      ? new Date(before)
      : undefined;

  const lines = await execute(
    listActivity,
    { limit: PAGE, hideSignIns: !showSignIns, before: beforeDate },
    await staffCaller(),
  );
  const last = lines[lines.length - 1];
  const query = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, value);
    }
    const text = search.toString();
    return `/backstage/settings/activity${text === "" ? "" : `?${text}`}`;
  };

  return (
    <>
      <PageHeader
        title="Activity log"
        lead="Every change made in the back end, newest first. Nothing here can be edited or removed."
        back={{ href: "/backstage/settings", label: "Settings" }}
        actions={
          <a
            href={query({ signins: showSignIns ? undefined : "1" })}
            className="bk-btn bk-btn-quiet"
          >
            <span className="cap-trim">
              {showSignIns ? "Hide sign-ins" : "Show sign-ins"}
            </span>
          </a>
        }
      />
      <Panel flush>
        <ActivityList lines={lines} now={now} />
      </Panel>
      <p className="mt-4 flex flex-wrap gap-2">
        {beforeDate !== undefined ? (
          <a
            href={query({ signins: showSignIns ? "1" : undefined })}
            className="bk-btn bk-btn-quiet"
          >
            <span className="cap-trim">Back to newest</span>
          </a>
        ) : null}
        {lines.length === PAGE && last !== undefined ? (
          <a
            href={query({
              before: last.at.toISOString(),
              signins: showSignIns ? "1" : undefined,
            })}
            className="bk-btn bk-btn-quiet"
          >
            <span className="cap-trim">Older</span>
          </a>
        ) : null}
      </p>
    </>
  );
}
