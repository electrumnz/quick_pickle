import Link from "next/link";

import { FooterAdminLink } from "@/components/auth/footer-admin-link";
import {
  NAV_HOME_LABEL,
  NAV_MENU_LABEL,
  SITE_NAV,
  type NavItem,
} from "@/components/home/data";
import { liveNav } from "@/components/home/routes";

import { cartCount } from "./cart";
import { cx } from "./cx";
import { SHOP_PATH, STORE_FOOTER } from "./copy";
import styles from "./shop.module.css";

/**
 * The masthead and footer for every route outside the homepage.
 *
 * `components/home/SiteHeader` is not reused here on purpose, and the reason is
 * in that component's own docstring: its first list is the HOMEPAGE's sections
 * — `#range`, `#serves`, `#making` — so mounting it on a product page would
 * fill the chrome with anchors that resolve to nothing there. What the two DO
 * share is `SITE_NAV`, the list of destinations that are not on any one page,
 * so a route that ships appears in both mastheads at once instead of in
 * whichever one somebody remembered. Both filter it through `liveNav`, so a
 * link is never drawn at a 404.
 *
 * The home link is the wordmark rather than the bare circular mark: a visitor
 * looking at the live site read that mark as a light/dark control, and an
 * accessible name does not fix a shape that looks like a switch.
 *
 * Below 768 the navigation is a `<details>` disclosure whose summary says the
 * word "Menu". It opens by tap, by Enter and with JavaScript switched off.
 */

type Here = "shop" | "product" | "wholesale" | "recipes" | "policy";

/** Which nav item, if any, is the page being looked at. */
function currentHref(here: Here | undefined): string | null {
  switch (here) {
    case "shop":
    case "product":
      return SHOP_PATH;
    case "wholesale":
      return "/wholesale";
    case "recipes":
      return "/recipes";
    default:
      return null;
  }
}

function NavLinks({
  items,
  current,
  className,
  row = false,
}: {
  items: readonly NavItem[];
  current: string | null;
  className: string;
  /** True inside the disclosure panel, where a link is a full-width menu row. */
  row?: boolean;
}) {
  return (
    <ul className={className}>
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            aria-current={item.href === current ? "page" : undefined}
            className={cx(
              styles.tap,
              row ? styles.navRow : styles.navLink,
              "text-body-sm text-primary px-1",
            )}
          >
            <span className={cx(styles.drawLink)}>{item.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export async function StoreHeader({ here }: { here?: Here }) {
  // A cart badge that is not wired to a real cart is a lie, so it reads the
  // cart through the provider and shows nothing at all when there is none.
  let count = 0;
  try {
    count = await cartCount();
  } catch {
    count = 0;
  }

  const items = liveNav(SITE_NAV);
  const current = currentHref(here);

  return (
    <header className={cx(styles.masthead, "px-gutter py-3")}>
      <div className="max-w-page mx-auto flex items-center justify-between gap-4">
        <Link
          href="/"
          className={cx(styles.tap, "text-primary shrink-0")}
          aria-label={NAV_HOME_LABEL}
        >
          <span
            className={cx(styles.wordmark)}
            style={{ width: "6rem" }}
            aria-hidden="true"
          />
        </Link>

        <nav aria-label="Main" className="hidden min-w-0 md:block">
          <NavLinks
            items={items}
            current={current}
            className="gap-stack flex flex-wrap items-center justify-end"
          />
        </nav>

        <div className="gap-inline flex shrink-0 items-center">
          <details className={cx(styles.disclosure, "md:hidden")}>
            <summary
              className={cx(styles.tap, "text-body-sm text-primary px-1")}
            >
              {NAV_MENU_LABEL}
              <span className={cx(styles.disclosureIcon)} aria-hidden="true">
                +
              </span>
            </summary>
            <nav aria-label="Pages" className={cx(styles.navPanel)}>
              <NavLinks
                items={items}
                current={current}
                row
                className="max-w-page gap-inline mx-auto flex flex-col"
              />
            </nav>
          </details>

          <span
            className={cx(styles.chip, styles.figure, styles.chipStocked)}
            aria-live="polite"
          >
            {count === 0 ? "Cart empty" : `Cart ${String(count)}`}
          </span>
        </div>
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
          className={cx(styles.wordmark)}
          style={{ width: "8rem" }}
          role="img"
          aria-label="Half Sour"
        />

        <nav
          aria-label="Site footer"
          className="gap-block mt-block grid grid-cols-2 md:grid-cols-4"
        >
          {STORE_FOOTER.map((column) => (
            <div key={column.heading}>
              <h2 className="text-eyebrow font-mono uppercase">
                {column.heading}
              </h2>
              <ul className="gap-inline mt-stack flex flex-col">
                {column.items.map((item) => (
                  <li key={item.href}>
                    {item.href.startsWith("mailto:") ? (
                      <a
                        href={item.href}
                        className={cx(styles.tap, "text-body-sm")}
                      >
                        <span className={cx(styles.drawLink)}>
                          {item.label}
                        </span>
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        className={cx(styles.tap, "text-body-sm")}
                      >
                        <span className={cx(styles.drawLink)}>
                          {item.label}
                        </span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-section gap-stack text-caption flex flex-wrap items-center justify-between">
          <span className={cx(styles.tap)}>
            &copy; {new Date().getFullYear()} Half Sour. Prices in NZD, GST
            included.
          </span>
          {/* `tap` and `tapSquare` are the 44px floor in both axes. The link
              owns its own padding, so nothing here competes with it. */}
          <FooterAdminLink className={cx(styles.tap, styles.tapSquare)} />
        </div>
      </div>
    </footer>
  );
}
