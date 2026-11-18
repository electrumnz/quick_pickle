/**
 * Reviews: what customers say, read by a person before anyone else sees it.
 *
 * A customer may say what they like on their own account. The moment we put
 * their words on the shop they are our words (legal/COPY-RULES.md, "Reviews
 * and reposts"). So every review lands as `pending`, is run through the copy
 * check, and can only be published by a person. A review that says what the
 * product did to someone's body cannot be published at all, however kind it
 * is: publishing it would make it our claim.
 *
 * A review is never edited. Changing a customer's words and then showing
 * them as theirs would be making a review up. One that cannot be published
 * as it stands is rejected, with the reason.
 *
 * No review is ever invented. The demo database has sample ones and their
 * own text says so.
 */

import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { customers, orders, reviews, users, type CopyCheck } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";

import { conflict, notFound } from "../core/errors";
import { defineOp, type OpContext } from "../core/op";
import {
  bannedIn,
  copyVerdict,
  isBodyClaim,
  nameFindings,
  type CopyVerdict,
} from "./copy-check";
import {
  checkPublicCopy,
  loadUnpermittedPartners,
  PARTNER_RULE,
  requireRestrictedRead,
} from "./gate";
import {
  acknowledgeRestricted,
  excerpt,
  recordId,
  refuseIfMoved,
  userIdOf,
} from "./shared";
import {
  REVIEW_ACTIONS,
  REVIEW_STATUSES,
  type ReviewAction,
  type ReviewStatus,
} from "./status";

type Review = typeof reviews.$inferSelect;

const ratingField = z
  .number({ error: "Give it one to five stars" })
  .int("Give it one to five stars")
  .min(1, "Give it one to five stars")
  .max(5, "Give it one to five stars");
const bodyField = z
  .string()
  .max(1500, "Keep it under 1,500 letters")
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .refine((value) => value.length >= 2, "Say a few words about it");
const displayNameField = z
  .string()
  .max(120)
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .refine((value) => value.length >= 1, "Say how you would like to be named")
  .refine((value) => value.length <= 60, "Keep the name under 60 letters");
const orderNumberField = z
  .string()
  .trim()
  .toUpperCase()
  .max(20)
  .optional()
  .transform((value) => (value === "" ? undefined : value));
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const reviewFields = {
  rating: ratingField,
  body: bodyField,
  displayName: displayNameField,
  orderNumber: orderNumberField,
  email: emailField,
};

async function loadReview(db: DbOrTx, id: string): Promise<Review> {
  const [review] = await db.select().from(reviews).where(eq(reviews.id, id));
  if (review === undefined) throw notFound("That review");
  return review;
}

/**
 * A review's own words and the name it will be shown under. They are the
 * customer's words, so our own style rule (no long dashes) is not theirs to
 * keep.
 */
const checkReview = (
  ctx: OpContext,
  words: { readonly body: string; readonly displayName: string },
): Promise<CopyCheck> =>
  checkPublicCopy(ctx.db, [words.body, words.displayName], ctx.now, {
    voice: "theirs",
  });

/**
 * The order a review belongs to, if the number and the email both match one
 * that was really placed. A wrong pair is not an error: the review is simply
 * not tied to an order, and nothing says whether the order exists.
 */
async function orderFor(
  db: DbOrTx,
  orderNumber: string | undefined,
  email: string | undefined,
): Promise<{ orderId: string; customerId: string | null } | null> {
  if (orderNumber === undefined || email === undefined) return null;
  if (!ORDER_NUMBER_PATTERN.test(orderNumber)) return null;
  const [order] = await db
    .select({ id: orders.id, customerId: orders.customerId })
    .from(orders)
    .where(
      and(
        eq(orders.number, orderNumber),
        eq(orders.email, email),
        eq(orders.isTest, false),
      ),
    );
  return order === undefined
    ? null
    : { orderId: order.id, customerId: order.customerId };
}

const entityOf = (id: string) => ({ type: "review", id });

const stars = (rating: number) =>
  `${String(rating)} ${rating === 1 ? "star" : "stars"}`;

async function receive(
  ctx: OpContext,
  input: {
    readonly rating: number;
    readonly body: string;
    readonly displayName: string;
    readonly orderNumber?: string;
    readonly email?: string;
  },
  source: "form" | "staff",
): Promise<{ id: string; tiedToOrder: boolean }> {
  const tie = await orderFor(ctx.db, input.orderNumber, input.email);
  const copyCheck = await checkReview(ctx, input);
  const id = newId("rev");
  await ctx.db.insert(reviews).values({
    id,
    orderId: tie?.orderId ?? null,
    customerId: tie?.customerId ?? null,
    rating: input.rating,
    body: input.body,
    displayName: input.displayName,
    status: "pending",
    copyCheck,
    createdAt: ctx.now,
  });
  await ctx.audit({
    entity: entityOf(id),
    summary:
      source === "form"
        ? `A review came in from ${input.displayName}: ${stars(input.rating)}`
        : `Added a review from ${input.displayName}: ${stars(input.rating)}`,
    data: {
      source,
      rating: input.rating,
      tiedToOrder: tie !== null,
      copy: copyVerdict(copyCheck),
    },
  });
  await ctx.emit({
    type: "review.submitted",
    entity: entityOf(id),
    payload: {
      reviewId: id,
      rating: input.rating,
      source,
      copy: copyVerdict(copyCheck),
    },
  });
  return { id, tiedToOrder: tie !== null };
}

export const submitReview = defineOp({
  name: "reviews.submit",
  title: "Take a review from the shop",
  description:
    "For the shop's review form (/review). Takes a rating from 1 to 5, a few words, and the name the customer wants shown. If they give an order number and the email it was placed with and the two match a real order, the review is tied to that order. It always lands as pending and is never shown until a person publishes it. The copy check runs on it straight away so the person reading it can see what it found.",
  access: "write",
  input: z.object(reviewFields),
  run: (ctx, input) => receive(ctx, input, "form"),
});

export const addReview = defineOp({
  name: "reviews.add",
  title: "Add a review by hand",
  description:
    "For a review a customer sent some other way, such as by email. Type it in exactly as they wrote it: a review must be the customer's own words. It lands as pending like any other, with the copy check run on it, and still has to be published.",
  access: "write",
  input: z.object(reviewFields),
  run: (ctx, input) => receive(ctx, input, "staff"),
});

export type ReviewRow = {
  readonly id: string;
  readonly rating: number;
  /** The first words. */
  readonly body: string;
  readonly displayName: string;
  readonly status: ReviewStatus;
  readonly verdict: CopyVerdict;
  /** Tied to a real order by its number and email. */
  readonly verified: boolean;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
};

export const listReviews = defineOp({
  name: "reviews.list",
  title: "List reviews",
  description:
    "Reviews, the ones waiting to be read first, then newest first. `status` narrows to pending, published or rejected.",
  access: "read",
  input: z.object({
    status: z.enum([...REVIEW_STATUSES, "all"]).default("all"),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  async run(ctx, input): Promise<ReviewRow[]> {
    const rows = await ctx.db
      .select()
      .from(reviews)
      .where(
        input.status === "all" ? undefined : eq(reviews.status, input.status),
      )
      .orderBy(
        sql`case ${reviews.status} when 'pending' then 0 when 'published' then 1 else 2 end`,
        desc(reviews.createdAt),
        desc(reviews.id),
      )
      .limit(input.limit);
    return rows.map((review) => ({
      id: review.id,
      rating: review.rating,
      body: excerpt(review.body, 160),
      displayName: review.displayName,
      status: review.status,
      verdict: copyVerdict(review.copyCheck),
      verified: review.orderId !== null,
      createdAt: review.createdAt,
      decidedAt: review.decidedAt,
    }));
  },
});

export const countReviews = defineOp({
  name: "reviews.counts",
  title: "Count reviews by stage",
  description:
    "How many reviews are waiting to be read, published and rejected.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<Record<ReviewStatus, number>> {
    const rows = await ctx.db
      .select({ status: reviews.status, n: count() })
      .from(reviews)
      .groupBy(reviews.status);
    const out = { pending: 0, published: 0, rejected: 0 };
    for (const row of rows) out[row.status] = row.n;
    return out;
  },
});

export type ReviewDetail = {
  readonly id: string;
  readonly rating: number;
  readonly body: string;
  readonly displayName: string;
  readonly status: ReviewStatus;
  readonly rejectedReason: string | null;
  readonly copyCheck: CopyCheck | null;
  readonly verdict: CopyVerdict;
  readonly orderNumber: string | null;
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly decidedByName: string | null;
  /** What can be done with it from the stage it is at. */
  readonly next: readonly ReviewAction[];
};

export const getReview = defineOp({
  name: "reviews.get",
  title: "Open one review",
  description:
    "One review in full: the rating, the words, the name to show, the order it is tied to if any, what the copy check found, who decided on it, and what can be done with it next.",
  access: "read",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<ReviewDetail> {
    const [row] = await ctx.db
      .select({
        review: reviews,
        orderNumber: orders.number,
        customerFirst: customers.firstName,
        customerLast: customers.lastName,
        decidedByName: users.name,
      })
      .from(reviews)
      .leftJoin(orders, eq(orders.id, reviews.orderId))
      .leftJoin(customers, eq(customers.id, reviews.customerId))
      .leftJoin(users, eq(users.id, reviews.decidedBy))
      .where(eq(reviews.id, input.id));
    if (row === undefined) throw notFound("That review");
    const { review } = row;
    const customerName =
      `${row.customerFirst ?? ""} ${row.customerLast ?? ""}`.trim();
    return {
      id: review.id,
      rating: review.rating,
      body: review.body,
      displayName: review.displayName,
      status: review.status,
      rejectedReason: review.rejectedReason,
      copyCheck: review.copyCheck,
      verdict: copyVerdict(review.copyCheck),
      orderNumber: row.orderNumber,
      customerId: review.customerId,
      customerName: customerName === "" ? null : customerName,
      createdAt: review.createdAt,
      decidedAt: review.decidedAt,
      decidedByName: row.decidedByName,
      next: REVIEW_ACTIONS[review.status],
    };
  },
});

/**
 * "Still at the stage it was read at." A review's words never change, so the
 * stage is all a decision has to be guarded on: two people deciding the same
 * review at the same moment cannot both win.
 */
const asRead = (read: Pick<Review, "id" | "status">) =>
  and(eq(reviews.id, read.id), eq(reviews.status, read.status));

/** Why a review with a banned finding cannot go on the shop. */
function publishRefusal(check: CopyCheck): string | null {
  const banned = bannedIn(check);
  if (banned.length === 0) return null;
  const body = banned.filter(isBodyClaim);
  if (body.length > 0) {
    return `This review cannot be published. It says what the product did to someone's body: ${nameFindings(body)}. Publishing it would make that our claim, however kind the review is. Reject it instead.`;
  }
  const named = banned.filter((finding) => finding.rule === PARTNER_RULE);
  if (named.length > 0) {
    return `This review cannot be published. It names ${named.map((finding) => finding.match).join(" and ")}, who ${named.length === 1 ? "has" : "have"} not agreed in writing to be named in public (rule ${PARTNER_RULE}). Record their permission in Partners first.`;
  }
  return `This review cannot be published. It uses words we may not publish about the product: ${nameFindings(banned)}. Once we publish a customer's words they count as our own, however kind the review is.`;
}

export const publishReview = defineOp({
  name: "reviews.publish",
  title: "Publish a review",
  description:
    "Puts a review where the shop can show it. Only a person may decide this. The copy check runs again first, and a banned finding refuses it: a review that says what the product did to someone's body cannot be published, however kind, because publishing makes it our claim. So does one that names a partner who has not agreed to be named. A restricted finding needs `acknowledgeRestricted: true`. The words are never changed. The shop shows it within a minute. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId, acknowledgeRestricted }),
  explain: () =>
    "This publishes the review, so the shop can show it to everyone. Once it is published its words count as ours.",
  async run(ctx, input): Promise<{ status: ReviewStatus }> {
    const review = await loadReview(ctx.db, input.id);
    if (review.status === "published") return { status: "published" };
    const copyCheck = await checkReview(ctx, review);
    const refusal = publishRefusal(copyCheck);
    if (refusal !== null) throw conflict(refusal);
    const read = requireRestrictedRead(
      copyCheck,
      input.acknowledgeRestricted,
      ctx.actor,
    );
    const published = await ctx.db
      .update(reviews)
      .set({
        status: "published",
        copyCheck,
        rejectedReason: null,
        decidedAt: ctx.now,
        decidedBy: userIdOf(ctx),
      })
      .where(asRead(review))
      .returning({ id: reviews.id });
    refuseIfMoved(published, `The review from ${review.displayName}`);
    await ctx.audit({
      entity: entityOf(review.id),
      summary:
        read.length === 0
          ? `Published the review from ${review.displayName}`
          : `Published the review from ${review.displayName}, having read the warnings (${read.join(", ")})`,
      data: { rating: review.rating, restrictedRead: read },
    });
    await ctx.emit({
      type: "review.published",
      entity: entityOf(review.id),
      payload: { reviewId: review.id, rating: review.rating },
    });
    return { status: "published" };
  },
});

export const rejectReview = defineOp({
  name: "reviews.reject",
  title: "Reject a review",
  description:
    "Decides a waiting review will not be shown, with the reason. The review is kept, with the reason beside it, and can still be published later if that was a mistake. A published review has to be taken down first (reviews.unpublish).",
  access: "write",
  input: z.object({
    id: recordId,
    reason: z.string().trim().min(3, "Say why, in a few words").max(280),
  }),
  async run(ctx, input): Promise<{ status: ReviewStatus }> {
    const review = await loadReview(ctx.db, input.id);
    if (review.status === "rejected") return { status: "rejected" };
    if (review.status === "published") {
      throw conflict(
        `The review from ${review.displayName} is published. Take it down first, then reject it.`,
      );
    }
    const rejected = await ctx.db
      .update(reviews)
      .set({
        status: "rejected",
        rejectedReason: input.reason,
        decidedAt: ctx.now,
        decidedBy: userIdOf(ctx),
      })
      .where(asRead(review))
      .returning({ id: reviews.id });
    refuseIfMoved(rejected, `The review from ${review.displayName}`);
    await ctx.audit({
      entity: entityOf(review.id),
      summary: `Rejected the review from ${review.displayName}: ${input.reason}`,
    });
    return { status: "rejected" };
  },
});

export const unpublishReview = defineOp({
  name: "reviews.unpublish",
  title: "Take a review down",
  description:
    "Takes a published review off the shop and puts it back in the waiting pile, where it can be published again or rejected.",
  access: "write",
  // It changes what customers see on the shop.
  effect: "outward",
  input: z.object({ id: recordId }),
  explain: () =>
    "This takes a published review off the shop. It goes back to the waiting pile, where a person can publish it again.",
  async run(ctx, input): Promise<{ status: ReviewStatus }> {
    const review = await loadReview(ctx.db, input.id);
    if (review.status !== "published") return { status: review.status };
    const taken = await ctx.db
      .update(reviews)
      .set({ status: "pending", decidedAt: ctx.now, decidedBy: userIdOf(ctx) })
      .where(asRead(review))
      .returning({ id: reviews.id });
    refuseIfMoved(taken, `The review from ${review.displayName}`);
    await ctx.audit({
      entity: entityOf(review.id),
      summary: `Took down the review from ${review.displayName}`,
    });
    await ctx.emit({
      type: "review.unpublished",
      entity: entityOf(review.id),
      payload: { reviewId: review.id },
    });
    return { status: "pending" };
  },
});

export type PublishedReview = {
  readonly id: string;
  readonly rating: number;
  readonly body: string;
  readonly displayName: string;
  /** Tied to a real order by its number and email. */
  readonly verified: boolean;
  readonly publishedAt: Date;
};

/**
 * For the shop, when it shows reviews: the published ones, newest first.
 *
 * Each is put through the copy check once more on the way out, with today's
 * rules, and anything with a banned finding is left out. A review published
 * before a rule existed therefore comes off the shop by itself the day the
 * rule arrives, without waiting for somebody to notice.
 */
export async function listPublishedReviews(
  db: DbOrTx,
  limit = 12,
  now: Date = new Date(),
): Promise<PublishedReview[]> {
  const wanted = Math.max(1, Math.min(100, Math.trunc(limit)));
  // A few spare, in case some no longer pass.
  return (await passingReviews(db, now, wanted * 2)).slice(0, wanted);
}

/**
 * The published reviews that pass today's rules, newest first, out of the
 * newest `rows` published. Checking is pure work once the partners who have
 * not agreed to be named are loaded, so a shop's worth costs very little.
 */
async function passingReviews(
  db: DbOrTx,
  now: Date,
  rows: number,
): Promise<PublishedReview[]> {
  const published = await db
    .select()
    .from(reviews)
    .where(eq(reviews.status, "published"))
    .orderBy(desc(reviews.decidedAt), desc(reviews.createdAt))
    .limit(rows);
  const unpermitted = await loadUnpermittedPartners(db);
  const out: PublishedReview[] = [];
  for (const review of published) {
    const check = await checkPublicCopy(
      db,
      [review.body, review.displayName],
      now,
      { voice: "theirs", unpermitted },
    );
    if (bannedIn(check).length > 0) continue;
    out.push({
      id: review.id,
      rating: review.rating,
      body: review.body,
      displayName: review.displayName,
      verified: review.orderId !== null,
      publishedAt: review.decidedAt ?? review.createdAt,
    });
  }
  return out;
}

/** How many reviews the shop's numbers are worked out over, at most. */
const COUNTED = 2000;

export type ShownReviews = {
  /** The newest published reviews that pass today's rules, newest first. */
  readonly reviews: readonly PublishedReview[];
  /** How many published reviews pass today's rules, all of them. */
  readonly count: number;
  /**
   * Their average rating, to one decimal, or null with none. Worked out over
   * every review the shop can show, never a chosen few: a review is turned
   * down for what the law will not let us say, and never for being unkind.
   */
  readonly average: number | null;
};

export const shownReviews = defineOp({
  name: "reviews.shown",
  title: "The reviews the shop shows",
  description:
    "For the shop itself, as it draws a page: the newest published reviews, how many there are and their average rating. Each is checked once more against today's rules, and the count and the average are over the same reviews the shop can show.",
  access: "read",
  input: z.object({
    limit: z.number().int().min(1).max(100).default(6),
  }),
  async run(ctx, input): Promise<ShownReviews> {
    const all = await passingReviews(ctx.db, ctx.now, COUNTED);
    const total = all.reduce((sum, review) => sum + review.rating, 0);
    return {
      reviews: all.slice(0, input.limit),
      count: all.length,
      average:
        all.length === 0 ? null : Math.round((total / all.length) * 10) / 10,
    };
  },
});
