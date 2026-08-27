/**
 * The commerce domain error type.
 *
 * Every failure a caller might reasonably *handle* — rather than merely log —
 * arrives as a {@link CommerceError} carrying a machine-readable
 * {@link CommerceErrorCode}. The UI switches on the code; it never parses a
 * message string, and it never has to guess whether a failure is worth
 * retrying.
 *
 * The codes are deliberately a superset-by-mapping of Shopify's own
 * `CartErrorCode` and `CartWarningCode` enums (Storefront API 2026-07), so the
 * Shopify adapter translates rather than invents. The two maps at the bottom of
 * this file are that translation, written once, here.
 */

export const COMMERCE_ERROR_CODES = [
  // --- catalogue ---
  "PRODUCT_NOT_FOUND",
  "VARIANT_NOT_FOUND",
  "COLLECTION_NOT_FOUND",
  "VARIANT_UNAVAILABLE",

  // --- cart identity + lifecycle ---
  "CART_NOT_FOUND",
  "CART_EXPIRED",
  "CART_ALREADY_COMPLETED",
  "CART_TOO_LARGE",
  "CART_LINE_NOT_FOUND",
  "CART_EMPTY",

  // --- quantities and stock ---
  "INVALID_QUANTITY",
  "OUT_OF_STOCK",
  "INSUFFICIENT_STOCK",
  "MAXIMUM_EXCEEDED",
  "MINIMUM_NOT_MET",

  // --- discounts ---
  "DISCOUNT_NOT_FOUND",
  "DISCOUNT_INACTIVE",
  "DISCOUNT_EXPIRED",
  "DISCOUNT_USAGE_LIMIT_REACHED",
  "DISCOUNT_CUSTOMER_USAGE_LIMIT_REACHED",
  "DISCOUNT_CUSTOMER_NOT_ELIGIBLE",
  "DISCOUNT_MINIMUM_NOT_MET",
  "DISCOUNT_NOT_APPLICABLE",

  // --- orders ---
  "ORDER_NOT_FOUND",
  "ORDER_NOT_EDITABLE",
  "ORDER_ALREADY_CANCELLED",

  // --- customers ---
  "CUSTOMER_NOT_FOUND",

  // --- inventory ---
  "LOCATION_NOT_FOUND",
  "INVENTORY_NOT_TRACKED",
  "INVENTORY_WOULD_GO_NEGATIVE",
  "INVENTORY_STALE_READ",

  // --- structural ---
  "CURRENCY_MISMATCH",
  "INVALID_INPUT",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
] as const;

export type CommerceErrorCode = (typeof COMMERCE_ERROR_CODES)[number];

/**
 * Codes worth retrying unchanged. Everything else needs the caller to change
 * something (the cart, the code, the quantity) before trying again.
 */
const RETRYABLE: ReadonlySet<CommerceErrorCode> = new Set([
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
  "INVENTORY_STALE_READ",
]);

/** Extra machine-readable context. Always JSON-serialisable. */
export type CommerceErrorDetails = Readonly<
  Record<string, string | number | boolean | null | readonly string[]>
>;

export type CommerceErrorInit = {
  /** Underlying cause, preserved for logs. Never shown to a shopper. */
  readonly cause?: unknown;
  readonly details?: CommerceErrorDetails;
  /** The provider-native code this was translated from, if any. */
  readonly providerCode?: string;
  /** Field path the error is about, mirroring Shopify's `userErrors.field`. */
  readonly field?: readonly string[];
  /** Seconds to wait before retrying. Only meaningful when `retryable`. */
  readonly retryAfterSeconds?: number;
};

export class CommerceError extends Error {
  override readonly name = "CommerceError";
  readonly code: CommerceErrorCode;
  readonly retryable: boolean;
  readonly details: CommerceErrorDetails;
  readonly providerCode: string | null;
  readonly field: readonly string[] | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: CommerceErrorCode,
    message: string,
    init: CommerceErrorInit = {},
  ) {
    super(
      message,
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    this.details = init.details ?? {};
    this.providerCode = init.providerCode ?? null;
    this.field = init.field ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }

  /** Safe to hand to a client: no cause, no stack, no internal identifiers. */
  toJSON(): {
    code: CommerceErrorCode;
    message: string;
    retryable: boolean;
    details: CommerceErrorDetails;
    field: readonly string[] | null;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
      field: this.field,
    };
  }
}

export function isCommerceError(value: unknown): value is CommerceError {
  return value instanceof CommerceError;
}

/** Narrow to a specific code without a two-step `instanceof` + compare. */
export function isCommerceErrorCode(
  value: unknown,
  code: CommerceErrorCode,
): value is CommerceError {
  return isCommerceError(value) && value.code === code;
}

/**
 * Named constructors. Using these rather than `new CommerceError(...)` keeps
 * the message wording consistent, which matters because these strings end up in
 * logs that get grepped.
 */
export const commerceErrors = {
  productNotFound(handleOrId: string): CommerceError {
    return new CommerceError(
      "PRODUCT_NOT_FOUND",
      `No product matches ${handleOrId}`,
      { details: { product: handleOrId } },
    );
  },
  variantNotFound(variantId: string): CommerceError {
    return new CommerceError(
      "VARIANT_NOT_FOUND",
      `Variant ${variantId} no longer exists`,
      { details: { variantId } },
    );
  },
  variantUnavailable(variantId: string, reason: string): CommerceError {
    return new CommerceError(
      "VARIANT_UNAVAILABLE",
      `Variant ${variantId} cannot be purchased: ${reason}`,
      { details: { variantId, reason } },
    );
  },
  collectionNotFound(handle: string): CommerceError {
    return new CommerceError(
      "COLLECTION_NOT_FOUND",
      `No collection matches ${handle}`,
      { details: { collection: handle } },
    );
  },
  cartNotFound(cartId: string): CommerceError {
    return new CommerceError(
      "CART_NOT_FOUND",
      `Cart ${cartId} does not exist`,
      {
        details: { cartId },
      },
    );
  },
  cartExpired(cartId: string, expiredAt: string): CommerceError {
    return new CommerceError("CART_EXPIRED", `Cart ${cartId} has expired`, {
      details: { cartId, expiredAt },
    });
  },
  cartAlreadyCompleted(cartId: string, orderId: string): CommerceError {
    return new CommerceError(
      "CART_ALREADY_COMPLETED",
      `Cart ${cartId} has already been checked out`,
      { details: { cartId, orderId } },
    );
  },
  cartEmpty(cartId: string): CommerceError {
    return new CommerceError(
      "CART_EMPTY",
      "There is nothing in the cart to check out",
      { details: { cartId } },
    );
  },
  cartTooLarge(cartId: string, limit: number): CommerceError {
    return new CommerceError(
      "CART_TOO_LARGE",
      `A cart holds at most ${String(limit)} lines`,
      { details: { cartId, limit } },
    );
  },
  cartLineNotFound(lineId: string): CommerceError {
    return new CommerceError(
      "CART_LINE_NOT_FOUND",
      `Cart line ${lineId} is not in this cart`,
      { details: { lineId }, field: ["lines", "id"] },
    );
  },
  invalidQuantity(quantity: number): CommerceError {
    return new CommerceError(
      "INVALID_QUANTITY",
      `Quantity must be a positive whole number, got ${String(quantity)}`,
      { details: { quantity }, field: ["lines", "quantity"] },
    );
  },
  outOfStock(variantId: string, sku: string): CommerceError {
    return new CommerceError("OUT_OF_STOCK", `${sku} is out of stock`, {
      details: { variantId, sku, available: 0 },
    });
  },
  insufficientStock(
    variantId: string,
    sku: string,
    requested: number,
    available: number,
  ): CommerceError {
    return new CommerceError(
      "INSUFFICIENT_STOCK",
      `Only ${String(available)} of ${sku} left, ${String(requested)} requested`,
      { details: { variantId, sku, requested, available } },
    );
  },
  discountNotFound(code: string): CommerceError {
    return new CommerceError(
      "DISCOUNT_NOT_FOUND",
      `${code} is not a valid code`,
      {
        details: { code },
      },
    );
  },
  orderNotFound(orderId: string): CommerceError {
    return new CommerceError(
      "ORDER_NOT_FOUND",
      `Order ${orderId} does not exist`,
      {
        details: { orderId },
      },
    );
  },
  orderNotEditable(orderId: string, reason: string): CommerceError {
    return new CommerceError(
      "ORDER_NOT_EDITABLE",
      `Order ${orderId} cannot be edited: ${reason}`,
      { details: { orderId, reason } },
    );
  },
  orderAlreadyCancelled(orderId: string): CommerceError {
    return new CommerceError(
      "ORDER_ALREADY_CANCELLED",
      `Order ${orderId} is already cancelled`,
      { details: { orderId } },
    );
  },
  customerNotFound(idOrEmail: string): CommerceError {
    return new CommerceError(
      "CUSTOMER_NOT_FOUND",
      `No customer matches ${idOrEmail}`,
      { details: { customer: idOrEmail } },
    );
  },
  locationNotFound(locationId: string): CommerceError {
    return new CommerceError(
      "LOCATION_NOT_FOUND",
      `Location ${locationId} does not exist`,
      { details: { locationId } },
    );
  },
  inventoryNotTracked(variantId: string, sku: string): CommerceError {
    return new CommerceError(
      "INVENTORY_NOT_TRACKED",
      `${sku} does not track inventory, so it cannot be adjusted`,
      { details: { variantId, sku } },
    );
  },
  inventoryWouldGoNegative(
    variantId: string,
    locationId: string,
    onHand: number,
    delta: number,
  ): CommerceError {
    return new CommerceError(
      "INVENTORY_WOULD_GO_NEGATIVE",
      `Adjusting by ${String(delta)} would take on-hand below zero (currently ${String(onHand)})`,
      { details: { variantId, locationId, onHand, delta } },
    );
  },
  inventoryStaleRead(
    variantId: string,
    expected: number,
    actual: number,
  ): CommerceError {
    return new CommerceError(
      "INVENTORY_STALE_READ",
      `Inventory moved underneath this request: expected ${String(expected)}, found ${String(actual)}`,
      { details: { variantId, expected, actual } },
    );
  },
  currencyMismatch(expected: string, actual: string): CommerceError {
    return new CommerceError(
      "CURRENCY_MISMATCH",
      `This store trades in ${expected}, not ${actual}`,
      { details: { expected, actual } },
    );
  },
  invalidInput(message: string, field?: readonly string[]): CommerceError {
    return new CommerceError("INVALID_INPUT", message, { field });
  },
  providerNotConfigured(
    provider: string,
    missing: readonly string[],
  ): CommerceError {
    return new CommerceError(
      "PROVIDER_NOT_CONFIGURED",
      `The ${provider} commerce provider is missing required configuration: ${missing.join(", ")}`,
      { details: { provider, missing } },
    );
  },
  providerUnavailable(provider: string, cause: unknown): CommerceError {
    return new CommerceError(
      "PROVIDER_UNAVAILABLE",
      `The ${provider} commerce provider is unreachable`,
      { cause, details: { provider } },
    );
  },
  rateLimited(provider: string, retryAfterSeconds: number): CommerceError {
    return new CommerceError(
      "RATE_LIMITED",
      `${provider} is rate limiting this client`,
      { details: { provider }, retryAfterSeconds },
    );
  },
} as const;

// ---------------------------------------------------------------------------
// Shopify translation tables
//
// Written here, once, so the Shopify adapter never has to decide what a code
// means. Source: Storefront API 2026-07 `CartErrorCode` and `CartWarningCode`.
// Anything not listed falls back to INVALID_INPUT (errors) or is surfaced as a
// non-blocking warning (warnings) rather than being invented into a code.
// ---------------------------------------------------------------------------

/** Shopify `CartErrorCode` -> domain code. Blocking: these become throws. */
export const SHOPIFY_CART_ERROR_CODE_MAP: Readonly<
  Record<string, CommerceErrorCode>
> = {
  CART_TOO_LARGE: "CART_TOO_LARGE",
  INVALID: "INVALID_INPUT",
  INVALID_INCREMENT: "INVALID_QUANTITY",
  INVALID_MERCHANDISE_LINE: "CART_LINE_NOT_FOUND",
  LESS_THAN: "INVALID_QUANTITY",
  MAXIMUM_EXCEEDED: "MAXIMUM_EXCEEDED",
  MERCHANDISE_NOT_APPLICABLE: "VARIANT_UNAVAILABLE",
  MINIMUM_NOT_MET: "MINIMUM_NOT_MET",
  MISSING_DISCOUNT_CODE: "DISCOUNT_NOT_FOUND",
  SELLING_PLAN_NOT_APPLICABLE: "VARIANT_UNAVAILABLE",
  SERVICE_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  VALIDATION_CUSTOM: "INVALID_INPUT",
  VARIANT_REQUIRES_SELLING_PLAN: "VARIANT_UNAVAILABLE",
};

/**
 * Shopify `CartWarningCode` -> domain code.
 *
 * Shopify returns these as non-blocking `warnings` on an otherwise successful
 * cart mutation. We keep that behaviour — see `CartMutationResult.warnings` —
 * and this map is what gives each warning a stable code the UI can switch on.
 */
export const SHOPIFY_CART_WARNING_CODE_MAP: Readonly<
  Record<string, CommerceErrorCode>
> = {
  DISCOUNT_CODE_NOT_HONOURED: "DISCOUNT_NOT_APPLICABLE",
  DISCOUNT_CURRENTLY_INACTIVE: "DISCOUNT_INACTIVE",
  DISCOUNT_CUSTOMER_NOT_ELIGIBLE: "DISCOUNT_CUSTOMER_NOT_ELIGIBLE",
  DISCOUNT_CUSTOMER_USAGE_LIMIT_REACHED:
    "DISCOUNT_CUSTOMER_USAGE_LIMIT_REACHED",
  DISCOUNT_ELIGIBLE_CUSTOMER_MISSING: "DISCOUNT_CUSTOMER_NOT_ELIGIBLE",
  DISCOUNT_INCOMPATIBLE_PURCHASE_TYPE: "DISCOUNT_NOT_APPLICABLE",
  DISCOUNT_NO_ENTITLED_LINE_ITEMS: "DISCOUNT_NOT_APPLICABLE",
  DISCOUNT_NO_ENTITLED_SHIPPING_LINES: "DISCOUNT_NOT_APPLICABLE",
  DISCOUNT_NOT_FOUND: "DISCOUNT_NOT_FOUND",
  DISCOUNT_PURCHASE_NOT_IN_RANGE: "DISCOUNT_MINIMUM_NOT_MET",
  DISCOUNT_QUANTITY_NOT_IN_RANGE: "DISCOUNT_MINIMUM_NOT_MET",
  DISCOUNT_USAGE_LIMIT_REACHED: "DISCOUNT_USAGE_LIMIT_REACHED",
  MERCHANDISE_NOT_ENOUGH_STOCK: "INSUFFICIENT_STOCK",
  MERCHANDISE_OUT_OF_STOCK: "OUT_OF_STOCK",
  PRODUCT_UNAVAILABLE_IN_BUYER_LOCATION: "VARIANT_UNAVAILABLE",
};

/**
 * Translate a Shopify cart `userErrors` entry into a {@link CommerceError}.
 * Unknown codes stay honest: INVALID_INPUT, with the original code preserved on
 * `providerCode` so nothing is lost in the logs.
 */
export function fromShopifyCartUserError(userError: {
  code?: string | null;
  message: string;
  field?: readonly string[] | null;
}): CommerceError {
  const providerCode = userError.code ?? undefined;
  const code =
    (providerCode === undefined
      ? undefined
      : SHOPIFY_CART_ERROR_CODE_MAP[providerCode]) ?? "INVALID_INPUT";
  return new CommerceError(code, userError.message, {
    providerCode,
    field: userError.field ?? undefined,
  });
}
