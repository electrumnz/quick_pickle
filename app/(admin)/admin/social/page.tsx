import type { Metadata } from "next";

import { load } from "@/components/admin/data/db";
import {
  ago,
  clip,
  count,
  day,
  dayAndTime,
  plural,
  until,
} from "@/components/admin/data/format";
import {
  bestPosts,
  pendingApprovalsOf,
  socialAccounts,
  socialPosts,
  type SocialPostItem,
} from "@/components/admin/data/queries";
import { ApprovalQueue } from "@/components/admin/approvals/ApprovalCard";
import { PostPreview } from "@/components/admin/social";
import { Disclosure } from "@/components/admin/ui/controls";
import {
  ActionLink,
  DataUnavailable,
  NotBuiltYet,
  PageHeader,
  PageSections,
  Section,
} from "@/components/admin/ui/page";
import { FilterNotice, SearchForm } from "@/components/admin/ui/search-form";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  Dot,
  EmptyState,
  Row,
  Rows,
  Stat,
  StatGrid,
  TableScroll,
  Td,
  Th,
} from "@/components/admin/ui/primitives";
import { Flash } from "@/components/admin/write/flash";
import { adminFormToken, requireAdminAccess } from "@/lib/auth/server";
import { platformWord } from "@/lib/social";

import { PostDeclineForm, PostDiaryForm, PostEditor } from "./post-forms";

export const metadata: Metadata = {
  title: "Social",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Social — what is scheduled, what went out, and how it did.
 *
 * The one number that matters to a small food brand is reach, so posts are
 * ranked by it rather than by likes. Everything drafted by an agent says so,
 * and anything that failed says why in the words the platform used.
 *
 * The queue at the top is the same approval card that appears on Today, on The
 * Team and on an agent's own page, because every queue in this admin is one
 * filter over `public.approvals` and she should only have to learn it once.
 *
 * Approving a post here is real and permanent, and it publishes nothing. No
 * account is connected to this deployment, so a scheduled post is a post with a
 * time written beside it. Every control on this page says so, in those words,
 * because the difference between "approved" and "sent" is the whole safety
 * model of this build.
 */

const STATUS_WORDS: Readonly<Record<string, string>> = {
  draft: "Draft",
  pending_approval: "Waiting on you",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Did not go out",
  archived: "Archived",
};

/**
 * A platform value, as a name.
 *
 * The table lives in `lib/social/platforms.ts` beside the enum it mirrors, so
 * "tiktok" is not rendered as "Tiktok" here and "TikTok" on the calendar.
 */
function platform(value: string): string {
  return platformWord(value);
}

/**
 * The line under the account name in a preview.
 *
 * It says a time and it never says "posting". A diarised post is a post with a
 * time written beside it and a person still to do it, and the preview is the
 * one place on this page where the layout might otherwise imply otherwise.
 */
function whenWords(post: SocialPostItem): string {
  if (post.publishedAt !== null) return `Published ${day(post.publishedAt)}`;
  if (post.scheduledFor !== null) {
    return `Pencilled in for ${dayAndTime(post.scheduledFor)} — nothing sends it`;
  }
  return "Not in the diary yet";
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Reads on an open demonstration need no session; writes still do. When
  // nobody is signed in there is no token to bind a form to, and
  // `adminFormToken` returns "" — which `assertAdminCsrf` can never accept, so
  // a submitted form lands on the sign-in page rather than in the database.
  const csrfToken = adminFormToken(await requireAdminAccess());
  const params = await searchParams;
  const raw = params["q"];
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const back =
    query === ""
      ? "/admin/social"
      : `/admin/social?q=${encodeURIComponent(query)}`;

  const result = await load(async () => {
    const [accounts, posts, best, decisions] = await Promise.all([
      socialAccounts(),
      socialPosts(20),
      bestPosts(3),
      pendingApprovalsOf("social_post"),
    ]);
    return { accounts, posts, best, decisions };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Social"
          lede="What is scheduled, what went out, and how it did."
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const { accounts, posts: everything, best, decisions } = result.data;
  const byId = new Map(everything.map((post) => [post.id, post]));
  // The handle a preview shows in its account row. Null where no account for
  // that platform exists, or where one exists and is not connected — which is
  // the truthful answer and the one the preview prints.
  const handles: Record<string, string | null> = {};
  for (const account of accounts) {
    handles[account.platform] = account.isActive ? account.handle : null;
  }
  // A decision about a post is editable in place: the card holds the same
  // caption box the queue below uses, so "change it first" is one control
  // rather than a trip to another section.
  const editors = new Map(
    decisions.flatMap((decision) => {
      const post =
        decision.subjectId === null ? undefined : byId.get(decision.subjectId);
      return post === undefined
        ? []
        : [
            [
              decision.id,
              <PostEditor
                key={post.id}
                post={post}
                csrfToken={csrfToken}
                back={back}
                scope="decide"
                bare
              />,
            ] as const,
          ];
    }),
  );
  // What the post will look like, inside the decision about it. Same card, same
  // place, so there is one approval surface rather than two.
  const previews = new Map(
    decisions.flatMap((decision) => {
      const post =
        decision.subjectId === null ? undefined : byId.get(decision.subjectId);
      return post === undefined
        ? []
        : [
            [
              decision.id,
              <PostPreview
                key={post.id}
                post={post}
                handles={handles}
                scope="decide"
                whenWords={whenWords(post)}
              />,
            ] as const,
          ];
    }),
  );
  const posts =
    query === ""
      ? everything
      : everything.filter(
          (post) =>
            post.caption.toLowerCase().includes(query.toLowerCase()) ||
            platform(post.platform).toLowerCase().includes(query.toLowerCase()),
        );
  const waiting = posts.filter(
    (post) => post.status === "pending_approval" || post.status === "scheduled",
  );
  const failed = posts.filter((post) => post.status === "failed");
  const published = posts.filter((post) => post.status === "published");
  const followers = accounts
    .filter((account) => account.isActive)
    .reduce((sum, account) => sum + account.followers, 0);
  const reach = published.reduce((sum, post) => sum + post.impressions, 0);

  return (
    <>
      <PageHeader
        title="Social"
        lede="Instagram and TikTok in one place: what is waiting to go out, what went out, and how far it travelled."
        meta={
          <>
            <span>{count(followers)} followers across live accounts</span>
            <span aria-hidden="true">·</span>
            <span>{plural(waiting.length, "post")} waiting</span>
          </>
        }
        actions={
          <>
            <ActionLink href="/admin/social/calendar">
              See the calendar
            </ActionLink>
            <SearchForm
              action="/admin/social"
              value={query}
              placeholder="What a post says"
              label="Search posts"
            />
          </>
        }
      />

      <PageSections>
        <Flash searchParams={params} />

        <Section
          title="Waiting on you"
          description="A post an agent drafted stops here. Saying yes is written down against the post for good — and it still does not send it."
        >
          <ApprovalQueue
            approvals={decisions}
            csrfToken={csrfToken}
            back={back}
            editors={editors}
            previews={previews}
            id="approve-ticked-social"
            emptyHeadline="Nobody is waiting on you"
            emptyFills="Vinnie drafts the fortnight's posts on a schedule, and each one stops here with its caption before it can go anywhere."
          >
            Every post an agent writes needs your yes before it can be put in
            the diary.
          </ApprovalQueue>
        </Section>

        {query !== "" && (
          <FilterNotice
            query={query}
            found={posts.length}
            clearHref="/admin/social"
            noun="post"
          />
        )}

        <Section title="Where things stand">
          <div className="rounded-lg border border-hairline bg-surface-raised px-4 py-4">
            <StatGrid>
              <Stat
                label="Waiting to go out"
                value={String(waiting.length)}
                hint="Drafted, and needing your yes or a scheduled time"
              />
              <Stat
                label="Did not go out"
                value={String(failed.length)}
                hint={
                  failed.length === 0
                    ? "Everything scheduled has published"
                    : "Something was rejected by the platform"
                }
                tone={failed.length > 0 ? "danger" : "neutral"}
              />
              <Stat
                label="People reached"
                value={count(reach)}
                hint="Across everything published so far"
              />
              <Stat
                label="Followers"
                value={count(followers)}
                hint={accounts
                  .filter((account) => account.isActive)
                  .map(
                    (account) =>
                      `${platform(account.platform)} ${count(account.followers)}`,
                  )
                  .join(" · ")}
              />
            </StatGrid>
          </div>
        </Section>

        <Section
          title="Waiting to go out"
          description="Nothing here has been published. A post drafted by Vinnie stops here until you say yes, and stays here after you have."
        >
          <Card>
            {waiting.length === 0 ? (
              <EmptyState
                headline="Nothing is queued"
                fills="Vinnie drafts the fortnight's posts on a schedule. Each one lands here with its caption and picture before it goes anywhere."
              >
                This is the queue of posts that are written but not yet public.
              </EmptyState>
            ) : (
              <Rows>
                {waiting.map((post) => (
                  <PostRow
                    key={post.id}
                    post={post}
                    csrfToken={csrfToken}
                    back={back}
                    handles={handles}
                  />
                ))}
              </Rows>
            )}
          </Card>
        </Section>

        {failed.length > 0 && (
          <Section
            title="Did not go out"
            description="The platform refused these. The reason is exactly what it said."
          >
            <Card>
              <Rows>
                {failed.map((post) => (
                  <Row key={post.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">
                        {clip(post.caption, 90)}
                      </p>
                      <Badge tone="danger">{platform(post.platform)}</Badge>
                    </div>
                    <p className="mt-1 text-caption text-danger">
                      {post.error ?? "No reason was recorded."}
                    </p>
                    <p className="mt-1 text-caption text-muted">
                      {post.agentName ?? "The admin"} ·{" "}
                      {ago(
                        post.publishedAt ??
                          post.scheduledFor ??
                          new Date().toISOString(),
                      )}
                    </p>
                  </Row>
                ))}
              </Rows>
            </Card>
          </Section>
        )}

        <Section
          title="What worked"
          description="Published posts ranked by how many people saw them."
        >
          <Card>
            <CardHeader title="Best three so far" />
            <Rows>
              {best.map((post) => (
                <Row key={post.id}>
                  <p className="text-body-sm text-primary">
                    {clip(post.caption, 120)}
                  </p>
                  <p className="mt-1 text-caption text-muted">
                    {platform(post.platform)} ·{" "}
                    {post.publishedAt === null
                      ? "not published"
                      : day(post.publishedAt)}{" "}
                    · {count(post.impressions)} people saw it ·{" "}
                    {count(post.likes)} likes · {count(post.linkClicks)} clicks
                    to the shop
                  </p>
                </Row>
              ))}
            </Rows>
          </Card>
        </Section>

        <Section
          title="Everything published"
          description="Newest first, with the numbers the platforms report back."
        >
          <Card>
            <TableScroll>
              <thead>
                <tr>
                  <Th>Post</Th>
                  <Th>Where</Th>
                  <Th>When</Th>
                  <Th numeric>Saw it</Th>
                  <Th numeric>Likes</Th>
                  <Th numeric>Clicks</Th>
                </tr>
              </thead>
              <tbody>
                {published.map((post) => (
                  <tr key={post.id}>
                    <Td>{clip(post.caption, 70)}</Td>
                    <Td>{platform(post.platform)}</Td>
                    <Td className="whitespace-nowrap">
                      {post.publishedAt === null ? "—" : day(post.publishedAt)}
                    </Td>
                    <Td numeric>{count(post.impressions)}</Td>
                    <Td numeric>{count(post.likes)}</Td>
                    <Td numeric>{count(post.linkClicks)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          </Card>
        </Section>

        <Section title="Accounts">
          <Card>
            <Rows>
              {accounts.map((account) => (
                <Row key={account.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="flex items-center gap-2 text-body-sm text-primary">
                      <Dot tone={account.isActive ? "live" : "quiet"} />
                      {platform(account.platform)} · @{account.handle}
                    </p>
                    <p className="text-caption text-muted tabular-nums">
                      {count(account.followers)} followers ·{" "}
                      {count(account.posts)} posts
                    </p>
                  </div>
                  <p className="mt-0.5 text-caption text-muted">
                    {account.isActive
                      ? account.lastSyncedAt === null
                        ? "Connected"
                        : `Numbers last checked ${ago(account.lastSyncedAt)}`
                      : "Not connected. Nothing is posted here and no numbers come back."}
                  </p>
                </Row>
              ))}
            </Rows>
          </Card>
        </Section>

        <NotBuiltYet
          blurb="Approving, rewording, diarising and declining a post all change the real database, permanently, with your name on them. None of them post anything: no Instagram or TikTok account is connected to this admin, so an approved post is a post written down and waiting for a person."
          works={[
            "Every post, its state, and the numbers the platform reported",
            "Seeing what a post will look like on each platform at a phone, tablet and desktop width, with the caption cut where that platform cuts it and every character, hashtag and crop counted against its real limits",
            "Approving a post and giving it a time, which is recorded against it for good",
            "Changing the wording before you say yes",
            "Declining a post with a reason, which answers the agent that asked",
            "Approving several waiting decisions at once",
            "Failures with the platform's own reason",
            "A month and a week of everything with a date on it, on the calendar, with the gaps between them said in words",
          ]}
          coming={[
            "Actually posting: nothing here is connected to Instagram or TikTok, so a scheduled post waits for a person",
            "The preview showing the photograph itself rather than its shape: the files sit on a CDN this admin does not fetch from, so the crop is drawn from the recorded dimensions",
            "Uploading the picture or video with the caption",
            "Replying to comments without leaving the admin",
          ]}
        />
      </PageSections>
    </>
  );
}

function PostRow({
  post,
  csrfToken,
  back,
  handles,
}: {
  post: SocialPostItem;
  csrfToken: string;
  back: string;
  handles: Readonly<Record<string, string | null>>;
}) {
  return (
    <Row>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-body-sm text-primary">
          {clip(post.caption, 140)}
        </p>
        <Badge tone={post.status === "pending_approval" ? "accent" : "quiet"}>
          {STATUS_WORDS[post.status] ?? post.status}
        </Badge>
      </div>
      <p className="mt-1 text-caption text-muted">
        {platform(post.platform)}
        {post.agentName === null ? "" : ` · drafted by ${post.agentName}`}
        {post.scheduledFor === null
          ? ""
          : ` · goes out ${dayAndTime(post.scheduledFor)}, ${until(post.scheduledFor)}`}
        {post.brandCheckPassed === true
          ? " · checked against the brand rules"
          : post.brandCheckPassed === false
            ? " · failed the brand rule check"
            : ""}
      </p>
      <div className="mt-3">
        {/* Folded here, open inside the decision above. A row is a list to
            scan; a decision is a thing to look at. */}
        <Disclosure label="See how it will look">
          <PostPreview
            post={post}
            handles={handles}
            scope="queue"
            whenWords={whenWords(post)}
          />
        </Disclosure>
      </div>
      {csrfToken === "" ? null : (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <PostEditor
            post={post}
            csrfToken={csrfToken}
            back={back}
            scope="queue"
          />
          {post.approvalPending ? null : (
            <PostDiaryForm post={post} csrfToken={csrfToken} back={back} />
          )}
          <PostDeclineForm post={post} csrfToken={csrfToken} back={back} />
        </div>
      )}
      {post.approvalPending && (
        <div className="mt-2">
          <Callout title="This one is in Waiting on you, above">
            It has a decision open, so the yes and the time are set there. You
            can still change the wording from here first.
          </Callout>
        </div>
      )}
    </Row>
  );
}
