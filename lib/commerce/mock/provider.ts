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

import { commerceErrors, type CommerceErrorCode } from "../errors";
import {
  money,
  zeroMoney,
  DEFAULT_CURRENCY,
  NZ_GST_BASIS_POINTS,
  type CurrencyCode,
} from "../money";
import type {
  CheckoutSimulator,
  CommerceProvider,
  CommerceProviderName,
  ProviderCapabilities,
  SimulatedCheckoutAddress,
  SimulatedCheckoutInput,
} from "../provider";
import {
  CUSTOMER_TYPES,
  DISCOUNT_SCOPES,
  DISCOUNT_STATUSES,
  DISCOUNT_VALUE_TYPES,
  MAX_CART_LINES,
  MAX_PAGE_SIZE,
  ORDER_FINANCIAL_STATUSES,
  ORDER_FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  SALES_CHANNELS,
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
  type Image,
  type DiscountValidation,
  type InventoryAdjustInput,
  type InventoryAdjustResult,
  type InventoryLevel,
  type InventoryLocation,
  type InventoryQuery,
  type Order,
  type OrderCancelInput,
  type OrderFulfillmentInput,
  type OrderFulfillmentStatus,
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
import { buildConnection, resolvePageWindow } from "./cursor";
import {
  mapAddress,
  mapCollection,
  mapCustomer,
  mapDiscount,
  mapInventoryLevel,
  mapLocation,
  mapProduct,
  selectedOptionsFor,
  unitPricingFor,
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
  readonly variantImage: Image | null;
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
  /**
   * Which name this instance reports as {@link CommerceProvider.name}.
   *
   * Defaults to `mock`. Demo mode passes `demo`, because the same class over a
   * Postgres compiled into the build is a different deployment answer to "what
   * am I reading from" and the admin's settings screen says so. It is a label,
   * not a mode: nothing below this line branches on it.
   */
  readonly name?: CommerceProviderName;
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
  readonly name: CommerceProviderName;
  readonly currencyCode: CurrencyCode;
  readonly capabilities: ProviderCapabilities;

  private readonly sql: SqlExecutor;
  private readonly siteUrl: string;
  private readonly now: () => Date;
  private readonly cartTtlDays: number;

  constructor(options: MockProviderOptions) {
    this.name = options.name ?? "mock";
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

  async listProducts(
    query: ProductListQuery = {},
  ): Promise<Connection<Product>> {
    const scope = "products";
    const countParams = new Params();
    const countWhere = productConditions(query.filter, countParams).join(
      " and ",
    );
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
    return buildConnection(
      scope,
      result.rows.map(mapCollection),
      window,
      total,
    );
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
    const countWhere = productConditions(query.filter, countParams).join(
      " and ",
    );
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
      products: buildConnection(
        scope,
        result.rows.map(mapProduct),
        window,
        total,
      ),
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
        throw commerceErrors.providerUnavailable(
          "mock",
          "cart insert returned no row",
        );
      }
      const id = str(inserted.id, "carts.id");
      const cartId = composeCartId(id, token);
      await tx.query(
        `update public.carts set checkout_url = $2 where id = $1`,
        [id, this.checkoutUrlFor(id, token)],
      );

      const warnings: CartWarning[] = [];
      if (input.lines !== undefined && input.lines.length > 0) {
        warnings.push(...(await this.applyLineAdditions(tx, id, input.lines)));
      }
      if (input.discountCodes !== undefined && input.discountCodes.length > 0) {
        warnings.push(
          ...(await this.applyDiscountCodes(tx, id, input.discountCodes)),
        );
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
      if (
        loaded.cart.status === "converted" ||
        loaded.cart.status === "expired"
      ) {
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
        if (line === undefined)
          throw commerceErrors.cartLineNotFound(update.lineId);
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
        if (buyerIdentity.countryCode === null)
          delete attributes[BUYER_COUNTRY_KEY];
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
        warnings.push(...(await this.mergeOtherCarts(tx, loaded, customer.id)));
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
      const loaded = await this.requireLiveCart(
        tx,
        parsed.id,
        parsed.token,
        cartId,
      );
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
        discount !== null && discount.outcome.applicable
          ? discount.rule.id
          : null,
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
          CUSTOMER_TYPES,
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
      | "trackInventory"
      | "inventoryPolicy"
      | "stockAvailable"
      | "sku"
      | "variantId"
    >,
    desired: number,
    warnings: CartWarning[],
  ): number {
    if (!line.trackInventory || line.inventoryPolicy === "continue")
      return desired;
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
      if (variant === undefined)
        throw commerceErrors.variantNotFound(line.variantId);
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
      const properties = JSON.stringify(
        attributesToJson(line.attributes ?? []),
      );

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
    const result = await tx.query<SqlRow>(VARIANT_FOR_CART_SQL, [
      [...variantIds],
    ]);
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
      return {
        id: str(row.id, "customers.id"),
        email: str(row.email, "customers.email"),
      };
    }
    if (buyerIdentity.email != null && buyerIdentity.email !== "") {
      const row = await queryOne<SqlRow>(
        tx,
        `select id, email from public.customers
          where lower(email) = lower($1) and deleted_at is null`,
        [buyerIdentity.email],
      );
      if (row === null) return null;
      return {
        id: str(row.id, "customers.id"),
        email: str(row.email, "customers.email"),
      };
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
      const loaded = await this.requireLiveCart(
        tx,
        parsed.id,
        parsed.token,
        cartId,
      );
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
        throw commerceErrors.providerUnavailable(
          "mock",
          "order insert returned no row",
        );
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
          throw commerceErrors.providerUnavailable(
            "mock",
            "order line insert failed",
          );
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
        throw commerceErrors.providerUnavailable(
          "mock",
          "order vanished after insert",
        );
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
      throw commerceErrors.providerUnavailable(
        "mock",
        "customer insert failed",
      );
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

  // -- Orders --------------------------------------------------------------

  async listOrders(query: OrderListQuery = {}): Promise<Connection<Order>> {
    const scope = "orders";
    const countParams = new Params();
    const countWhere = orderConditions(query.filter, countParams).join(" and ");
    const total = await this.count(
      this.sql,
      `select count(*)::int as total from public.orders o where ${countWhere}`,
      countParams.values,
    );
    const window = resolvePageWindow(scope, query, total);
    if (window.limit === 0 || window.offset >= total) {
      return buildConnection<Order>(scope, [], window, total);
    }
    const params = new Params();
    const where = orderConditions(query.filter, params).join(" and ");
    const order = orderOrderBy(query.sortKey, query.reverse ?? false);
    const limit = params.add(window.limit);
    const offset = params.add(window.offset);
    const result = await this.sql.query<SqlRow>(
      `select ${ORDER_COLUMNS} from public.orders o
        where ${where}
        order by ${order}
        limit ${limit} offset ${offset}`,
      params.values,
    );
    return buildConnection(scope, result.rows.map(mapOrder), window, total);
  }

  async getOrder(orderId: string): Promise<Order | null> {
    if (!isUuid(orderId)) return null;
    return this.readOrder(this.sql, "o.id = $1", [orderId]);
  }

  async getOrderByNumber(orderNumber: string): Promise<Order | null> {
    return this.readOrder(this.sql, "o.order_number = $1", [orderNumber]);
  }

  private async readOrder(
    sql: SqlExecutor,
    predicate: string,
    params: readonly unknown[],
  ): Promise<Order | null> {
    const row = await queryOne<SqlRow>(
      sql,
      `select ${ORDER_COLUMNS} from public.orders o where ${predicate} limit 1`,
      params,
    );
    return row === null ? null : mapOrder(row);
  }

  async updateOrder(orderId: string, patch: OrderPatch): Promise<Order> {
    return this.sql.transaction(async (tx) => {
      const current = await this.lockOrder(tx, orderId);
      if (current.status === "cancelled") {
        throw commerceErrors.orderNotEditable(orderId, "it is cancelled");
      }
      const params = new Params();
      const sets: string[] = [];
      if (patch.email !== undefined)
        sets.push(`email = ${params.add(patch.email)}`);
      if (patch.phone !== undefined)
        sets.push(`phone = ${params.add(patch.phone)}`);
      if (patch.note !== undefined)
        sets.push(`note = ${params.add(patch.note)}`);
      if (patch.customerNote !== undefined) {
        sets.push(`customer_note = ${params.add(patch.customerNote)}`);
      }
      if (patch.tags !== undefined) {
        sets.push(`tags = ${params.add([...patch.tags])}::text[]`);
      }
      if (patch.shippingMethod !== undefined) {
        sets.push(`shipping_method = ${params.add(patch.shippingMethod)}`);
      }
      if (sets.length > 0) {
        const id = params.add(orderId);
        await tx.query(
          `update public.orders set ${sets.join(", ")} where id = ${id}`,
          params.values,
        );
      }
      return this.requireOrder(tx, orderId);
    });
  }

  async markOrderPaid(orderId: string): Promise<Order> {
    return this.sql.transaction(async (tx) => {
      const current = await this.lockOrder(tx, orderId);
      if (current.status === "cancelled") {
        throw commerceErrors.orderNotEditable(orderId, "it is cancelled");
      }
      if (current.financialStatus === "paid")
        return this.requireOrder(tx, orderId);
      await tx.query(
        `update public.orders
            set financial_status = 'paid', paid_at = coalesce(paid_at, $2)
          where id = $1`,
        [orderId, this.now().toISOString()],
      );
      return this.requireOrder(tx, orderId);
    });
  }

  async fulfillOrder(
    orderId: string,
    input: OrderFulfillmentInput,
  ): Promise<Order> {
    return this.sql.transaction(async (tx) => {
      const current = await this.lockOrder(tx, orderId);
      if (current.status === "cancelled") {
        throw commerceErrors.orderNotEditable(orderId, "it is cancelled");
      }
      const items = await tx.query<SqlRow>(
        `select id, quantity, quantity_fulfilled from public.order_items
          where order_id = $1 for update`,
        [orderId],
      );
      const outstanding = new Map(
        items.rows.map((row) => [
          str(row.id, "order_items.id"),
          int(row.quantity, "order_items.quantity") -
            int(row.quantity_fulfilled, "order_items.quantity_fulfilled"),
        ]),
      );
      const requested =
        input.lineItems ??
        [...outstanding.entries()].map(([lineItemId, quantity]) => ({
          lineItemId,
          quantity,
        }));

      for (const line of requested) {
        const available = outstanding.get(line.lineItemId);
        if (available === undefined) {
          throw commerceErrors.invalidInput(
            `Order line ${line.lineItemId} is not on order ${orderId}`,
            ["lineItems"],
          );
        }
        if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) {
          throw commerceErrors.invalidQuantity(line.quantity);
        }
        if (line.quantity > available) {
          throw commerceErrors.invalidInput(
            `Only ${String(available)} of order line ${line.lineItemId} is outstanding`,
            ["lineItems", "quantity"],
          );
        }
        if (line.quantity === 0) continue;
        await tx.query(
          `update public.order_items
              set quantity_fulfilled = quantity_fulfilled + $2
            where id = $1`,
          [line.lineItemId, line.quantity],
        );
      }

      const remaining = await this.count(
        tx,
        `select coalesce(sum(quantity - quantity_fulfilled), 0)::int as total
           from public.order_items where order_id = $1`,
        [orderId],
      );
      const fulfilledSoFar = await this.count(
        tx,
        `select coalesce(sum(quantity_fulfilled), 0)::int as total
           from public.order_items where order_id = $1`,
        [orderId],
      );
      const status =
        remaining === 0
          ? "fulfilled"
          : fulfilledSoFar > 0
            ? "partially_fulfilled"
            : "unfulfilled";

      await tx.query(
        `update public.orders
            set fulfillment_status = $2::public.order_fulfillment_status,
                fulfilled_at = case
                  when $2::public.order_fulfillment_status
                       in ('fulfilled', 'delivered')
                  then coalesce(fulfilled_at, $3::timestamptz)
                  else fulfilled_at end,
                tracking_carrier = $4, tracking_number = $5, tracking_url = $6
          where id = $1`,
        [
          orderId,
          status,
          this.now().toISOString(),
          input.carrier,
          input.trackingNumber,
          input.trackingUrl ?? null,
        ],
      );
      return this.requireOrder(tx, orderId);
    });
  }

  async cancelOrder(orderId: string, input: OrderCancelInput): Promise<Order> {
    return this.sql.transaction(async (tx) => {
      const current = await this.lockOrder(tx, orderId);
      if (current.status === "cancelled") {
        throw commerceErrors.orderAlreadyCancelled(orderId);
      }

      if (input.restock === true) {
        const movements = await tx.query<SqlRow>(
          `select ia.variant_id, ia.location_id, sum(-ia.delta)::int as quantity,
                  oi.id as order_item_id
             from public.inventory_adjustments ia
             join public.order_items oi on oi.id = ia.order_item_id
            where oi.order_id = $1 and ia.reason = 'sale'
            group by ia.variant_id, ia.location_id, oi.id`,
          [orderId],
        );
        for (const row of movements.rows) {
          const quantity = int(row.quantity, "inventory_adjustments.delta");
          if (quantity <= 0) continue;
          await tx.query(
            `update public.inventory_levels
                set on_hand = on_hand + $3
              where variant_id = $1 and location_id = $2`,
            [row.variant_id, row.location_id, quantity],
          );
          await tx.query(
            `insert into public.inventory_adjustments
               (variant_id, location_id, delta, reason, order_item_id, actor_type, note)
             values ($1, $2, $3, 'return', $4, 'operator', 'Order cancelled')`,
            [row.variant_id, row.location_id, quantity, row.order_item_id],
          );
        }
      }

      const refund = input.refund === true && current.paidAt !== null;

      // Cancelling settles the goods as well as the money, and the schema has
      // two different words for how. `returned` is stock that left and came
      // back — it only applies when something had actually shipped and the
      // restock counted it in. `cancelled` is an order whose goods never
      // completed the trip. Leaving this at `unfulfilled` would put a voided
      // order in the shopkeeper's to-pack pile.
      const shipped =
        current.fulfillmentStatus === "fulfilled" ||
        current.fulfillmentStatus === "partially_fulfilled" ||
        current.fulfillmentStatus === "delivered";
      const fulfillment: OrderFulfillmentStatus =
        current.deliveredAt !== null
          ? // `orders_delivered_stamped` ties `delivered` to `delivered_at`, so
            // moving a delivered order off that value means erasing the date it
            // was delivered. The delivery happened; `status = 'cancelled'` and
            // the refund carry the rest of the story.
            "delivered"
          : shipped && input.restock === true
            ? "returned"
            : "cancelled";

      await tx.query(
        `update public.orders
            set status = 'cancelled',
                cancelled_at = $2,
                cancel_reason = $3,
                financial_status = $4,
                refunded_cents = $5,
                fulfillment_status = $6::public.order_fulfillment_status
          where id = $1`,
        [
          orderId,
          this.now().toISOString(),
          input.reason,
          refund
            ? "refunded"
            : current.financialStatus === "paid"
              ? "paid"
              : "voided",
          refund ? current.totalCents : 0,
          fulfillment,
        ],
      );
      return this.requireOrder(tx, orderId);
    });
  }

  private async lockOrder(
    tx: SqlExecutor,
    orderId: string,
  ): Promise<{
    status: string;
    financialStatus: string;
    fulfillmentStatus: string;
    paidAt: string | null;
    deliveredAt: string | null;
    totalCents: number;
  }> {
    if (!isUuid(orderId)) throw commerceErrors.orderNotFound(orderId);
    const row = await queryOne<SqlRow>(
      tx,
      `select status, financial_status, fulfillment_status,
              paid_at, delivered_at, total_cents
         from public.orders where id = $1 for update`,
      [orderId],
    );
    if (row === null) throw commerceErrors.orderNotFound(orderId);
    return {
      status: str(row.status, "orders.status"),
      financialStatus: str(row.financial_status, "orders.financial_status"),
      fulfillmentStatus: str(
        row.fulfillment_status,
        "orders.fulfillment_status",
      ),
      paidAt: isoOrNull(row.paid_at, "orders.paid_at"),
      deliveredAt: isoOrNull(row.delivered_at, "orders.delivered_at"),
      totalCents: int(row.total_cents, "orders.total_cents"),
    };
  }

  private async requireOrder(tx: SqlExecutor, orderId: string): Promise<Order> {
    const order = await this.readOrder(tx, "o.id = $1", [orderId]);
    if (order === null) throw commerceErrors.orderNotFound(orderId);
    return order;
  }

  // -- Inventory -----------------------------------------------------------

  async listLocations(): Promise<readonly InventoryLocation[]> {
    const result = await this.sql.query<SqlRow>(
      `select * from public.inventory_locations order by is_default desc, code asc`,
    );
    return result.rows.map(mapLocation);
  }

  async getInventoryLevels(
    query: InventoryQuery = {},
  ): Promise<Connection<InventoryLevel>> {
    const scope = "inventory";
    const build = (params: Params): string => {
      const conditions = ["v.deleted_at is null"];
      if (query.variantIds !== undefined) {
        const ids = query.variantIds.filter(isUuid);
        if (ids.length === 0) return "false";
        conditions.push(`il.variant_id = any(${params.add([...ids])}::uuid[])`);
      }
      if (query.locationId !== undefined) {
        if (!isUuid(query.locationId)) return "false";
        conditions.push(`il.location_id = ${params.add(query.locationId)}`);
      }
      if (query.belowReorderPoint === true) {
        conditions.push(
          "il.reorder_point > 0 and il.available <= il.reorder_point",
        );
      }
      return conditions.join(" and ");
    };

    const countParams = new Params();
    const countWhere = build(countParams);
    const total = await this.count(
      this.sql,
      `select count(*)::int as total
         from public.inventory_levels il
         join public.product_variants v on v.id = il.variant_id
        where ${countWhere}`,
      countParams.values,
    );
    const window = resolvePageWindow(scope, query, total);
    if (window.limit === 0 || window.offset >= total) {
      return buildConnection<InventoryLevel>(scope, [], window, total);
    }
    const params = new Params();
    const where = build(params);
    const limit = params.add(window.limit);
    const offset = params.add(window.offset);
    const result = await this.sql.query<SqlRow>(
      `select il.*, v.sku, l.code as location_code
         from public.inventory_levels il
         join public.product_variants v on v.id = il.variant_id
         join public.inventory_locations l on l.id = il.location_id
        where ${where}
        order by v.sku asc, l.code asc
        limit ${limit} offset ${offset}`,
      params.values,
    );
    return buildConnection(
      scope,
      result.rows.map(mapInventoryLevel),
      window,
      total,
    );
  }

  async adjustInventory(
    input: InventoryAdjustInput,
  ): Promise<InventoryAdjustResult> {
    if (input.changes.length === 0) {
      throw commerceErrors.invalidInput("No inventory changes given", [
        "changes",
      ]);
    }
    return this.sql.transaction(async (tx) => {
      const applied: InventoryAdjustResult["changes"][number][] = [];
      // Sorted so two concurrent multi-line adjustments take the same row locks
      // in the same order and cannot deadlock against each other.
      const changes = [...input.changes].sort((a, b) =>
        `${a.variantId}:${a.locationId}`.localeCompare(
          `${b.variantId}:${b.locationId}`,
        ),
      );

      for (const change of changes) {
        if (!Number.isSafeInteger(change.delta) || change.delta === 0) {
          throw commerceErrors.invalidInput(
            `Delta must be a non-zero integer, got ${String(change.delta)}`,
            ["changes", "delta"],
          );
        }
        if (!isUuid(change.variantId)) {
          throw commerceErrors.variantNotFound(change.variantId);
        }
        if (!isUuid(change.locationId)) {
          throw commerceErrors.locationNotFound(change.locationId);
        }

        const variant = await queryOne<SqlRow>(
          tx,
          `select id, sku, track_inventory from public.product_variants
            where id = $1 and deleted_at is null`,
          [change.variantId],
        );
        if (variant === null)
          throw commerceErrors.variantNotFound(change.variantId);
        if (
          !bool(variant.track_inventory, "product_variants.track_inventory")
        ) {
          throw commerceErrors.inventoryNotTracked(
            change.variantId,
            str(variant.sku, "product_variants.sku"),
          );
        }

        const location = await queryOne<SqlRow>(
          tx,
          `select id from public.inventory_locations where id = $1`,
          [change.locationId],
        );
        if (location === null) {
          throw commerceErrors.locationNotFound(change.locationId);
        }

        let level = await queryOne<SqlRow>(
          tx,
          `select id, on_hand from public.inventory_levels
            where variant_id = $1 and location_id = $2 for update`,
          [change.variantId, change.locationId],
        );
        if (level === null) {
          level = await queryOne<SqlRow>(
            tx,
            `insert into public.inventory_levels
               (variant_id, location_id, provider, sync_status, on_hand)
             values ($1, $2, 'local', 'local', 0)
             returning id, on_hand`,
            [change.variantId, change.locationId],
          );
        }
        if (level === null) {
          throw commerceErrors.providerUnavailable(
            "mock",
            "inventory level missing",
          );
        }

        const onHand = int(level.on_hand, "inventory_levels.on_hand");
        if (
          change.changeFromQuantity !== undefined &&
          change.changeFromQuantity !== onHand
        ) {
          throw commerceErrors.inventoryStaleRead(
            change.variantId,
            change.changeFromQuantity,
            onHand,
          );
        }
        const next = onHand + change.delta;
        if (next < 0) {
          throw commerceErrors.inventoryWouldGoNegative(
            change.variantId,
            change.locationId,
            onHand,
            change.delta,
          );
        }

        await tx.query(
          `update public.inventory_levels set on_hand = $2 where id = $1`,
          [str(level.id, "inventory_levels.id"), next],
        );
        await tx.query(
          `insert into public.inventory_adjustments
             (variant_id, location_id, delta, reason, actor_type, note)
           values ($1, $2, $3, $4, 'operator', $5)`,
          [
            change.variantId,
            change.locationId,
            change.delta,
            input.reason,
            input.note ?? input.referenceDocumentUri ?? null,
          ],
        );
        applied.push({
          variantId: change.variantId,
          locationId: change.locationId,
          delta: change.delta,
          quantityAfterChange: next,
        });
      }

      return {
        reason: input.reason,
        adjustedAt: this.now().toISOString(),
        changes: applied,
      };
    });
  }

  // -- Customers -----------------------------------------------------------

  async listCustomers(
    query: CustomerListQuery = {},
  ): Promise<Connection<Customer>> {
    const scope = "customers";
    const build = (params: Params): string => {
      const conditions = ["c.deleted_at is null"];
      if (query.customerType !== undefined) {
        conditions.push(`c.customer_type = ${params.add(query.customerType)}`);
      }
      if (query.acceptsMarketing !== undefined) {
        conditions.push(
          query.acceptsMarketing
            ? "c.accepts_marketing"
            : "not c.accepts_marketing",
        );
      }
      if (query.search !== undefined && query.search.trim() !== "") {
        const term = params.add(`%${query.search.trim()}%`);
        conditions.push(
          `(c.email ilike ${term} or coalesce(c.full_name, '') ilike ${term} or coalesce(c.company_name, '') ilike ${term})`,
        );
      }
      return conditions.join(" and ");
    };

    const countParams = new Params();
    const total = await this.count(
      this.sql,
      `select count(*)::int as total from public.customers c where ${build(countParams)}`,
      countParams.values,
    );
    const window = resolvePageWindow(scope, query, total);
    if (window.limit === 0 || window.offset >= total) {
      return buildConnection<Customer>(scope, [], window, total);
    }
    const params = new Params();
    const where = build(params);
    const limit = params.add(window.limit);
    const offset = params.add(window.offset);
    const result = await this.sql.query<SqlRow>(
      `select ${CUSTOMER_COLUMNS} from public.customers c
        where ${where}
        order by c.created_at desc, c.id asc
        limit ${limit} offset ${offset}`,
      params.values,
    );
    return buildConnection(scope, result.rows.map(mapCustomer), window, total);
  }

  async getCustomer(customerId: string): Promise<Customer | null> {
    if (!isUuid(customerId)) return null;
    const row = await queryOne<SqlRow>(
      this.sql,
      `select ${CUSTOMER_COLUMNS} from public.customers c
        where c.id = $1 and c.deleted_at is null`,
      [customerId],
    );
    return row === null ? null : mapCustomer(row);
  }

  async getCustomerByEmail(email: string): Promise<Customer | null> {
    const row = await queryOne<SqlRow>(
      this.sql,
      `select ${CUSTOMER_COLUMNS} from public.customers c
        where lower(c.email) = lower($1) and c.deleted_at is null`,
      [email],
    );
    return row === null ? null : mapCustomer(row);
  }

  // -- Discounts -----------------------------------------------------------

  async getDiscountByCode(code: string): Promise<Discount | null> {
    const row = await queryOne<SqlRow>(
      this.sql,
      `select * from public.discounts where upper(code) = upper($1)`,
      [code],
    );
    return row === null ? null : mapDiscount(row);
  }

  async validateDiscountCode(
    cartId: string,
    code: string,
  ): Promise<DiscountValidation> {
    const parsed = parseCartId(cartId);
    if (parsed === null) throw commerceErrors.cartNotFound(cartId);
    return this.sql.transaction(async (tx) => {
      await this.requireLiveCart(tx, parsed.id, parsed.token, cartId);
      // Rebuild first so the cart handed back is the same object the caller
      // would get from getCart, and so pricing is current.
      const cart = await this.refreshAndBuild(tx, cartId, parsed.id);
      const row = await queryOne<SqlRow>(
        tx,
        `select * from public.carts where id = $1`,
        [parsed.id],
      );
      if (row === null) throw commerceErrors.cartNotFound(cartId);
      const cartRow = mapCartRow(row);
      const priced = toPricedLines(await this.loadCartLines(tx, parsed.id));

      const discountRow = await queryOne<SqlRow>(
        tx,
        `select * from public.discounts where upper(code) = upper($1)`,
        [code],
      );
      if (discountRow === null) {
        return {
          code,
          applicable: false,
          discount: null,
          rejectionCode: "DISCOUNT_NOT_FOUND" as CommerceErrorCode,
          rejectionMessage: `${code} is not a valid code`,
          amountOff: zeroMoney(this.currencyCode),
          cart,
        };
      }
      const rule = mapDiscountRule(discountRow);
      const outcome = await this.evaluateRule(tx, rule, cartRow, priced);
      return {
        code: rule.code,
        applicable: outcome.applicable,
        discount: mapDiscount(discountRow),
        rejectionCode: outcome.rejectionCode,
        rejectionMessage: outcome.rejectionMessage,
        amountOff: money(outcome.amountCents, this.currencyCode),
        cart,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// SQL used by the cart and order paths
// ---------------------------------------------------------------------------

const CART_STOCK_CTES = `
with shipping_location as (
  select id from public.inventory_locations where is_active and ships_orders
),
variant_stock as (
  select il.variant_id, sum(il.available)::int as available
    from public.inventory_levels il
    join shipping_location sl on sl.id = il.location_id
   group by il.variant_id
)`;

const CART_LINE_COLUMNS = `
  v.id as variant_id, v.product_id, v.sku, v.barcode,
  v.title as variant_title, v.price_cents, v.compare_at_price_cents, v.currency,
  v.size_ml, v.pack_count, v.weight_grams, v.track_inventory,
  v.inventory_policy, v.position,
  (v.deleted_at is not null) as variant_deleted,
  p.handle as product_handle, p.title as product_title,
  (p.status = 'active' and p.published_at is not null and p.deleted_at is null)
    as product_sellable,
  p.requires_shipping, p.hero_image_url,
  coalesce(vs.available, 0)::int as stock_available,
  coalesce((select array_agg(cp.collection_id::text)
              from public.collection_products cp where cp.product_id = p.id),
           '{}'::text[]) as collection_ids,
  (select json_build_object('id', pi.id, 'url', pi.url, 'alt_text', pi.alt_text,
                            'width_px', pi.width_px, 'height_px', pi.height_px,
                            'position', pi.position, 'variant_id', pi.variant_id)
     from public.product_images pi
    where pi.variant_id = v.id
    order by pi.position, pi.id limit 1) as variant_image`;

const CART_LINES_SQL = `${CART_STOCK_CTES}
select ci.id as line_id, ci.quantity, ci.properties,
       ci.unit_price_cents as stored_unit_price_cents,
       ${CART_LINE_COLUMNS}
  from public.cart_items ci
  join public.product_variants v on v.id = ci.variant_id
  join public.products p on p.id = v.product_id
  left join variant_stock vs on vs.variant_id = v.id
 where ci.cart_id = $1
 order by ci.created_at asc, ci.id asc`;

const VARIANT_FOR_CART_SQL = `${CART_STOCK_CTES}
select null::uuid as line_id, 0 as quantity, '{}'::jsonb as properties,
       v.price_cents as stored_unit_price_cents,
       ${CART_LINE_COLUMNS}
  from public.product_variants v
  join public.products p on p.id = v.product_id
  left join variant_stock vs on vs.variant_id = v.id
 where v.id = any($1::uuid[]) and v.deleted_at is null and p.deleted_at is null`;

const ADDRESS_JSON = `json_build_object(
  'id', a.id, 'first_name', a.first_name, 'last_name', a.last_name,
  'company', a.company, 'line1', a.line1, 'line2', a.line2, 'suburb', a.suburb,
  'city', a.city, 'region', a.region, 'postcode', a.postcode,
  'country_code', a.country_code, 'phone', a.phone,
  'delivery_instructions', a.delivery_instructions
)`;

const ORDER_COLUMNS = `
  o.*,
  (select coalesce(json_agg(json_build_object(
      'id', oi.id, 'variant_id', oi.variant_id, 'product_id', oi.product_id,
      'sku', oi.sku, 'title', oi.title, 'variant_title', oi.variant_title,
      'quantity', oi.quantity, 'quantity_fulfilled', oi.quantity_fulfilled,
      'quantity_refunded', oi.quantity_refunded,
      'unit_price_cents', oi.unit_price_cents, 'discount_cents', oi.discount_cents,
      'tax_cents', oi.tax_cents, 'line_total_cents', oi.line_total_cents,
      'position', oi.position) order by oi.position, oi.id), '[]'::json)
     from public.order_items oi where oi.order_id = o.id) as line_items,
  (select json_build_object('id', cu.id, 'email', cu.email,
                            'display_name', cu.full_name)
     from public.customers cu where cu.id = o.customer_id) as customer_summary,
  (select ${ADDRESS_JSON} from public.addresses a
    where a.id = o.shipping_address_id) as shipping_address,
  (select ${ADDRESS_JSON} from public.addresses a
    where a.id = o.billing_address_id) as billing_address`;

const CUSTOMER_COLUMNS = `
  c.*,
  (select coalesce(json_agg(${ADDRESS_JSON} order by a.address_type, a.created_at),
                   '[]'::json)
     from public.addresses a where a.customer_id = c.id) as addresses`;

// ---------------------------------------------------------------------------
// Row mapping and small helpers
// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function attributesToJson(
  attributes: readonly Attribute[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const attribute of attributes) out[attribute.key] = attribute.value;
  return out;
}

function jsonToAttributes(value: Record<string, unknown>): Attribute[] {
  return Object.entries(value)
    .filter(([key]) => !RESERVED_ATTRIBUTE_KEYS.has(key))
    .map(([key, raw]) => ({
      key,
      value: typeof raw === "string" ? raw : JSON.stringify(raw),
    }));
}

function mapCartRow(row: SqlRow): CartRow {
  return {
    id: str(row.id, "carts.id"),
    token: str(row.token, "carts.token"),
    currencyCode: str(row.currency, "carts.currency"),
    customerId: strOrNull(row.customer_id, "carts.customer_id"),
    email: strOrNull(row.email, "carts.email"),
    status: oneOf(
      row.status,
      ["active", "abandoned", "converted", "expired"] as const,
      "carts.status",
    ),
    note: strOrNull(row.note, "carts.note"),
    attributes: jsonObject(row.attributes, "carts.attributes"),
    discountId: strOrNull(row.discount_id, "carts.discount_id"),
    discountCode: strOrNull(row.discount_code, "carts.discount_code"),
    convertedOrderId: strOrNull(
      row.converted_order_id,
      "carts.converted_order_id",
    ),
    expiresAt: iso(row.expires_at, "carts.expires_at"),
    createdAt: iso(row.created_at, "carts.created_at"),
    updatedAt: iso(row.updated_at, "carts.updated_at"),
  };
}

function mapCartLineRow(row: SqlRow): CartLineRow {
  return {
    lineId: strOrNull(row.line_id, "cart_items.id") ?? "",
    quantity: int(row.quantity, "cart_items.quantity"),
    attributes: jsonToAttributes(
      jsonObject(row.properties, "cart_items.properties"),
    ),
    storedUnitPriceCents: int(
      row.stored_unit_price_cents,
      "cart_items.unit_price_cents",
    ),
    variantId: str(row.variant_id, "product_variants.id"),
    productId: str(row.product_id, "product_variants.product_id"),
    sku: str(row.sku, "product_variants.sku"),
    barcode: strOrNull(row.barcode, "product_variants.barcode"),
    variantTitle: str(row.variant_title, "product_variants.title"),
    priceCents: int(row.price_cents, "product_variants.price_cents"),
    compareAtPriceCents: intOrNull(
      row.compare_at_price_cents,
      "product_variants.compare_at_price_cents",
    ),
    currencyCode: str(row.currency, "product_variants.currency"),
    sizeMl: intOrNull(row.size_ml, "product_variants.size_ml"),
    packCount: int(row.pack_count, "product_variants.pack_count"),
    weightGrams: intOrNull(row.weight_grams, "product_variants.weight_grams"),
    trackInventory: bool(
      row.track_inventory,
      "product_variants.track_inventory",
    ),
    inventoryPolicy: oneOf(
      row.inventory_policy,
      ["deny", "continue"] as const,
      "product_variants.inventory_policy",
    ),
    position: int(row.position, "product_variants.position"),
    variantDeleted: bool(row.variant_deleted, "product_variants.deleted_at"),
    productHandle: str(row.product_handle, "products.handle"),
    productTitle: str(row.product_title, "products.title"),
    productSellable: bool(row.product_sellable, "products.status"),
    requiresShipping: bool(row.requires_shipping, "products.requires_shipping"),
    heroImageUrl: strOrNull(row.hero_image_url, "products.hero_image_url"),
    stockAvailable: int(row.stock_available, "variant_stock.available"),
    collectionIds: strArray(
      row.collection_ids,
      "collection_products.collection_id",
    ),
    variantImage:
      row.variant_image == null ? null : mapImageJson(row.variant_image),
  };
}

function mapImageJson(raw: unknown): {
  id: string;
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
} {
  const row = jsonObject(raw, "product_images");
  return {
    id: str(row.id, "product_images.id"),
    url: str(row.url, "product_images.url"),
    altText: strOrNull(row.alt_text, "product_images.alt_text"),
    width: intOrNull(row.width_px, "product_images.width_px"),
    height: intOrNull(row.height_px, "product_images.height_px"),
  };
}

function toPricedLines(lines: readonly CartLineRow[]): PricedLineInput[] {
  return lines.map((line) => ({
    lineId: line.lineId,
    variantId: line.variantId,
    productId: line.productId,
    quantity: line.quantity,
    // The catalogue price, not `cart_items.unit_price_cents`. This is the
    // single line that makes price tampering pointless.
    catalogueUnitPriceCents: line.priceCents,
    collectionIds: line.collectionIds,
  }));
}

function assertPurchasable(lines: readonly CartLineRow[]): void {
  for (const line of lines) {
    if (line.variantDeleted)
      throw commerceErrors.variantNotFound(line.variantId);
    if (!line.productSellable) {
      throw commerceErrors.variantUnavailable(
        line.variantId,
        "the product is not published",
      );
    }
    if (!line.trackInventory || line.inventoryPolicy === "continue") continue;
    if (line.stockAvailable <= 0) {
      throw commerceErrors.outOfStock(line.variantId, line.sku);
    }
    if (line.quantity > line.stockAvailable) {
      throw commerceErrors.insufficientStock(
        line.variantId,
        line.sku,
        line.quantity,
        line.stockAvailable,
      );
    }
  }
}

function mapDiscountRule(row: SqlRow): DiscountRule {
  const restriction = strOrNull(
    row.customer_type_restriction,
    "discounts.customer_type_restriction",
  );
  return {
    id: str(row.id, "discounts.id"),
    code: str(row.code, "discounts.code"),
    title: str(row.title, "discounts.title"),
    valueType: oneOf(
      row.value_type,
      DISCOUNT_VALUE_TYPES,
      "discounts.value_type",
    ),
    valueBasisPoints: intOrNull(row.value_bp, "discounts.value_bp"),
    valueCents: intOrNull(row.value_cents, "discounts.value_cents"),
    appliesTo: oneOf(row.applies_to, DISCOUNT_SCOPES, "discounts.applies_to"),
    targetProductId: strOrNull(
      row.target_product_id,
      "discounts.target_product_id",
    ),
    targetCollectionId: strOrNull(
      row.target_collection_id,
      "discounts.target_collection_id",
    ),
    minimumSubtotalCents: intOrNull(
      row.minimum_subtotal_cents,
      "discounts.minimum_subtotal_cents",
    ),
    minimumQuantity: intOrNull(
      row.minimum_quantity,
      "discounts.minimum_quantity",
    ),
    customerTypeRestriction:
      restriction === null
        ? null
        : oneOf(
            restriction,
            CUSTOMER_TYPES,
            "discounts.customer_type_restriction",
          ),
    oncePerCustomer: bool(row.once_per_customer, "discounts.once_per_customer"),
    usageLimit: intOrNull(row.usage_limit, "discounts.usage_limit"),
    usageLimitPerCustomer: intOrNull(
      row.usage_limit_per_customer,
      "discounts.usage_limit_per_customer",
    ),
    usedCount: int(row.used_count, "discounts.used_count"),
    status: oneOf(row.status, DISCOUNT_STATUSES, "discounts.status"),
    startsAt: iso(row.starts_at, "discounts.starts_at"),
    endsAt: isoOrNull(row.ends_at, "discounts.ends_at"),
  };
}

function buildDomainCart(args: {
  readonly cartId: string;
  readonly cart: CartRow;
  readonly lines: readonly CartLineRow[];
  readonly totals: ReturnType<typeof computeCartTotals>;
  readonly discount: { rule: DiscountRule; outcome: DiscountOutcome } | null;
  readonly checkoutUrl: string;
}): Cart {
  const { cart, lines, totals, discount } = args;
  const currency = cart.currencyCode;
  const rule = discount?.rule ?? null;
  const applicable = discount?.outcome.applicable ?? false;

  const domainLines: CartLine[] = lines.map((line, index) => {
    const subtotal = totals.lineSubtotals[index] ?? 0;
    const lineDiscount = totals.lineDiscounts[index] ?? 0;
    const unit = unitPricingFor(
      line.priceCents,
      line.sizeMl,
      line.packCount,
      line.currencyCode,
    );
    const inStock =
      !line.trackInventory ||
      line.inventoryPolicy === "continue" ||
      line.stockAvailable > 0;

    return {
      id: line.lineId,
      quantity: line.quantity,
      merchandise: {
        id: line.variantId,
        productId: line.productId,
        sku: line.sku,
        barcode: line.barcode,
        title: line.variantTitle,
        price: money(line.priceCents, line.currencyCode),
        compareAtPrice:
          line.compareAtPriceCents === null
            ? null
            : money(line.compareAtPriceCents, line.currencyCode),
        unitPrice: unit.unitPrice,
        unitPriceMeasurement: unit.measurement,
        availableForSale: line.productSellable && inStock,
        quantityAvailable: line.trackInventory ? line.stockAvailable : null,
        currentlyNotInStock:
          line.trackInventory &&
          line.stockAvailable <= 0 &&
          line.inventoryPolicy === "continue",
        requiresShipping: line.requiresShipping,
        weightGrams: line.weightGrams,
        selectedOptions: selectedOptionsFor(line.sizeMl, line.packCount),
        image: line.variantImage,
        position: line.position,
        product: {
          id: line.productId,
          handle: line.productHandle,
          title: line.productTitle,
          featuredImage:
            line.heroImageUrl === null
              ? line.variantImage
              : {
                  id: `${line.productId}:hero`,
                  url: line.heroImageUrl,
                  altText: line.productTitle,
                  width: null,
                  height: null,
                },
        },
      },
      cost: {
        amountPerQuantity: money(line.priceCents, line.currencyCode),
        compareAtAmountPerQuantity:
          line.compareAtPriceCents === null
            ? null
            : money(line.compareAtPriceCents, line.currencyCode),
        subtotalAmount: money(subtotal, currency),
        totalAmount: money(subtotal - lineDiscount, currency),
      },
      attributes: line.attributes,
      discountAllocations:
        lineDiscount > 0 && rule !== null
          ? [
              {
                discountedAmount: money(lineDiscount, currency),
                title: rule.title,
                code: rule.code,
              },
            ]
          : [],
    };
  });

  const cartAllocations: DiscountAllocation[] =
    totals.discountCents > 0 && rule !== null
      ? [
          {
            discountedAmount: money(totals.discountCents, currency),
            title: rule.title,
            code: rule.code,
          },
        ]
      : [];

  const phone = cart.attributes[BUYER_PHONE_KEY];
  const country = cart.attributes[BUYER_COUNTRY_KEY];

  return {
    id: args.cartId,
    currencyCode: currency,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    lines: domainLines,
    cost: {
      subtotalAmount: money(totals.subtotalCents, currency),
      // The merchandise subtotal is exact: it is a sum of catalogue prices.
      subtotalAmountEstimated: false,
      totalAmount: money(totals.totalCents, currency),
      // The total is not: shipping and the final GST treatment are settled by
      // the hosted checkout, which is the only thing that knows the address.
      totalAmountEstimated: true,
      checkoutChargeAmount: money(totals.totalCents, currency),
    },
    discountCodes:
      cart.discountCode === null
        ? []
        : [{ code: cart.discountCode, applicable }],
    discountAllocations: cartAllocations,
    buyerIdentity: {
      email: cart.email,
      phone: typeof phone === "string" ? phone : null,
      customerId: cart.customerId,
      countryCode: typeof country === "string" ? country : "NZ",
    },
    note: cart.note,
    attributes: jsonToAttributes(cart.attributes),
    checkoutUrl: args.checkoutUrl,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

type OrderFilterArg = NonNullable<OrderListQuery["filter"]>;

function orderConditions(
  filter: OrderFilterArg | undefined,
  params: Params,
): string[] {
  const conditions = ["true"];
  if (filter === undefined) return conditions;
  if (filter.status !== undefined) {
    conditions.push(`o.status = ${params.add(filter.status)}`);
  }
  if (filter.financialStatus !== undefined) {
    conditions.push(
      `o.financial_status = ${params.add(filter.financialStatus)}`,
    );
  }
  if (filter.fulfillmentStatus !== undefined) {
    conditions.push(
      `o.fulfillment_status = ${params.add(filter.fulfillmentStatus)}`,
    );
  }
  if (filter.channel !== undefined) {
    conditions.push(`o.channel = ${params.add(filter.channel)}`);
  }
  if (filter.customerId !== undefined) {
    conditions.push(
      isUuid(filter.customerId)
        ? `o.customer_id = ${params.add(filter.customerId)}`
        : "false",
    );
  }
  if (filter.email !== undefined) {
    conditions.push(`lower(o.email) = lower(${params.add(filter.email)})`);
  }
  if (filter.placedAfter !== undefined) {
    conditions.push(`o.placed_at >= ${params.add(filter.placedAfter)}`);
  }
  if (filter.placedBefore !== undefined) {
    conditions.push(`o.placed_at <= ${params.add(filter.placedBefore)}`);
  }
  if (filter.search !== undefined && filter.search.trim() !== "") {
    const term = params.add(`%${filter.search.trim()}%`);
    conditions.push(`(o.order_number ilike ${term} or o.email ilike ${term})`);
  }
  return conditions;
}

function orderOrderBy(
  sortKey: OrderListQuery["sortKey"],
  reverse: boolean,
): string {
  const direction = reverse ? "desc" : "asc";
  switch (sortKey ?? "PROCESSED_AT") {
    case "TOTAL_PRICE":
      return `o.total_cents ${direction}, o.id asc`;
    case "ORDER_NUMBER":
      return `o.order_number ${direction}, o.id asc`;
    case "UPDATED_AT":
      return `o.updated_at ${direction}, o.id asc`;
    case "PROCESSED_AT":
      return `o.placed_at ${direction}, o.id asc`;
  }
}

function mapOrder(row: SqlRow): Order {
  const currency = str(row.currency, "orders.currency");
  const taxRateBp = int(row.tax_rate_bp, "orders.tax_rate_bp");
  const lineItems: OrderLineItem[] = jsonArray(
    row.line_items,
    "order_items",
  ).map((raw) => {
    const item = jsonObject(raw, "order_items");
    return {
      id: str(item.id, "order_items.id"),
      variantId: str(item.variant_id, "order_items.variant_id"),
      productId: str(item.product_id, "order_items.product_id"),
      sku: str(item.sku, "order_items.sku"),
      title: str(item.title, "order_items.title"),
      variantTitle: strOrNull(item.variant_title, "order_items.variant_title"),
      quantity: int(item.quantity, "order_items.quantity"),
      quantityFulfilled: int(
        item.quantity_fulfilled,
        "order_items.quantity_fulfilled",
      ),
      quantityRefunded: int(
        item.quantity_refunded,
        "order_items.quantity_refunded",
      ),
      unitPrice: money(
        int(item.unit_price_cents, "order_items.unit_price_cents"),
        currency,
      ),
      discountTotal: money(
        int(item.discount_cents, "order_items.discount_cents"),
        currency,
      ),
      taxTotal: money(int(item.tax_cents, "order_items.tax_cents"), currency),
      lineTotal: money(
        int(item.line_total_cents, "order_items.line_total_cents"),
        currency,
      ),
      position: int(item.position, "order_items.position"),
    };
  });

  const summaryRaw = row.customer_summary;
  const trackingCarrier = strOrNull(
    row.tracking_carrier,
    "orders.tracking_carrier",
  );
  const trackingNumber = strOrNull(
    row.tracking_number,
    "orders.tracking_number",
  );

  return {
    id: str(row.id, "orders.id"),
    orderNumber: str(row.order_number, "orders.order_number"),
    email: str(row.email, "orders.email"),
    phone: strOrNull(row.phone, "orders.phone"),
    status: oneOf(row.status, ORDER_STATUSES, "orders.status"),
    financialStatus: oneOf(
      row.financial_status,
      ORDER_FINANCIAL_STATUSES,
      "orders.financial_status",
    ),
    fulfillmentStatus: oneOf(
      row.fulfillment_status,
      ORDER_FULFILLMENT_STATUSES,
      "orders.fulfillment_status",
    ),
    channel: oneOf(row.channel, SALES_CHANNELS, "orders.channel"),
    currencyCode: currency,
    subtotal: money(int(row.subtotal_cents, "orders.subtotal_cents"), currency),
    discountTotal: money(
      int(row.discount_cents, "orders.discount_cents"),
      currency,
    ),
    shippingTotal: money(
      int(row.shipping_cents, "orders.shipping_cents"),
      currency,
    ),
    taxTotal: money(int(row.tax_cents, "orders.tax_cents"), currency),
    taxIncluded: bool(row.tax_inclusive, "orders.tax_inclusive"),
    taxRateBasisPoints: taxRateBp,
    total: money(int(row.total_cents, "orders.total_cents"), currency),
    refundedTotal: money(
      int(row.refunded_cents, "orders.refunded_cents"),
      currency,
    ),
    lineItems,
    customer:
      summaryRaw == null
        ? null
        : (() => {
            const summary = jsonObject(summaryRaw, "orders.customer");
            return {
              id: str(summary.id, "customers.id"),
              email: str(summary.email, "customers.email"),
              displayName: strOrNull(
                summary.display_name,
                "customers.full_name",
              ),
            };
          })(),
    shippingAddress:
      row.shipping_address == null ? null : mapAddress(row.shipping_address),
    billingAddress:
      row.billing_address == null ? null : mapAddress(row.billing_address),
    shippingMethod: strOrNull(row.shipping_method, "orders.shipping_method"),
    tracking:
      trackingCarrier === null || trackingNumber === null
        ? null
        : {
            carrier: trackingCarrier,
            number: trackingNumber,
            url: strOrNull(row.tracking_url, "orders.tracking_url"),
          },
    discountCode: strOrNull(row.discount_code, "orders.discount_code"),
    note: strOrNull(row.note, "orders.note"),
    customerNote: strOrNull(row.customer_note, "orders.customer_note"),
    tags: strArray(row.tags, "orders.tags"),
    cartId: strOrNull(row.cart_id, "orders.cart_id"),
    placedAt: iso(row.placed_at, "orders.placed_at"),
    paidAt: isoOrNull(row.paid_at, "orders.paid_at"),
    fulfilledAt: isoOrNull(row.fulfilled_at, "orders.fulfilled_at"),
    deliveredAt: isoOrNull(row.delivered_at, "orders.delivered_at"),
    cancelledAt: isoOrNull(row.cancelled_at, "orders.cancelled_at"),
    cancelReason: strOrNull(row.cancel_reason, "orders.cancel_reason"),
    createdAt: iso(row.created_at, "orders.created_at"),
    updatedAt: iso(row.updated_at, "orders.updated_at"),
  };
}
