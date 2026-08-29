/**
 * Seeding the mock provider's database.
 *
 * The catalogue, locations, stock, customers and discount codes come from
 * `half-sour.seed.sql` (or from `supabase/seed.sql` if the platform's own seed
 * file exists, which takes precedence). The *order history* does not: it is
 * placed through {@link MockProvider.completeCheckout} and then backdated, so
 * every seeded order has a matching inventory ledger, discount redemption and
 * customer rollup instead of hand-typed figures that merely satisfy the check
 * constraints. A demo built on this looks like a shop that has been trading,
 * because arithmetically it has been.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { MockProvider } from "../mock/provider";
import type { SimulatedCheckoutInput } from "../provider";
import type { SqlExecutor } from "../sql/executor";

const FIXTURE_RELATIVE_PATH = path.join(
  "lib",
  "commerce",
  "seed",
  "half-sour.seed.sql",
);

/**
 * Locate the fixture without `import.meta.url`.
 *
 * The suite runs under Vitest (ESM), Playwright's runner (CJS) and plain Node,
 * and `import.meta` is a syntax error in one of those. Walking up from the
 * working directory works under all three and needs no build step.
 */
function resolveFixturePath(): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(directory, FIXTURE_RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(
    `Could not find ${FIXTURE_RELATIVE_PATH} from ${process.cwd()}`,
  );
}

/** Variant ids from the fixture, so callers do not have to look them up. */
export const SEED_VARIANTS = {
  house: "22222222-0000-4000-8000-000000000001",
  dirty: "22222222-0000-4000-8000-000000000002",
  smoke: "22222222-0000-4000-8000-000000000003",
  fullSet: "22222222-0000-4000-8000-000000000004",
} as const;

export const SEED_CUSTOMERS = {
  aroha: "55555555-0000-4000-8000-000000000001",
  tom: "55555555-0000-4000-8000-000000000002",
  meiling: "55555555-0000-4000-8000-000000000003",
  brassPenny: "55555555-0000-4000-8000-000000000004",
  sione: "55555555-0000-4000-8000-000000000005",
} as const;

export const SEED_LOCATIONS = {
  kitchen: "44444444-0000-4000-8000-000000000001",
  coolstore: "44444444-0000-4000-8000-000000000002",
  market: "44444444-0000-4000-8000-000000000003",
} as const;

export const SEED_PRODUCTS = {
  house: "11111111-0000-4000-8000-000000000001",
  dirty: "11111111-0000-4000-8000-000000000002",
  smoke: "11111111-0000-4000-8000-000000000003",
  fullSet: "11111111-0000-4000-8000-000000000004",
} as const;

/**
 * Apply the catalogue fixture. Idempotent.
 *
 * Defaults to this unit's own fixture rather than `supabase/seed.sql`, and
 * deliberately so: the conformance suite asserts on specific SKUs, prices and
 * stock levels, and a suite whose expectations can be changed by another unit
 * editing an unrelated file is not a conformance suite. Pass
 * {@link platformSeedPath} to load the platform seed instead.
 */
export async function seedCatalogue(
  sql: SqlExecutor,
  source: string | URL = resolveFixturePath(),
): Promise<string> {
  const text = readFileSync(source, "utf8");
  await sql.execScript(text);
  return typeof source === "string" ? source : source.pathname;
}

/** `supabase/seed.sql`, if the platform unit has written one. */
export function platformSeedPath(): string | null {
  const candidate = path.join(process.cwd(), "supabase", "seed.sql");
  return existsSync(candidate) ? candidate : null;
}

type DemoOrder = {
  readonly customerId: string;
  readonly daysAgo: number;
  readonly lines: readonly {
    readonly variantId: string;
    readonly quantity: number;
  }[];
  readonly discountCode?: string;
  readonly checkout: SimulatedCheckoutInput;
  readonly fulfil?: {
    readonly carrier: string;
    readonly trackingNumber: string;
  };
  readonly delivered?: boolean;
};

const NZ_POST = "NZ Post";

const DEMO_ORDERS: readonly DemoOrder[] = [
  {
    customerId: SEED_CUSTOMERS.aroha,
    daysAgo: 41,
    lines: [{ variantId: SEED_VARIANTS.smoke, quantity: 1 }],
    checkout: {
      email: "aroha.ngata@example.co.nz",
      phone: "+64 21 447 992",
      shippingAddress: {
        firstName: "Aroha",
        lastName: "Ngata",
        line1: "48 Surrey Crescent",
        suburb: "Grey Lynn",
        city: "Auckland",
        region: "Auckland",
        postcode: "1021",
        phone: "+64 21 447 992",
        deliveryInstructions: "Leave by the side gate.",
      },
      acceptsMarketing: true,
    },
    fulfil: { carrier: NZ_POST, trackingNumber: "NZ4471928374NZ" },
    delivered: true,
  },
  {
    customerId: SEED_CUSTOMERS.aroha,
    daysAgo: 12,
    lines: [
      { variantId: SEED_VARIANTS.house, quantity: 2 },
      { variantId: SEED_VARIANTS.dirty, quantity: 1 },
    ],
    discountCode: "WELCOME10",
    checkout: {
      email: "aroha.ngata@example.co.nz",
      phone: "+64 21 447 992",
      shippingAddress: {
        firstName: "Aroha",
        lastName: "Ngata",
        line1: "48 Surrey Crescent",
        suburb: "Grey Lynn",
        city: "Auckland",
        region: "Auckland",
        postcode: "1021",
        phone: "+64 21 447 992",
      },
    },
    fulfil: { carrier: NZ_POST, trackingNumber: "NZ4482017365NZ" },
    delivered: true,
  },
  {
    customerId: SEED_CUSTOMERS.tom,
    daysAgo: 26,
    lines: [{ variantId: SEED_VARIANTS.fullSet, quantity: 1 }],
    discountCode: "FULLSET5",
    checkout: {
      email: "tom.blackwood@example.co.nz",
      phone: "+64 27 118 640",
      shippingAddress: {
        firstName: "Tom",
        lastName: "Blackwood",
        line1: "9 Ellice Street",
        line2: "Flat 2",
        suburb: "Mount Victoria",
        city: "Wellington",
        region: "Wellington",
        postcode: "6011",
        phone: "+64 27 118 640",
      },
      customerNote: "Gift for my brother — no invoice in the box please.",
    },
    fulfil: { carrier: NZ_POST, trackingNumber: "NZ4390118822NZ" },
    delivered: true,
  },
  {
    customerId: SEED_CUSTOMERS.brassPenny,
    daysAgo: 4,
    lines: [
      { variantId: SEED_VARIANTS.house, quantity: 6 },
      { variantId: SEED_VARIANTS.dirty, quantity: 6 },
    ],
    discountCode: "BARFLY",
    checkout: {
      email: "orders@brasspenny.example.nz",
      phone: "+64 9 361 2280",
      shippingAddress: {
        firstName: "Dan",
        lastName: "Petersen",
        company: "The Brass Penny",
        line1: "14 Vermont Street",
        suburb: "Ponsonby",
        city: "Auckland",
        region: "Auckland",
        postcode: "1011",
        phone: "+64 9 361 2280",
        deliveryInstructions: "Before 3pm, Vermont Street door.",
      },
    },
    fulfil: { carrier: "Post Haste", trackingNumber: "PH0099471624" },
  },
  {
    customerId: SEED_CUSTOMERS.meiling,
    daysAgo: 5,
    lines: [{ variantId: SEED_VARIANTS.fullSet, quantity: 2 }],
    checkout: {
      email: "meiling.chen@example.co.nz",
      phone: "+64 22 903 517",
      shippingAddress: {
        firstName: "Mei-Ling",
        lastName: "Chen",
        line1: "132 Papanui Road",
        suburb: "Merivale",
        city: "Christchurch",
        region: "Canterbury",
        postcode: "8014",
        phone: "+64 22 903 517",
      },
      acceptsMarketing: true,
    },
  },
  {
    customerId: SEED_CUSTOMERS.sione,
    daysAgo: 1,
    lines: [{ variantId: SEED_VARIANTS.smoke, quantity: 1 }],
    checkout: {
      email: "sione.tuilagi@example.co.nz",
      phone: "+64 21 660 204",
      shippingAddress: {
        firstName: "Sione",
        lastName: "Tuilagi",
        line1: "27 Ruakura Road",
        suburb: "Hamilton East",
        city: "Hamilton",
        region: "Waikato",
        postcode: "3216",
        phone: "+64 21 660 204",
      },
    },
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Place the demo order history. Each order goes through create cart -> add
 * lines -> identify buyer -> apply code -> checkout, exactly as a shopper
 * would, and is then moved back in time.
 */
export async function seedOrderHistory(
  provider: MockProvider,
  sql: SqlExecutor,
  now: Date = new Date(),
): Promise<readonly string[]> {
  const placed: string[] = [];

  for (const demo of DEMO_ORDERS) {
    const { cart } = await provider.createCart();
    await provider.addCartLines(cart.id, demo.lines);
    await provider.updateCartBuyerIdentity(cart.id, {
      customerId: demo.customerId,
    });
    if (demo.discountCode !== undefined) {
      await provider.updateCartDiscountCodes(cart.id, [demo.discountCode]);
    }
    const order = await provider.completeCheckout(cart.id, demo.checkout);
    if (demo.fulfil !== undefined) {
      await provider.fulfillOrder(order.id, {
        carrier: demo.fulfil.carrier,
        trackingNumber: demo.fulfil.trackingNumber,
        trackingUrl: `https://www.nzpost.co.nz/tools/tracking/item/${demo.fulfil.trackingNumber}`,
      });
    }

    const placedAt = new Date(now.getTime() - demo.daysAgo * DAY_MS);
    await backdateOrder(sql, order.id, placedAt, demo.delivered === true);
    placed.push(order.id);
  }

  await recomputeCustomerRollups(sql);
  return placed;
}

/**
 * Move an order, its lines and its stock movements back in time.
 *
 * Written as explicit updates rather than by inserting fabricated rows so the
 * order still satisfies `orders_total_balances`, `orders_dates_after_placed`
 * and every other constraint it was created under.
 */
async function backdateOrder(
  sql: SqlExecutor,
  orderId: string,
  placedAt: Date,
  delivered: boolean,
): Promise<void> {
  const placed = placedAt.toISOString();
  const fulfilled = new Date(placedAt.getTime() + DAY_MS).toISOString();
  const deliveredAt = new Date(placedAt.getTime() + 3 * DAY_MS).toISOString();

  await sql.query(
    `update public.orders
        set placed_at = $2::timestamptz,
            created_at = $2::timestamptz,
            paid_at = case when paid_at is null then null else $2::timestamptz end,
            fulfilled_at = case
              when fulfilled_at is null then null else $3::timestamptz end,
            fulfillment_status = case
              when $4::boolean and fulfilled_at is not null
              then 'delivered'::public.order_fulfillment_status
              else fulfillment_status end,
            delivered_at = case
              when $4::boolean and fulfilled_at is not null
              then $5::timestamptz else delivered_at end
      where id = $1`,
    [orderId, placed, fulfilled, delivered, deliveredAt],
  );
  await sql.query(
    `update public.order_items set created_at = $2::timestamptz where order_id = $1`,
    [orderId, placed],
  );
  await sql.query(
    `update public.inventory_adjustments ia
        set occurred_at = $2::timestamptz, created_at = $2::timestamptz
       from public.order_items oi
      where oi.id = ia.order_item_id and oi.order_id = $1`,
    [orderId, placed],
  );
  await sql.query(
    `update public.discount_redemptions set redeemed_at = $2::timestamptz where order_id = $1`,
    [orderId, placed],
  );
  await sql.query(
    `update public.carts set created_at = $2::timestamptz where converted_order_id = $1`,
    [orderId, placed],
  );
}

/** Rebuild every customer's order rollups from the orders that now exist. */
async function recomputeCustomerRollups(sql: SqlExecutor): Promise<void> {
  await sql.query(
    `update public.customers c
        set orders_count = 0, total_spent_cents = 0,
            first_ordered_at = null, last_ordered_at = null
      where c.orders_count > 0`,
  );
  await sql.query(
    `update public.customers c
        set orders_count = agg.order_count,
            total_spent_cents = agg.spent,
            first_ordered_at = agg.first_at,
            last_ordered_at = agg.last_at
       from (select o.customer_id,
                    count(*)::int as order_count,
                    sum(o.total_cents)::int as spent,
                    min(o.placed_at) as first_at,
                    max(o.placed_at) as last_at
               from public.orders o
              where o.customer_id is not null and o.status <> 'cancelled'
              group by o.customer_id) agg
      where agg.customer_id = c.id`,
  );
}

/** Catalogue plus order history, in one call. */
export async function seedCommerce(
  provider: MockProvider,
  sql: SqlExecutor,
  now?: Date,
  source_?: string | URL,
): Promise<{ source: string; orderIds: readonly string[] }> {
  const source = await seedCatalogue(sql, source_ ?? resolveFixturePath());
  const orderIds = await seedOrderHistory(provider, sql, now);
  return { source, orderIds };
}
