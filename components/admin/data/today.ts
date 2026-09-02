import "server-only";

import type { Order } from "@/lib/commerce";

import {
  between,
  dailyTakings,
  inventoryLevels,
  locations,
  nameStockLines,
  allProducts,
  ordersSince,
  ordersToPack,
  stockBySku,
  summarise,
  unitsBySku,
  type DayTakings,
  type SalesWindow,
  type SkuStock,
} from "./commerce-reads";
import {
  activity,
  batchesInProgress,
  ingredientsRunningLow,
  purchaseOrders,
  reviewsNeedingAttention,
  socialPosts,
  troubles,
  type ActivityItem,
  type BatchItem,
  type IngredientItem,
} from "./queries";
import { plural } from "./format";

/**
 * Today.
 *
 * The one screen that has to answer "what is my day" before she has decided
 * what to look at. Everything on it is drawn from the same questions:
 *
 *   1. What has failed quietly and is still failing? (Mirror, posts)
 *   2. What physically has to happen today — orders packed, stock ordered?
 *   3. Is the business alright?
 *   4. What happened while she was away? (audit_log via activity)
 *
 * Agent-raised decisions and AI spend are gone with the in-site roster.
 */

export type ActionKind = "Not working" | "Reply owed";

export type ActionItem = {
  readonly id: string;
  readonly kind: ActionKind;
  readonly title: string;
  /** Why it matters, and what happens if she leaves it. */
  readonly why: string;
  /** Who raised it and when, already in words. */
  readonly source: string;
  readonly occurredAt: string;
  readonly expiresAt: string | null;
  /** The money at stake, already in the words that make it mean something. */
  readonly amountLabel: string | null;
  readonly risk: "low" | "medium" | "high" | "critical" | null;
  readonly section: string;
  readonly href: string;
  /** Higher sorts first. Composed, not stored — see `rank` below. */
  readonly urgency: number;
};

export type PackOrder = {
  readonly id: string;
  readonly number: string;
  readonly customer: string;
  readonly destination: string;
  readonly items: string;
  readonly totalCents: number;
  readonly placedAt: string;
  readonly paid: boolean;
  readonly shippingMethod: string | null;
};

export type UpcomingItem = {
  readonly id: string;
  readonly when: string;
  readonly what: string;
  readonly where: string;
  readonly href: string;
  /** A supplier delivery whose promised date has already passed. */
  readonly late: boolean;
};

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  pinterest: "Pinterest",
};

export type TodayData = {
  readonly now: string;
  readonly actions: readonly ActionItem[];
  readonly failures: number;
  readonly repliesOwed: number;
  readonly toPack: readonly PackOrder[];
  readonly awaitingPayment: number;
  readonly stock: readonly SkuStock[];
  readonly lowIngredients: readonly IngredientItem[];
  readonly batches: readonly BatchItem[];
  readonly week: SalesWindow;
  readonly previousWeek: SalesWindow;
  readonly days: readonly DayTakings[];
  readonly activity: readonly ActivityItem[];
  readonly upcoming: readonly UpcomingItem[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function rank(item: { kind: ActionKind; risk: ActionItem["risk"] }): number {
  if (item.kind === "Not working") return 80;
  return 60;
}

function describeOrderItems(order: Order): string {
  return order.lineItems
    .map((line) => `${String(line.quantity)} × ${line.title}`)
    .join(", ");
}

function destinationOf(order: Order): string {
  const address = order.shippingAddress;
  if (address === null) return "No address on the order";
  const parts = [address.city, address.region].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  const place = parts.length > 0 ? parts[0] : "New Zealand";
  return address.company === null || address.company === undefined
    ? String(place)
    : `${address.company}, ${String(place)}`;
}

export async function loadToday(now: Date = new Date()): Promise<TodayData> {
  const since = new Date(now.getTime() - 90 * DAY_MS);

  const [
    failing,
    reviews,
    packQueue,
    levels,
    products,
    places,
    windowOrders,
    lowIngredients,
    batches,
    log,
    posts,
    orders,
  ] = await Promise.all([
    troubles(),
    reviewsNeedingAttention(),
    ordersToPack(20),
    inventoryLevels(),
    allProducts(),
    locations(),
    ordersSince(since),
    ingredientsRunningLow(),
    batchesInProgress(),
    activity(8),
    socialPosts(12),
    purchaseOrders(8),
  ]);

  const actions: ActionItem[] = [];

  for (const trouble of failing) {
    actions.push({
      id: trouble.id,
      kind: "Not working",
      title: trouble.title,
      why: trouble.detail,
      source: trouble.source,
      occurredAt: trouble.occurredAt,
      expiresAt: null,
      amountLabel: null,
      risk: null,
      section: trouble.section,
      href: trouble.href,
      urgency: rank({ kind: "Not working", risk: null }),
    });
  }

  for (const review of reviews) {
    const stars = `${String(review.rating)}-star`;
    actions.push({
      id: `review-${review.id}`,
      kind: "Reply owed",
      title:
        review.status === "pending"
          ? `A ${stars} review is waiting to be published`
          : `A ${stars} review has had no reply`,
      why:
        review.title === null
          ? review.body
          : `“${review.title}” — ${review.body}`,
      source: `${review.author}${review.verified ? ", a verified buyer" : ""}`,
      occurredAt: review.createdAt,
      expiresAt: null,
      amountLabel: null,
      risk: null,
      section: "Customers & Marketing",
      href: "/admin/customers",
      urgency: rank({ kind: "Reply owed", risk: null }),
    });
  }

  actions.sort((a, b) => {
    if (a.urgency !== b.urgency) return b.urgency - a.urgency;
    const left = a.expiresAt ?? a.occurredAt;
    const right = b.expiresAt ?? b.occurredAt;
    return left.localeCompare(right);
  });

  const toPack: PackOrder[] = packQueue.map((order) => ({
    id: order.id,
    number: order.orderNumber,
    customer: order.customer?.displayName ?? order.email,
    destination: destinationOf(order),
    items: describeOrderItems(order),
    totalCents: order.total.amountInMinorUnits,
    placedAt: order.placedAt,
    paid: order.financialStatus === "paid",
    shippingMethod: order.shippingMethod,
  }));

  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const recentUnits = unitsBySku(between(windowOrders, thirtyDaysAgo, now));
  const perDay = new Map<string, number>();
  for (const [sku, units] of recentUnits) perDay.set(sku, units / 30);
  const stock = stockBySku(nameStockLines(levels, products, places), perDay);

  const weekStart = new Date(now.getTime() - 7 * DAY_MS);
  const priorStart = new Date(now.getTime() - 14 * DAY_MS);
  const week = summarise(between(windowOrders, weekStart, now));
  const previousWeek = summarise(between(windowOrders, priorStart, weekStart));

  const upcoming: UpcomingItem[] = [];
  for (const order of orders) {
    if (order.receivedAt !== null || order.expectedAt === null) continue;
    const late = new Date(order.expectedAt).getTime() < now.getTime();
    upcoming.push({
      id: `po-${order.id}`,
      when: order.expectedAt,
      what: `${order.supplierName} delivery${late ? ", late" : ""}`,
      where: `${order.number} · Stock & Batches`,
      href: "/admin/stock",
      late,
    });
  }
  for (const post of posts) {
    if (post.scheduledFor === null || post.publishedAt !== null) continue;
    if (new Date(post.scheduledFor).getTime() < now.getTime()) continue;
    upcoming.push({
      id: `post-${post.id}`,
      when: post.scheduledFor,
      what: `${PLATFORM_NAMES[post.platform] ?? post.platform} post goes out`,
      where: "Social",
      href: "/admin/social",
      late: false,
    });
  }
  for (const batch of batches) {
    if (batch.plannedFor === null) continue;
    if (new Date(batch.plannedFor).getTime() < now.getTime()) continue;
    upcoming.push({
      id: `batch-${batch.id}`,
      when: batch.plannedFor,
      what: `${batch.productTitle ?? batch.code} — ${batch.status.replace(/_/g, " ")}`,
      where: `${batch.code} · Stock & Batches`,
      href: "/admin/stock",
      late: false,
    });
  }
  upcoming.sort((a, b) => a.when.localeCompare(b.when));

  return {
    now: now.toISOString(),
    actions,
    failures: failing.length,
    repliesOwed: reviews.length,
    toPack,
    awaitingPayment: toPack.filter((order) => !order.paid).length,
    stock,
    lowIngredients,
    batches,
    week,
    previousWeek,
    days: dailyTakings(windowOrders, 14, now),
    activity: log,
    upcoming: upcoming.slice(0, 6),
  };
}

/**
 * The sentence at the top of Today.
 *
 * Written by counting rather than by template, so a quiet morning reads like a
 * quiet morning instead of like a dashboard with nothing in it.
 */
export function summariseDay(data: TodayData): string {
  const clauses: string[] = [];
  if (data.toPack.length > 0) {
    clauses.push(`${plural(data.toPack.length, "order")} to pack`);
  }
  if (data.failures > 0) {
    clauses.push(
      `${plural(data.failures, "thing")} ${data.failures === 1 ? "is" : "are"} not working`,
    );
  }
  if (data.repliesOwed > 0) {
    clauses.push(`${plural(data.repliesOwed, "review")} owed a reply`);
  }
  if (data.awaitingPayment > 0) {
    clauses.push(
      `${plural(data.awaitingPayment, "order")} unpaid — do not pack yet`,
    );
  }
  if (clauses.length === 0) {
    return "Nothing is waiting on you. Every order is packed and nothing has failed.";
  }
  const last = clauses.pop() ?? "";
  const sentence =
    clauses.length === 0 ? last : `${clauses.join(", ")}, and ${last}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
