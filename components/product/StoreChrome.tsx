import Link from "next/link";

import { FooterAdminLink } from "@/components/auth/footer-admin-link";

import { cartCount } from "./cart";
import { cx } from "./cx";
import { SHOP_PATH } from "./copy";
import styles from "./shop.module.css";

/**
 * The shop's masthead and footer.
 *
 * `components/home/SiteHeader` is not reused here on purpose, and the reason is
 * in that component's own docstring: its navigation is a list of the HOMEPAGE's
 * sections — `#range`, `#serves`, `#making` — so mounting it on a product page
 * would fill the chrome with anchors that resolve to nothing. Same for the
 * footer, whose first column is those same anchors. The vocabulary is identical
 * (sticky, hairline-ruled, translucent, the masked mark, drawn underlines);
 * only the destinations differ, and here they are all routes that exist.
 */

export async function StoreHeader({ here }: { here?: "shop" | "product" }) {
  // A cart badge that is not wired to a real cart is a lie, so it reads the
  // cart through the provider and shows nothing at all when there is none.
  let count = 0;
  try {
    count = await cartCount();
  } catch {
    count = 0;
  }

  return (
    <header className={cx(styles.masthead, "px-gutter py-3")}>
      <div className="max-w-page mx-auto flex items-center justify-between gap-4">
        <Link
          href="/"
          className={cx(styles.tap, styles.tapSquare, "text-primary shrink-0")}
          aria-label="Half Sour — home"
        >
          <span
            className={cx(styles.mark)}
            style={{ width: "1.75rem" }}
            aria-hidden="true"
          />
        </Link>

        <nav aria-label="Shop" className="min-w-0">
          <ul className="gap-stack flex items-center justify-end">
            <li>
              <Link
                href={SHOP_PATH}
                aria-current={here === "shop" ? "page" : undefined}
                className={cx(styles.tap, "text-body-sm text-primary px-1")}
              >
                <span className={cx(styles.drawLink)}>All bottles</span>
              </Link>
            </li>
            <li>
              <span
                className={cx(styles.chip, styles.figure, styles.chipStocked)}
                aria-live="polite"
              >
                {count === 0 ? "Cart empty" : `Cart ${String(count)}`}
              </span>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function StoreFooter() {
  return (
    <footer
      className={cx(styles.deep, "px-gutter pt-section pb-block mt-auto")}
    >
      <div className="max-w-page mx-auto">
        <span
          className={cx(styles.mark)}
          style={{ width: "2rem" }}
          role="img"
          aria-label="Half Sour"
        />

        <nav
          aria-label="Shop footer"
          className="gap-block mt-block grid grid-cols-2 md:grid-cols-3"
        >
          <div>
            <h2 className="text-eyebrow font-mono uppercase">Bottles</h2>
            <ul className="gap-inline mt-stack flex flex-col">
              <li>
                <Link
                  href={SHOP_PATH}
                  className={cx(styles.tap, "text-body-sm")}
                >
                  <span className={cx(styles.drawLink)}>All bottles</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/products/the-full-set"
                  className={cx(styles.tap, "text-body-sm")}
                >
                  <span className={cx(styles.drawLink)}>The Full Set</span>
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-eyebrow font-mono uppercase">The house</h2>
            <ul className="gap-inline mt-stack flex flex-col">
              <li>
                <Link href="/" className={cx(styles.tap, "text-body-sm")}>
                  <span className={cx(styles.drawLink)}>Home</span>
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-eyebrow font-mono uppercase">Trade</h2>
            <ul className="gap-inline mt-stack flex flex-col">
              <li>
                <a
                  href="mailto:hello@halfsour.co.nz"
                  className={cx(styles.tap, "text-body-sm")}
                >
                  <span className={cx(styles.drawLink)}>
                    hello@halfsour.co.nz
                  </span>
                </a>
              </li>
            </ul>
          </div>
        </nav>

        <div className="mt-section gap-stack text-caption flex flex-wrap items-center justify-between">
          <span className={cx(styles.tap)}>
            &copy; {new Date().getFullYear()} Half Sour. Prices in NZD, GST
            included.
          </span>
          <FooterAdminLink
            className={cx(styles.tap, styles.tapSquare, "px-2")}
          />
        </div>
      </div>
    </footer>
  );
}
