/**
 * Marketing at a glance: the front page of the area, and the short list of
 * things in it that are waiting on a person (for the Today page and the
 * count beside "Marketing" in the menu).
 */

import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
} from "drizzle-orm";
import { z } from "zod";

import { campaigns, partners, reviews, socialPosts } from "@/db/schema";
import { addDays, nzDateKey, startOfNzDay } from "@/lib/time";

import { defineOp } from "../core/op";
import {
  countHeldCampaigns,
  countStuckCampaigns,
  listCampaigns,
  type CampaignRow,
} from "./campaigns";
import { collabBoard, type CollabRow } from "./collabs";
import { weekBounds, weekStartKey } from "./dates";
import { listLinks, type LinkRow } from "./links";
import { listPartners, type PartnerRow } from "./partners";
import { listReviews, type ReviewRow } from "./reviews";
import { plural } from "./shared";
import { listSocialPosts, type SocialRow } from "./social";
import { OPEN_SOCIAL_STATUSES } from "./status";

export type MarketingOverview = {
  /** Drafts, approved campaigns and ones on their way out. */
  readonly campaigns: readonly CampaignRow[];
  /** Not yet posted, and planned for any day up to the end of this week. */
  readonly postsDue: readonly SocialRow[];
  readonly reviewsWaiting: number;
  readonly reviews: readonly ReviewRow[];
  /** Next step due today or overdue. */
  readonly partnersDue: readonly PartnerRow[];
  /** Switched on, most followed first. */
  readonly topLinks: readonly LinkRow[];
  /** Partners with a code, a link or a cost, biggest sales first. */
  readonly collabs: readonly CollabRow[];
};

export const marketingOverview = defineOp({
  name: "marketing.overview",
  title: "Marketing at a glance",
  description:
    "The front page of the marketing area in one read: campaigns still in progress, posts due by the end of this week (New Zealand time), reviews waiting to be read, partners whose next step is due, the short links followed most, and the collabs that have brought in the most (with what each has cost and the sales back for each dollar).",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<MarketingOverview> {
    const thisWeek = weekBounds(weekStartKey(nzDateKey(ctx.now)));
    const [
      inProgress,
      postsDue,
      waiting,
      partnersDue,
      topLinks,
      pending,
      collabs,
    ] = await Promise.all([
      listCampaigns.run(ctx, { status: "open", limit: 6 }),
      listSocialPosts.run(ctx, {
        status: "open",
        unplanned: false,
        before: thisWeek.to,
        limit: 12,
      }),
      listReviews.run(ctx, { status: "pending", limit: 5 }),
      listPartners.run(ctx, { status: "all", due: true, limit: 6 }),
      listLinks.run(ctx, { active: "on", sort: "clicks", limit: 5 }),
      ctx.db
        .select({ n: count() })
        .from(reviews)
        .where(eq(reviews.status, "pending")),
      collabBoard.run(ctx, { limit: 5 }),
    ]);
    return {
      campaigns: inProgress,
      // A post with no day is on the ideas pile, not due.
      postsDue: postsDue.filter((post) => post.plannedFor !== null),
      reviewsWaiting: pending[0]?.n ?? 0,
      reviews: waiting,
      partnersDue,
      topLinks,
      collabs,
    };
  },
});

export type NeedsYouItem = {
  readonly key:
    "held" | "stuck" | "reviews" | "posts" | "campaigns" | "partners";
  readonly count: number;
  /** A whole sentence, ready to show. */
  readonly sentence: string;
  /** Where to go to deal with it. */
  readonly href: string;
};

export const marketingNeedsYou = defineOp({
  name: "marketing.needsYou",
  title: "What in marketing is waiting on a person",
  description:
    "The things in the marketing area that need somebody now, each as a count, a sentence to show and a link: campaigns that have stopped themselves part way (too many bounces or spam complaints), reviews waiting to be read, posts whose day has come and are not posted, campaigns approved but neither sent nor given a time, and partners whose next step is due. `total` is all of them, for the count beside Marketing in the menu. Items with nothing waiting are left out.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<{ total: number; items: NeedsYouItem[] }> {
    const today = nzDateKey(ctx.now);
    const endOfToday = startOfNzDay(addDays(today, 1));
    const one = async (query: Promise<{ n: number }[]>) =>
      (await query)[0]?.n ?? 0;
    const [held, stuck, reviewsWaiting, postsDue, campaignsReady, partnersDue] =
      await Promise.all([
        countHeldCampaigns(ctx.db),
        countStuckCampaigns(ctx.db),
        one(
          ctx.db
            .select({ n: count() })
            .from(reviews)
            .where(eq(reviews.status, "pending")),
        ),
        one(
          ctx.db
            .select({ n: count() })
            .from(socialPosts)
            .where(
              and(
                inArray(socialPosts.status, [...OPEN_SOCIAL_STATUSES]),
                lt(socialPosts.plannedFor, endOfToday),
              ),
            ),
        ),
        one(
          ctx.db
            .select({ n: count() })
            .from(campaigns)
            .where(
              and(eq(campaigns.status, "approved"), isNull(campaigns.sendAt)),
            ),
        ),
        one(
          ctx.db
            .select({ n: count() })
            .from(partners)
            .where(
              and(
                isNotNull(partners.nextStepOn),
                lte(partners.nextStepOn, today),
              ),
            ),
        ),
      ]);

    const items: NeedsYouItem[] = [];
    if (held > 0) {
      items.push({
        key: "held",
        count: held,
        sentence: `${plural(held, "campaign")} ${held === 1 ? "has" : "have"} stopped part way: too many emails bounced or were marked as spam.`,
        href: "/backstage/marketing/campaigns",
      });
    }
    if (stuck > 0) {
      items.push({
        key: "stuck",
        count: stuck,
        sentence: `${plural(stuck, "campaign")} ${stuck === 1 ? "has" : "have"} emails waiting that cannot be sent. ${stuck === 1 ? "It says" : "Each says"} why.`,
        href: "/backstage/marketing/campaigns",
      });
    }
    if (reviewsWaiting > 0) {
      items.push({
        key: "reviews",
        count: reviewsWaiting,
        sentence: `${plural(reviewsWaiting, "review")} ${reviewsWaiting === 1 ? "is" : "are"} waiting to be read.`,
        href: "/backstage/marketing/reviews",
      });
    }
    if (postsDue > 0) {
      items.push({
        key: "posts",
        count: postsDue,
        sentence: `${plural(postsDue, "post")} ${postsDue === 1 ? "is" : "are"} due and not posted yet.`,
        href: "/backstage/marketing/social",
      });
    }
    if (campaignsReady > 0) {
      items.push({
        key: "campaigns",
        count: campaignsReady,
        sentence: `${plural(campaignsReady, "campaign")} ${campaignsReady === 1 ? "is" : "are"} approved and waiting to be sent.`,
        href: "/backstage/marketing/campaigns",
      });
    }
    if (partnersDue > 0) {
      items.push({
        key: "partners",
        count: partnersDue,
        sentence: `${plural(partnersDue, "partner")} ${partnersDue === 1 ? "has" : "have"} a next step due.`,
        href: "/backstage/marketing/partners?due=1",
      });
    }
    return {
      total: items.reduce((sum, item) => sum + item.count, 0),
      items,
    };
  },
});
