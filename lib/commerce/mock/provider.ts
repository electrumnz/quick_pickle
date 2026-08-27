/**
 * `MockProvider` — the commerce provider backed directly by the Supabase
 * schema.
 *
 * This is not a test double. Until the store owner issues Shopify API tokens by
 * hand, this is what the storefront and the admin actually run on, so every
 * operation is a real transaction against the real tables with the real check
 * constraints in force. Seeded with the real product line it is indistinguishable
 * from a working shop, and the conformance suite that proves the Shopify
 * implementation later is the same suite that proves this one now.
 *
 * Three invariants hold everywhere below.
 *
 * 1. **Prices come from `product_variants`, on every call.** `cart_items
 *    .unit_price_cents` is a denormalised cache. It is re-synced from the
 *    catalogue at the top of every cart read and every cart mutation, so a row
 *    edited behind the application's back is corrected before it can affect a
 *    total. Nothing a client sends can name a price.
 *
 * 2. **Anything that changes money or stock runs in one transaction.** Checkout
 *    takes stock, writes the ledger, creates the order, redeems the discount
 *    and converts the cart, or it does none of those things.
 *
 * 3. **Rows are written with `provider = 'local'` and `sync_status = 'local'`.**
 *    That is the schema's discriminator for "this never came from Shopify", and
 *    its own constraints enforce that such a row carries no Shopify identity.
 */

import { randomBytes } from "node:crypto";

import {
  commerceErrors,
  CommerceError,
  type CommerceErrorCode,
} from "../errors";
import {
  money,
  taxIncludedInTotal,
  zeroMoney,
  DEFAULT_CURRENCY,
  NZ_GST_BASIS_POINTS,
  type CurrencyCode,
} from "../money";
import type {
  CheckoutSimulator,
  CommerceProvider,
  ProviderCapabilities,
  SimulatedCheckoutAddress,
  SimulatedCheckoutInput,
} from "../provider";
import {
  MAX_CART_LINES,
  MAX_PAGE_SIZE,
  type Attribute,
  type BuyerIdentityInput,
  type Cart,
  type CartCreateInput,
  type CartLine,
  type CartLineInput,
  type CartLineUpdateInput,
  type CartMutationResult,
  type CartWarning,
  type CheckoutHandoff,
  type Collection,
  type CollectionListQuery,
  type CollectionProductsQuery,
  type CollectionWithProducts,
  type Connection,
  type Customer,
  type CustomerListQuery,
  type CustomerType,
  type Discount,
  type DiscountAllocation,
  type DiscountValidation,
  type InventoryAdjustInput,
  type InventoryAdjustResult,
  type InventoryLevel,
  type InventoryLocation,
  type InventoryQuery,
  type Order,
  type OrderCancelInput,
  type OrderFulfillmentInput,
  type OrderLineItem,
  type OrderListQuery,
  type OrderPatch,
  type Product,
  type ProductListQuery,
  type ProductVariant,
} from "../types";
import { queryOne, type SqlExecutor, type SqlRow } from "../sql/executor";
import {
  bool,
  int,
  intOrNull,
  iso,
  isoOrNull,
  jsonArray,
  jsonObject,
  oneOf,
  str,
  strArray,
  strOrNull,
} from "./coerce";
import {
  buildConnection,
  emptyConnection,
  resolvePageWindow,
  type PageWindow,
} from "./cursor";
import {
  mapCollection,
  mapCustomer,
  mapDiscount,
  mapInventoryLevel,
  mapLocation,
  mapProduct,
} from "./mappers";
import {
  computeCartTotals,
  computeOrderTotals,
  evaluateDiscount,
  type DiscountOutcome,
  type DiscountRule,
  type PricedLineInput,
} from "./pricing";

// ---------------------------------------------------------------------------
// Parameter binding
// ---------------------------------------------------------------------------

/**
 * Collects bind parameters and hands back `$n` placeholders. Every value that
 * reaches SQL goes through here; there is no string interpolation of data
 * anywhere in this file.
 */
class Params {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${String(this.values.length)}`;
  }
}

/** Reserved `carts.attributes` keys. Hidden from the public attribute list. */
const BUYER_PHONE_KEY = "__buyer_phone";
const BUYER_COUNTRY_KEY = "__buyer_country";
const MERGED_INTO_KEY = "__merged_into";
const RESERVED_ATTRIBUTE_KEYS = new Set([
  BUYER_PHONE_KEY,
  BUYER_COUNTRY_KEY,
  MERGED_INTO_KEY,
]);

const CART_ID_PATTERN = /^([0-9a-fA-F-]{36})\?key=([0-9a-f]{32,128})$/;

function composeCartId(id: string, token: string): string {
  return `${id}?key=${token}`;
}

/**
 * Split the opaque cart handle back into its row id and bearer token.
 *
 * Mirrors Shopify, whose cart id is `gid://shopify/Cart/<token>?key=<secret>`
 * and which refuses to mutate a cart when the key is missing. A handle without
 * a well-formed key is treated as a cart that does not exist, so a guessed uuid
 * gets the same answer as a wrong one.
 */
function parseCartId(cartId: string): { id: string; token: string } | null {
  const match = CART_ID_PATTERN.exec(cartId);
  if (match === null) return null;
  const [, id, token] = match;
  if (id === undefined || token === undefined) return null;
  return { id, token };
}

function newCartToken(): string {
  return randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

type CartRow = {
  readonly id: string;
  readonly token: string;
  readonly currencyCode: CurrencyCode;
  readonly customerId: string | null;
  readonly email: string | null;
  readonly status: "active" | "abandoned" | "converted" | "expired";
  readonly note: string | null;
  readonly attributes: Record<string, unknown>;
  readonly discountId: string | null;
  readonly discountCode: string | null;
  readonly convertedOrderId: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type CartLineRow = {
  readonly lineId: string;
  readonly quantity: number;
  readonly attributes: readonly Attribute[];
  readonly storedUnitPriceCents: number;
  readonly variantId: string;
  readonly productId: string;
  readonly sku: string;
  readonly barcode: string | null;
  readonly variantTitle: string;
  readonly priceCents: number;
  readonly compareAtPriceCents: number | null;
  readonly currencyCode: CurrencyCode;
  readonly sizeMl: number | null;
  readonly packCount: number;
  readonly weightGrams: number | null;
  readonly trackInventory: boolean;
  readonly inventoryPolicy: "deny" | "continue";
  readonly position: number;
  readonly variantDeleted: boolean;
  readonly productHandle: string;
  readonly productTitle: string;
  readonly productSellable: boolean;
  readonly requiresShipping: boolean;
  readonly heroImageUrl: string | null;
  readonly stockAvailable: number;
  readonly collectionIds: readonly string[];
};

type LoadedCart = {
  readonly cart: CartRow;
  readonly lines: readonly CartLineRow[];
};

export type MockProviderOptions = {
  readonly sql: SqlExecutor;
  /** Absolute origin used to build the mock checkout URL. */
  readonly siteUrl: string;
  readonly currencyCode?: CurrencyCode;
  /** Injectable clock, so expiry can be tested without waiting 30 days. */
  readonly now?: () => Date;
  readonly cartTtlDays?: number;
};

// ---------------------------------------------------------------------------
// Catalogue SQL
//
// One set of CTEs shared by every catalogue read, so "what is available" is
// defined exactly once: stock is summed over the locations that actually ship
// orders, a variant is sellable when it is untracked, on backorder, or has
// stock, and a product is sellable when any of its variants is.
// ---------------------------------------------------------------------------

const CATALOGUE_CTES = `
with shipping_location as (
  select id from public.inventory_locations where is_active and ships_orders
),
variant_stock as (
  select il.variant_id, sum(il.available)::int as available
    from public.inventory_levels il
    join shipping_location sl on sl.id = il.location_id
   group by il.variant_id
),
live_variant as (
  select v.*, coalesce(vs.available, 0)::int as stock_available
    from public.product_variants v
    left join variant_stock vs on vs.variant_id = v.id
   where v.deleted_at is null
),
product_agg as (
  select lv.product_id,
         min(lv.price_cents)::int as min_price_cents,
         max(lv.price_cents)::int as max_price_cents,
         bool_or(case
                   when not lv.track_inventory then true
                   when lv.inventory_policy = 'continue' then true
                   else lv.stock_available > 0
                 end) as available_for_sale
    from live_variant lv
   group by lv.product_id
),
best_selling as (
  select oi.product_id, sum(oi.quantity)::int as units_sold
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.status <> 'cancelled'
   group by oi.product_id
)`;

const VARIANT_JSON = `json_build_object(
  'id', lv.id, 'sku', lv.sku, 'barcode', lv.barcode, 'title', lv.title,
  'price_cents', lv.price_cents,
  'compare_at_price_cents', lv.compare_at_price_cents,
  'currency', lv.currency, 'size_ml', lv.size_ml, 'pack_count', lv.pack_count,
  'weight_grams', lv.weight_grams, 'track_inventory', lv.track_inventory,
  'inventory_policy', lv.inventory_policy, 'is_trade_only', lv.is_trade_only,
  'position', lv.position, 'stock_available', lv.stock_available
)`;

const IMAGE_JSON = `json_build_object(
  'id', pi.id, 'url', pi.url, 'alt_text', pi.alt_text, 'position', pi.position,
  'width_px', pi.width_px, 'height_px', pi.height_px, 'variant_id', pi.variant_id
)`;

const PRODUCT_COLUMNS = `
  p.id, p.handle, p.title, p.subtitle, p.description, p.product_type, p.vendor,
  p.status, p.published_at, p.tags, p.seo_title, p.seo_description,
  p.requires_shipping, p.hero_image_url, p.position, p.created_at, p.updated_at,
  pa.min_price_cents, pa.max_price_cents, pa.available_for_sale,
  coalesce(bs.units_sold, 0) as units_sold,
  (select coalesce(json_agg(${VARIANT_JSON} order by lv.position, lv.sku), '[]'::json)
     from live_variant lv where lv.product_id = p.id) as variants,
  (select coalesce(json_agg(${IMAGE_JSON} order by pi.position, pi.id), '[]'::json)
     from public.product_images pi where pi.product_id = p.id) as images`;

const PRODUCT_FROM = `
  from public.products p
  join product_agg pa on pa.product_id = p.id
  left join best_selling bs on bs.product_id = p.id`;

type ProductFilterArg = NonNullable<ProductListQuery["filter"]>;

function productConditions(
  filter: ProductFilterArg | undefined,
  params: Params,
): string[] {
  const conditions = ["p.deleted_at is null"];
  const status = filter?.status ?? "active";
  conditions.push(`p.status = ${params.add(status)}`);
  if (status === "active") conditions.push("p.published_at is not null");

  if (filter === undefined) return conditions;

  if (filter.availableForSale !== undefined) {
    conditions.push(
      filter.availableForSale
        ? "pa.available_for_sale"
        : "not pa.available_for_sale",
    );
  }
  if (filter.productType !== undefined) {
    conditions.push(`p.product_type = ${params.add(filter.productType)}`);
  }
  if (filter.vendor !== undefined) {
    conditions.push(`p.vendor = ${params.add(filter.vendor)}`);
  }
  if (filter.tags !== undefined && filter.tags.length > 0) {
    conditions.push(`p.tags @> ${params.add([...filter.tags])}::text[]`);
  }
  if (filter.excludeTags !== undefined && filter.excludeTags.length > 0) {
    conditions.push(
      `not (p.tags && ${params.add([...filter.excludeTags])}::text[])`,
    );
  }
  if (filter.search !== undefined && filter.search.trim() !== "") {
    conditions.push(
      `p.search_vector @@ websearch_to_tsquery('english', ${params.add(filter.search)})`,
    );
  }
  if (filter.minPrice !== undefined) {
    conditions.push(
      `exists (select 1 from live_variant lv where lv.product_id = p.id and lv.price_cents >= ${params.add(filter.minPrice)})`,
    );
  }
  if (filter.maxPrice !== undefined) {
    conditions.push(
      `exists (select 1 from live_variant lv where lv.product_id = p.id and lv.price_cents <= ${params.add(filter.maxPrice)})`,
    );
  }
  if (filter.createdAfter !== undefined) {
    conditions.push(`p.created_at > ${params.add(filter.createdAfter)}`);
  }
  if (filter.updatedAfter !== undefined) {
    conditions.push(`p.updated_at > ${params.add(filter.updatedAfter)}`);
  }
  return conditions;
}

function productOrderBy(
  sortKey: ProductListQuery["sortKey"] | "MANUAL" | undefined,
  reverse: boolean,
  search: string | undefined,
  params: Params,
): string {
  const direction = reverse ? "desc" : "asc";
  const inverse = reverse ? "asc" : "desc";
  switch (sortKey ?? "TITLE") {
    case "PRICE":
      return `pa.min_price_cents ${direction}, p.title asc, p.id asc`;
    case "CREATED_AT":
      return `p.created_at ${direction}, p.id asc`;
    case "UPDATED_AT":
      return `p.updated_at ${direction}, p.id asc`;
    case "BEST_SELLING":
      // "Best selling" counts down by default, so reverse flips it up.
      return `coalesce(bs.units_sold, 0) ${inverse}, p.title asc, p.id asc`;
    case "PRODUCT_TYPE":
      return `p.product_type ${direction} nulls last, p.title asc, p.id asc`;
    case "MANUAL":
      return `cp.position ${direction}, p.title asc, p.id asc`;
    case "RELEVANCE":
      if (search !== undefined && search.trim() !== "") {
        return `ts_rank(p.search_vector, websearch_to_tsquery('english', ${params.add(search)})) ${inverse}, p.title asc, p.id asc`;
      }
      return `p.position ${direction}, p.title asc, p.id asc`;
    case "TITLE":
      return `p.title ${direction}, p.id asc`;
  }
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export class MockProvider implements CommerceProvider, CheckoutSimulator {
  readonly name = "mock" as const;
  readonly currencyCode: CurrencyCode;
  readonly capabilities: ProviderCapabilities;

  private readonly sql: SqlExecutor;
  private readonly siteUrl: string;
  private readonly now: () => Date;
  private readonly cartTtlDays: number;

  constructor(options: MockProviderOptions) {
    this.sql = options.sql;
    this.siteUrl = options.siteUrl.replace(/\/+$/, "");
    this.currencyCode = options.currencyCode ?? DEFAULT_CURRENCY;
    this.now = options.now ?? (() => new Date());
    this.cartTtlDays = options.cartTtlDays ?? 30;
    this.capabilities = {
      cartTtlDays: this.cartTtlDays,
      maxCartLines: MAX_CART_LINES,
      maxPageSize: MAX_PAGE_SIZE,
      exposesInventoryQuantities: true,
      simulatesCheckout: true,
    };
  }

  get checkoutSimulator(): CheckoutSimulator {
    return this;
  }

  async close(): Promise<void> {
    await this.sql.close();
  }

  // -- helpers -------------------------------------------------------------

  private async count(
    sql: SqlExecutor,
    text: string,
    params: readonly unknown[],
  ): Promise<number> {
    const row = await queryOne<{ total: unknown }>(sql, text, params);
    return row === null ? 0 : int(row.total, "count");
  }

  private checkoutUrlFor(id: string, token: string): string {
    return `${this.siteUrl}/checkout/mock/${id}?key=${token}`;
  }

  // -- Catalogue -----------------------------------------------------------

  async listProducts(query: ProductListQuery = {}): Promise<Connection<Product>> {
    const scope = "products";
    const countParams = new Params();
    const countWhere = productConditions(query.filter, countParams).join(" and ");
    const total = await this.count(
      this.sql,
      `${CATALOGUE_CTES}
       select count(*)::int as total ${PRODUCT_FROM} where ${countWhere}`,
      countParams.values,
    );

    const window = resolvePageWindow(scope, query, total);
    if (window.limit === 0 || window.offset >= total) {
      return buildConnection<Product>(scope, [], window, total);
    }

    const params = new Params();
    const where = productConditions(query.filter, params).join(" and ");
    const order = productOrderBy(
      query.sortKey,
      query.reverse ?? false,
      query.filter?.search,
      params,
    );
    const limit = params.add(window.limit);
    const offset = params.add(window.offset);
    const result = await this.sql.query<SqlRow>(
      `${CATALOGUE_CTES}
       select ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
        where ${where}
        order by ${order}
        limit ${limit} offset ${offset}`,
      params.values,
    );
    return buildConnection(scope, result.rows.map(mapProduct), window, total);
  }

  async getProductByHandle(handle: string): Promise<Product | null> {
    return this.getProductWhere("p.handle = $1", [handle]);
  }

  async getProductById(id: string): Promise<Product | null> {
    if (!isUuid(id)) return null;
    return this.getProductWhere("p.id = $1", [id]);
  }

  private async getProductWhere(
    predicate: string,
    params: readonly unknown[],
  ): Promise<Product | null> {
    const row = await queryOne<SqlRow>(
      this.sql,
      `${CATALOGUE_CTES}
       select ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
        where ${predicate} and p.deleted_at is null
        limit 1`,
      params,
    );
    return row === null ? null : mapProduct(row);
  }

  async getVariantsById(
    ids: readonly string[],
  ): Promise<readonly ProductVariant[]> {
    const wanted = ids.filter(isUuid);
    if (wanted.length === 0) return [];
    const result = await this.sql.query<SqlRow>(
      `${CATALOGUE_CTES}
       select ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
        where p.deleted_at is null
          and exists (select 1 from live_variant lv
                       where lv.product_id = p.id and lv.id = any($1::uuid[]))`,
      [[...wanted]],
    );
    const byId = new Map<string, ProductVariant>();
    for (const row of result.rows) {
      for (const variant of mapProduct(row).variants) {
        byId.set(variant.id, variant);
      }
    }
    return wanted
      .map((id) => byId.get(id))
      .filter((variant): variant is ProductVariant => variant !== undefined);
  }

  async listCollections(
    query: CollectionListQuery = {},
  ): Promise<Connection<Collection>> {
    const scope = "collections";
    const publishedOnly = query.publishedOnly ?? true;
    const where = publishedOnly ? "c.is_published" : "true";
    const total = await this.count(
      this.sql,
      `select count(*)::int as total from public.collections c where ${where}`,
      [],
    );
    const window = resolvePageWindow(scope, query, total);
    if (window.limit === 0 || window.offset >= total) {
      return buildConnection<Collection>(scope, [], window, total);
    }
    const direction = query.reverse === true ? "desc" : "asc";
    const order =
      query.sortKey === "UPDATED_AT"
        ? `c.updated_at ${direction}, c.id asc`
        : query.sortKey === "TITLE"
          ? `c.title ${direction}, c.id asc`
          : `c.position ${direction}, c.title asc, c.id asc`;
    const result = await this.sql.query<SqlRow>(
      `select c.* from public.collections c
        where ${where}
        order by ${order}
        limit $1 offset $2`,
      [window.limit, window.offset],
    );
    return buildConnection(scope, result.rows.map(mapCollection), window, total);
  }

  async getCollectionByHandle(
    handle: string,
    query: CollectionProductsQuery = {},
  ): Promise<CollectionWithProducts | null> {
    const collectionRow = await queryOne<SqlRow>(
      this.sql,
      `select c.* from public.collections c where c.handle = $1 and c.is_published`,
      [handle],
    );
    if (collectionRow === null) return null;
    const collection = mapCollection(collectionRow);

    const scope = `collection:${collection.id}`;
    const joinClause = `join public.collection_products cp
        on cp.product_id = p.id and cp.collection_id = $COLLECTION`;

    const countParams = new Params();
    const collectionParam = countParams.add(collection.id);
    const countWhere = productConditions(query.filter, countParams).join(" and ");
    const total = await this.count(
      this.sql,
      `${CATALOGUE_CTES}
       select count(*)::int as total ${PRODUCT_FROM}
       ${joinClause.replace("$COLLECTION", collectionParam)}
        where ${countWhere}`,
      countParams.values,
    );

    const window = resolvePageWindow(scope, query, total);
    if (window.limit === 0 || window.offset >= total) {
      return {
        collection,
        products: buildConnection<Product>(scope, [], window, total),
      };
    }

    const params = new Params();
    const collectionParam2 = params.add(collection.id);
    const where = productConditions(query.filter, params).join(" and ");
    const order = productOrderBy(
      query.sortKey ?? "MANUAL",
      query.reverse ?? false,
      query.filter?.search,
      params,
    );
    const limit = params.add(window.limit);
    const offset = params.add(window.offset);
    const result = await this.sql.query<SqlRow>(
      `${CATALOGUE_CTES}
       select ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
       ${joinClause.replace("$COLLECTION", collectionParam2)}
        where ${where}
        order by ${order}
        limit ${limit} offset ${offset}`,
      params.values,
    );
    return {
      collection,
      products: buildConnection(scope, result.rows.map(mapProduct), window, total),
    };
  }

  // -- Cart ----------------------------------------------------------------

  async createCart(input: CartCreateInput = {}): Promise<CartMutationResult> {
    return this.sql.transaction(async (tx) => {
      const token = newCartToken();
      const now = this.now();
      const expiresAt = new Date(
        now.getTime() + this.cartTtlDays * 24 * 60 * 60 * 1000,
      );
      const attributes = attributesToJson(input.attributes ?? []);
      if (input.buyerIdentity?.phone != null) {
        attributes[BUYER_PHONE_KEY] = input.buyerIdentity.phone;
      }
      if (input.buyerIdentity?.countryCode != null) {
        attributes[BUYER_COUNTRY_KEY] = input.buyerIdentity.countryCode;
      }
      const inserted = await queryOne<{ id: unknown }>(
        tx,
        `insert into public.carts
           (provider, sync_status, token, currency, status, note, attributes,
            email, customer_id, expires_at)
         values ('local', 'local', $1, $2, 'active', $3, $4::jsonb, $5, $6, $7)
         returning id`,
        [
          token,
          this.currencyCode,
          input.note ?? null,
          JSON.stringify(attributes),
          input.buyerIdentity?.email ?? null,
          input.buyerIdentity?.customerId ?? null,
          expiresAt.toISOString(),
        ],
      );
      if (inserted === null) {
        throw commerceErrors.providerUnavailable("mock", "cart insert returned no row");
      }
      const id = str(inserted.id, "carts.id");
      const cartId = composeCartId(id, token);
      await tx.query(`update public.carts set checkout_url = $2 where id = $1`, [
        id,
        this.checkoutUrlFor(id, token),
      ]);

      const warnings: CartWarning[] = [];
      if (input.lines !== undefined && input.lines.length > 0) {
        warnings.push(...(await this.applyLineAdditions(tx, id, input.lines)));
      }
      if (input.discountCodes !== undefined && input.discountCodes.length > 0) {
        warnings.push(...(await this.applyDiscountCodes(tx, id, input.discountCodes)));
      }
      return {
        cart: await this.refreshAndBuild(tx, cartId, id),
        warnings,
      };
    });
  }

  async getCart(cartId: string): Promise<Cart | null> {
    const parsed = parseCartId(cartId);
    if (parsed === null) return null;
    return this.sql.transaction(async (tx) => {
      const loaded = await this.loadCart(tx, parsed.id, parsed.token, true);
      if (loaded === null) return null;
      if (loaded.cart.status === "converted" || loaded.cart.status === "expired") {
        return null;
      }
      if (this.isExpired(loaded.cart)) {
        await this.markExpired(tx, loaded.cart.id);
        return null;
      }
      return this.refreshAndBuild(tx, cartId, parsed.id);
    });
  }

  async addCartLines(
    cartId: string,
    lines: readonly CartLineInput[],
  ): Promise<CartMutationResult> {
    return this.mutateCart(cartId, async (tx, loaded) => {
      return this.applyLineAdditions(tx, loaded.cart.id, lines);
    });
  }

  async updateCartLines(
    cartId: string,
    updates: readonly CartLineUpdateInput[],
  ): Promise<CartMutationResult> {
    return this.mutateCart(cartId, async (tx, loaded) => {
      const warnings: CartWarning[] = [];
      const byId = new Map(loaded.lines.map((line) => [line.lineId, line]));
      for (const update of updates) {
        const line = byId.get(update.lineId);
        if (line === undefined) throw commerceErrors.cartLineNotFound(update.lineId);
        if (!Number.isSafeInteger(update.quantity) || update.quantity < 0) {
          throw commerceErrors.invalidQuantity(update.quantity);
        }
        if (update.quantity === 0) {
          await tx.query(`delete from public.cart_items where id = $1`, [
            update.lineId,
          ]);
          continue;
        }
        const capped = this.capToStock(line, update.quantity, warnings);
        await tx.query(
          `update public.cart_items
              set quantity = $2,
                  unit_price_cents = $3,
                  properties = coalesce($4::jsonb, properties)
            where id = $1`,
          [
            update.lineId,
            capped,
            // Re-read from the catalogue on every write. The client never
            // supplies a price and the stored one is never trusted.
            line.priceCents,
            update.attributes === undefined
              ? null
              : JSON.stringify(attributesToJson(update.attributes)),
          ],
        );
      }
      return warnings;
    });
  }

  async removeCartLines(
    cartId: string,
    lineIds: readonly string[],
  ): Promise<CartMutationResult> {
    return this.mutateCart(cartId, async (tx, loaded) => {
      const known = new Set(loaded.lines.map((line) => line.lineId));
      for (const lineId of lineIds) {
        if (!known.has(lineId)) throw commerceErrors.cartLineNotFound(lineId);
      }
      if (lineIds.length > 0) {
        await tx.query(
          `delete from public.cart_items where cart_id = $1 and id = any($2::uuid[])`,
          [loaded.cart.id, [...lineIds]],
        );
      }
      return [];
    });
  }

  async updateCartDiscountCodes(
    cartId: string,
    codes: readonly string[],
  ): Promise<CartMutationResult> {
    return this.mutateCart(cartId, async (tx, loaded) =>
      this.applyDiscountCodes(tx, loaded.cart.id, codes),
    );
  }

  async updateCartNote(
    cartId: string,
    note: string | null,
  ): Promise<CartMutationResult> {
    return this.mutateCart(cartId, async (tx, loaded) => {
      await tx.query(`update public.carts set note = $2 where id = $1`, [
        loaded.cart.id,
        note,
      ]);
      return [];
    });
  }

  async updateCartAttributes(
    cartId: string,
    attributes: readonly Attribute[],
  ): Promise<CartMutationResult> {
    return this.mutateCart(cartId, async (tx, loaded) => {
      const next = attributesToJson(attributes);
      for (const key of RESERVED_ATTRIBUTE_KEYS) {
        const existing = loaded.cart.attributes[key];
        if (existing !== undefined) next[key] = existing;
      }
      await tx.query(
        `update public.carts set attributes = $2::jsonb where id = $1`,
        [loaded.cart.id, JSON.stringify(next)],
      );
      return [];
    });
  }

  /**
   * Identify the buyer, merging any cart they already had into this one.
   *
   * The cart in hand wins: it is the one the shopper is looking at. The older
   * cart's lines are folded in (quantities summed, then capped to stock) and it
   * is retired as abandoned with a pointer to its successor, so an abandoned
   * cart report does not double-count.
   */
  async updateCartBuyerIdentity(
    cartId: string,
    buyerIdentity: BuyerIdentityInput,
  ): Promise<CartMutationResult> {
    return this.mutateCart(cartId, async (tx, loaded) => {
      const warnings: CartWarning[] = [];
      const customer = await this.resolveCustomer(tx, buyerIdentity);

      const attributes = { ...loaded.cart.attributes };
      if (buyerIdentity.phone !== undefined) {
        if (buyerIdentity.phone === null) delete attributes[BUYER_PHONE_KEY];
        else attributes[BUYER_PHONE_KEY] = buyerIdentity.phone;
      }
      if (buyerIdentity.countryCode !== undefined) {
        if (buyerIdentity.countryCode === null) delete attributes[BUYER_COUNTRY_KEY];
        else attributes[BUYER_COUNTRY_KEY] = buyerIdentity.countryCode;
      }

      const email =
        buyerIdentity.email !== undefined
          ? buyerIdentity.email
          : (customer?.email ?? loaded.cart.email);

      await tx.query(
        `update public.carts
            set customer_id = $2, email = $3, attributes = $4::jsonb
          where id = $1`,
        [
          loaded.cart.id,
          customer?.id ?? loaded.cart.customerId,
          email,
          JSON.stringify(attributes),
        ],
      );

      if (customer !== null) {
        warnings.push(
          ...(await this.mergeOtherCarts(tx, loaded, customer.id)),
        );
      }
      return warnings;
    });
  }
