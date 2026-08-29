import { formatPrice, type CatalogueEntry } from "./catalogue";
import { STATE } from "./copy";
import styles from "./shop.module.css";
import { cx } from "./cx";

/**
 * The small, repeated pieces: the availability chip and the price block.
 *
 * Both exist so the collection page and the product page cannot disagree about
 * what a bottle costs or whether it can be bought — which is the single most
 * common inconsistency in a storefront and the one a shopper notices fastest.
 */

/**
 * Availability, stated.
 *
 * The count is only printed when it is small enough to be information, and it
 * is read live from the catalogue on every render. That matters legally as well
 * as editorially: under the Fair Trading Act s 9 a scarcity signal that is not
 * wired to real stock is misleading conduct, so there is no countdown here, no
 * "selling fast", and nothing that moves when the stock does not.
 */
export function AvailabilityChip({
  entry,
  className,
}: {
  entry: CatalogueEntry;
  className?: string;
}) {
  const { availability, quantityAvailable } = entry;

  if (availability === "in-stock") {
    return (
      <span className={cx(styles.chip, styles.chipStocked, className)}>
        <span className={cx(styles.chipDot)} aria-hidden="true" />
        {STATE.inStock}
      </span>
    );
  }

  if (availability === "low") {
    return (
      <span className={cx(styles.chip, styles.chipLow, className)}>
        <span className={cx(styles.chipDot)} aria-hidden="true" />
        {quantityAvailable === null
          ? STATE.inStock
          : `${String(quantityAvailable)} ${STATE.countSuffix}`}
      </span>
    );
  }

  return (
    <span className={cx(styles.chip, styles.chipOut, className)}>
      <span className={cx(styles.chipDot)} aria-hidden="true" />
      {availability === "sold-out" ? STATE.soldOut : STATE.unlistedShort}
    </span>
  );
}

/**
 * Price, with the comparison figure underneath.
 *
 * The per-100ml line is Shopify's own `unitPriceMeasurement`, not a number this
 * unit worked out, so it is the same figure a shelf-edge label would carry and
 * it survives the move from the mock provider to the real one untouched.
 */
export function PriceBlock({
  entry,
  size = "md",
  range = false,
  className,
}: {
  entry: CatalogueEntry;
  size?: "md" | "lg";
  /**
   * True on a card, where one number has to stand for a product that may have
   * several. False on the product page, where a variant is actually selected
   * and the price shown is that variant's.
   */
  range?: boolean;
  className?: string;
}) {
  const showFrom = range && entry.priceFrom !== null;
  return (
    <div className={cx(className)}>
      <p
        className={cx(
          styles.figure,
          "text-primary",
          size === "lg" ? "text-heading-1" : "text-heading-3",
        )}
      >
        {showFrom ? (
          <>
            <span className="text-caption">{STATE.fromPrice} </span>
            {formatPrice(entry.priceFrom ?? entry.price)}
          </>
        ) : (
          formatPrice(entry.price)
        )}
      </p>
      <p className={cx(styles.figure, "text-caption text-muted mt-1")}>
        {[
          entry.volumeMl === null
            ? null
            : `${String(entry.volumeMl)} ml${entry.bottleCount > 1 ? ` × ${String(entry.bottleCount)}` : ""}`,
          entry.unitPriceLabel,
        ]
          .filter((part): part is string => part !== null)
          .join("  ·  ")}
      </p>
    </div>
  );
}

/** An eyebrow: mono, uppercase, wide. Used above every section heading. */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cx("text-eyebrow font-mono uppercase", className)}>
      {children}
    </p>
  );
}
