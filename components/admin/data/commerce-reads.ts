import "server-only";

import type {
  Customer,
  InventoryLevel,
  InventoryLocation,
  Order,
  OrderListQuery,
  Product,
} from "@/lib/commerce";

import { commerce } from "./db";
import { nzDateKey } from "./format";

/**
 * Everything the admin knows about orders, products and stock.
 *
 * All of it goes through `lib/commerce`'s provider interface. Nothing in here
 * writes SQL against `public.orders`, and nothing above here knows whether the
 * answers came from the Supabase mirror or from Shopify.
 */

const MAX_PAGE = 250;

/**
 * The two order states this admin can read.
 *
 * There is a third, `cancelled`, and it is deliberately never asked for. The
 * mock provider cannot map a cancelled order: the schema records its
 * fulfilment as `cancelled` while the domain type's matching value is
 * `restocked`, so mapping the row throws before it reaches this file. Rather
 * than let one voided order take a whole screen down, every list here asks for
 * the live states by name. The cancelled order is reported in Money as a
 * count, which is where its only remaining meaning is.
 *
 * This is a defect in `lib/commerce`, not a preference. It belongs to that
 * unit; this constant is the containment.
 */
const READABLE_STATUSES = ["open", "archived"] as const;

/**
 * Run an order query once per readable state and merge, newest first.
 *
 * `OrderListFilter.status` takes one value, so "everything except cancelled"
 * is two calls. At this shop's volume that is two indexed queries.
 */
async function listOrders(
  query: OrderListQuery,
  limit: number,
): Promise<readonly Order[]> {
  const provider = commerce();
  const pages = await Promise.all(
    READABLE_STATUSES.map(async (status) => {
      const collected: Order[] = [];
      let after: string | undefined;
      while (collected.length < limit) {
        const page = await provider.listOrders({
          ...query,
          first: Math.min(MAX_PAGE, limit - collected.length),
          ...(after === undefined ? {} : { after }),
          filter: { ...query.filter, status },
        });
        collected.push(...page.nodes);
        if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) {
          break;
        }
        after = page.pageInfo.endCursor;
      }
      return collected;
    }),
  );
  return pages
    .flat()
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
    .slice(0, limit);
}

/** Every order placed since `since`, newest first. */
export async function ordersSince(
  since: Date,
  limit = 500,
): Promise<readonly Order[]> {
  return listOrders(
    {
      filter: { placedAfter: since.toISOString() },
      sortKey: "PROCESSED_AT",
      reverse: true,
    },
    limit,
  );
}

/** The most recent orders, newest first. */
export async function recentOrders(first = 25): Promise<readonly Order[]> {
  return listOrders({ sortKey: "PROCESSED_AT", reverse: true }, first);
}

/** Orders matching a free-text search over order number and email. */
export async function searchOrders(
  search: string,
  first = 25,
): Promise<readonly Order[]> {
  return listOrders(
    { filter: { search }, sortKey: "PROCESSED_AT", reverse: true },
    first,
  );
}

/** Paid but not yet packed, oldest first — the pack queue. */
export async function ordersToPack(first = 25): Promise<readonly Order[]> {
  const page = await commerce().listOrders({
    first,
    filter: { status: "open", fulfillmentStatus: "unfulfilled" },
    sortKey: "PROCESSED_AT",
  });
  return page.nodes;
}

/** Packed and on the way, so she can answer "where is my order" questions. */
export async function ordersInTransit(first = 10): Promise<readonly Order[]> {
  const page = await commerce().listOrders({
    first,
    filter: { status: "open", fulfillmentStatus: "fulfilled" },
    sortKey: "PROCESSED_AT",
    reverse: true,
  });
  return page.nodes;
}

export async function allProducts(): Promise<readonly Product[]> {
  const page = await commerce().listProducts({
    first: 50,
    filter: { status: "active" },
    sortKey: "TITLE",
  });
  return page.nodes;
}

export async function inventoryLevels(): Promise<readonly InventoryLevel[]> {
  const page = await commerce().getInventoryLevels({ first: MAX_PAGE });
  return page.nodes;
}

export async function locations(): Promise<readonly InventoryLocation[]> {
  return commerce().listLocations();
}

// ---------------------------------------------------------------------------
// Derived numbers — the ones a person actually asks for
// ---------------------------------------------------------------------------

export type SalesWindow = {
  /** Orders placed in the window, cancelled ones excluded. */
  readonly orders: number;
  /** What customers paid, GST included, in cents. */
  readonly takingsCents: number;
  /** The GST inside those takings. Owed to IRD, not income. */
  readonly gstCents: number;
  /** Takings divided by orders, in cents. */
  readonly averageOrderCents: number;
  /** Bottles and sets shipped. */
  readonly units: number;
};

export function summarise(orders: readonly Order[]): SalesWindow {
  const live = orders.filter((order) => order.status !== "cancelled");
  const takingsCents = live.reduce(
    (sum, o) => sum + o.total.amountInMinorUnits,
    0,
  );
  const gstCents = live.reduce(
    (sum, o) => sum + o.taxTotal.amountInMinorUnits,
    0,
  );
  const units = live.reduce(
    (sum, o) => sum + o.lineItems.reduce((n, line) => n + line.quantity, 0),
    0,
  );
  return {
    orders: live.length,
    takingsCents,
    gstCents,
    averageOrderCents:
      live.length === 0 ? 0 : Math.round(takingsCents / live.length),
    units,
  };
}

/** Orders placed between two instants. */
export function between(
  orders: readonly Order[],
  from: Date,
  to: Date,
): readonly Order[] {
  return orders.filter((order) => {
    const placed = new Date(order.placedAt).getTime();
    return placed >= from.getTime() && placed < to.getTime();
  });
}

/** Units sold per SKU across a set of orders — the input to "days of cover". */
export function unitsBySku(
  orders: readonly Order[],
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    for (const line of order.lineItems) {
      totals.set(line.sku, (totals.get(line.sku) ?? 0) + line.quantity);
    }
  }
  return totals;
}

export type DayTakings = {
  /** `2026-08-30`, in New Zealand time. */
  readonly date: string;
  readonly takingsCents: number;
  readonly orders: number;
};

/** A day-by-day series, with the quiet days present as zeroes. */
export function dailyTakings(
  orders: readonly Order[],
  days: number,
  now: Date,
): readonly DayTakings[] {
  const buckets = new Map<string, { takingsCents: number; orders: number }>();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let back = days - 1; back >= 0; back -= 1) {
    buckets.set(nzDateKey(new Date(now.getTime() - back * dayMs)), {
      takingsCents: 0,
      orders: 0,
    });
  }
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    const key = nzDateKey(order.placedAt);
    const bucket = buckets.get(key);
    if (bucket === undefined) continue;
    bucket.takingsCents += order.total.amountInMinorUnits;
    bucket.orders += 1;
  }
  return [...buckets.entries()].map(([date, value]) => ({ date, ...value }));
}

export type WeekTakings = {
  /** Monday of the week, in New Zealand time. */
  readonly weekStart: string;
  readonly takingsCents: number;
  readonly orders: number;
};

/** Takings by week, oldest first. Weeks start on Monday, as NZ business does. */
export function weeklyTakings(
  orders: readonly Order[],
  weeks: number,
  now: Date,
): readonly WeekTakings[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfWeek = (value: Date): string => {
    const key = nzDateKey(value);
    const parsed = new Date(`${key}T00:00:00Z`);
    const weekday = (parsed.getUTCDay() + 6) % 7;
    return nzDateKey(new Date(parsed.getTime() - weekday * dayMs));
  };
  const buckets = new Map<string, { takingsCents: number; orders: number }>();
  for (let back = weeks - 1; back >= 0; back -= 1) {
    buckets.set(startOfWeek(new Date(now.getTime() - back * 7 * dayMs)), {
      takingsCents: 0,
      orders: 0,
    });
  }
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    const bucket = buckets.get(startOfWeek(new Date(order.placedAt)));
    if (bucket === undefined) continue;
    bucket.takingsCents += order.total.amountInMinorUnits;
    bucket.orders += 1;
  }
  return [...buckets.entries()].map(([weekStart, value]) => ({
    weekStart,
    ...value,
  }));
}

export type StockLine = {
  readonly sku: string;
  readonly productTitle: string;
  readonly variantTitle: string;
  readonly locationCode: string;
  readonly locationName: string;
  readonly onHand: number;
  readonly committed: number;
  readonly available: number;
  readonly reorderPoint: number;
  readonly reorderQuantity: number;
};

/** Inventory levels with the product and location named rather than keyed. */
export function nameStockLines(
  levels: readonly InventoryLevel[],
  products: readonly Product[],
  places: readonly InventoryLocation[],
): readonly StockLine[] {
  // A product with two sizes needs the size in its name, or the 500ml and the
  // 1 litre appear twice under one title and neither can be told apart.
  const bySku = new Map<string, { title: string; variantTitle: string }>();
  for (const product of products) {
    for (const variant of product.variants) {
      bySku.set(variant.sku, {
        title:
          product.variants.length > 1
            ? `${product.title} · ${variant.title}`
            : product.title,
        variantTitle: variant.title,
      });
    }
  }
  const byCode = new Map(places.map((place) => [place.code, place]));
  return levels.map((level) => {
    const match = bySku.get(level.sku);
    const place = byCode.get(level.locationCode);
    return {
      sku: level.sku,
      productTitle: match?.title ?? level.sku,
      variantTitle: match?.variantTitle ?? "",
      locationCode: level.locationCode,
      locationName: place?.name ?? level.locationCode,
      onHand: level.onHand,
      committed: level.committed,
      available: level.available,
      reorderPoint: level.reorderPoint,
      reorderQuantity: level.reorderQuantity,
    };
  });
}

export type SkuStock = {
  readonly sku: string;
  readonly productTitle: string;
  /** Sellable across every location. */
  readonly available: number;
  readonly onHand: number;
  /** Held for orders that are paid but not yet packed. */
  readonly committed: number;
  readonly reorderPoint: number;
  readonly soldPerDay: number;
  /** Whole days of stock left at the recent rate, or null when nothing sells. */
  readonly coverDays: number | null;
  readonly locations: readonly StockLine[];
};

/** One row per product, which is how she thinks about stock. */
export function stockBySku(
  lines: readonly StockLine[],
  soldPerDay: ReadonlyMap<string, number>,
): readonly SkuStock[] {
  const grouped = new Map<string, StockLine[]>();
  for (const line of lines) {
    const bucket = grouped.get(line.sku);
    if (bucket === undefined) grouped.set(line.sku, [line]);
    else bucket.push(line);
  }
  return [...grouped.entries()]
    .map(([sku, group]) => {
      const rate = soldPerDay.get(sku) ?? 0;
      const available = group.reduce((sum, line) => sum + line.available, 0);
      return {
        sku,
        productTitle: group[0]?.productTitle ?? sku,
        available,
        onHand: group.reduce((sum, line) => sum + line.onHand, 0),
        committed: group.reduce((sum, line) => sum + line.committed, 0),
        reorderPoint: group.reduce((sum, line) => sum + line.reorderPoint, 0),
        soldPerDay: rate,
        coverDays: rate <= 0 ? null : Math.floor(available / rate),
        locations: group,
      };
    })
    .sort((a, b) => {
      const left = a.coverDays ?? Number.MAX_SAFE_INTEGER;
      const right = b.coverDays ?? Number.MAX_SAFE_INTEGER;
      return left - right;
    });
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/** Everyone who has ever bought, through the adapter. */
export async function allCustomers(first = 250): Promise<readonly Customer[]> {
  const page = await commerce().listCustomers({ first });
  return page.nodes;
}

/** Customers matching a free-text search over name and email. */
export async function searchCustomers(
  search: string,
  first = 25,
): Promise<readonly Customer[]> {
  const page = await commerce().listCustomers({ first, search });
  return page.nodes;
}

export type CustomerRollup = {
  readonly total: number;
  readonly repeat: number;
  readonly trade: number;
  readonly marketing: number;
  readonly lifetimeCents: number;
};

/** The handful of customer numbers worth putting on a screen. */
export function rollUpCustomers(
  customers: readonly Customer[],
): CustomerRollup {
  const buyers = customers.filter((customer) => customer.ordersCount > 0);
  return {
    total: buyers.length,
    repeat: buyers.filter((customer) => customer.ordersCount > 1).length,
    trade: customers.filter(
      (customer) =>
        customer.customerType === "trade" ||
        customer.customerType === "wholesale",
    ).length,
    marketing: customers.filter((customer) => customer.acceptsMarketing).length,
    lifetimeCents: buyers.reduce(
      (sum, customer) => sum + customer.totalSpent.amountInMinorUnits,
      0,
    ),
  };
}
