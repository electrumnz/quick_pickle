/**
 * Row -> domain mapping.
 *
 * The only place in the mock provider that knows column names. Everything
 * arriving here has come out of `json_build_object` or a plain column and is
 * coerced through `./coerce`, so a schema change surfaces as a loud
 * `PROVIDER_UNAVAILABLE` naming the column rather than as `undefined` leaking
 * into a total.
 */

import { money, type Money } from "../money";
import type {
  Address,
  Collection,
  Customer,
  CustomerType,
  Discount,
  DiscountScope,
  DiscountStatus,
  DiscountValueType,
  Image,
  InventoryLevel,
  InventoryLocation,
  LocationKind,
  Product,
  ProductStatus,
  ProductVariant,
  SelectedOption,
  UnitPriceMeasurement,
} from "../types";
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

const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
const LOCATION_KINDS = [
  "kitchen",
  "coolstore",
  "warehouse",
  "retail",
  "third_party",
  "market_stall",
] as const;
const CUSTOMER_TYPES = [
  "retail",
  "trade",
  "wholesale",
  "staff",
  "press",
] as const;
const DISCOUNT_VALUE_TYPES = [
  "percentage",
  "fixed_amount",
  "free_shipping",
] as const;
const DISCOUNT_SCOPES = ["order", "product", "collection", "shipping"] as const;
const DISCOUNT_STATUSES = [
  "draft",
  "scheduled",
  "active",
  "expired",
  "disabled",
] as const;

export type ImageRow = {
  readonly id: string;
  readonly url: string;
  readonly altText: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly position: number;
  readonly variantId: string | null;
};

export function mapImage(raw: unknown): ImageRow {
  const row = jsonObject(raw, "product_images");
  return {
    id: str(row.id, "product_images.id"),
    url: str(row.url, "product_images.url"),
    altText: strOrNull(row.alt_text, "product_images.alt_text"),
    width: intOrNull(row.width_px, "product_images.width_px"),
    height: intOrNull(row.height_px, "product_images.height_px"),
    position: int(row.position, "product_images.position"),
    variantId: strOrNull(row.variant_id, "product_images.variant_id"),
  };
}

function toImage(row: ImageRow): Image {
  return {
    id: row.id,
    url: row.url,
    altText: row.altText,
    width: row.width,
    height: row.height,
  };
}

/**
 * A variant's size and pack count become `selectedOptions`, because that is the
 * Shopify-native way to say "the 750 ml one". The interface does not carry a
 * bare `sizeMl` field for the same reason.
 */
function selectedOptionsFor(
  sizeMl: number | null,
  packCount: number,
): SelectedOption[] {
  const options: SelectedOption[] = [];
  if (sizeMl !== null) {
    options.push({ name: "Size", value: `${String(sizeMl)} ml` });
  }
  if (packCount > 1) {
    options.push({ name: "Pack", value: `${String(packCount)} bottles` });
  }
  return options;
}

/**
 * Shelf-label unit pricing, per 100 ml — the reference quantity NZ grocery
 * unit pricing uses for liquids. Null when the variant has no stated volume.
 */
function unitPricingFor(
  priceCents: number,
  sizeMl: number | null,
  packCount: number,
  currencyCode: string,
): { unitPrice: Money | null; measurement: UnitPriceMeasurement | null } {
  if (sizeMl === null || sizeMl <= 0) {
    return { unitPrice: null, measurement: null };
  }
  const totalMl = sizeMl * packCount;
  const referenceMl = 100;
  // Integer arithmetic only: cents * 100ml / totalMl, rounded half away from
  // zero without ever forming a fraction.
  const numerator = BigInt(priceCents) * BigInt(referenceMl);
  const denominator = BigInt(totalMl);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const perReference = Number(
    remainder * 2n >= denominator ? quotient + 1n : quotient,
  );
  return {
    unitPrice: money(perReference, currencyCode),
    measurement: {
      measuredType: "VOLUME",
      quantityUnit: "ML",
      quantityValue: totalMl,
      referenceUnit: "ML",
      referenceValue: referenceMl,
    },
  };
}

export type VariantRow = {
  readonly variant: ProductVariant;
  readonly trackInventory: boolean;
  readonly inventoryPolicy: "deny" | "continue";
  readonly isTradeOnly: boolean;
  readonly stockAvailable: number;
};

export function mapVariant(
  raw: unknown,
  productId: string,
  productRequiresShipping: boolean,
  productSellable: boolean,
  imagesByVariant: ReadonlyMap<string, ImageRow>,
): VariantRow {
  const row = jsonObject(raw, "product_variants");
  const id = str(row.id, "product_variants.id");
  const currencyCode = str(row.currency, "product_variants.currency");
  const priceCents = int(row.price_cents, "product_variants.price_cents");
  const compareAt = intOrNull(
    row.compare_at_price_cents,
    "product_variants.compare_at_price_cents",
  );
  const sizeMl = intOrNull(row.size_ml, "product_variants.size_ml");
  const packCount = int(row.pack_count, "product_variants.pack_count");
  const trackInventory = bool(
    row.track_inventory,
    "product_variants.track_inventory",
  );
  const inventoryPolicy = oneOf(
    row.inventory_policy,
    ["deny", "continue"] as const,
    "product_variants.inventory_policy",
  );
  const stockAvailable = int(row.stock_available, "variant_stock.available");
  const unit = unitPricingFor(priceCents, sizeMl, packCount, currencyCode);

  const inStock =
    !trackInventory || inventoryPolicy === "continue" || stockAvailable > 0;

  return {
    variant: {
      id,
      productId,
      sku: str(row.sku, "product_variants.sku"),
      barcode: strOrNull(row.barcode, "product_variants.barcode"),
      title: str(row.title, "product_variants.title"),
      price: money(priceCents, currencyCode),
      compareAtPrice:
        compareAt === null ? null : money(compareAt, currencyCode),
      unitPrice: unit.unitPrice,
      unitPriceMeasurement: unit.measurement,
      availableForSale: productSellable && inStock,
      quantityAvailable: trackInventory ? stockAvailable : null,
      currentlyNotInStock:
        trackInventory && stockAvailable <= 0 && inventoryPolicy === "continue",
      requiresShipping: productRequiresShipping,
      weightGrams: intOrNull(row.weight_grams, "product_variants.weight_grams"),
      selectedOptions: selectedOptionsFor(sizeMl, packCount),
      image: (() => {
        const image = imagesByVariant.get(id);
        return image === undefined ? null : toImage(image);
      })(),
      position: int(row.position, "product_variants.position"),
    },
    trackInventory,
    inventoryPolicy,
    isTradeOnly: bool(row.is_trade_only, "product_variants.is_trade_only"),
    stockAvailable,
  };
}

export function mapProduct(row: Record<string, unknown>): Product {
  const id = str(row.id, "products.id");
  const status = oneOf(row.status, PRODUCT_STATUSES, "products.status");
  const publishedAt = isoOrNull(row.published_at, "products.published_at");
  const requiresShipping = bool(
    row.requires_shipping,
    "products.requires_shipping",
  );
  const sellable = status === "active" && publishedAt !== null;

  const images = jsonArray(row.images, "products.images").map(mapImage);
  images.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const imagesByVariant = new Map<string, ImageRow>();
  for (const image of images) {
    if (image.variantId !== null && !imagesByVariant.has(image.variantId)) {
      imagesByVariant.set(image.variantId, image);
    }
  }

  const variantRows = jsonArray(row.variants, "products.variants").map((raw) =>
    mapVariant(raw, id, requiresShipping, sellable, imagesByVariant),
  );
  variantRows.sort(
    (a, b) =>
      a.variant.position - b.variant.position ||
      a.variant.sku.localeCompare(b.variant.sku),
  );
  const variants = variantRows.map((entry) => entry.variant);

  const first = variants[0];
  if (first === undefined) {
    // The catalogue query inner-joins on the variant aggregate, so this cannot
    // happen; the check exists so a future query change fails here, loudly.
    throw new Error(`Product ${id} has no live variants`);
  }
  const currencyCode = first.price.currencyCode;
  const minPrice = int(row.min_price_cents, "product_agg.min_price_cents");
  const maxPrice = int(row.max_price_cents, "product_agg.max_price_cents");

  const heroUrl = strOrNull(row.hero_image_url, "products.hero_image_url");
  const productImages = images.filter((image) => image.variantId === null);
  const fallbackImage = productImages[0] ?? images[0];
  const featuredImage: Image | null =
    heroUrl !== null
      ? {
          id: `${id}:hero`,
          url: heroUrl,
          altText: str(row.title, "products.title"),
          width: null,
          height: null,
        }
      : fallbackImage === undefined
        ? null
        : toImage(fallbackImage);

  return {
    id,
    handle: str(row.handle, "products.handle"),
    title: str(row.title, "products.title"),
    subtitle: strOrNull(row.subtitle, "products.subtitle"),
    description: strOrNull(row.description, "products.description"),
    productType: strOrNull(row.product_type, "products.product_type"),
    vendor: str(row.vendor, "products.vendor"),
    status,
    publishedAt,
    tags: strArray(row.tags, "products.tags"),
    seo: {
      title: strOrNull(row.seo_title, "products.seo_title"),
      description: strOrNull(row.seo_description, "products.seo_description"),
    },
    featuredImage,
    images: images.map(toImage),
    variants,
    priceRange: {
      min: money(minPrice, currencyCode),
      max: money(maxPrice, currencyCode),
    },
    availableForSale: bool(
      row.available_for_sale,
      "product_agg.available_for_sale",
    ),
    requiresShipping,
    createdAt: iso(row.created_at, "products.created_at"),
    updatedAt: iso(row.updated_at, "products.updated_at"),
  };
}

export function mapCollection(row: Record<string, unknown>): Collection {
  const imageUrl = strOrNull(row.image_url, "collections.image_url");
  const id = str(row.id, "collections.id");
  return {
    id,
    handle: str(row.handle, "collections.handle"),
    title: str(row.title, "collections.title"),
    description: strOrNull(row.description, "collections.description"),
    image:
      imageUrl === null
        ? null
        : {
            id: `${id}:image`,
            url: imageUrl,
            altText: str(row.title, "collections.title"),
            width: null,
            height: null,
          },
    seo: {
      title: strOrNull(row.seo_title, "collections.seo_title"),
      description: strOrNull(
        row.seo_description,
        "collections.seo_description",
      ),
    },
    updatedAt: iso(row.updated_at, "collections.updated_at"),
  };
}

export function mapAddress(raw: unknown): Address {
  const row = jsonObject(raw, "addresses");
  return {
    id: str(row.id, "addresses.id"),
    firstName: strOrNull(row.first_name, "addresses.first_name"),
    lastName: strOrNull(row.last_name, "addresses.last_name"),
    company: strOrNull(row.company, "addresses.company"),
    line1: str(row.line1, "addresses.line1"),
    line2: strOrNull(row.line2, "addresses.line2"),
    suburb: strOrNull(row.suburb, "addresses.suburb"),
    city: str(row.city, "addresses.city"),
    region: strOrNull(row.region, "addresses.region"),
    postcode: strOrNull(row.postcode, "addresses.postcode"),
    countryCode: str(row.country_code, "addresses.country_code"),
    phone: strOrNull(row.phone, "addresses.phone"),
    deliveryInstructions: strOrNull(
      row.delivery_instructions,
      "addresses.delivery_instructions",
    ),
  };
}

export function mapCustomer(row: Record<string, unknown>): Customer {
  const currencyCode = str(row.currency, "customers.currency");
  const addresses = jsonArray(row.addresses, "customers.addresses").map(
    mapAddress,
  );
  const defaultAddressId = strOrNull(
    row.default_address_id,
    "customers.default_address_id",
  );
  return {
    id: str(row.id, "customers.id"),
    email: str(row.email, "customers.email"),
    firstName: strOrNull(row.first_name, "customers.first_name"),
    lastName: strOrNull(row.last_name, "customers.last_name"),
    displayName: strOrNull(row.full_name, "customers.full_name"),
    phone: strOrNull(row.phone, "customers.phone"),
    customerType: oneOf(
      row.customer_type,
      CUSTOMER_TYPES,
      "customers.customer_type",
    ) as CustomerType,
    companyName: strOrNull(row.company_name, "customers.company_name"),
    acceptsMarketing: bool(
      row.accepts_marketing,
      "customers.accepts_marketing",
    ),
    tags: strArray(row.tags, "customers.tags"),
    note: strOrNull(row.note, "customers.note"),
    ordersCount: int(row.orders_count, "customers.orders_count"),
    totalSpent: money(
      int(row.total_spent_cents, "customers.total_spent_cents"),
      currencyCode,
    ),
    defaultAddress:
      addresses.find((address) => address.id === defaultAddressId) ?? null,
    addresses,
    firstOrderedAt: isoOrNull(
      row.first_ordered_at,
      "customers.first_ordered_at",
    ),
    lastOrderedAt: isoOrNull(row.last_ordered_at, "customers.last_ordered_at"),
    createdAt: iso(row.created_at, "customers.created_at"),
    updatedAt: iso(row.updated_at, "customers.updated_at"),
  };
}

export function mapLocation(row: Record<string, unknown>): InventoryLocation {
  return {
    id: str(row.id, "inventory_locations.id"),
    code: str(row.code, "inventory_locations.code"),
    name: str(row.name, "inventory_locations.name"),
    kind: oneOf(
      row.kind,
      LOCATION_KINDS,
      "inventory_locations.kind",
    ) as LocationKind,
    city: strOrNull(row.city, "inventory_locations.city"),
    countryCode: str(row.country_code, "inventory_locations.country_code"),
    isActive: bool(row.is_active, "inventory_locations.is_active"),
    isDefault: bool(row.is_default, "inventory_locations.is_default"),
    shipsOrders: bool(row.ships_orders, "inventory_locations.ships_orders"),
  };
}

export function mapInventoryLevel(
  row: Record<string, unknown>,
): InventoryLevel {
  return {
    variantId: str(row.variant_id, "inventory_levels.variant_id"),
    sku: str(row.sku, "product_variants.sku"),
    locationId: str(row.location_id, "inventory_levels.location_id"),
    locationCode: str(row.location_code, "inventory_locations.code"),
    available: int(row.available, "inventory_levels.available"),
    onHand: int(row.on_hand, "inventory_levels.on_hand"),
    committed: int(row.committed, "inventory_levels.committed"),
    incoming: int(row.incoming, "inventory_levels.incoming"),
    reorderPoint: int(row.reorder_point, "inventory_levels.reorder_point"),
    reorderQuantity: int(
      row.reorder_quantity,
      "inventory_levels.reorder_quantity",
    ),
    updatedAt: iso(row.updated_at, "inventory_levels.updated_at"),
  };
}

export function mapDiscount(row: Record<string, unknown>): Discount {
  const currencyCode = str(row.currency, "discounts.currency");
  const valueCents = intOrNull(row.value_cents, "discounts.value_cents");
  const minimumSubtotal = intOrNull(
    row.minimum_subtotal_cents,
    "discounts.minimum_subtotal_cents",
  );
  const restriction = strOrNull(
    row.customer_type_restriction,
    "discounts.customer_type_restriction",
  );
  return {
    id: str(row.id, "discounts.id"),
    code: str(row.code, "discounts.code"),
    title: str(row.title, "discounts.title"),
    description: strOrNull(row.description, "discounts.description"),
    valueType: oneOf(
      row.value_type,
      DISCOUNT_VALUE_TYPES,
      "discounts.value_type",
    ) as DiscountValueType,
    percentageBasisPoints: intOrNull(row.value_bp, "discounts.value_bp"),
    amount: valueCents === null ? null : money(valueCents, currencyCode),
    appliesTo: oneOf(
      row.applies_to,
      DISCOUNT_SCOPES,
      "discounts.applies_to",
    ) as DiscountScope,
    targetProductId: strOrNull(
      row.target_product_id,
      "discounts.target_product_id",
    ),
    targetCollectionId: strOrNull(
      row.target_collection_id,
      "discounts.target_collection_id",
    ),
    minimumSubtotal:
      minimumSubtotal === null ? null : money(minimumSubtotal, currencyCode),
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
    usageCount: int(row.used_count, "discounts.used_count"),
    status: oneOf(
      row.status,
      DISCOUNT_STATUSES,
      "discounts.status",
    ) as DiscountStatus,
    startsAt: iso(row.starts_at, "discounts.starts_at"),
    endsAt: isoOrNull(row.ends_at, "discounts.ends_at"),
  };
}
