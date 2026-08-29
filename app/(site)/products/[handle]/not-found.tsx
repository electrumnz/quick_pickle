import Link from "next/link";

import { formatPrice, loadCatalogue } from "@/components/product/catalogue";
import { productPath, SHOP_PATH, STATE } from "@/components/product/copy";
import styles from "@/components/product/shop.module.css";
import { cx } from "@/components/product/cx";
import { StoreFooter, StoreHeader } from "@/components/product/StoreChrome";

/**
 * A handle that is neither in the range nor in the catalogue.
 *
 * A real 404 with real chrome, a real status code and a real way out. The range
 * is five products, so the fastest apology is to simply list all five and let
 * the visitor pick — not a search box, not a "go home" button.
 */
export default async function ProductNotFound() {
  const catalogue = await loadCatalogue();

  return (
    <>
      <StoreHeader />

      <main id="top" className="px-gutter py-section flex-1">
        <div className="max-w-page mx-auto">
          <p className={cx(styles.figure, "text-caption text-muted uppercase")}>
            404
          </p>
          <h1 className="text-display-2 text-primary mt-stack">
            {STATE.notFoundHeading}
          </h1>
          <p className="text-lede text-muted mt-stack max-w-prose">
            {STATE.notFoundNote}
          </p>

          <ul className="mt-block max-w-4xl">
            {catalogue.entries.map((entry) => (
              <li key={entry.handle}>
                <Link
                  href={productPath(entry.handle)}
                  className={cx(styles.chooserRow, styles.tap, "text-primary")}
                >
                  <span>
                    <span className="text-heading-3 block">{entry.job}</span>
                    <span
                      className={cx(
                        styles.figure,
                        "text-caption text-muted uppercase",
                      )}
                    >
                      {entry.title}
                    </span>
                  </span>
                  <span className={cx(styles.figure, "text-body-sm")}>
                    {formatPrice(entry.price)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <Link
            href={SHOP_PATH}
            className={cx(styles.button, styles.buttonPrimary, "mt-block")}
          >
            {STATE.notFoundCta}
          </Link>
        </div>
      </main>

      <StoreFooter />
    </>
  );
}
