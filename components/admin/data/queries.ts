import "server-only";

import { pgTextArray } from "@/lib/agents/roster";

import { ago } from "./format";
import {
  adminSql,
  bool,
  boolOrNull,
  decimal,
  int,
  iso,
  isoOrNull,
  text,
  textArray,
  textOrNull,
} from "./db";

/**
 * The tables Half Sour owns outright.
 *
 * Recipes, batches, ingredients, suppliers, agents, approvals, social posts,
 * brand rules, settings and the audit log have no Shopify counterpart, so
 * there is no adapter for them and these read the schema directly. Commerce —
 * orders, products, inventory, customers — is in `commerce-reads.ts` and goes
 * through the provider instead.
 *
 * Every function returns a named, typed shape. No screen above this file ever
 * sees a column name, and no screen ever shows a raw uuid where a name exists.
 */

// ---------------------------------------------------------------------------
// Approvals — the queue the whole company waits on
// ---------------------------------------------------------------------------

export type ApprovalRisk = "low" | "medium" | "high" | "critical";

export type ApprovalItem = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly rationale: string | null;
  readonly subjectType: string;
  readonly risk: ApprovalRisk;
  readonly amountCents: number | null;
  readonly requestedAt: string;
  readonly expiresAt: string | null;
  readonly status: string;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly agentName: string | null;
  readonly agentSlug: string | null;
  readonly agentJobTitle: string | null;
  readonly runGoal: string | null;
  /** The table the decision is about, e.g. `social_posts`. */
  readonly subjectTable: string;
  /** The row it is about, when the agent named one. */
  readonly subjectId: string | null;
  /** What the agent wants changed, as it wrote it for a human to read. */
  readonly preview: Readonly<Record<string, unknown>>;
  /** The exact call to make on approval. Shown as words, never replayed here. */
  readonly payload: Readonly<Record<string, unknown>>;
};

const APPROVAL_SELECT = `
  select a.id, a.title, a.summary, a.rationale, a.subject_type, a.risk,
         a.amount_cents, a.requested_at, a.expires_at, a.status, a.decided_at,
         a.decision_note, a.subject_table, a.subject_id, a.preview, a.payload,
         ag.name as agent_name, ag.slug as agent_slug,
         ag.job_title as agent_job_title,
         r.goal as run_goal
    from public.approvals a
    left join public.agents ag on ag.id = a.requested_by_agent_id
    left join public.agent_runs r on r.id = a.requested_by_run_id`;

function toApproval(row: Record<string, unknown>): ApprovalItem {
  const risk = text(row, "risk");
  return {
    id: text(row, "id"),
    title: text(row, "title"),
    summary: text(row, "summary"),
    rationale: textOrNull(row, "rationale"),
    subjectType: text(row, "subject_type"),
    risk:
      risk === "critical" || risk === "high" || risk === "medium"
        ? risk
        : "low",
    amountCents: row["amount_cents"] === null ? null : int(row, "amount_cents"),
    requestedAt: iso(row, "requested_at"),
    expiresAt: isoOrNull(row, "expires_at"),
    status: text(row, "status"),
    decidedAt: isoOrNull(row, "decided_at"),
    decisionNote: textOrNull(row, "decision_note"),
    agentName: textOrNull(row, "agent_name"),
    agentSlug: textOrNull(row, "agent_slug"),
    agentJobTitle: textOrNull(row, "agent_job_title"),
    runGoal: textOrNull(row, "run_goal"),
    subjectTable: text(row, "subject_table"),
    subjectId: textOrNull(row, "subject_id"),
    preview: jsonObject(row["preview"]),
    payload: jsonObject(row["payload"]),
  };
}

/** `jsonb` arrives already parsed. Anything that is not an object is nothing. */
function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Everything waiting on her, riskiest and oldest first. */
export async function pendingApprovals(): Promise<readonly ApprovalItem[]> {
  const result = await adminSql().query(
    `${APPROVAL_SELECT}
      where a.status = 'pending'
      order by case a.risk when 'critical' then 0 when 'high' then 1
                           when 'medium' then 2 else 3 end,
               a.requested_at`,
  );
  return result.rows.map(toApproval);
}

/** One decision by id. Null when the id names nothing. */
export async function approvalById(id: string): Promise<ApprovalItem | null> {
  const result = await adminSql().query(`${APPROVAL_SELECT} where a.id = $1`, [
    id,
  ]);
  const row = result.rows[0];
  return row === undefined ? null : toApproval(row);
}

/** Everything waiting on her about one kind of thing. */
export async function pendingApprovalsOf(
  subjectType: string,
): Promise<readonly ApprovalItem[]> {
  const result = await adminSql().query(
    `${APPROVAL_SELECT}
      where a.status = 'pending' and a.subject_type = $1::public.approval_subject
      order by a.requested_at`,
    [subjectType],
  );
  return result.rows.map(toApproval);
}

/** Everything one agent is waiting on her for. */
export async function pendingApprovalsBy(
  agentId: string,
): Promise<readonly ApprovalItem[]> {
  const result = await adminSql().query(
    `${APPROVAL_SELECT}
      where a.status = 'pending' and a.requested_by_agent_id = $1
      order by a.requested_at`,
    [agentId],
  );
  return result.rows.map(toApproval);
}

/** What she already decided, most recent first. */
export async function decidedApprovals(
  limit = 10,
): Promise<readonly ApprovalItem[]> {
  const result = await adminSql().query(
    `${APPROVAL_SELECT}
      where a.status <> 'pending'
      order by coalesce(a.decided_at, a.requested_at) desc
      limit $1`,
    [limit],
  );
  return result.rows.map(toApproval);
}

// ---------------------------------------------------------------------------
// The team
// ---------------------------------------------------------------------------

export type AgentProfile = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly jobTitle: string;
  readonly purpose: string;
  readonly model: string;
  readonly status: string;
  readonly autonomy: string;
  readonly needsApprovalFor: readonly string[];
  readonly tools: readonly string[];
  readonly dailyCapCents: number;
  readonly monthlyCapCents: number;
  readonly singleActionCapCents: number | null;
  readonly scheduleCron: string | null;
  readonly lastRunAt: string | null;
  readonly runsCount: number;
  readonly isEnabled: boolean;
  readonly spentTodayCents: number;
  readonly spentMonthCents: number;
  readonly pendingApprovals: number;
  readonly failedRuns7d: number;
};

/** Every AI role, with what it has spent today and what it is waiting on. */
export async function team(): Promise<readonly AgentProfile[]> {
  const result = await adminSql().query(
    `select a.*,
            coalesce(today.micros, 0)  as spent_today_micros,
            coalesce(month.micros, 0)  as spent_month_micros,
            coalesce(pending.n, 0)     as pending_approvals,
            coalesce(failed.n, 0)      as failed_runs_7d
       from public.agents a
       left join lateral (
         select sum(c.cost_micros) as micros from public.agent_costs c
          where c.agent_id = a.id
            and c.incurred_on = (now() at time zone 'Pacific/Auckland')::date
       ) today on true
       left join lateral (
         select sum(c.cost_micros) as micros from public.agent_costs c
          where c.agent_id = a.id
            and c.incurred_on >= date_trunc('month',
                  (now() at time zone 'Pacific/Auckland'))::date
       ) month on true
       left join lateral (
         select count(*)::int as n from public.approvals ap
          where ap.requested_by_agent_id = a.id and ap.status = 'pending'
       ) pending on true
       left join lateral (
         select count(*)::int as n from public.agent_runs r
          where r.agent_id = a.id and r.status = 'failed'
            and r.queued_at > now() - interval '7 days'
       ) failed on true
      order by a.name`,
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    slug: text(row, "slug"),
    name: text(row, "name"),
    jobTitle: text(row, "job_title"),
    purpose: text(row, "purpose"),
    model: text(row, "model"),
    status: text(row, "status"),
    autonomy: text(row, "autonomy"),
    // `requires_approval_for` is an array of an ENUM, and `pg` has no type
    // parser for one: enum OIDs are per-database, so the driver hands the
    // column back as the literal string `{purchase_order,discount}`. Read
    // with `textArray` it came back empty, and every agent on the Team page
    // said it always asks you about nothing — the most dangerous sentence
    // this screen could get wrong. `pgTextArray` copes with both shapes.
    needsApprovalFor: pgTextArray(row["requires_approval_for"]),
    tools: pgTextArray(row["tools"]),
    dailyCapCents: int(row, "daily_spend_cap_cents"),
    monthlyCapCents: int(row, "monthly_spend_cap_cents"),
    singleActionCapCents:
      row["single_action_cap_cents"] === null
        ? null
        : int(row, "single_action_cap_cents"),
    scheduleCron: textOrNull(row, "schedule_cron"),
    lastRunAt: isoOrNull(row, "last_run_at"),
    runsCount: int(row, "runs_count"),
    isEnabled: bool(row, "is_enabled"),
    spentTodayCents: Math.round(int(row, "spent_today_micros") / 10_000),
    spentMonthCents: Math.round(int(row, "spent_month_micros") / 10_000),
    pendingApprovals: int(row, "pending_approvals"),
    failedRuns7d: int(row, "failed_runs_7d"),
  }));
}

export type RunItem = {
  readonly id: string;
  readonly agentName: string;
  readonly agentSlug: string;
  readonly status: string;
  readonly trigger: string;
  readonly goal: string;
  readonly outcome: string | null;
  readonly error: string | null;
  readonly queuedAt: string;
  readonly finishedAt: string | null;
  readonly costCents: number;
  readonly toolCalls: number;
};

function toRun(row: Record<string, unknown>): RunItem {
  return {
    id: text(row, "id"),
    agentName: text(row, "agent_name"),
    agentSlug: text(row, "agent_slug"),
    status: text(row, "status"),
    trigger: text(row, "trigger"),
    goal: text(row, "goal"),
    outcome: textOrNull(row, "outcome"),
    error: textOrNull(row, "error"),
    queuedAt: iso(row, "queued_at"),
    finishedAt: isoOrNull(row, "finished_at"),
    costCents: Math.round(int(row, "cost_micros") / 10_000),
    toolCalls: int(row, "tool_call_count"),
  };
}

/** What the team has been doing, newest first. */
export async function recentRuns(limit = 12): Promise<readonly RunItem[]> {
  const result = await adminSql().query(
    `select r.*, a.name as agent_name, a.slug as agent_slug
       from public.agent_runs r join public.agents a on a.id = r.agent_id
      order by r.queued_at desc limit $1`,
    [limit],
  );
  return result.rows.map(toRun);
}

export async function runsForAgent(
  agentId: string,
  limit = 5,
): Promise<readonly RunItem[]> {
  const result = await adminSql().query(
    `select r.*, a.name as agent_name, a.slug as agent_slug
       from public.agent_runs r join public.agents a on a.id = r.agent_id
      where r.agent_id = $1
      order by r.queued_at desc limit $2`,
    [agentId, limit],
  );
  return result.rows.map(toRun);
}

// ---------------------------------------------------------------------------
// Things that are broken
// ---------------------------------------------------------------------------

export type Trouble = {
  readonly id: string;
  /** What broke, in her words. */
  readonly title: string;
  /** Why it matters and what happens if she leaves it. */
  readonly detail: string;
  /** Who or what it happened to. */
  readonly source: string;
  readonly occurredAt: string;
  readonly section: string;
  readonly href: string;
};

/**
 * Everything currently failing, from four different places, in one list.
 *
 * A failed webhook, a failed agent run, a post that never went out and a sync
 * that has been retrying for weeks are the same kind of event to her: something
 * did not happen and she was not told. They are one list here for that reason.
 */
const SYNC_SUBJECTS: Readonly<Record<string, string>> = {
  product: "Products",
  product_variant: "Product sizes",
  collection: "Collections",
  inventory_level: "Stock levels",
  inventory_item: "Stock items",
  customer: "Customers",
  address: "Addresses",
  order: "Orders",
  order_item: "Order lines",
  draft_order: "Draft orders",
  cart: "Carts",
  discount: "Discount codes",
  price_rule: "Price rules",
  fulfillment: "Fulfilments",
  refund: "Refunds",
  subscription_contract: "Subscriptions",
  shop: "Shop details",
};

function syncSubject(resource: string): string {
  return SYNC_SUBJECTS[resource] ?? resource.replace(/_/g, " ");
}

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

function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform;
}

function lowerFirst(sentence: string): string {
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

function lastSuccess(iso: string | null): string {
  return iso === null ? "it was set up" : ago(iso);
}

export async function troubles(): Promise<readonly Trouble[]> {
  const sql = adminSql();
  const [runs, posts, hooks, syncs] = await Promise.all([
    sql.query(
      `select r.id, r.error, r.goal, r.finished_at, r.queued_at, a.name as agent_name
         from public.agent_runs r join public.agents a on a.id = r.agent_id
        where r.status = 'failed' and r.queued_at > now() - interval '30 days'
        order by r.queued_at desc`,
    ),
    sql.query(
      `select p.id, p.platform, p.caption, p.error, p.updated_at, a.name as agent_name
         from public.social_posts p
         left join public.agents a on a.id = p.created_by_agent_id
        where p.status = 'failed'
        order by p.updated_at desc`,
    ),
    sql.query(
      `select w.id, w.topic, w.error, w.attempts, w.received_at
         from public.webhook_events w
        where w.process_status = 'failed'
        order by w.received_at desc`,
    ),
    sql.query(
      `select s.id, s.resource_type, s.error, s.consecutive_failures,
              s.last_error_at, s.last_success_at
         from public.sync_state s
        where s.status = 'failed'
        order by s.last_error_at desc nulls last`,
    ),
  ]);

  const items: Trouble[] = [];
  for (const row of runs.rows) {
    items.push({
      id: `run-${text(row, "id")}`,
      title: `${text(row, "agent_name")} hit an error and stopped`,
      detail: `It was part way through: ${lowerFirst(text(row, "goal"))}. It has not tried again on its own.`,
      source: text(row, "agent_name"),
      occurredAt: isoOrNull(row, "finished_at") ?? iso(row, "queued_at"),
      section: "The Team",
      href: "/admin/team",
    });
  }
  for (const row of posts.rows) {
    items.push({
      id: `post-${text(row, "id")}`,
      title: `A ${platformName(text(row, "platform"))} post did not go out`,
      detail:
        textOrNull(row, "error") ??
        "The post was scheduled and never published.",
      source: textOrNull(row, "agent_name") ?? "Social",
      occurredAt: iso(row, "updated_at"),
      section: "Social",
      href: "/admin/social",
    });
  }
  for (const row of hooks.rows) {
    items.push({
      id: `hook-${text(row, "id")}`,
      title: "An order from the shop could not be filed",
      detail: `It is for a bottle size this admin has not seen yet, so it was parked rather than half-recorded. It will go in as soon as the product list is refreshed. Tried ${String(int(row, "attempts"))} times.`,
      source: "Storefront sync",
      occurredAt: iso(row, "received_at"),
      section: "Orders & Delivery",
      href: "/admin/orders",
    });
  }
  for (const row of syncs.rows) {
    items.push({
      id: `sync-${text(row, "id")}`,
      title: `${syncSubject(text(row, "resource_type"))} have stopped syncing with the shop`,
      detail: `${String(int(row, "consecutive_failures"))} failures in a row, and nothing has come through since ${lastSuccess(isoOrNull(row, "last_success_at"))}. Anything that changed on the shop since then is not in here yet.`,
      source: "Storefront sync",
      occurredAt:
        isoOrNull(row, "last_error_at") ?? iso(row, "last_success_at"),
      section: "Settings",
      href: "/admin/settings",
    });
  }
  return items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type ReviewItem = {
  readonly id: string;
  readonly author: string;
  readonly rating: number;
  readonly title: string | null;
  readonly body: string;
  readonly status: string;
  readonly productTitle: string | null;
  readonly verified: boolean;
  readonly repliedAt: string | null;
  readonly createdAt: string;
};

function toReview(row: Record<string, unknown>): ReviewItem {
  return {
    id: text(row, "id"),
    author: text(row, "author_name"),
    rating: int(row, "rating"),
    title: textOrNull(row, "title"),
    body: text(row, "body"),
    status: text(row, "status"),
    productTitle: textOrNull(row, "product_title"),
    verified: bool(row, "is_verified_purchase"),
    repliedAt: isoOrNull(row, "replied_at"),
    createdAt: iso(row, "created_at"),
  };
}

/**
 * Reviews still owed something.
 *
 * The brand rule `reply-within-day` says a review gets an answer within one
 * working day, so an unanswered one is an obligation rather than an inbox item.
 */
export async function reviewsNeedingAttention(): Promise<
  readonly ReviewItem[]
> {
  const result = await adminSql().query(
    `select r.*, p.title as product_title
       from public.reviews r
       left join public.products p on p.id = r.product_id
      where r.status = 'pending'
         or (r.status = 'published' and r.reply_body is null and r.rating <= 3)
      order by r.created_at`,
  );
  return result.rows.map(toReview);
}

export async function recentReviews(limit = 8): Promise<readonly ReviewItem[]> {
  const result = await adminSql().query(
    `select r.*, p.title as product_title
       from public.reviews r
       left join public.products p on p.id = r.product_id
      where r.status = 'published'
      order by r.created_at desc limit $1`,
    [limit],
  );
  return result.rows.map(toReview);
}

// ---------------------------------------------------------------------------
// Production — batches, recipes, ingredients, suppliers
// ---------------------------------------------------------------------------

export type BatchItem = {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly productTitle: string | null;
  readonly recipeName: string | null;
  readonly locationName: string | null;
  /** Needed by the release form, which has to put bottles somewhere. */
  readonly locationId: string | null;
  readonly plannedFor: string | null;
  readonly producedAt: string | null;
  readonly releasedAt: string | null;
  readonly expiresAt: string | null;
  readonly unitsProduced: number;
  readonly unitsRemaining: number;
  readonly unitCostCents: number;
  readonly qaPassed: boolean | null;
  readonly notes: string | null;
};

function toBatch(row: Record<string, unknown>): BatchItem {
  return {
    id: text(row, "id"),
    code: text(row, "batch_code"),
    status: text(row, "status"),
    productTitle: textOrNull(row, "product_title"),
    recipeName: textOrNull(row, "recipe_name"),
    locationName: textOrNull(row, "location_name"),
    locationId: textOrNull(row, "location_id"),
    plannedFor: isoOrNull(row, "planned_for"),
    producedAt: isoOrNull(row, "produced_at"),
    releasedAt: isoOrNull(row, "released_at"),
    expiresAt: isoOrNull(row, "expires_at"),
    unitsProduced: int(row, "units_produced"),
    unitsRemaining: int(row, "units_remaining"),
    unitCostCents: int(row, "unit_cost_cents"),
    qaPassed: boolOrNull(row, "qa_passed"),
    notes: textOrNull(row, "notes"),
  };
}

const BATCH_SELECT = `
  select b.*, p.title as product_title, r.name as recipe_name,
         l.name as location_name
    from public.batches b
    left join public.products p on p.id = b.product_id
    left join public.recipes r on r.id = b.recipe_id
    left join public.inventory_locations l on l.id = b.location_id`;

/** Batches that are still work: planned, brewing, fermenting, bottling, held. */
export async function batchesInProgress(): Promise<readonly BatchItem[]> {
  const result = await adminSql().query(
    `${BATCH_SELECT}
      where b.status in ('planned','brewing','fermenting','conditioning',
                         'bottling','qa_hold')
      order by coalesce(b.planned_for, b.created_at)`,
  );
  return result.rows.map(toBatch);
}

export async function recentBatches(limit = 8): Promise<readonly BatchItem[]> {
  const result = await adminSql().query(
    `${BATCH_SELECT}
      order by coalesce(b.produced_at, b.planned_for, b.created_at) desc
      limit $1`,
    [limit],
  );
  return result.rows.map(toBatch);
}

export type IngredientItem = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly unit: string;
  readonly stockOnHand: number;
  readonly reorderPoint: number;
  readonly reorderQuantity: number;
  readonly supplierName: string | null;
  readonly supplierLeadDays: number | null;
  readonly standardCostCents: number;
};

function toIngredient(row: Record<string, unknown>): IngredientItem {
  return {
    id: text(row, "id"),
    code: text(row, "code"),
    name: text(row, "name"),
    category: text(row, "category"),
    unit: text(row, "unit"),
    stockOnHand: decimal(row, "stock_on_hand"),
    reorderPoint: decimal(row, "reorder_point"),
    reorderQuantity: decimal(row, "reorder_quantity"),
    supplierName: textOrNull(row, "supplier_name"),
    supplierLeadDays:
      row["lead_time_days"] === null ? null : int(row, "lead_time_days"),
    standardCostCents: int(row, "standard_cost_cents"),
  };
}

const INGREDIENT_SELECT = `
  select i.*, s.name as supplier_name, s.lead_time_days
    from public.ingredients i
    left join public.suppliers s on s.id = i.preferred_supplier_id`;

/** Ingredients and packaging at or under the point she reorders at. */
export async function ingredientsRunningLow(): Promise<
  readonly IngredientItem[]
> {
  const result = await adminSql().query(
    `${INGREDIENT_SELECT}
      where i.is_active and i.reorder_point > 0
        and i.stock_on_hand <= i.reorder_point
      order by (i.stock_on_hand / nullif(i.reorder_point, 0))`,
  );
  return result.rows.map(toIngredient);
}

export async function allIngredients(): Promise<readonly IngredientItem[]> {
  const result = await adminSql().query(
    `${INGREDIENT_SELECT} where i.is_active order by i.category, i.name`,
  );
  return result.rows.map(toIngredient);
}

export type SupplierItem = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly city: string | null;
  readonly region: string | null;
  readonly status: string;
  readonly leadTimeDays: number | null;
  readonly rating: number | null;
  readonly contactName: string | null;
  readonly email: string | null;
  readonly foodSafetyExpiresOn: string | null;
};

export async function suppliers(): Promise<readonly SupplierItem[]> {
  const result = await adminSql().query(
    `select * from public.suppliers order by name`,
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    code: text(row, "code"),
    name: text(row, "name"),
    city: textOrNull(row, "city"),
    region: textOrNull(row, "region"),
    status: text(row, "status"),
    leadTimeDays:
      row["lead_time_days"] === null ? null : int(row, "lead_time_days"),
    rating: row["rating"] === null ? null : int(row, "rating"),
    contactName: textOrNull(row, "contact_name"),
    email: textOrNull(row, "email"),
    foodSafetyExpiresOn: isoOrNull(row, "food_safety_expires_on"),
  }));
}

export type PurchaseOrderItem = {
  readonly id: string;
  readonly number: string;
  readonly supplierName: string;
  readonly status: string;
  readonly totalCents: number;
  readonly orderedAt: string | null;
  readonly expectedAt: string | null;
  readonly receivedAt: string | null;
  readonly lines: readonly string[];
};

/** Orders placed with suppliers, newest first. */
export async function purchaseOrders(
  limit = 10,
): Promise<readonly PurchaseOrderItem[]> {
  const result = await adminSql().query(
    `select po.*, s.name as supplier_name,
            (select coalesce(array_agg(coalesce(i.name, poi.description)
                                       order by poi.created_at), '{}')
               from public.purchase_order_items poi
               left join public.ingredients i on i.id = poi.ingredient_id
              where poi.purchase_order_id = po.id) as line_names
       from public.purchase_orders po
       join public.suppliers s on s.id = po.supplier_id
      order by coalesce(po.ordered_at, po.created_at) desc
      limit $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    number: text(row, "po_number"),
    supplierName: text(row, "supplier_name"),
    status: text(row, "status"),
    totalCents: int(row, "total_cents"),
    orderedAt: isoOrNull(row, "ordered_at"),
    expectedAt: isoOrNull(row, "expected_at"),
    receivedAt: isoOrNull(row, "received_at"),
    lines: textArray(row, "line_names"),
  }));
}

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

export type SocialAccount = {
  readonly id: string;
  readonly platform: string;
  readonly handle: string;
  readonly followers: number;
  readonly posts: number;
  readonly isActive: boolean;
  readonly lastSyncedAt: string | null;
};

export async function socialAccounts(): Promise<readonly SocialAccount[]> {
  const result = await adminSql().query(
    `select * from public.social_accounts order by followers_count desc`,
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    platform: text(row, "platform"),
    handle: text(row, "handle"),
    followers: int(row, "followers_count"),
    posts: int(row, "posts_count"),
    isActive: bool(row, "is_active"),
    lastSyncedAt: isoOrNull(row, "last_synced_at"),
  }));
}

/**
 * A picture or clip already attached to a post, as `social_post_assets` has it.
 *
 * Enough to draw the crop truthfully and nothing more: the shape it was shot
 * in, the words describing it, and how long it runs. The bytes themselves live
 * on a CDN this admin does not fetch from, which is why there is no URL here —
 * see `components/admin/social/PostPreview.tsx` for what the frame draws
 * instead.
 */
export type PostMedia = {
  readonly title: string;
  /** `image`, `video`, `carousel`… straight off `content_asset_type`. */
  readonly kind: string;
  /** The alt text on the record. Empty when nobody has written one. */
  readonly alt: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly seconds: number | null;
};

export type SocialPostItem = {
  readonly id: string;
  readonly platform: string;
  readonly status: string;
  readonly caption: string;
  /** Kept in their own column, and appended to the caption on the way out. */
  readonly hashtags: readonly string[];
  readonly linkUrl: string | null;
  readonly firstComment: string | null;
  /** What it would go out with, in the order it was attached. */
  readonly media: readonly PostMedia[];
  readonly scheduledFor: string | null;
  readonly publishedAt: string | null;
  readonly impressions: number;
  readonly likes: number;
  readonly comments: number;
  readonly linkClicks: number;
  readonly agentName: string | null;
  readonly brandCheckPassed: boolean | null;
  readonly error: string | null;
  /** The decision attached to it, when one has been raised. */
  readonly approvalId: string | null;
  /** Whether that decision is still waiting on her. */
  readonly approvalPending: boolean;
};

/** A dimension from `json_agg`, which hands back numbers, strings or null. */
function positiveOrNull(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function toMedia(value: unknown): readonly PostMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): readonly PostMedia[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    return [
      {
        title: text(record, "title"),
        kind: text(record, "kind"),
        alt: text(record, "alt"),
        width: positiveOrNull(record["width"]),
        height: positiveOrNull(record["height"]),
        seconds: positiveOrNull(record["seconds"]),
      },
    ];
  });
}

function toPost(row: Record<string, unknown>): SocialPostItem {
  return {
    id: text(row, "id"),
    platform: text(row, "platform"),
    status: text(row, "status"),
    caption: text(row, "caption"),
    hashtags: textArray(row, "hashtags"),
    linkUrl: textOrNull(row, "link_url"),
    firstComment: textOrNull(row, "first_comment"),
    media: toMedia(row["media"]),
    scheduledFor: isoOrNull(row, "scheduled_for"),
    publishedAt: isoOrNull(row, "published_at"),
    impressions: int(row, "impressions"),
    likes: int(row, "likes"),
    comments: int(row, "comments_count"),
    linkClicks: int(row, "link_clicks"),
    agentName: textOrNull(row, "agent_name"),
    brandCheckPassed: boolOrNull(row, "brand_check_passed"),
    error: textOrNull(row, "error"),
    approvalId: textOrNull(row, "approval_id"),
    approvalPending: text(row, "approval_status") === "pending",
  };
}

const POST_SELECT = `
  select p.*, a.name as agent_name, ap.status as approval_status,
         (select coalesce(
                   json_agg(json_build_object(
                     'title',   ca.title,
                     'kind',    ca.asset_type,
                     'alt',     coalesce(ca.alt_text, ''),
                     'width',   ca.width_px,
                     'height',  ca.height_px,
                     'seconds', ca.duration_seconds)
                   order by spa.position, ca.title),
                   '[]'::json)
            from public.social_post_assets spa
            join public.content_assets ca on ca.id = spa.asset_id
           where spa.post_id = p.id) as media
    from public.social_posts p
    left join public.agents a on a.id = p.created_by_agent_id
    left join public.approvals ap on ap.id = p.approval_id`;

export async function socialPosts(
  limit = 20,
): Promise<readonly SocialPostItem[]> {
  const result = await adminSql().query(
    `${POST_SELECT}
      order by coalesce(p.published_at, p.scheduled_for, p.updated_at) desc
      limit $1`,
    [limit],
  );
  return result.rows.map(toPost);
}

/** Published posts ranked by reach — what actually worked. */
export async function bestPosts(limit = 3): Promise<readonly SocialPostItem[]> {
  const result = await adminSql().query(
    `${POST_SELECT}
      where p.status = 'published'
      order by p.impressions desc limit $1`,
    [limit],
  );
  return result.rows.map(toPost);
}

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

export type CampaignItem = {
  readonly id: string;
  readonly name: string;
  readonly channel: string;
  readonly status: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly spendCents: number;
  readonly revenueCents: number;
  readonly ownerAgentName: string | null;
};

export async function campaigns(limit = 8): Promise<readonly CampaignItem[]> {
  const result = await adminSql().query(
    `select c.*, a.name as owner_name
       from public.campaigns c
       left join public.agents a on a.id = c.owner_agent_id
      order by coalesce(c.starts_at, c.created_at) desc limit $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    name: text(row, "name"),
    channel: text(row, "channel"),
    status: text(row, "status"),
    startsAt: isoOrNull(row, "starts_at"),
    endsAt: isoOrNull(row, "ends_at"),
    spendCents: int(row, "spend_cents"),
    revenueCents: int(row, "revenue_cents"),
    ownerAgentName: textOrNull(row, "owner_name"),
  }));
}

export type EmailSummary = {
  readonly sent: number;
  readonly delivered: number;
  readonly opened: number;
  readonly clicked: number;
  readonly bounced: number;
  readonly queued: number;
};

export async function emailSummary(): Promise<EmailSummary> {
  const result = await adminSql().query(
    `select count(*) filter (where sent_at is not null)        as sent,
            count(*) filter (where delivered_at is not null)   as delivered,
            count(*) filter (where first_opened_at is not null) as opened,
            count(*) filter (where last_clicked_at is not null) as clicked,
            count(*) filter (where bounced_at is not null)     as bounced,
            count(*) filter (where status in ('draft','queued')) as queued
       from public.email_sends`,
  );
  const row = result.rows[0] ?? {};
  return {
    sent: int(row, "sent"),
    delivered: int(row, "delivered"),
    opened: int(row, "opened"),
    clicked: int(row, "clicked"),
    bounced: int(row, "bounced"),
    queued: int(row, "queued"),
  };
}

export type SubscriptionSummary = {
  readonly active: number;
  readonly paused: number;
  readonly nextBillingAt: string | null;
};

export async function subscriptionSummary(): Promise<SubscriptionSummary> {
  const result = await adminSql().query(
    `select count(*) filter (where status = 'active')  as active,
            count(*) filter (where status = 'paused')  as paused,
            min(next_billing_at) filter (where status = 'active')
              as next_billing_at
       from public.subscriptions`,
  );
  const row = result.rows[0] ?? {};
  return {
    active: int(row, "active"),
    paused: int(row, "paused"),
    nextBillingAt: isoOrNull(row, "next_billing_at"),
  };
}

// ---------------------------------------------------------------------------
// Brand rules, settings, and the log of what happened
// ---------------------------------------------------------------------------

export type BrandRuleItem = {
  readonly id: string;
  readonly slug: string;
  readonly kind: string;
  readonly severity: string;
  readonly title: string;
  readonly rule: string;
  readonly rationale: string | null;
  readonly goodExample: string | null;
  readonly badExample: string | null;
  readonly appliesTo: readonly string[];
  readonly isActive: boolean;
};

export async function brandRules(): Promise<readonly BrandRuleItem[]> {
  const result = await adminSql().query(
    `select * from public.brand_rules where is_active order by priority`,
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    slug: text(row, "slug"),
    kind: text(row, "kind"),
    severity: text(row, "severity"),
    title: text(row, "title"),
    rule: text(row, "rule"),
    rationale: textOrNull(row, "rationale"),
    goodExample: textOrNull(row, "good_example"),
    badExample: textOrNull(row, "bad_example"),
    appliesTo: textArray(row, "applies_to"),
    isActive: bool(row, "is_active"),
  }));
}

export type SettingItem = {
  readonly key: string;
  readonly category: string;
  readonly description: string | null;
  /** Already readable: an address is a line, not a blob of JSON. */
  readonly value: string;
  readonly isSecret: boolean;
};

/**
 * A stored value as a sentence.
 *
 * Settings are JSON, and a couple of them are objects. Printing the JSON puts
 * braces and quote marks in front of someone who wants to read her own
 * address, so an object is flattened to its values in the order they were
 * written, which for an address is the order you would write it on an envelope.
 */
function renderSettingValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (Array.isArray(raw)) return raw.map(renderSettingValue).join(", ");
  if (typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([field]) => field !== "country_code")
      .map(([, value]) => renderSettingValue(value))
      .filter((part) => part !== "")
      .join(", ");
  }
  return String(raw);
}

/** Settings, with secrets reported as held rather than printed. */
export async function settings(): Promise<readonly SettingItem[]> {
  const result = await adminSql().query(
    `select key, category, description, is_secret,
            case when is_secret then '"held in the vault"'::jsonb
                 else value end as value
       from public.settings order by category, key`,
  );
  return result.rows.map((row) => ({
    key: text(row, "key"),
    category: text(row, "category"),
    description: textOrNull(row, "description"),
    value: renderSettingValue(row["value"]),
    isSecret: bool(row, "is_secret"),
  }));
}

export type ActivityItem = {
  readonly id: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly actorType: string;
  readonly action: string;
  readonly summary: string;
  readonly entityLabel: string | null;
};

/**
 * The company's own log, in sentences.
 *
 * Sign-ins are left out. She is the only human, so "Nadia signed in" is a line
 * about herself in a feed whose whole purpose is telling her what happened
 * while she was not here. Sessions are on Settings, where they are a security
 * question rather than news.
 */
export async function activity(limit = 10): Promise<readonly ActivityItem[]> {
  const result = await adminSql().query(
    `select id, occurred_at, actor_type, actor_label, action, summary,
            entity_label
       from public.audit_log
      where action not in ('login', 'logout')
      order by occurred_at desc limit $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    occurredAt: iso(row, "occurred_at"),
    actor: textOrNull(row, "actor_label") ?? "System",
    actorType: text(row, "actor_type"),
    action: text(row, "action"),
    summary: text(row, "summary"),
    entityLabel: textOrNull(row, "entity_label"),
  }));
}

// ---------------------------------------------------------------------------
// Company facts and the runtime's own state
// ---------------------------------------------------------------------------

export type CompanyFacts = {
  readonly tradingName: string;
  readonly legalName: string;
  readonly gstNumber: string;
  readonly nzbn: string;
  readonly supportEmail: string;
  readonly address: string;
  readonly gstRateBasisPoints: number;
  readonly freeShippingThresholdCents: number;
  readonly standardShippingCents: number;
  readonly shopDomain: string;
};

function settingText(map: Map<string, unknown>, key: string): string {
  const value = map.get(key);
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** The handful of facts every page footer, invoice and label needs. */
export async function companyFacts(): Promise<CompanyFacts> {
  const result = await adminSql().query(
    `select key, value from public.settings where is_secret = false`,
  );
  const map = new Map<string, unknown>(
    result.rows.map((row) => [text(row, "key"), row["value"]]),
  );
  const address = map.get("company.address");
  const addressText =
    address !== null && typeof address === "object"
      ? Object.entries(address as Record<string, unknown>)
          .filter(([field]) => field !== "country")
          .map(([, value]) => (typeof value === "string" ? value : ""))
          .filter(Boolean)
          .join(", ")
      : "";
  const numberOf = (key: string): number => {
    const value = map.get(key);
    return typeof value === "number" ? value : 0;
  };
  return {
    tradingName: settingText(map, "company.trading_name"),
    legalName: settingText(map, "company.legal_name"),
    gstNumber: settingText(map, "company.gst_number"),
    nzbn: settingText(map, "company.nzbn"),
    supportEmail: settingText(map, "company.support_email"),
    address: addressText,
    gstRateBasisPoints: numberOf("tax.gst_rate_bp"),
    freeShippingThresholdCents: numberOf("shipping.free_threshold_cents"),
    standardShippingCents: numberOf("shipping.standard_cents"),
    shopDomain: settingText(map, "commerce.shop_domain"),
  };
}

export type AgentSpend = {
  readonly todayCents: number;
  readonly monthCents: number;
  readonly dailyCapCents: number;
  readonly killSwitchOn: boolean;
  readonly runsToday: number;
  readonly runningNow: number;
  readonly waitingOnHer: number;
};

/** What the team costs, and whether anything is holding them back. */
export async function agentSpend(): Promise<AgentSpend> {
  const sql = adminSql();
  const [costs, caps, kill, runs] = await Promise.all([
    sql.query(
      `select coalesce(sum(cost_micros) filter (
                where incurred_on = (now() at time zone 'Pacific/Auckland')::date
              ), 0) as today_micros,
              coalesce(sum(cost_micros) filter (
                where incurred_on >= date_trunc('month',
                        (now() at time zone 'Pacific/Auckland'))::date
              ), 0) as month_micros
         from public.agent_costs`,
    ),
    sql.query(
      `select coalesce(sum(daily_spend_cap_cents), 0) as cap
         from public.agents where is_enabled`,
    ),
    sql.query(
      `select value from public.settings where key = 'agents.kill_switch'`,
    ),
    sql.query(
      `select count(*) filter (
                where queued_at >= (date_trunc('day',
                  now() at time zone 'Pacific/Auckland')
                  at time zone 'Pacific/Auckland')
              ) as today,
              count(*) filter (where status = 'running')            as running,
              count(*) filter (where status = 'awaiting_approval')  as waiting
         from public.agent_runs`,
    ),
  ]);
  const costRow = costs.rows[0] ?? {};
  const runRow = runs.rows[0] ?? {};
  const killValue = kill.rows[0]?.["value"];
  const halted =
    killValue !== null &&
    typeof killValue === "object" &&
    (killValue as Record<string, unknown>)["halted"] === true;
  return {
    todayCents: Math.round(int(costRow, "today_micros") / 10_000),
    monthCents: Math.round(int(costRow, "month_micros") / 10_000),
    dailyCapCents: int(caps.rows[0] ?? {}, "cap"),
    killSwitchOn: halted,
    runsToday: int(runRow, "today"),
    runningNow: int(runRow, "running"),
    waitingOnHer: int(runRow, "waiting"),
  };
}

// ---------------------------------------------------------------------------
// Who is signed in
// ---------------------------------------------------------------------------

export type OperatorProfile = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly timezone: string;
  readonly lastSeenAt: string | null;
};

/** The human. There is exactly one, and the sidebar says her name. */
export async function operator(
  operatorId: string,
): Promise<OperatorProfile | null> {
  const result = await adminSql().query(
    `select id, full_name, email, role, timezone, last_seen_at
       from public.operators where id = $1`,
    [operatorId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: text(row, "id"),
    name: textOrNull(row, "full_name") ?? text(row, "email"),
    email: text(row, "email"),
    role: text(row, "role"),
    timezone: text(row, "timezone"),
    lastSeenAt: isoOrNull(row, "last_seen_at"),
  };
}

export type SessionItem = {
  readonly id: string;
  /** The label the operator gave the device, when there is one. */
  readonly device: string | null;
  readonly userAgent: string | null;
  readonly startedAt: string;
  readonly lastActiveAt: string;
  readonly expiresAt: string;
  readonly ipAddress: string | null;
  readonly revokedAt: string | null;
  /** Decided by the database clock, not the render's. */
  readonly isExpired: boolean;
  readonly isCurrent: boolean;
};

/** Every sign-in on this account, so a stranger's session is visible. */
export async function operatorSessions(
  operatorId: string,
  currentSessionId: string,
): Promise<readonly SessionItem[]> {
  const result = await adminSql().query(
    `select id, device_label, user_agent, started_at, last_active_at,
            expires_at, ip_address, revoked_at, (expires_at < now()) as expired
       from public.admin_sessions
      where operator_id = $1
      order by last_active_at desc limit 8`,
    [operatorId],
  );
  return result.rows.map((row) => ({
    id: text(row, "id"),
    device: textOrNull(row, "device_label"),
    userAgent: textOrNull(row, "user_agent"),
    startedAt: iso(row, "started_at"),
    lastActiveAt: iso(row, "last_active_at"),
    expiresAt: iso(row, "expires_at"),
    ipAddress: textOrNull(row, "ip_address"),
    revokedAt: isoOrNull(row, "revoked_at"),
    isExpired: bool(row, "expired"),
    isCurrent: text(row, "id") === currentSessionId,
  }));
}
