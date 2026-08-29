import "server-only";

import { cache } from "react";

import {
  CommerceError,
  formatMoney,
  getCommerceProvider,
  money,
  type CommerceProvider,
  type Money,
  type Product,
  type ProductVariant,
} from "@/lib/commerce";
import { ALL_BRINES, BRINES, brineLabel } from "@/content/brines";
import type { Brine, BrineId } from "@/content/types";

import {
  FULL_SET_HANDLE,
  JOB,
  SET_BOTTLE_COUNT,
  SET_DESCRIPTOR,
  SET_JOB,
  SET_LINE,
  SET_PRICE_NZD,
  SET_TITLE,
} from "./copy";

/**
 * The shop's read model.
 *
 * Two authorities meet here and neither is allowed to overrule the other:
 *
 *   `content/brines.ts`  owns the WORDS — name, descriptor, the line that says
 *                        what a bottle is for, the tasting notes, the run. That
 *                        file has passed the copy audit; nothing below rewrites
 *                        a syllable of it.
 *   `lib/commerce`       owns COMMERCE — price, variants, stock, cart. Read
 *                        through the provider adapter and nowhere else. There
 *                        is no Supabase client in this unit and no hardcoded
 *                        price anywhere in it.
 *
 * They are joined on the product handle. The join is deliberately a LEFT JOIN
 * from the range, because the two sets are not guaranteed to be equal and
 * pretending otherwise is how a storefront ends up lying:
 *
 *   in both        the normal case. A bottle you can read about and buy.
 *   range only     the bottle exists as a product the company makes, but the
 *                  catalogue has no sellable variant for it today. Rendered in
 *                  full, marked `unlisted`, and NOT given a buy button.
 *   catalogue only a SKU the content layer has not been told about yet. Still
 *                  rendered, from commerce data alone, rather than hidden.
 *
 * Failure is a first-class outcome. If the provider is unconfigured or the
 * database is unreachable, {@link loadCatalogue} degrades to the content layer
 * instead of throwing: the product information stays readable and every buy
 * control is withdrawn, which is the honest version of that state. `degraded`
 * says so out loud so the pages can render it as a designed state rather than
 * quietly serving a shop with no prices.
 */

/** At or below this many sellable units, the exact count is worth stating. */
export const LOW_STOCK_THRESHOLD = 24;

export type Availability =
  /** A sellable variant with stock, or one that does not track stock. */
  | "in-stock"
  /** Sellable, and the remaining count is small enough to be worth naming. */
  | "low"
  /** A real catalogue product with nothing sellable behind it. */
  | "sold-out"
  /** In the range, but the catalogue carries no product for it today. */
  | "unlisted";

export type EntryKind = "brine" | "set" | "other";

export type CatalogueEntry = {
  readonly handle: string;
  readonly kind: EntryKind;
  /** The content record, when the range knows this handle. */
  readonly brine: Brine | null;
  /** The commerce record, when the catalogue carries this handle. */
  readonly product: Product | null;
  /** Every sellable option, in the provider's own order. */
  readonly variants: readonly ProductVariant[];
  /** The variant a page defaults to: the first sellable one, else the first. */
  readonly variant: ProductVariant | null;
  /** "No. 02 DIRTY" — the lockup used everywhere but the label itself. */
  readonly title: string;
  /** "Martini Brine" */
  readonly descriptor: string | null;
  /** Four words at most. What this bottle is FOR. The card's headline. */
  readonly job: string;
  /** The line from the content layer, verbatim. */
  readonly line: string | null;
  readonly price: Money;
  /**
   * The cheapest variant, when a product has more than one price. A card must
   * say "From $18" rather than quote whichever variant happens to be first, or
   * the collection page and the product page will show different numbers for
   * the same bottle and one of them will be wrong.
   */
  readonly priceFrom: Money | null;
  /** Per-100ml shelf price, when the catalogue publishes a measurement. */
  readonly unitPrice: Money | null;
  readonly unitPriceLabel: string | null;
  readonly volumeMl: number | null;
  readonly bottleCount: number;
  readonly availability: Availability;
  readonly quantityAvailable: number | null;
  readonly supplyLimited: boolean;
};

export type Catalogue = {
  readonly entries: readonly CatalogueEntry[];
  /** True when commerce could not be reached and prices come from content. */
  readonly degraded: boolean;
  /** The reason, for the designed degraded state. Never shown raw to a buyer. */
  readonly reason: string | null;
  readonly currencyCode: string;
};

const DEFAULT_CURRENCY = "NZD";

/* --------------------------------------------------------------- provider */

type ProviderHandle =
  | { readonly ok: true; readonly provider: CommerceProvider }
  | { readonly ok: false; readonly reason: string };

/**
 * One provider resolution per request.
 *
 * `getCommerceProvider` throws a typed {@link CommerceError} when
 * `COMMERCE_PROVIDER` is unset or the selected provider has no credentials —
 * which is exactly the state a CI build runs in. Catching it here is what lets
 * `npm run build` succeed with no database while the deployed app, which has
 * one, serves live prices.
 */
const resolveProvider = cache((): ProviderHandle => {
  try {
    return { ok: true, provider: getCommerceProvider() };
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
});

function describe(error: unknown): string {
  if (error instanceof CommerceError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/* ------------------------------------------------------------------ join */

function pickVariant(
  product: Product | null,
): readonly [readonly ProductVariant[], ProductVariant | null] {
  if (product === null) return [[], null];
  const variants = product.variants;
  const sellable = variants.find((variant) => variant.availableForSale);
  return [variants, sellable ?? variants[0] ?? null];
}

function availabilityOf(
  product: Product | null,
  variant: ProductVariant | null,
): Availability {
  if (product === null || variant === null) return "unlisted";
  if (!variant.availableForSale) return "sold-out";
  const quantity = variant.quantityAvailable;
  if (quantity !== null && quantity <= LOW_STOCK_THRESHOLD) return "low";
  return "in-stock";
}

/**
 * "$3.60 / 100 ml". Shopify publishes the measurement rather than a sentence,
 * so the sentence is built here from the two fields it does publish.
 */
function unitPriceLabelFor(variant: ProductVariant | null): string | null {
  if (variant === null) return null;
  const { unitPrice, unitPriceMeasurement } = variant;
  if (unitPrice === null || unitPriceMeasurement === null) return null;
  const unit = unitPriceMeasurement.referenceUnit.toLowerCase();
  return `${formatMoney(unitPrice)} / ${unitPriceMeasurement.referenceValue} ${unit}`;
}

/** How many bottles are in the box. Read off the variant's own options. */
function bottleCountFor(variant: ProductVariant | null): number {
  if (variant === null) return 1;
  const pack = variant.selectedOptions.find(
    (option) => option.name.toLowerCase() === "pack",
  );
  if (pack === undefined) return 1;
  const digits = /(\d+)/.exec(pack.value);
  return digits === null ? 1 : Number(digits[1]);
}

function volumeOf(
  brine: Brine | null,
  variant: ProductVariant | null,
  kind: EntryKind,
): number | null {
  const size = variant?.selectedOptions.find(
    (option) => option.name.toLowerCase() === "size",
  );
  if (size !== undefined) {
    const digits = /(\d+)/.exec(size.value);
    if (digits !== null) return Number(digits[1]);
  }
  // Every bottle in the range is 500 ml, box or no box.
  return brine?.volumeMl ?? (kind === "set" ? 500 : null);
}

function kindOf(handle: string, brine: Brine | null): EntryKind {
  if (handle === FULL_SET_HANDLE) return "set";
  return brine === null ? "other" : "brine";
}

function entryFor(
  handle: string,
  brine: Brine | null,
  product: Product | null,
  currencyCode: string,
): CatalogueEntry {
  const [variants, variant] = pickVariant(product);
  const kind = kindOf(handle, brine);

  // Price authority: the catalogue, always, when it has one. The content
  // layer's price is the published shelf price and stands in only when
  // commerce is unreachable — never alongside it, so the two cannot disagree
  // on screen.
  const fallbackDollars =
    brine !== null ? brine.priceNzd : kind === "set" ? SET_PRICE_NZD : null;

  const price =
    variant?.price ??
    product?.priceRange.min ??
    (fallbackDollars === null
      ? money(0, currencyCode)
      : money(fallbackDollars * 100, currencyCode));

  const range = product?.priceRange ?? null;
  const hasRange =
    range !== null &&
    range.min.amountInMinorUnits !== range.max.amountInMinorUnits;

  return {
    handle,
    kind,
    brine,
    product,
    variants,
    variant,
    title:
      brine !== null
        ? brineLabel(brine.id)
        : (product?.title ?? (kind === "set" ? SET_TITLE : handle)),
    descriptor:
      brine?.descriptor ??
      product?.subtitle ??
      (kind === "set" ? SET_DESCRIPTOR : null),
    job: brine === null ? SET_JOB : JOB[brine.id],
    // The box has no record in `content/brines.ts` — it is not a brine — so its
    // one line comes from the homepage's view model, which is where it was
    // written and audited.
    line: brine?.line ?? (kind === "set" ? SET_LINE : null),
    price,
    priceFrom: hasRange && range !== null ? range.min : null,
    unitPrice: variant?.unitPrice ?? null,
    unitPriceLabel: unitPriceLabelFor(variant),
    volumeMl: volumeOf(brine, variant, kind),
    bottleCount:
      kind === "set"
        ? variant === null
          ? SET_BOTTLE_COUNT
          : bottleCountFor(variant)
        : 1,
    availability: availabilityOf(product, variant),
    quantityAvailable: variant?.quantityAvailable ?? null,
    supplyLimited: brine?.supplyLimited ?? false,
  };
}

/* ------------------------------------------------------------------ reads */

/** Handles the range names, in the order the range names them. */
export const RANGE_HANDLES: readonly string[] = [
  ...ALL_BRINES.map((brine) => brine.handle),
  FULL_SET_HANDLE,
];

function brineForHandle(handle: string): Brine | null {
  const id = (Object.keys(BRINES) as BrineId[]).find(
    (key) => BRINES[key].handle === handle,
  );
  return id === undefined ? null : BRINES[id];
}

/**
 * The whole shop, joined and ordered.
 *
 * Ordered by the range first (01, 02, 03, 04, then the set) so the numbering
 * on the labels is the numbering on the page, with any catalogue-only product
 * appended rather than dropped.
 */
export const loadCatalogue = cache(async (): Promise<Catalogue> => {
  const handle = resolveProvider();
  if (!handle.ok) {
    return {
      entries: RANGE_HANDLES.map((value) =>
        entryFor(value, brineForHandle(value), null, DEFAULT_CURRENCY),
      ),
      degraded: true,
      reason: handle.reason,
      currencyCode: DEFAULT_CURRENCY,
    };
  }

  const { provider } = handle;
  try {
    const page = await provider.listProducts({ first: 100 });
    const byHandle = new Map(page.nodes.map((node) => [node.handle, node]));

    const entries: CatalogueEntry[] = RANGE_HANDLES.map((value) =>
      entryFor(
        value,
        brineForHandle(value),
        byHandle.get(value) ?? null,
        provider.currencyCode,
      ),
    );
    for (const node of page.nodes) {
      if (RANGE_HANDLES.includes(node.handle)) continue;
      entries.push(entryFor(node.handle, null, node, provider.currencyCode));
    }

    return {
      entries,
      degraded: false,
      reason: null,
      currencyCode: provider.currencyCode,
    };
  } catch (error) {
    return {
      entries: RANGE_HANDLES.map((value) =>
        entryFor(value, brineForHandle(value), null, DEFAULT_CURRENCY),
      ),
      degraded: true,
      reason: describe(error),
      currencyCode: DEFAULT_CURRENCY,
    };
  }
});

/**
 * One product, or null when the handle is neither in the range nor in the
 * catalogue — which is the only case that may 404. A handle the range knows
 * always resolves to a page, even with commerce down, because the words are
 * still true and a shopper still deserves to read them.
 */
export const loadEntry = cache(
  async (handle: string): Promise<CatalogueEntry | null> => {
    const catalogue = await loadCatalogue();
    const known = catalogue.entries.find((entry) => entry.handle === handle);
    if (known !== undefined) return known;

    const resolved = resolveProvider();
    if (!resolved.ok) return null;
    try {
      const product = await resolved.provider.getProductByHandle(handle);
      if (product === null) return null;
      return entryFor(handle, null, product, resolved.provider.currencyCode);
    } catch {
      return null;
    }
  },
);

/** The set, for the bundle path on a bottle's page. */
export async function loadFullSet(): Promise<CatalogueEntry | null> {
  const catalogue = await loadCatalogue();
  return (
    catalogue.entries.find((entry) => entry.handle === FULL_SET_HANDLE) ?? null
  );
}

/**
 * Whether the catalogue's image URLs point at images that actually exist.
 *
 * The mock provider's fixture rows carry plausible-looking Shopify CDN URLs for
 * photographs that were never taken — useful for exercising the mapper, fatal
 * in a `Product.image` that a search engine will go and fetch. A rich result
 * advertising a 404 is worse than one with no image at all, so structured data
 * only quotes them when the provider is the real one.
 */
export function catalogueImagesArePublished(): boolean {
  const handle = resolveProvider();
  return handle.ok && handle.provider.name === "shopify";
}

/* ---------------------------------------------------------------- helpers */

/** "$18", "$4.60" — trailing zero cents are noise on a whole-dollar shelf. */
export function formatPrice(value: Money): string {
  const text = formatMoney(value);
  return text.endsWith(".00") ? text.slice(0, -3) : text;
}

/**
 * What the set saves against buying its contents one at a time.
 *
 * Computed from live catalogue prices on every render rather than written into
 * copy, because a saving that is stated and not computed is a saving that goes
 * wrong the first time a price moves — and a wrong one is a misrepresentation
 * under the Fair Trading Act, not a typo.
 */
export function setSaving(
  set: CatalogueEntry,
  parts: readonly CatalogueEntry[],
): { readonly separately: Money; readonly saving: Money } | null {
  if (set.bottleCount < 2 || parts.length === 0) return null;
  const included = parts.slice(0, set.bottleCount);
  if (included.length !== set.bottleCount) return null;
  const separatelyMinor = included.reduce(
    (total, part) => total + part.price.amountInMinorUnits,
    0,
  );
  const savingMinor = separatelyMinor - set.price.amountInMinorUnits;
  if (savingMinor <= 0) return null;
  return {
    separately: money(separatelyMinor, set.price.currencyCode),
    saving: money(savingMinor, set.price.currencyCode),
  };
}

/** "3" -> "three". Numerals belong to prices and measures, not to counting. */
const WORD = ["zero", "one", "two", "three", "four", "five", "six"] as const;

export function inWords(count: number): string {
  return WORD[count] ?? String(count);
}

/** Per-bottle price of a multi-bottle pack, in whole minor units. */
export function perBottle(entry: CatalogueEntry): Money | null {
  if (entry.bottleCount < 2) return null;
  const each = Math.round(entry.price.amountInMinorUnits / entry.bottleCount);
  return money(each, entry.price.currencyCode);
}
