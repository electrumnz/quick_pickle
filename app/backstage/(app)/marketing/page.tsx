import type { Metadata } from "next";
import Link from "next/link";

import {
  Empty,
  Notice,
  PageHeader,
  Panel,
  Pill,
  Stat,
  When,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { dayLabel } from "@/lib/backstage/marketing/dates";
import { marketingOverview } from "@/lib/backstage/marketing/overview";
import { FORMAT_LABEL, NETWORK_LABEL } from "@/lib/backstage/marketing/status";
import { formatNzTime, nzDateKey } from "@/lib/time";

import { CampaignPill, MarketingNav, SocialPill, VerdictPill } from "./parts";

export const metadata: Metadata = { title: "Marketing" };

function More({ href, children }: { readonly href: string; children: string }) {
  return (
    <Link href={href} className="link text-[0.9375rem]">
      {children}
    </Link>
  );
}

/**
 * Marketing at a glance: what is in progress and what is waiting on a
 * person, with a way in to each part of the area.
 */
export default async function MarketingPage() {
  await requireStaff();
  const now = new Date();
  const overview = await execute(marketingOverview, {}, await staffCaller());
  const today = nzDateKey(now);

  return (
    <>
      <PageHeader
        title="Marketing"
        lead="Getting the word out: emails to the Pickle Crew, promo codes, the social planner, short links, reviews and partners."
      />
      <MarketingNav current="overview" />
      <div className="mb-5">
        <Notice>
          Two things do not happen from here yet. Email is not connected, so a
          campaign you send is lined up and waits. And nothing posts to social
          media: posts are put up by hand, then marked as posted.
        </Notice>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Stat
          label="Reviews waiting"
          value={overview.reviewsWaiting}
          note={
            overview.reviewsWaiting === 0 ? "All read" : "To read and decide"
          }
        />
        <Stat
          label="Posts due"
          value={overview.postsDue.length}
          note="By the end of this week"
        />
        <Stat
          label="Campaigns"
          value={overview.campaigns.length}
          note="Being written or sent"
        />
        <Stat
          label="Partner steps"
          value={overview.partnersDue.length}
          note="Due today or overdue"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel
          title="Campaigns in progress"
          flush
          aside={
            <More href="/backstage/marketing/campaigns">All campaigns</More>
          }
        >
          {overview.campaigns.length === 0 ? (
            <Empty title="None in progress">
              No campaign is being written or sent.
            </Empty>
          ) : (
            <ul className="bk-rows">
              {overview.campaigns.map((campaign) => (
                <li key={campaign.id}>
                  <Link
                    href={`/backstage/marketing/campaigns/${campaign.id}`}
                    className="bk-row grid-cols-[1fr_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {campaign.name}
                      </span>
                      <span className="bk-muted block truncate text-[0.9375rem]">
                        {campaign.subject === ""
                          ? "No subject yet"
                          : campaign.subject}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <CampaignPill status={campaign.status} />
                      {campaign.held ? (
                        <Pill tone="todo">Stopped itself</Pill>
                      ) : null}
                      <VerdictPill verdict={campaign.verdict} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Posts due this week"
          flush
          aside={<More href="/backstage/marketing/social">The planner</More>}
        >
          {overview.postsDue.length === 0 ? (
            <Empty title="Nothing due">
              No post is planned between now and Sunday.
            </Empty>
          ) : (
            <ul className="bk-rows">
              {overview.postsDue.map((post) => (
                <li key={post.id}>
                  <Link
                    href={`/backstage/marketing/social/${post.id}`}
                    className="bk-row grid-cols-[1fr_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {post.title}
                      </span>
                      <span className="bk-muted block text-[0.9375rem]">
                        {post.plannedFor
                          ? `${dayLabel(nzDateKey(post.plannedFor))}, ${formatNzTime(post.plannedFor)} · `
                          : ""}
                        {NETWORK_LABEL[post.network]}{" "}
                        {FORMAT_LABEL[post.format].toLowerCase()}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <SocialPill status={post.status} />
                      {post.plannedFor && nzDateKey(post.plannedFor) < today ? (
                        <Pill tone="todo">Overdue</Pill>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Reviews waiting"
          flush
          aside={<More href="/backstage/marketing/reviews">All reviews</More>}
        >
          {overview.reviews.length === 0 ? (
            <Empty title="Nothing waiting">
              Every review that has come in has been read.
            </Empty>
          ) : (
            <ul className="bk-rows">
              {overview.reviews.map((review) => (
                <li key={review.id}>
                  <Link
                    href={`/backstage/marketing/reviews/${review.id}`}
                    className="bk-row grid-cols-[1fr_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">
                        {review.rating} out of 5, from {review.displayName}
                      </span>
                      <span className="bk-muted block truncate text-[0.9375rem]">
                        {review.body}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <VerdictPill verdict={review.verdict} />
                      <span className="bk-muted text-[0.875rem] whitespace-nowrap">
                        <When at={review.createdAt} now={now} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Partners: next step due"
          flush
          aside={<More href="/backstage/marketing/partners">All partners</More>}
        >
          {overview.partnersDue.length === 0 ? (
            <Empty title="Nothing due">
              No next step is due today or overdue.
            </Empty>
          ) : (
            <ul className="bk-rows">
              {overview.partnersDue.map((partner) => (
                <li key={partner.id}>
                  <Link
                    href={`/backstage/marketing/partners/${partner.id}`}
                    className="bk-row grid-cols-1"
                  >
                    <span className="font-semibold [overflow-wrap:anywhere]">
                      {partner.name}
                    </span>
                    <span className="bk-muted text-[0.9375rem] [overflow-wrap:anywhere]">
                      {partner.nextStep}
                      {partner.nextStepOn
                        ? ` (${dayLabel(partner.nextStepOn)})`
                        : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Most followed links"
          flush
          aside={<More href="/backstage/marketing/links">All links</More>}
          className="lg:col-span-2"
        >
          {overview.topLinks.length === 0 ? (
            <Empty title="No links yet">
              Make a short link for a bio or a flyer and its clicks show here.
            </Empty>
          ) : (
            <ul className="bk-rows">
              {overview.topLinks.map((link) => (
                <li key={link.id} className="bk-row grid-cols-[1fr_auto]">
                  <span className="min-w-0">
                    <span className="block font-mono font-semibold [overflow-wrap:anywhere]">
                      {link.path}
                    </span>
                    <span className="bk-muted block truncate text-[0.9375rem]">
                      {link.label === "" ? link.target : link.label}
                    </span>
                  </span>
                  <span className="bk-num font-semibold">
                    {link.clicks} {link.clicks === 1 ? "click" : "clicks"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
