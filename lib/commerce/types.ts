/**
 * The commerce domain model.
 *
 * Every type here is chosen so that a Shopify implementation is a *mapping*
 * rather than an argument. Where a name is Shopify's own (`checkoutUrl`,
 * `availableForSale`, `quantityAvailable`, `selectedOptions`,
 * `unitPriceMeasurement`, `discountCodes[].applicable`) it is kept, because
 * renaming a field you are going to have to map back is a cost with no payoff.
 *
 * Two absences are deliberate and are the load-bearing design decisions:
 *
 *  1. **There is no payment anywhere in this file.** Checkout is a handoff to
 *     Shopify's hosted checkout, which owns GST, payment, fraud and shipping
 *     rates. The interface hands back a URL and later reads an order.
 *
 *  2. **A cart has no tax and no shipping total.** Shopify deprecated
 *     `CartCost.totalTaxAmount` and `CartCost.totalDutyAmount` for exactly this
 *     reason: until an address and a shipping method exist, any tax number is a
 *     guess. `subtotalAmountEstimated` / `totalAmountEstimated` carry that
 *     uncertainty instead of a fabricated figure.
 */

import type { CurrencyCode, Money } from "./money";
import type { CommerceErrorCode } from "./errors";

// ---------------------------------------------------------------------------
// Pagination — Relay connections, as both APIs speak
// ---------------------------------------------------------------------------

export type PageInfo = {
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly startCursor: string | null;
  readonly endCursor: string | null;
};

export type Connection<T> = {
  readonly nodes: readonly T[];
  readonly pageInfo: PageInfo;
};

/**
 * Relay page arguments. Exactly one direction may be given: `first`/`after` or
 * `last`/`before`. Providers cap `first`/`last` at {@link MAX_PAGE_SIZE}, as
 * Shopify does at 250.
 */
export type PageArgs = {
  readonly first?: number;
  readonly after?: string;
  readonly last?: number;
  readonly before?: string;
};

export const MAX_PAGE_SIZE = 250;
export const DEFAULT_PAGE_SIZE = 24;

/** A cart holds at most this many lines. Shopify's documented limit. */
export const MAX_CART_LINES = 500;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export type ProductStatus = "draft" | "active" | "archived";

export type Image = {
  readonly id: string;
  readonly url: string;
  readonly altText: string | null;
  readonly width: number | null;
  readonly height: number | null;
};

export type SelectedOption = {
  readonly name: string;
  readonly value: string;
};

/**
 * Shopify's unit-price measurement, used for "$4.60 / 100ml" shelf labelling.
 * Populated from the variant's size, which is why a bare `sizeMl` is not on
 * this interface: this is the field Shopify actually has.
 */
export type UnitPriceMeasurement = {
  readonly measuredType: "VOLUME" | "WEIGHT" | "AREA" | "LENGTH";
  readonly quantityUnit: string;
  readonly quantityValue: number;
  readonly referenceUnit: string;
  readonly referenceValue: number;
};

export type ProductVariant = {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly barcode: string | null;
  readonly title: string;
  readonly price: Money;
  readonly compareAtPrice: Money | null;
  /** Per-unit price for shelf labelling, e.g. per 100 ml. */
  readonly unitPrice: Money | null;
  readonly unitPriceMeasurement: UnitPriceMeasurement | null;
  readonly availableForSale: boolean;
  /**
   * Sellable units across every location that ships orders, or `null` when the
   * variant does not track inventory. Shopify gates this field on the
   * `unauthenticated_read_product_inventory` scope and returns `null` without
   * it, so callers must handle `null` regardless of provider.
   */
  readonly quantityAvailable: number | null;
  /** True when stock is zero but the variant still sells (backorder). */
  readonly currentlyNotInStock: boolean;
  readonly requiresShipping: boolean;
  readonly weightGrams: number | null;
  readonly selectedOptions: readonly SelectedOption[];
  readonly image: Image | null;
  readonly position: number;
};

export type Product = {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly description: string | null;
  readonly productType: string | null;
  readonly vendor: string;
  readonly status: ProductStatus;
  readonly publishedAt: string | null;
  readonly tags: readonly string[];
  readonly seo: {
    readonly title: string | null;
    readonly description: string | null;
  };
  readonly featuredImage: Image | null;
  readonly images: readonly Image[];
  readonly variants: readonly ProductVariant[];
  readonly priceRange: { readonly min: Money; readonly max: Money };
  readonly availableForSale: boolean;
  readonly requiresShipping: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type Collection = {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly description: string | null;
  readonly image: Image | null;
  readonly seo: {
    readonly title: string | null;
    readonly description: string | null;
  };
  readonly updatedAt: string;
};

/**
 * Product sort keys. A strict subset of Shopify's `ProductSortKeys` — only the
 * keys a SQL mirror can honour identically are here, so that
 * `sort: "PRICE", reverse: true` means the same thing on both providers.
 */
export const PRODUCT_SORT_KEYS = [
  "TITLE",
  "PRICE",
  "CREATED_AT",
  "UPDATED_AT",
  "BEST_SELLING",
  "PRODUCT_TYPE",
  "RELEVANCE",
] as const;
export type ProductSortKey = (typeof PRODUCT_SORT_KEYS)[number];

export const COLLECTION_SORT_KEYS = ["TITLE", "UPDATED_AT", "MANUAL"] as const;
export type CollectionSortKey = (typeof COLLECTION_SORT_KEYS)[number];

export const ORDER_SORT_KEYS = [
  "PROCESSED_AT",
  "TOTAL_PRICE",
  "ORDER_NUMBER",
  "UPDATED_AT",
] as const;
export type OrderSortKey = (typeof ORDER_SORT_KEYS)[number];

/**
 * A typed product filter.
 *
 * Shopify's `products(query:)` takes a search-syntax *string*
 * (`available_for_sale:true AND tag:'bar'`). Building that string by hand at
 * every call site is how injection bugs and typos happen, so the interface
 * takes this structure and the Shopify adapter serialises it. Every field here
 * has a documented counterpart in the Storefront `ProductConnection` filter
 * list; nothing else is accepted, precisely so nothing unmappable creeps in.
 */
export type ProductFilter = {
  readonly availableForSale?: boolean;
  readonly productType?: string;
  readonly vendor?: string;
  /** Products carrying every one of these tags. */
  readonly tags?: readonly string[];
  /** Products carrying none of these tags. Shopify's `tag_not`. */
  readonly excludeTags?: readonly string[];
  /** Free-text search over title, subtitle, description and type. */
  readonly search?: string;
  /** Inclusive bounds on variant price, in minor units. */
  readonly minPrice?: number;
  readonly maxPrice?: number;
  readonly createdAfter?: string;
  readonly updatedAfter?: string;
};

export type ProductListQuery = PageArgs & {
  readonly filter?: ProductFilter;
  readonly sortKey?: ProductSortKey;
  readonly reverse?: boolean;
};

export type CollectionListQuery = PageArgs & {
  readonly sortKey?: CollectionSortKey;
  readonly reverse?: boolean;
  /** Only collections visible on the storefront. Defaults to true. */
  readonly publishedOnly?: boolean;
};

export type CollectionProductsQuery = PageArgs & {
  readonly filter?: ProductFilter;
  /** `MANUAL` follows the merchandiser's hand-ordering of the collection. */
  readonly sortKey?: ProductSortKey | "MANUAL";
  readonly reverse?: boolean;
};

export type CollectionWithProducts = {
  readonly collection: Collection;
  readonly products: Connection<Product>;
};

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export type Attribute = { readonly key: string; readonly value: string };

/**
 * The variant as it sits on a cart line, plus just enough of its product to
 * render the line without a second round trip. Mirrors Shopify's
 * `CartLine.merchandise` being a `ProductVariant` with a nested `product`.
 */
export type CartLineMerchandise = ProductVariant & {
  readonly product: {
    readonly id: string;
    readonly handle: string;
    readonly title: string;
    readonly featuredImage: Image | null;
  };
};

export type CartLineCost = {
  readonly amountPerQuantity: Money;
  readonly compareAtAmountPerQuantity: Money | null;
  /** Before line-level discounts. */
  readonly subtotalAmount: Money;
  /** After line-level discounts. */
  readonly totalAmount: Money;
};

export type DiscountAllocation = {
  readonly discountedAmount: Money;
  readonly title: string;
  readonly code: string | null;
};

export type CartLine = {
  readonly id: string;
  readonly quantity: number;
  readonly merchandise: CartLineMerchandise;
  readonly cost: CartLineCost;
  readonly attributes: readonly Attribute[];
  readonly discountAllocations: readonly DiscountAllocation[];
};

/**
 * Cart money. Mirrors Shopify's `CartCost`, including the two `…Estimated`
 * booleans and the deliberate absence of tax — see the note at the top of this
 * file.
 */
export type CartCost = {
  readonly subtotalAmount: Money;
  readonly subtotalAmountEstimated: boolean;
  readonly totalAmount: Money;
  readonly totalAmountEstimated: boolean;
  /** What the buyer is charged at checkout time. Equals `totalAmount` here. */
  readonly checkoutChargeAmount: Money;
};

export type CartDiscountCode = {
  readonly code: string;
  /** Whether the code applies to the cart's *current* contents. */
  readonly applicable: boolean;
};

export type CartBuyerIdentity = {
  readonly email: string | null;
  readonly phone: string | null;
  readonly customerId: string | null;
  readonly countryCode: string | null;
};

export type Cart = {
  /**
   * The opaque cart handle. Both providers embed the bearer secret in it —
   * Shopify as `gid://shopify/Cart/<token>?key=<secret>`, the mock as
   * `<uuid>?key=<token>` — so a client that holds the id holds everything it
   * needs and nothing it should not. Never log this whole value.
   */
  readonly id: string;
  readonly currencyCode: CurrencyCode;
  readonly totalQuantity: number;
  readonly lines: readonly CartLine[];
  readonly cost: CartCost;
  readonly discountCodes: readonly CartDiscountCode[];
  readonly discountAllocations: readonly DiscountAllocation[];
  readonly buyerIdentity: CartBuyerIdentity;
  readonly note: string | null;
  readonly attributes: readonly Attribute[];
  readonly checkoutUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/**
 * A non-blocking problem with an otherwise successful cart mutation — the line
 * went in, but only 3 of the 5 requested were in stock. Shopify returns these
 * as `warnings` alongside the cart and so do we.
 */
export type CartWarning = {
  readonly code: CommerceErrorCode;
  readonly message: string;
  /** The cart line or field the warning is about. */
  readonly target: string | null;
};

export type CartMutationResult = {
  readonly cart: Cart;
  readonly warnings: readonly CartWarning[];
};

/**
 * A line to add. Note what is **not** here: there is no price field, at any
 * level, by design. A price the client can name is a price the client can
 * change; the provider reads `product_variants.price_cents` and nothing else.
 */
export type CartLineInput = {
  readonly variantId: string;
  readonly quantity: number;
  readonly attributes?: readonly Attribute[];
};

export type CartLineUpdateInput = {
  readonly lineId: string;
  readonly quantity: number;
  readonly attributes?: readonly Attribute[];
};

export type CartCreateInput = {
  readonly lines?: readonly CartLineInput[];
  readonly buyerIdentity?: BuyerIdentityInput;
  readonly note?: string;
  readonly attributes?: readonly Attribute[];
  readonly discountCodes?: readonly string[];
};

export type BuyerIdentityInput = {
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly customerId?: string | null;
  readonly countryCode?: string | null;
};

// ---------------------------------------------------------------------------
// Checkout handoff
// ---------------------------------------------------------------------------

/**
 * Everything the storefront needs to send a buyer to checkout, and nothing
 * about how they will pay. The URL is Shopify's hosted checkout in production
 * and the mock checkout route in development; in both cases the app's last act
 * is a redirect.
 */
export type CheckoutHandoff = {
  readonly cartId: string;
  readonly checkoutUrl: string;
  readonly totalQuantity: number;
  /**
   * The total as the cart currently computes it. Explicitly an *estimate*: the
   * hosted checkout adds shipping and confirms GST, and the order is the only
   * authority on what was actually charged.
   */
  readonly estimatedTotal: Money;
  readonly currencyCode: CurrencyCode;
};

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderStatus = "open" | "archived" | "cancelled";

export type OrderFinancialStatus =
  | "pending"
  | "authorized"
  | "partially_paid"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "voided";

export type OrderFulfillmentStatus =
  | "unfulfilled"
  | "partially_fulfilled"
  | "fulfilled"
  | "delivered"
  | "restocked";

export type SalesChannel =
  "online" | "wholesale" | "market" | "phone" | "retail" | "subscription";

export type Address = {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly company: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly suburb: string | null;
  readonly city: string;
  readonly region: string | null;
  readonly postcode: string | null;
  readonly countryCode: string;
  readonly phone: string | null;
  readonly deliveryInstructions: string | null;
};

export type OrderLineItem = {
  readonly id: string;
  readonly variantId: string;
  readonly productId: string;
  readonly sku: string;
  readonly title: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly quantityFulfilled: number;
  readonly quantityRefunded: number;
  readonly unitPrice: Money;
  readonly discountTotal: Money;
  /** GST contained in this line, since NZ prices are tax-inclusive. */
  readonly taxTotal: Money;
  readonly lineTotal: Money;
  readonly position: number;
};

export type OrderTracking = {
  readonly carrier: string;
  readonly number: string;
  readonly url: string | null;
};

export type CustomerSummary = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
};

export type Order = {
  readonly id: string;
  /** The human-facing number, e.g. `HS-01042`. Shopify calls this `name`. */
  readonly orderNumber: string;
  readonly email: string;
  readonly phone: string | null;
  readonly status: OrderStatus;
  readonly financialStatus: OrderFinancialStatus;
  readonly fulfillmentStatus: OrderFulfillmentStatus;
  readonly channel: SalesChannel;
  readonly currencyCode: CurrencyCode;
  readonly subtotal: Money;
  readonly discountTotal: Money;
  readonly shippingTotal: Money;
  /** GST. Contained *within* `total` when `taxIncluded` is true, as in NZ. */
  readonly taxTotal: Money;
  readonly taxIncluded: boolean;
  readonly taxRateBasisPoints: number;
  readonly total: Money;
  readonly refundedTotal: Money;
  readonly lineItems: readonly OrderLineItem[];
  readonly customer: CustomerSummary | null;
  readonly shippingAddress: Address | null;
  readonly billingAddress: Address | null;
  readonly shippingMethod: string | null;
  readonly tracking: OrderTracking | null;
  readonly discountCode: string | null;
  readonly note: string | null;
  readonly customerNote: string | null;
  readonly tags: readonly string[];
  readonly cartId: string | null;
  readonly placedAt: string;
  readonly paidAt: string | null;
  readonly fulfilledAt: string | null;
  readonly deliveredAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type OrderListFilter = {
  readonly status?: OrderStatus;
  readonly financialStatus?: OrderFinancialStatus;
  readonly fulfillmentStatus?: OrderFulfillmentStatus;
  readonly channel?: SalesChannel;
  readonly customerId?: string;
  readonly email?: string;
  readonly placedAfter?: string;
  readonly placedBefore?: string;
  /** Free text over order number and customer email. */
  readonly search?: string;
};

export type OrderListQuery = PageArgs & {
  readonly filter?: OrderListFilter;
  readonly sortKey?: OrderSortKey;
  readonly reverse?: boolean;
};

/**
 * The whole of what may be changed on an existing order.
 *
 * This is Shopify's `OrderInput` minus the fields we have no column for, and it
 * is short on purpose: totals, line items, financial status and fulfilment
 * status are **not** editable through this door on either provider. Money on a
 * placed order changes only through a refund; fulfilment changes only through
 * {@link CommerceProvider.fulfillOrder}.
 */
export type OrderPatch = {
  readonly email?: string;
  readonly phone?: string | null;
  readonly note?: string | null;
  readonly customerNote?: string | null;
  readonly tags?: readonly string[];
  readonly shippingMethod?: string | null;
};

export type OrderFulfillmentInput = {
  readonly carrier: string;
  readonly trackingNumber: string;
  readonly trackingUrl?: string | null;
  readonly notifyCustomer?: boolean;
  /** Omit to fulfil every outstanding line. */
  readonly lineItems?: readonly {
    readonly lineItemId: string;
    readonly quantity: number;
  }[];
};

export type OrderCancelInput = {
  readonly reason:
    "customer" | "declined" | "fraud" | "inventory" | "staff" | "other";
  /** Return the stock to the location it was taken from. */
  readonly restock?: boolean;
  readonly refund?: boolean;
  readonly notifyCustomer?: boolean;
};

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export type CustomerType = "retail" | "trade" | "wholesale" | "staff" | "press";

export type Customer = {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly displayName: string | null;
  readonly phone: string | null;
  /** Maps to a Shopify customer tag (`trade`, `wholesale`, …). */
  readonly customerType: CustomerType;
  readonly companyName: string | null;
  readonly acceptsMarketing: boolean;
  readonly tags: readonly string[];
  readonly note: string | null;
  readonly ordersCount: number;
  readonly totalSpent: Money;
  readonly defaultAddress: Address | null;
  readonly addresses: readonly Address[];
  readonly firstOrderedAt: string | null;
  readonly lastOrderedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type CustomerListQuery = PageArgs & {
  readonly customerType?: CustomerType;
  readonly acceptsMarketing?: boolean;
  /** Free text over email and name. */
  readonly search?: string;
};

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export type LocationKind =
  | "kitchen"
  | "coolstore"
  | "warehouse"
  | "retail"
  | "third_party"
  | "market_stall";

export type InventoryLocation = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: LocationKind;
  readonly city: string | null;
  readonly countryCode: string;
  readonly isActive: boolean;
  readonly isDefault: boolean;
  readonly shipsOrders: boolean;
};

export type InventoryLevel = {
  readonly variantId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  /** Sellable now. `onHand - committed`. */
  readonly available: number;
  readonly onHand: number;
  readonly committed: number;
  readonly incoming: number;
  readonly reorderPoint: number;
  readonly reorderQuantity: number;
  readonly updatedAt: string;
};

export type InventoryQuery = PageArgs & {
  readonly variantIds?: readonly string[];
  readonly locationId?: string;
  /** Only levels at or below their reorder point. */
  readonly belowReorderPoint?: boolean;
};

/**
 * Adjustment reasons. These are the schema's `public.inventory_reason` values;
 * {@link SHOPIFY_INVENTORY_REASONS} maps each to the string Shopify's
 * `inventoryAdjustQuantities` accepts, so the adapter is a table lookup.
 */
export const INVENTORY_REASONS = [
  "batch_release",
  "sale",
  "return",
  "damage",
  "sample",
  "stocktake",
  "transfer",
  "expiry",
  "recall",
  "correction",
] as const;
export type InventoryReason = (typeof INVENTORY_REASONS)[number];

/** Domain reason -> Shopify `inventoryAdjustQuantities` reason (2026-07). */
export const SHOPIFY_INVENTORY_REASONS: Readonly<
  Record<InventoryReason, string>
> = {
  batch_release: "received",
  sale: "shrinkage",
  return: "restock",
  damage: "damaged",
  sample: "promotion",
  stocktake: "cycle_count_available",
  transfer: "movement_created",
  expiry: "shrinkage",
  recall: "quality_control",
  correction: "correction",
};

export type InventoryChange = {
  readonly variantId: string;
  readonly locationId: string;
  /** Positive adds stock, negative removes it. Never zero. */
  readonly delta: number;
  /**
   * Compare-and-swap guard: the on-hand quantity the caller believes is there.
   * If it has moved, the adjustment is refused with `INVENTORY_STALE_READ`
   * rather than applied to a number the caller never saw. Shopify calls this
   * `changeFromQuantity`; pass `undefined` to opt out, exactly as there.
   */
  readonly changeFromQuantity?: number;
};

export type InventoryAdjustInput = {
  readonly reason: InventoryReason;
  readonly changes: readonly InventoryChange[];
  /** Free-form URI naming what caused this, e.g. a batch or order id. */
  readonly referenceDocumentUri?: string;
  readonly note?: string;
};

export type InventoryAdjustResult = {
  readonly reason: InventoryReason;
  readonly adjustedAt: string;
  readonly changes: readonly {
    readonly variantId: string;
    readonly locationId: string;
    readonly delta: number;
    readonly quantityAfterChange: number;
  }[];
};

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------

export type DiscountValueType = "percentage" | "fixed_amount" | "free_shipping";
export type DiscountScope = "order" | "product" | "collection" | "shipping";
export type DiscountStatus =
  "draft" | "scheduled" | "active" | "expired" | "disabled";

export type Discount = {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string | null;
  readonly valueType: DiscountValueType;
  /** Set when `valueType` is `percentage`. 1000bp = 10%. */
  readonly percentageBasisPoints: number | null;
  /** Set when `valueType` is `fixed_amount`. */
  readonly amount: Money | null;
  readonly appliesTo: DiscountScope;
  readonly targetProductId: string | null;
  readonly targetCollectionId: string | null;
  readonly minimumSubtotal: Money | null;
  readonly minimumQuantity: number | null;
  readonly customerTypeRestriction: CustomerType | null;
  readonly oncePerCustomer: boolean;
  readonly usageLimit: number | null;
  readonly usageLimitPerCustomer: number | null;
  readonly usageCount: number;
  readonly status: DiscountStatus;
  readonly startsAt: string;
  readonly endsAt: string | null;
};

/**
 * The result of trying a code against a cart.
 *
 * Shaped after how Shopify actually answers this question — there is no
 * "validate this code" endpoint; you apply the code with
 * `cartDiscountCodesUpdate` and read back `discountCodes[].applicable` plus any
 * `warnings`. So this carries the same three things: whether it applied, why
 * not, and what the cart looks like now.
 */
export type DiscountValidation = {
  readonly code: string;
  readonly applicable: boolean;
  readonly discount: Discount | null;
  /** Why it did not apply. Null when `applicable`. */
  readonly rejectionCode: CommerceErrorCode | null;
  readonly rejectionMessage: string | null;
  /** What it would take off this cart. Zero when not applicable. */
  readonly amountOff: Money;
  readonly cart: Cart;
};
