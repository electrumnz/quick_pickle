import "server-only";

import { adminSql, int, text, textOrNull } from "./db";
import { commerce } from "./db";
import { money } from "./format";

/**
 * One search box over the whole company.
 *
 * Nine destinations is a small enough map to hold in your head, but the things
 * *inside* them are not: 95 orders, 50 customers, 18 batches, seven suppliers.
 * So search covers the nouns rather than the pages — an order number, a
 * customer's name, a batch code, a supplier, a member of the team — and every
 * result says which section it lives in, so finding something also teaches
 * where it lives.
 *
 * Orders, products and customers come through the commerce provider. Batches,
 * suppliers, ingredients, agents, posts and settings are Half Sour's own
 * tables and come from SQL.
 */

export type SearchHit = {
  readonly id: string;
  /** What it is, in her words: "Order", "Customer", "Batch". */
  readonly kind: string;
  readonly title: string;
  readonly subtitle: string;
  /** Which of the nine sections it lives in. */
  readonly section: string;
  readonly href: string;
};

export type SearchResults = {
  readonly query: string;
  readonly hits: readonly SearchHit[];
};

const EMPTY: SearchResults = { query: "", hits: [] };

/** The words the rest of the admin uses for a platform and a post's state. */
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

const POST_STATE_WORDS: Readonly<Record<string, string>> = {
  draft: "draft",
  pending_approval: "waiting on you",
  scheduled: "scheduled",
  published: "published",
  failed: "did not go out",
  archived: "archived",
};

/** The words the rest of the admin uses for an order's state. */
const FULFILMENT_WORDS: Readonly<Record<string, string>> = {
  unfulfilled: "still to pack",
  partially_fulfilled: "part sent",
  fulfilled: "on its way",
  delivered: "delivered",
  returned: "came back",
  cancelled: "cancelled",
};

export async function searchEverything(
  rawQuery: string,
  limitPerGroup = 5,
): Promise<SearchResults> {
  const query = rawQuery.trim();
  if (query.length < 2) return EMPTY;
  const like = `%${query}%`;
  const provider = commerce();
  const sql = adminSql();

  const [orders, customers, products, rest] = await Promise.all([
    provider
      .listOrders({
        first: limitPerGroup,
        filter: { search: query },
        sortKey: "PROCESSED_AT",
        reverse: true,
      })
      .catch(() => null),
    provider
      .listCustomers({ first: limitPerGroup, search: query })
      .catch(() => null),
    provider
      .listProducts({
        first: limitPerGroup,
        filter: { search: query },
        sortKey: "TITLE",
      })
      .catch(() => null),
    sql
      .query(
        `select 'batch' as kind, b.id::text as id, b.batch_code as title,
                b.status as detail, p.title as extra
           from public.batches b
           left join public.products p on p.id = b.product_id
          where b.batch_code ilike $1
          limit $2`,
        [like, limitPerGroup],
      )
      .then(async (batches) => {
        const [suppliers, ingredients, agents, posts, rules, keys] =
          await Promise.all([
            sql.query(
              `select id::text as id, name as title, coalesce(city, region, '') as detail
                 from public.suppliers
                where name ilike $1 or code ilike $1 or coalesce(city,'') ilike $1
                limit $2`,
              [like, limitPerGroup],
            ),
            sql.query(
              `select id::text as id, name as title, category::text as detail
                 from public.ingredients
                where is_active and (name ilike $1 or code ilike $1)
                limit $2`,
              [like, limitPerGroup],
            ),
            sql.query(
              `select id::text as id, name as title, job_title as detail
                 from public.agents
                where name ilike $1 or job_title ilike $1 or slug ilike $1
                limit $2`,
              [like, limitPerGroup],
            ),
            sql.query(
              `select id::text as id, left(caption, 70) as title,
                      platform::text as detail, status::text as extra
                 from public.social_posts
                where caption ilike $1
                limit $2`,
              [like, limitPerGroup],
            ),
            sql.query(
              `select id::text as id, title, kind::text as detail
                 from public.brand_rules
                where is_active and (title ilike $1 or rule ilike $1)
                limit $2`,
              [like, limitPerGroup],
            ),
            sql.query(
              `select key as id, key as title, category as detail
                 from public.settings
                where is_secret = false
                  and (key ilike $1 or coalesce(description, '') ilike $1)
                limit $2`,
              [like, limitPerGroup],
            ),
          ]);
        return { batches, suppliers, ingredients, agents, posts, rules, keys };
      })
      .catch(() => null),
  ]);

  const hits: SearchHit[] = [];

  for (const order of orders?.nodes ?? []) {
    const who = order.customer?.displayName ?? order.email;
    hits.push({
      id: `order-${order.id}`,
      kind: "Order",
      title: `${order.orderNumber} — ${who}`,
      subtitle: `${money(order.total.amountInMinorUnits)}, ${FULFILMENT_WORDS[order.fulfillmentStatus] ?? order.fulfillmentStatus}`,
      section: "Orders & Delivery",
      href: `/admin/orders?q=${encodeURIComponent(order.orderNumber)}`,
    });
  }

  for (const customer of customers?.nodes ?? []) {
    hits.push({
      id: `customer-${customer.id}`,
      kind: "Customer",
      title: customer.displayName ?? customer.companyName ?? customer.email,
      subtitle: `${String(customer.ordersCount)} orders, ${money(customer.totalSpent.amountInMinorUnits)} spent`,
      section: "Customers & Marketing",
      href: `/admin/customers?q=${encodeURIComponent(customer.email)}`,
    });
  }

  for (const product of products?.nodes ?? []) {
    hits.push({
      id: `product-${product.id}`,
      kind: "Product",
      title: product.title,
      subtitle: `${money(product.priceRange.min.amountInMinorUnits)} · ${String(product.variants.length)} size${product.variants.length === 1 ? "" : "s"}`,
      section: "Stock & Batches",
      href: `/admin/stock?q=${encodeURIComponent(product.title)}`,
    });
  }

  if (rest !== null) {
    for (const row of rest.batches.rows) {
      hits.push({
        id: `batch-${text(row, "id")}`,
        kind: "Batch",
        title: text(row, "title"),
        subtitle: `${textOrNull(row, "extra") ?? "Batch"} · ${text(row, "detail").replace(/_/g, " ")}`,
        section: "Stock & Batches",
        href: `/admin/stock?q=${encodeURIComponent(text(row, "title"))}`,
      });
    }
    for (const row of rest.suppliers.rows) {
      hits.push({
        id: `supplier-${text(row, "id")}`,
        kind: "Supplier",
        title: text(row, "title"),
        subtitle: text(row, "detail"),
        section: "Stock & Batches",
        href: `/admin/stock?q=${encodeURIComponent(text(row, "title"))}`,
      });
    }
    for (const row of rest.ingredients.rows) {
      hits.push({
        id: `ingredient-${text(row, "id")}`,
        kind: "Ingredient",
        title: text(row, "title"),
        subtitle: `Ingredient · ${text(row, "detail")}`,
        section: "Stock & Batches",
        href: `/admin/stock?q=${encodeURIComponent(text(row, "title"))}`,
      });
    }
    for (const row of rest.agents.rows) {
      hits.push({
        id: `agent-${text(row, "id")}`,
        kind: "Team",
        title: text(row, "title"),
        subtitle: text(row, "detail"),
        section: "The Team",
        href: `/admin/team?q=${encodeURIComponent(text(row, "title"))}`,
      });
    }
    for (const row of rest.posts.rows) {
      hits.push({
        id: `post-${text(row, "id")}`,
        kind: "Social post",
        title: text(row, "title"),
        subtitle: `${PLATFORM_NAMES[text(row, "detail")] ?? text(row, "detail")} · ${POST_STATE_WORDS[text(row, "extra")] ?? text(row, "extra")}`,
        section: "Social",
        href: `/admin/social?q=${encodeURIComponent(text(row, "title").slice(0, 24))}`,
      });
    }
    for (const row of rest.rules.rows) {
      hits.push({
        id: `rule-${text(row, "id")}`,
        kind: "Brand rule",
        title: text(row, "title"),
        subtitle: text(row, "detail"),
        section: "Brand & Plan",
        href: "/admin/brand",
      });
    }
    for (const row of rest.keys.rows) {
      hits.push({
        id: `setting-${text(row, "id")}`,
        kind: "Setting",
        title: text(row, "title"),
        subtitle: text(row, "detail"),
        section: "Settings",
        href: `/admin/settings?q=${encodeURIComponent(text(row, "title"))}`,
      });
    }
  }

  return { query, hits };
}

/** Counts for the sidebar badges. Cheap, and read on every admin page. */
export type NavCountsData = {
  readonly needsYou: number;
  readonly toPack: number;
  readonly stockLow: number;
  readonly socialWaiting: number;
};

export async function navCounts(): Promise<NavCountsData> {
  const sql = adminSql();
  const result = await sql.query(
    `select
       (select count(*) from public.approvals where status = 'pending')       as approvals,
       (select count(*) from public.agent_runs
         where status = 'failed' and queued_at > now() - interval '30 days')  as failed_runs,
       (select count(*) from public.social_posts where status = 'failed')     as failed_posts,
       (select count(*) from public.webhook_events
         where process_status = 'failed')                                     as failed_hooks,
       (select count(*) from public.sync_state where status = 'failed')       as failed_syncs,
       (select count(*) from public.reviews
         where status = 'pending'
            or (status = 'published' and reply_body is null and rating <= 3)) as reviews,
       (select count(*) from public.orders
         where status = 'open' and fulfillment_status = 'unfulfilled')        as to_pack,
       (select count(*) from public.ingredients
         where is_active and reorder_point > 0
           and stock_on_hand <= reorder_point)                                as low_ingredients,
       (select count(*) from public.inventory_levels
         where reorder_point > 0 and available <= reorder_point)              as low_stock,
       (select count(*) from public.social_posts
         where status in ('pending_approval', 'scheduled'))                   as social_waiting`,
  );
  const row = result.rows[0] ?? {};
  const failures =
    int(row, "failed_runs") +
    int(row, "failed_posts") +
    int(row, "failed_hooks") +
    int(row, "failed_syncs");
  return {
    needsYou: int(row, "approvals") + failures + int(row, "reviews"),
    toPack: int(row, "to_pack"),
    stockLow: int(row, "low_ingredients") + int(row, "low_stock"),
    socialWaiting: int(row, "social_waiting"),
  };
}
