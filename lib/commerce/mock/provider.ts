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
