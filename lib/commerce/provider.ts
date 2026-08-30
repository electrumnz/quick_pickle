/**
 * `CommerceProvider` — the contract the entire storefront and admin sit on.
 *
 * There are two implementations. `MockProvider` runs against the Supabase
 * schema and is what the first demo actually serves. `ShopifyProvider` will map
 * the same calls onto the Storefront and Admin GraphQL APIs. Nothing above this
 * line knows which one it has.
 *
 * ## The rules this interface is built from
 *
 * **Every operation is expressible on Shopify.** Each method below names the
 * Storefront or Admin operation it maps to. Where Shopify has no equivalent —
 * "reserve this stock", "validate a code without a cart", "read the cart's tax"
 * — the method is absent rather than present-and-broken on one provider.
 *
 * **Checkout is a handoff.** {@link CommerceProvider.beginCheckout} returns a
 * URL. There is no payment type anywhere in this layer, no card, no gateway, no
 * intent. Shopify's hosted checkout owns GST, payment, fraud and shipping
 * rates; we own the cart up to the redirect and the order after it.
 *
 * **Totals are never an input.** No method accepts a price, a subtotal or a
 * total. Prices are read from the catalogue by the provider on every single
 * call, so a tampered client request has nothing to tamper with.
 *
 * **Reads may return null; writes throw.** A missing product is `null`. A
 * mutation against a missing, expired or already-converted cart throws a typed
 * `CommerceError` — see `./errors`, which is also where the codes named by the
 * `@throws` tags below are defined. This mirrors Shopify, where a query for a
 * dead cart returns null and a mutation returns a `userError`.
 */

import type { CurrencyCode } from "./money";
import type {
  Cart,
  CartCreateInput,
  CartLineInput,
  CartLineUpdateInput,
  CartMutationResult,
  BuyerIdentityInput,
  CheckoutHandoff,
  Collection,
  CollectionListQuery,
  CollectionProductsQuery,
  CollectionWithProducts,
  Connection,
  Customer,
  CustomerListQuery,
  Discount,
  DiscountValidation,
  InventoryAdjustInput,
  InventoryAdjustResult,
  InventoryLevel,
  InventoryLocation,
  InventoryQuery,
  Order,
  OrderCancelInput,
  OrderFulfillmentInput,
  OrderListQuery,
  OrderPatch,
  Product,
  ProductListQuery,
} from "./types";

/**
 * Every implementation name that can exist on this seam.
 *
 * `demo` is the mock provider pointed at a Postgres compiled into the build
 * rather than at one over the network — see `lib/commerce/demo/provider.ts`. It
 * is a third entry on the seam, not a fork: the same class, the same SQL, the
 * same conformance suite. It is only *selectable* when `HALF_SOUR_DEMO=1`, which
 * is why {@link COMMERCE_PROVIDER_NAMES} and the set a human may put in
 * `COMMERCE_PROVIDER` are two different lists — see `selectableProviderNames`
 * in `./config`.
 */
export const COMMERCE_PROVIDER_NAMES = ["mock", "shopify", "demo"] as const;
export type CommerceProviderName = (typeof COMMERCE_PROVIDER_NAMES)[number];

/**
 * Facts about a provider that callers legitimately need but that are not a
 * field on any Shopify object.
 *
 * `cartTtlDays` is the clearest example: Shopify documents that "unused and
 * abandoned carts automatically expire within 30 days of creation" but exposes
 * no `expiresAt` on `Cart`. So the number lives here, where both providers can
 * state it honestly, instead of on a cart object where only one of them could
 * fill it in.
 */
export type ProviderCapabilities = {
  /** How long a cart survives without activity. Shopify: 30. */
  readonly cartTtlDays: number;
  /** Maximum lines in one cart. Shopify: 500. */
  readonly maxCartLines: number;
  /** Largest page either API will return. Shopify: 250. */
  readonly maxPageSize: number;
  /**
   * True when `quantityAvailable` is populated. On Shopify this depends on the
   * storefront token carrying `unauthenticated_read_product_inventory`.
   */
  readonly exposesInventoryQuantities: boolean;
  /** True when the provider can place an order without a real payment. */
  readonly simulatesCheckout: boolean;
};

/**
 * The buyer's half of checkout, simulated.
 *
 * On Shopify this is null: a human completes the hosted checkout and the order
 * arrives by webhook. The mock has to stand in for that human, and it does so
 * behind this separate interface rather than as an optional method on
 * `CommerceProvider`, so that no storefront code can accidentally depend on
 * being able to conjure an order.
 *
 * The order it produces is a real row, built by the same transaction that would
 * run on a webhook: stock is decremented, the ledger is written, the cart is
 * marked converted, the customer's rollups move. The flow either side of it is
 * identical on both providers.
 */
export type CheckoutSimulator = {
  /**
   * Complete the cart's checkout as if the buyer had paid.
   *
   * @throws {CommerceError} `CART_NOT_FOUND`, `CART_EXPIRED`, `CART_EMPTY`,
   * `CART_ALREADY_COMPLETED`, `OUT_OF_STOCK` or `INSUFFICIENT_STOCK`.
   */
  completeCheckout(
    cartId: string,
    input: SimulatedCheckoutInput,
  ): Promise<Order>;
};

export type SimulatedCheckoutInput = {
  readonly email: string;
  readonly phone?: string | null;
  readonly shippingAddress: SimulatedCheckoutAddress;
  readonly billingAddress?: SimulatedCheckoutAddress;
  readonly shippingMethod?: string;
  /** Shipping charge in minor units. The hosted checkout's job in production. */
  readonly shippingAmount?: number;
  readonly customerNote?: string;
  readonly acceptsMarketing?: boolean;
};

export type SimulatedCheckoutAddress = {
  readonly firstName: string;
  readonly lastName: string;
  readonly company?: string | null;
  readonly line1: string;
  readonly line2?: string | null;
  readonly suburb?: string | null;
  readonly city: string;
  readonly region?: string | null;
  readonly postcode?: string | null;
  readonly countryCode?: string;
  readonly phone?: string | null;
  readonly deliveryInstructions?: string | null;
};

export interface CommerceProvider {
  readonly name: CommerceProviderName;
  /** The single currency this store trades in. NZD. */
  readonly currencyCode: CurrencyCode;
  readonly capabilities: ProviderCapabilities;

  /**
   * Non-null only when {@link ProviderCapabilities.simulatesCheckout}. See
   * {@link CheckoutSimulator}.
   */
  readonly checkoutSimulator: CheckoutSimulator | null;

  /** Release connections. Safe to call twice. */
  close(): Promise<void>;

  // -- Catalogue ------------------------------------------------------------
  // Storefront: `products`, `product(handle:)`, `collections`,
  // `collection(handle:)`.

  /** @throws {CommerceError} `INVALID_INPUT` for contradictory page args. */
  listProducts(query?: ProductListQuery): Promise<Connection<Product>>;

  getProductByHandle(handle: string): Promise<Product | null>;

  getProductById(id: string): Promise<Product | null>;

  /** Variants by id, in the order asked for. Missing ids are simply absent. */
  getVariantsById(
    ids: readonly string[],
  ): Promise<readonly Product["variants"][number][]>;

  listCollections(query?: CollectionListQuery): Promise<Connection<Collection>>;

  /**
   * A collection and one page of its products. Returns null when the handle is
   * unknown or the collection is unpublished.
   */
  getCollectionByHandle(
    handle: string,
    query?: CollectionProductsQuery,
  ): Promise<CollectionWithProducts | null>;

  // -- Cart -----------------------------------------------------------------
  // Storefront: `cartCreate`, `cart(id:)`, `cartLinesAdd`, `cartLinesUpdate`,
  // `cartLinesRemove`, `cartDiscountCodesUpdate`, `cartBuyerIdentityUpdate`,
  // `cartNoteUpdate`, `cartAttributesUpdate`.

  createCart(input?: CartCreateInput): Promise<CartMutationResult>;

  /** Null for a cart that never existed, expired, or was already converted. */
  getCart(cartId: string): Promise<Cart | null>;

  /**
   * @throws {CommerceError} `CART_NOT_FOUND`, `CART_EXPIRED`,
   * `CART_ALREADY_COMPLETED`, `VARIANT_NOT_FOUND`, `VARIANT_UNAVAILABLE`,
   * `INVALID_QUANTITY`, `CART_TOO_LARGE`.
   */
  addCartLines(
    cartId: string,
    lines: readonly CartLineInput[],
  ): Promise<CartMutationResult>;

  /** Quantity 0 removes the line, as `cartLinesUpdate` does. */
  updateCartLines(
    cartId: string,
    lines: readonly CartLineUpdateInput[],
  ): Promise<CartMutationResult>;

  removeCartLines(
    cartId: string,
    lineIds: readonly string[],
  ): Promise<CartMutationResult>;

  /**
   * Replace the cart's discount codes. An inapplicable code is *kept* with
   * `applicable: false` and reported as a warning, which is what Shopify does
   * and what lets the UI say "SPRING20 doesn't apply to these items".
   */
  updateCartDiscountCodes(
    cartId: string,
    codes: readonly string[],
  ): Promise<CartMutationResult>;

  /**
   * Identify the buyer. This is where an anonymous cart becomes a known one:
   * if the email or customer id matches a customer who already has an open
   * cart, that cart's lines are merged into this one and the old cart is
   * retired.
   */
  updateCartBuyerIdentity(
    cartId: string,
    buyerIdentity: BuyerIdentityInput,
  ): Promise<CartMutationResult>;

  updateCartNote(
    cartId: string,
    note: string | null,
  ): Promise<CartMutationResult>;

  updateCartAttributes(
    cartId: string,
    attributes: readonly { readonly key: string; readonly value: string }[],
  ): Promise<CartMutationResult>;

  // -- Checkout handoff -----------------------------------------------------

  /**
   * Recompute the cart from the database and hand back the URL to send the
   * buyer to. This is the last thing this layer does before the buyer leaves.
   *
   * @throws {CommerceError} `CART_NOT_FOUND`, `CART_EXPIRED`, `CART_EMPTY`,
   * `CART_ALREADY_COMPLETED`, `OUT_OF_STOCK`.
   */
  beginCheckout(cartId: string): Promise<CheckoutHandoff>;

  // -- Orders ---------------------------------------------------------------
  // Admin: `orders`, `order(id:)`, `orderUpdate`, `orderCancel`,
  // `fulfillmentCreate`, `orderMarkAsPaid`.

  listOrders(query?: OrderListQuery): Promise<Connection<Order>>;

  getOrder(orderId: string): Promise<Order | null>;

  getOrderByNumber(orderNumber: string): Promise<Order | null>;

  /**
   * Change only what Shopify's `OrderInput` allows to change. Totals, line
   * items and statuses are not in {@link OrderPatch} and never will be.
   *
   * @throws {CommerceError} `ORDER_NOT_FOUND`, `ORDER_NOT_EDITABLE`.
   */
  updateOrder(orderId: string, patch: OrderPatch): Promise<Order>;

  /** Admin `orderMarkAsPaid`. */
  markOrderPaid(orderId: string): Promise<Order>;

  /** Admin `fulfillmentCreate`. */
  fulfillOrder(orderId: string, input: OrderFulfillmentInput): Promise<Order>;

  /** Admin `orderCancel`. Restocking writes an inventory ledger entry. */
  cancelOrder(orderId: string, input: OrderCancelInput): Promise<Order>;

  // -- Inventory ------------------------------------------------------------
  // Admin: `locations`, `inventoryItem.inventoryLevels.quantities`,
  // `inventoryAdjustQuantities`.

  listLocations(): Promise<readonly InventoryLocation[]>;

  getInventoryLevels(
    query?: InventoryQuery,
  ): Promise<Connection<InventoryLevel>>;

  /**
   * Apply a set of deltas atomically: either every change lands or none does.
   *
   * @throws {CommerceError} `VARIANT_NOT_FOUND`, `LOCATION_NOT_FOUND`,
   * `INVENTORY_NOT_TRACKED`, `INVENTORY_WOULD_GO_NEGATIVE`,
   * `INVENTORY_STALE_READ`.
   */
  adjustInventory(input: InventoryAdjustInput): Promise<InventoryAdjustResult>;

  // -- Customers ------------------------------------------------------------
  // Admin: `customers`, `customer(id:)`.

  listCustomers(query?: CustomerListQuery): Promise<Connection<Customer>>;

  getCustomer(customerId: string): Promise<Customer | null>;

  getCustomerByEmail(email: string): Promise<Customer | null>;

  // -- Discounts ------------------------------------------------------------
  // Admin: `codeDiscountNodeByCode`. Storefront: `cartDiscountCodesUpdate`
  // followed by reading `discountCodes[].applicable`.

  /** Look a code up without touching a cart. Null when there is no such code. */
  getDiscountByCode(code: string): Promise<Discount | null>;

  /**
   * Try a code against a specific cart and report what happens.
   *
   * Requires a cart because that is the only way Shopify can answer: a code's
   * applicability depends on the cart's contents, subtotal and buyer. Calling
   * this does **not** leave the code applied — the cart is restored to whatever
   * codes it had before.
   *
   * @throws {CommerceError} `CART_NOT_FOUND`, `CART_EXPIRED`.
   */
  validateDiscountCode(
    cartId: string,
    code: string,
  ): Promise<DiscountValidation>;
}
