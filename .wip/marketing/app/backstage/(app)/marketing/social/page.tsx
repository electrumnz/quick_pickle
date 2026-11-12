import type { Metadata } from "next";
import Link from "next/link";

import { Empty, Notice, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import {
  dayLabel,
  weekBounds,
  weekLabel,
  weekStartKey,
} from "@/lib/backstage/marketing/dates";
import {
  listSocialPosts,
  type SocialRow,
} from "@/lib/backstage/marketing/social";
import { FORMAT_LABEL, NETWORK_LABEL } from "@/lib/backstage/marketing/status";
import { addDays, formatNzTime, nzDateKey } from "@/lib/time";

import {
  FilterTabs,
  Flash,
  MarketingNav,
  SocialPill,
  VerdictPill,
} from "../parts";

export const metadata: Metadata = { title: "Social planner" };

function PostRow({ post }: { readonly post: SocialRow }) {
  return (
    <li>
      <Link
        href={`/backstage/marketing/social/${post.id}`}
        className="bk-row grid-cols-[1fr_auto]"
      >
        <span className="min-w-0">
          <span className="block font-semibold [overflow-wrap:anywhere]">
            {post.title}
          </span>
          <span className="bk-muted block text-[0.9375rem]">
            {post.plannedFor
              ? `${dayLabel(nzDateKey(post.plannedFor))}, ${formatNzTime(post.plannedFor)} · `
              : ""}
            {NETWORK_LABEL[post.network]}{" "}
            {FORMAT_LABEL[post.format].toLowerCase()}
          </span>
          {post.caption === "" ? null : (
            <span className="bk-muted block truncate text-[0.9375rem]">
              {post.caption}
            </span>
          )}
        </span>
        <span className="flex flex-col items-end gap-1">
          <SocialPill status={post.status} />
          <VerdictPill verdict={post.verdict} />
        </span>
      </Link>
    </li>
  );
}

function PostList({
  posts,
  empty,
}: {
  readonly posts: readonly SocialRow[];
  readonly empty: string;
}) {
  if (posts.length === 0) {
    return <p className="bk-muted px-4 py-5 leading-snug">{empty}</p>;
  }
  return (
    <ul className="bk-rows">
      {posts.map((post) => (
        <PostRow key={post.id} post={post} />
      ))}
    </ul>
  );
}

export default async function SocialPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const view = params.view === "done" ? "done" : "plan";
  const caller = await staffCaller();
  const canWrite = staff.role !== "viewer";
  const today = nzDateKey(new Date());
  const thisWeek = weekStartKey(today);
  const { from } = weekBounds(thisWeek);

  const tabs = (
    <FilterTabs
      label="Planner views"
      current={view}
      tabs={[
        { key: "plan", label: "The plan", href: "/backstage/marketing/social" },
        {
          key: "done",
          label: "Posted and dropped",
          href: "/backstage/marketing/social?view=done",
        },
      ]}
    />
  );
  const header = (
    <>
      <PageHeader
        title="Social planner"
        lead="What is going out, where and when. New Zealand time, weeks from Monday."
        actions={
          canWrite ? (
            <Link href="/backstage/marketing/social/new" className="bk-btn">
              <span className="cap-trim">New idea</span>
            </Link>
          ) : null
        }
      />
      <MarketingNav current="social" />
      <Flash notice={params.notice} tone={params.tone} />
      <div className="mb-4">
        <Notice>
          Nothing here posts for you. A post is written and approved here, put
          up by hand in the app, then marked as posted.
        </Notice>
      </div>
      {tabs}
    </>
  );

  if (view === "done") {
    const [posted, dropped] = await Promise.all([
      execute(listSocialPosts, { status: "posted", limit: 100 }, caller),
      execute(listSocialPosts, { status: "dropped", limit: 100 }, caller),
    ]);
    return (
      <>
        {header}
        <div className="flex flex-col gap-6">
          <Panel title="Posted" flush>
            <PostList
              posts={[...posted].reverse()}
              empty="Nothing has been marked as posted yet."
            />
          </Panel>
          <Panel title="Dropped" flush>
            <PostList posts={dropped} empty="Nothing has been dropped." />
          </Panel>
        </div>
      </>
    );
  }

  const [planned, overdue, pile] = await Promise.all([
    execute(listSocialPosts, { from, limit: 200 }, caller),
    execute(
      listSocialPosts,
      { status: "open", before: from, limit: 50 },
      caller,
    ),
    execute(
      listSocialPosts,
      { status: "open", unplanned: true, limit: 100 },
      caller,
    ),
  ]);

  // This week and next are always shown, then any later week with something in it.
  const weeks = new Map<string, SocialRow[]>([
    [thisWeek, []],
    [addDays(thisWeek, 7), []],
  ]);
  for (const post of planned) {
    if (post.plannedFor === null || post.status === "dropped") continue;
    const week = weekStartKey(nzDateKey(post.plannedFor));
    weeks.set(week, [...(weeks.get(week) ?? []), post]);
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-6">
        {overdue.length > 0 ? (
          <Panel title="Overdue" flush>
            <PostList posts={overdue} empty="" />
          </Panel>
        ) : null}

        {[...weeks.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([week, posts]) => (
            <Panel
              key={week}
              title={weekLabel(week, today)}
              aside={
                <span className="bk-muted text-[0.9375rem]">
                  {dayLabel(week)} to {dayLabel(addDays(week, 6))}
                </span>
              }
              flush
            >
              <PostList posts={posts} empty="Nothing planned." />
            </Panel>
          ))}

        <Panel title="Ideas with no day yet" flush>
          {pile.length === 0 ? (
            <Empty title="No loose ideas">
              An idea with no day lands here until it is given one.
            </Empty>
          ) : (
            <PostList posts={pile} empty="" />
          )}
        </Panel>
      </div>
    </>
  );
}
