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
  agentSpend,
  batchesInProgress,
  ingredientsRunningLow,
  pendingApprovals,
  purchaseOrders,
  reviewsNeedingAttention,
  socialPosts,
  team,
  troubles,
  type ActivityItem,
  type AgentProfile,
  type AgentSpend,
  type BatchItem,
  type IngredientItem,
} from "./queries";
import { money, plural } from "./format";

/**
 * Today.
 *
 * The one screen that has to answer "what is my day" before she has decided
 * what to look at. Everything on it is drawn from the same four questions:
 *
 *   1. What is waiting on a decision only she can make?
 *   2. What has failed quietly and is still failing?
 *   3. What physically has to happen today — orders packed, stock ordered?
 *   4. Is the business alright?
 *
 * The action inbox merges the first two into one list, because to her a
 * purchase order that needs approving and a post that never went out are the
 * same thing: something is stuck and she is the reason it is stuck.
 */

export type ActionKind = "Decision" | "Not working" | "Reply owed";

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
  readonly decisions: number;
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
  readonly spend: AgentSpend;
  readonly upcoming: readonly UpcomingItem[];
  readonly team: readonly AgentProfile[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the number on an approval actually means.
 *
 * `amount_cents` is a different quantity for each kind of decision — a bill on
 * a purchase order, a per-bottle step on a price change, a ceiling on a
 * discount. Printing it bare would be a number with no unit, so it is never
 * shown without the sentence that says which one it is.
 */
function amountLabel(subjectType: string, cents: number | null): string | null {
  if (cents === null || cents === 0) return null;
  switch (subjectType) {
    case "purchase_order":
      return `Costs ${money(cents)}`;
    case "discount":
      return `Up to ${money(cents)} given away`;
    case "price_change":
      return `${money(cents)} a bottle more`;
    case "refund":
      return `Refund of ${money(cents)}`;
    default:
      return money(cents);
  }
}

function rank(item: { kind: ActionKind; risk: ActionItem["risk"] }): number {
  if (item.kind === "Decision") {
    if (item.risk === "critical") return 100;
    if (item.risk === "high") return 90;
    if (item.risk === "medium") return 70;
    return 50;
  }
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
    approvals,
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
    spend,
    roster,
    posts,
    orders,
  ] = await Promise.all([
    pendingApprovals(),
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
    agentSpend(),
    team(),
    socialPosts(12),
    purchaseOrders(8),
  ]);

  // --- the action inbox ----------------------------------------------------
  const actions: ActionItem[] = [];

  for (const approval of approvals) {
    const who =
      approval.agentName === null
        ? "Raised inside the admin"
        : `${approval.agentName}, ${approval.agentJobTitle ?? "the team"}`;
    actions.push({
      id: `approval-${approval.id}`,
      kind: "Decision",
      title: approval.title,
      why: approval.rationale ?? approval.summary,
      source: who,
      occurredAt: approval.requestedAt,
      expiresAt: approval.expiresAt,
      amountLabel: amountLabel(approval.subjectType, approval.amountCents),
      risk: approval.risk,
      section: "Approvals",
      // Straight to the queue, not to the top of The Team: the decision is the
      // reason she clicked, and it is now something she can settle there.
      href: "/admin/team#decisions",
      urgency: rank({ kind: "Decision", risk: approval.risk }),
    });
  }

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

  // --- the pack queue ------------------------------------------------------
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

  // --- stock ---------------------------------------------------------------
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const recentUnits = unitsBySku(between(windowOrders, thirtyDaysAgo, now));
  const perDay = new Map<string, number>();
  for (const [sku, units] of recentUnits) perDay.set(sku, units / 30);
  const stock = stockBySku(nameStockLines(levels, products, places), perDay);

  // --- money ---------------------------------------------------------------
  const weekStart = new Date(now.getTime() - 7 * DAY_MS);
  const priorStart = new Date(now.getTime() - 14 * DAY_MS);
  const week = summarise(between(windowOrders, weekStart, now));
  const previousWeek = summarise(between(windowOrders, priorStart, weekStart));

  // --- what is coming ------------------------------------------------------
  //
  // Only things that have not happened yet, with one exception: a supplier
  // delivery whose date has passed is *more* interesting than one that has
  // not, so it stays and is labelled late.
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
    decisions: approvals.length,
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
    spend,
    upcoming: upcoming.slice(0, 6),
    team: roster,
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
  if (data.decisions > 0) {
    clauses.push(
      `${plural(data.decisions, "decision")} ${data.decisions === 1 ? "is" : "are"} waiting on you`,
    );
  }
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
  if (clauses.length === 0) {
    return "Nothing is waiting on you. The team has everything it needs, every order is packed and nothing has failed.";
  }
  const last = clauses.pop() ?? "";
  const sentence =
    clauses.length === 0 ? last : `${clauses.join(", ")}, and ${last}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
