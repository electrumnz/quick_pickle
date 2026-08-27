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

  // -- Cart internals ------------------------------------------------------

  private isExpired(cart: CartRow): boolean {
    return new Date(cart.expiresAt).getTime() <= this.now().getTime();
  }

  private async markExpired(tx: SqlExecutor, id: string): Promise<void> {
    await tx.query(
      `update public.carts set status = 'expired' where id = $1 and status = 'active'`,
      [id],
    );
  }

  private async mutateCart(
    cartId: string,
    apply: (tx: SqlExecutor, loaded: LoadedCart) => Promise<CartWarning[]>,
  ): Promise<CartMutationResult> {
    const parsed = parseCartId(cartId);
    if (parsed === null) throw commerceErrors.cartNotFound(cartId);
    return this.sql.transaction(async (tx) => {
      const loaded = await this.requireLiveCart(tx, parsed.id, parsed.token, cartId);
      const warnings = await apply(tx, loaded);
      const cart = await this.refreshAndBuild(tx, cartId, parsed.id);
      return { cart, warnings };
    });
  }

  private async requireLiveCart(
    tx: SqlExecutor,
    id: string,
    token: string,
    cartId: string,
  ): Promise<LoadedCart> {
    const loaded = await this.loadCart(tx, id, token, true);
    if (loaded === null) throw commerceErrors.cartNotFound(cartId);
    if (loaded.cart.status === "converted") {
      throw commerceErrors.cartAlreadyCompleted(
        cartId,
        loaded.cart.convertedOrderId ?? "unknown",
      );
    }
    if (loaded.cart.status === "expired" || this.isExpired(loaded.cart)) {
      await this.markExpired(tx, id);
      throw commerceErrors.cartExpired(cartId, loaded.cart.expiresAt);
    }
    return loaded;
  }

  private async loadCart(
    tx: SqlExecutor,
    id: string,
    token: string,
    forUpdate: boolean,
  ): Promise<LoadedCart | null> {
    const row = await queryOne<SqlRow>(
      tx,
      `select * from public.carts where id = $1 and token = $2${forUpdate ? " for update" : ""}`,
      [id, token],
    );
    if (row === null) return null;
    return { cart: mapCartRow(row), lines: await this.loadCartLines(tx, id) };
  }

  private async loadCartLines(
    tx: SqlExecutor,
    cartId: string,
  ): Promise<CartLineRow[]> {
    const result = await tx.query<SqlRow>(CART_LINES_SQL, [cartId]);
    return result.rows.map(mapCartLineRow);
  }

  /**
   * Re-derive everything about the cart from the database and write the cached
   * totals back.
   *
   * This is the server-side recomputation the whole design turns on. It runs on
   * every read and after every mutation, so `carts.total_cents` can only ever
   * be stale for the duration of a single statement, and a row edited outside
   * the application is corrected the next time anyone looks at the cart.
   */
  private async refreshAndBuild(
    tx: SqlExecutor,
    cartId: string,
    id: string,
  ): Promise<Cart> {
    // 1. Drop lines whose merchandise no longer exists at all.
    await tx.query(
      `delete from public.cart_items ci
        using public.product_variants v, public.products p
        where v.id = ci.variant_id and p.id = v.product_id
          and ci.cart_id = $1
          and (v.deleted_at is not null or p.deleted_at is not null
               or p.status = 'archived')`,
      [id],
    );

    // 2. Re-sync every line's price from the catalogue. Any value that got in
    //    by another route — a tampered request, a stale row, a price change
    //    since the item was added — is overwritten here, before it can reach a
    //    total.
    await tx.query(
      `update public.cart_items ci
          set unit_price_cents = v.price_cents
         from public.product_variants v
        where v.id = ci.variant_id
          and ci.cart_id = $1
          and ci.unit_price_cents is distinct from v.price_cents`,
      [id],
    );

    const row = await queryOne<SqlRow>(
      tx,
      `select * from public.carts where id = $1`,
      [id],
    );
    if (row === null) throw commerceErrors.cartNotFound(cartId);
    const cart = mapCartRow(row);
    const lines = await this.loadCartLines(tx, id);
    const priced = toPricedLines(lines);

    const discount = await this.evaluateCartDiscount(tx, cart, priced);
    const totals = computeCartTotals(priced, discount?.outcome ?? null);

    await tx.query(
      `update public.carts
          set subtotal_cents = $2, discount_cents = $3, shipping_cents = 0,
              tax_cents = 0, total_cents = $4,
              discount_id = $5, checkout_url = $6
        where id = $1`,
      [
        id,
        totals.subtotalCents,
        totals.discountCents,
        totals.totalCents,
        discount !== null && discount.outcome.applicable ? discount.rule.id : null,
        this.checkoutUrlFor(id, cart.token),
      ],
    );

    return buildDomainCart({
      cartId,
      cart,
      lines,
      totals,
      discount,
      checkoutUrl: this.checkoutUrlFor(id, cart.token),
    });
  }

  private async evaluateCartDiscount(
    tx: SqlExecutor,
    cart: CartRow,
    lines: readonly PricedLineInput[],
  ): Promise<{ rule: DiscountRule; outcome: DiscountOutcome } | null> {
    if (cart.discountCode === null) return null;
    const rule = await this.loadDiscountRule(tx, cart.discountCode);
    if (rule === null) return null;
    return {
      rule,
      outcome: await this.evaluateRule(tx, rule, cart, lines),
    };
  }

  private async evaluateRule(
    tx: SqlExecutor,
    rule: DiscountRule,
    cart: CartRow,
    lines: readonly PricedLineInput[],
  ): Promise<DiscountOutcome> {
    let customerType: CustomerType | null = null;
    let redemptions = 0;
    if (cart.customerId !== null) {
      const customerRow = await queryOne<SqlRow>(
        tx,
        `select customer_type from public.customers where id = $1`,
        [cart.customerId],
      );
      if (customerRow !== null) {
        customerType = oneOf(
          customerRow.customer_type,
          ["retail", "trade", "wholesale", "staff", "press"] as const,
          "customers.customer_type",
        );
      }
      redemptions = await this.count(
        tx,
        `select count(*)::int as total from public.discount_redemptions
          where discount_id = $1 and customer_id = $2`,
        [rule.id, cart.customerId],
      );
    }
    return evaluateDiscount(rule, lines, {
      now: this.now(),
      customerType,
      customerRedemptions: redemptions,
    });
  }

  private async loadDiscountRule(
    tx: SqlExecutor,
    code: string,
  ): Promise<DiscountRule | null> {
    const row = await queryOne<SqlRow>(
      tx,
      `select * from public.discounts where upper(code) = upper($1)`,
      [code],
    );
    return row === null ? null : mapDiscountRule(row);
  }

  private capToStock(
    line: Pick<
      CartLineRow,
      "trackInventory" | "inventoryPolicy" | "stockAvailable" | "sku" | "variantId"
    >,
    desired: number,
    warnings: CartWarning[],
  ): number {
    if (!line.trackInventory || line.inventoryPolicy === "continue") return desired;
    if (line.stockAvailable <= 0) {
      throw commerceErrors.outOfStock(line.variantId, line.sku);
    }
    if (desired > line.stockAvailable) {
      warnings.push({
        code: "INSUFFICIENT_STOCK",
        message: `Only ${String(line.stockAvailable)} of ${line.sku} left, so the line was set to that`,
        target: line.variantId,
      });
      return line.stockAvailable;
    }
    return desired;
  }

  private async applyLineAdditions(
    tx: SqlExecutor,
    id: string,
    lines: readonly CartLineInput[],
  ): Promise<CartWarning[]> {
    const warnings: CartWarning[] = [];
    if (lines.length === 0) return warnings;

    for (const line of lines) {
      if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
        throw commerceErrors.invalidQuantity(line.quantity);
      }
      if (!isUuid(line.variantId)) {
        throw commerceErrors.variantNotFound(line.variantId);
      }
    }

    const variantIds = [...new Set(lines.map((line) => line.variantId))];
    const variants = await this.loadPurchasableVariants(tx, variantIds);
    const existing = new Map(
      (await this.loadCartLines(tx, id)).map((line) => [line.variantId, line]),
    );

    for (const line of lines) {
      const variant = variants.get(line.variantId);
      if (variant === undefined) throw commerceErrors.variantNotFound(line.variantId);
      if (!variant.productSellable) {
        throw commerceErrors.variantUnavailable(
          line.variantId,
          "the product is not published",
        );
      }
      if (variant.currencyCode !== this.currencyCode) {
        throw commerceErrors.currencyMismatch(
          this.currencyCode,
          variant.currencyCode,
        );
      }

      const current = existing.get(line.variantId);
      const desired = (current?.quantity ?? 0) + line.quantity;
      const quantity = this.capToStock(variant, desired, warnings);
      const properties = JSON.stringify(attributesToJson(line.attributes ?? []));

      if (current === undefined) {
        const lineCount = await this.count(
          tx,
          `select count(*)::int as total from public.cart_items where cart_id = $1`,
          [id],
        );
        if (lineCount >= MAX_CART_LINES) {
          throw commerceErrors.cartTooLarge(id, MAX_CART_LINES);
        }
      }

      await tx.query(
        `insert into public.cart_items
           (cart_id, currency, product_id, variant_id, quantity, unit_price_cents, properties)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb)
         on conflict (cart_id, variant_id) do update
            set quantity = excluded.quantity,
                unit_price_cents = excluded.unit_price_cents,
                properties = excluded.properties`,
        [
          id,
          this.currencyCode,
          variant.productId,
          variant.variantId,
          quantity,
          // The catalogue price, read in this same transaction. Never an input.
          variant.priceCents,
          properties,
        ],
      );
      existing.set(line.variantId, { ...variant, quantity, lineId: "" });
    }
    return warnings;
  }

  private async loadPurchasableVariants(
    tx: SqlExecutor,
    variantIds: readonly string[],
  ): Promise<Map<string, CartLineRow>> {
    const result = await tx.query<SqlRow>(VARIANT_FOR_CART_SQL, [[...variantIds]]);
    return new Map(
      result.rows.map((row) => {
        const line = mapCartLineRow(row);
        return [line.variantId, line];
      }),
    );
  }

  private async applyDiscountCodes(
    tx: SqlExecutor,
    id: string,
    codes: readonly string[],
  ): Promise<CartWarning[]> {
    if (codes.length > 1) {
      throw commerceErrors.invalidInput(
        "This store applies one discount code at a time",
        ["discountCodes"],
      );
    }
    const code = codes[0]?.trim();
    if (code === undefined || code === "") {
      await tx.query(
        `update public.carts set discount_id = null, discount_code = null where id = $1`,
        [id],
      );
      return [];
    }

    await tx.query(
      `update public.carts set discount_code = $2, discount_id = null where id = $1`,
      [id, code],
    );

    const rule = await this.loadDiscountRule(tx, code);
    if (rule === null) {
      return [
        {
          code: "DISCOUNT_NOT_FOUND",
          message: `${code} is not a valid code`,
          target: "discountCodes",
        },
      ];
    }

    const row = await queryOne<SqlRow>(
      tx,
      `select * from public.carts where id = $1`,
      [id],
    );
    if (row === null) throw commerceErrors.cartNotFound(id);
    const cart = mapCartRow(row);
    const priced = toPricedLines(await this.loadCartLines(tx, id));
    const outcome = await this.evaluateRule(tx, rule, cart, priced);

    if (!outcome.applicable) {
      return [
        {
          code: outcome.rejectionCode ?? "DISCOUNT_NOT_APPLICABLE",
          message: outcome.rejectionMessage ?? `${code} does not apply`,
          target: "discountCodes",
        },
      ];
    }
    return [];
  }

  private async resolveCustomer(
    tx: SqlExecutor,
    buyerIdentity: BuyerIdentityInput,
  ): Promise<{ id: string; email: string } | null> {
    if (buyerIdentity.customerId != null) {
      if (!isUuid(buyerIdentity.customerId)) {
        throw commerceErrors.customerNotFound(buyerIdentity.customerId);
      }
      const row = await queryOne<SqlRow>(
        tx,
        `select id, email from public.customers where id = $1 and deleted_at is null`,
        [buyerIdentity.customerId],
      );
      if (row === null) {
        throw commerceErrors.customerNotFound(buyerIdentity.customerId);
      }
      return { id: str(row.id, "customers.id"), email: str(row.email, "customers.email") };
    }
    if (buyerIdentity.email != null && buyerIdentity.email !== "") {
      const row = await queryOne<SqlRow>(
        tx,
        `select id, email from public.customers
          where lower(email) = lower($1) and deleted_at is null`,
        [buyerIdentity.email],
      );
      if (row === null) return null;
      return { id: str(row.id, "customers.id"), email: str(row.email, "customers.email") };
    }
    return null;
  }

  private async mergeOtherCarts(
    tx: SqlExecutor,
    loaded: LoadedCart,
    customerId: string,
  ): Promise<CartWarning[]> {
    const others = await tx.query<SqlRow>(
      `select id from public.carts
        where customer_id = $1 and id <> $2 and status = 'active'
          and expires_at > now()
        order by updated_at desc
        for update`,
      [customerId, loaded.cart.id],
    );
    if (others.rows.length === 0) return [];

    const warnings: CartWarning[] = [];
    for (const row of others.rows) {
      const otherId = str(row.id, "carts.id");
      const otherLines = await this.loadCartLines(tx, otherId);
      if (otherLines.length > 0) {
        warnings.push(
          ...(await this.applyLineAdditions(
            tx,
            loaded.cart.id,
            otherLines.map((line) => ({
              variantId: line.variantId,
              quantity: line.quantity,
            })),
          )),
        );
      }
      await tx.query(
        `update public.carts
            set status = 'abandoned',
                abandoned_at = now(),
                attributes = attributes || jsonb_build_object($2::text, $3::text)
          where id = $1`,
        [otherId, MERGED_INTO_KEY, loaded.cart.id],
      );
    }
    return warnings;
  }

  // -- Checkout ------------------------------------------------------------

  async beginCheckout(cartId: string): Promise<CheckoutHandoff> {
    const parsed = parseCartId(cartId);
    if (parsed === null) throw commerceErrors.cartNotFound(cartId);
    return this.sql.transaction(async (tx) => {
      await this.requireLiveCart(tx, parsed.id, parsed.token, cartId);
      const cart = await this.refreshAndBuild(tx, cartId, parsed.id);
      if (cart.lines.length === 0) throw commerceErrors.cartEmpty(cartId);
      assertPurchasable(await this.loadCartLines(tx, parsed.id));
      return {
        cartId,
        checkoutUrl: cart.checkoutUrl,
        totalQuantity: cart.totalQuantity,
        estimatedTotal: cart.cost.totalAmount,
        currencyCode: this.currencyCode,
      };
    });
  }

  /**
   * Stand in for the buyer completing Shopify's hosted checkout.
   *
   * Everything this does is what the `orders/create` webhook handler will do in
   * production: one transaction that reprices the cart from the catalogue,
   * takes the stock with a ledger entry per movement, writes the order and its
   * lines, redeems the discount, moves the customer's rollups and converts the
   * cart. The storefront's flow either side is identical on both providers —
   * redirect to `checkoutUrl`, then read the order back.
   */
  async completeCheckout(
    cartId: string,
    input: SimulatedCheckoutInput,
  ): Promise<Order> {
    const parsed = parseCartId(cartId);
    if (parsed === null) throw commerceErrors.cartNotFound(cartId);

    return this.sql.transaction(async (tx) => {
      const loaded = await this.requireLiveCart(tx, parsed.id, parsed.token, cartId);
      // Reprice and prune before anything is committed to.
      await this.refreshAndBuild(tx, cartId, parsed.id);

      const cartRow = await queryOne<SqlRow>(
        tx,
        `select * from public.carts where id = $1`,
        [parsed.id],
      );
      if (cartRow === null) throw commerceErrors.cartNotFound(cartId);
      const cart = mapCartRow(cartRow);
      const lines = await this.loadCartLines(tx, parsed.id);
      if (lines.length === 0) throw commerceErrors.cartEmpty(cartId);

      // Lock every inventory row this order will touch before deciding whether
      // there is enough, so two checkouts cannot both pass the same check.
      await tx.query(
        `select il.id from public.inventory_levels il
          where il.variant_id = any($1::uuid[])
          order by il.id
          for update`,
        [lines.map((line) => line.variantId)],
      );
      const fresh = await this.loadCartLines(tx, parsed.id);
      assertPurchasable(fresh);

      const priced = toPricedLines(fresh);
      const discount = await this.evaluateCartDiscount(tx, cart, priced);
      const outcome = discount?.outcome ?? null;
      const totals = computeOrderTotals(
        priced,
        outcome,
        input.shippingAmount ?? null,
      );

      const now = this.now().toISOString();
      const customerId = await this.upsertCustomer(tx, input, cart.customerId);
      const shippingAddressId = await this.insertAddress(
        tx,
        customerId,
        input.shippingAddress,
        "shipping",
      );
      const billingAddressId =
        input.billingAddress === undefined
          ? shippingAddressId
          : await this.insertAddress(
              tx,
              customerId,
              input.billingAddress,
              "billing",
            );

      const orderRow = await queryOne<{ id: unknown }>(
        tx,
        `insert into public.orders
           (provider, sync_status, customer_id, email, phone, status,
            financial_status, fulfillment_status, channel, currency,
            subtotal_cents, discount_cents, shipping_cents, tax_cents,
            total_cents, tax_rate_bp, tax_inclusive,
            shipping_address_id, billing_address_id, shipping_method,
            discount_id, discount_code, cart_id, payment_gateway,
            customer_note, placed_at, paid_at)
         values ('local', 'local', $1, $2, $3, 'open',
                 'paid', 'unfulfilled', 'online', $4,
                 $5, $6, $7, $8, $9, $10, true,
                 $11, $12, $13, $14, $15, $16, 'mock',
                 $17, $18, $18)
         returning id`,
        [
          customerId,
          input.email,
          input.phone ?? null,
          this.currencyCode,
          totals.subtotalCents,
          totals.discountCents,
          totals.shippingCents,
          totals.taxCents,
          totals.totalCents,
          NZ_GST_BASIS_POINTS,
          shippingAddressId,
          billingAddressId,
          input.shippingMethod ?? "NZ Post Standard",
          outcome !== null && outcome.applicable ? discount?.rule.id : null,
          cart.discountCode,
          cart.id,
          input.customerNote ?? null,
          now,
        ],
      );
      if (orderRow === null) {
        throw commerceErrors.providerUnavailable("mock", "order insert returned no row");
      }
      const orderId = str(orderRow.id, "orders.id");

      for (const [index, line] of fresh.entries()) {
        const lineDiscount = totals.lineDiscounts[index] ?? 0;
        const lineTotal = totals.lineTotals[index] ?? 0;
        const lineTax = totals.lineTaxes[index] ?? 0;
        const itemRow = await queryOne<{ id: unknown }>(
          tx,
          `insert into public.order_items
             (order_id, currency, product_id, variant_id, sku, title,
              variant_title, quantity, unit_price_cents, discount_cents,
              tax_cents, line_total_cents, position)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           returning id`,
          [
            orderId,
            this.currencyCode,
            line.productId,
            line.variantId,
            line.sku,
            line.productTitle,
            line.variantTitle,
            line.quantity,
            line.priceCents,
            lineDiscount,
            lineTax,
            lineTotal,
            index,
          ],
        );
        if (itemRow === null) {
          throw commerceErrors.providerUnavailable("mock", "order line insert failed");
        }
        await this.takeStock(tx, line, str(itemRow.id, "order_items.id"));
      }

      if (discount !== null && discount.outcome.applicable) {
        await tx.query(
          `insert into public.discount_redemptions
             (discount_id, order_id, customer_id, amount_cents)
           values ($1, $2, $3, $4)`,
          [discount.rule.id, orderId, customerId, totals.discountCents],
        );
        await tx.query(
          `update public.discounts set used_count = used_count + 1 where id = $1`,
          [discount.rule.id],
        );
      }

      await tx.query(
        `update public.customers
            set orders_count = orders_count + 1,
                total_spent_cents = total_spent_cents + $2,
                first_ordered_at = coalesce(first_ordered_at, $3),
                last_ordered_at = $3
          where id = $1`,
        [customerId, totals.totalCents, now],
      );

      await tx.query(
        `update public.carts
            set status = 'converted', converted_order_id = $2
          where id = $1`,
        [loaded.cart.id, orderId],
      );

      const order = await this.readOrder(tx, "o.id = $1", [orderId]);
      if (order === null) {
        throw commerceErrors.providerUnavailable("mock", "order vanished after insert");
      }
      return order;
    });
  }

  /**
   * Take `line.quantity` off the shelf, default location first, writing one
   * ledger row per location touched. A variant that does not track inventory is
   * skipped entirely; one on backorder is allowed to go negative at the default
   * location, which is exactly what `inventory_policy = 'continue'` means.
   */
  private async takeStock(
    tx: SqlExecutor,
    line: CartLineRow,
    orderItemId: string,
  ): Promise<void> {
    if (!line.trackInventory) return;

    const levels = await tx.query<SqlRow>(
      `select il.id, il.location_id, il.available, l.is_default
         from public.inventory_levels il
         join public.inventory_locations l on l.id = il.location_id
        where il.variant_id = $1 and l.is_active and l.ships_orders
        order by l.is_default desc, il.available desc, l.code asc`,
      [line.variantId],
    );

    let remaining = line.quantity;
    for (const row of levels.rows) {
      if (remaining === 0) break;
      const available = int(row.available, "inventory_levels.available");
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      await this.recordStockMovement(
        tx,
        str(row.id, "inventory_levels.id"),
        line.variantId,
        str(row.location_id, "inventory_levels.location_id"),
        -take,
        orderItemId,
      );
      remaining -= take;
    }

    if (remaining === 0) return;

    const fallback = levels.rows[0];
    if (fallback === undefined || line.inventoryPolicy === "deny") {
      throw commerceErrors.insufficientStock(
        line.variantId,
        line.sku,
        line.quantity,
        line.quantity - remaining,
      );
    }
    await this.recordStockMovement(
      tx,
      str(fallback.id, "inventory_levels.id"),
      line.variantId,
      str(fallback.location_id, "inventory_levels.location_id"),
      -remaining,
      orderItemId,
    );
  }

  private async recordStockMovement(
    tx: SqlExecutor,
    levelId: string,
    variantId: string,
    locationId: string,
    delta: number,
    orderItemId: string,
  ): Promise<void> {
    await tx.query(
      `update public.inventory_levels set on_hand = on_hand + $2 where id = $1`,
      [levelId, delta],
    );
    await tx.query(
      `insert into public.inventory_adjustments
         (variant_id, location_id, delta, reason, order_item_id, actor_type, note)
       values ($1, $2, $3, 'sale', $4, 'system', 'Checkout')`,
      [variantId, locationId, delta, orderItemId],
    );
  }

  private async upsertCustomer(
    tx: SqlExecutor,
    input: SimulatedCheckoutInput,
    existingCustomerId: string | null,
  ): Promise<string> {
    if (existingCustomerId !== null) return existingCustomerId;
    const found = await queryOne<SqlRow>(
      tx,
      `select id from public.customers
        where lower(email) = lower($1) and deleted_at is null`,
      [input.email],
    );
    if (found !== null) return str(found.id, "customers.id");

    const acceptsMarketing = input.acceptsMarketing ?? false;
    const created = await queryOne<SqlRow>(
      tx,
      `insert into public.customers
         (provider, sync_status, email, first_name, last_name, phone,
          customer_type, accepts_marketing, marketing_opt_in_at, currency)
       values ('local', 'local', $1, $2, $3, $4, 'retail', $5, $6, $7)
       returning id`,
      [
        input.email,
        input.shippingAddress.firstName,
        input.shippingAddress.lastName,
        input.phone ?? input.shippingAddress.phone ?? null,
        acceptsMarketing,
        acceptsMarketing ? this.now().toISOString() : null,
        this.currencyCode,
      ],
    );
    if (created === null) {
      throw commerceErrors.providerUnavailable("mock", "customer insert failed");
    }
    return str(created.id, "customers.id");
  }

  private async insertAddress(
    tx: SqlExecutor,
    customerId: string,
    address: SimulatedCheckoutAddress,
    addressType: "shipping" | "billing",
  ): Promise<string> {
    const hasDefault = await this.count(
      tx,
      `select count(*)::int as total from public.addresses
        where customer_id = $1 and address_type = $2 and is_default`,
      [customerId, addressType],
    );
    const row = await queryOne<SqlRow>(
      tx,
      `insert into public.addresses
         (customer_id, provider, sync_status, address_type, first_name, last_name,
          company, line1, line2, suburb, city, region, postcode, country_code,
          phone, delivery_instructions, is_default)
       values ($1, 'local', 'local', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15)
       returning id`,
      [
        customerId,
        addressType,
        address.firstName,
        address.lastName,
        address.company ?? null,
        address.line1,
        address.line2 ?? null,
        address.suburb ?? null,
        address.city,
        address.region ?? null,
        address.postcode ?? null,
        address.countryCode ?? "NZ",
        address.phone ?? null,
        address.deliveryInstructions ?? null,
        hasDefault === 0,
      ],
    );
    if (row === null) {
      throw commerceErrors.providerUnavailable("mock", "address insert failed");
    }
    const id = str(row.id, "addresses.id");
    if (hasDefault === 0 && addressType === "shipping") {
      await tx.query(
        `update public.customers set default_address_id = $2
          where id = $1 and default_address_id is null`,
        [customerId, id],
      );
    }
    return id;
  }
