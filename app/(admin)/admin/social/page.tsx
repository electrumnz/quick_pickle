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
  socialAccounts,
  socialPosts,
  type SocialPostItem,
} from "@/components/admin/data/queries";
import {
  DataUnavailable,
  NotBuiltYet,
  PageHeader,
  PageSections,
  Section,
} from "@/components/admin/ui/page";
import { FilterNotice, SearchForm } from "@/components/admin/ui/search-form";
import {
  Badge,
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
 */

const PLATFORM_WORDS: Readonly<Record<string, string>> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  pinterest: "Pinterest",
};

const STATUS_WORDS: Readonly<Record<string, string>> = {
  draft: "Draft",
  pending_approval: "Waiting on you",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Did not go out",
  archived: "Archived",
};

function platform(value: string): string {
  return PLATFORM_WORDS[value] ?? value;
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params["q"];
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

  const result = await load(async () => {
    const [accounts, posts, best] = await Promise.all([
      socialAccounts(),
      socialPosts(20),
      bestPosts(3),
    ]);
    return { accounts, posts, best };
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

  const { accounts, posts: everything, best } = result.data;
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
          <SearchForm
            action="/admin/social"
            value={query}
            placeholder="What a post says"
            label="Search posts"
          />
        }
      />

      <PageSections>
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
          description="Nothing here has been published. A post drafted by Vinnie stops here until you say yes."
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
                  <PostRow key={post.id} post={post} />
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
          works={[
            "Every post, its state, and the numbers the platform reported",
            "The queue of posts waiting on your approval",
            "Failures with the platform's own reason",
            "Follower counts for each connected account",
          ]}
          coming={[
            "Writing or editing a post here, and approving one",
            "A calendar view of the fortnight ahead",
            "Uploading the picture or video with the caption",
            "Replying to comments without leaving the admin",
          ]}
        />
      </PageSections>
    </>
  );
}

function PostRow({ post }: { post: SocialPostItem }) {
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
    </Row>
  );
}
