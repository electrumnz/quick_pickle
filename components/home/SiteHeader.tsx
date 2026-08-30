import {
  HEADER_CTA,
  NAV_HOME_LABEL,
  NAV_MENU_LABEL,
  PRIMARY_NAV,
  SITE_NAV,
  type NavItem,
} from "./data";
import { cx } from "./cx";
import styles from "./home.module.css";
import { liveNav } from "./routes";

/**
 * The storefront masthead.
 *
 * Fixed, hairline-ruled, and carrying only the destinations that exist. The
 * translucent ground is deliberate: the hero runs underneath it for two and a
 * half screens, and a solid band would cut the line-up in half at the top of
 * the viewport.
 *
 * Fixed rather than sticky, and that is a geometry fix rather than a taste: a
 * sticky bar occupies 65px of normal flow, so the 100svh hero stage below it
 * started 65px down and lost its closing band — the positioning line and both
 * buttons — off the bottom of the first screen. Out of flow, the stage is one
 * viewport tall and `.masthead` publishes its height for the hero to pad by.
 *
 * ## Two lists, one bar
 *
 * `PRIMARY_NAV` is the sections of THIS page. `SITE_NAV` is the rest of the
 * site — the shop, the recipe library, the trade page — and it is the same list
 * the shop's own masthead draws, so a route that ships appears in the
 * navigation everywhere at once. Both go through `liveNav`, so a destination
 * that is not deployed is not drawn rather than drawn at a 404.
 *
 * ## The small screen has navigation, not a hidden one
 *
 * This bar used to be `hidden md:block` below 768, which left a phone with a
 * mark and a Buy button and no way to reach anything. It is now a
 * `<details>` disclosure: it opens by tap, by Enter and with JavaScript
 * switched off, the summary says the word "Menu" rather than being an icon a
 * visitor has to guess at, and the panel is absolutely positioned so opening it
 * cannot change the masthead height the hero is padded by.
 *
 * ## The home link is the wordmark, not the mark
 *
 * The bare circular mark was read by a visitor as a light/dark toggle, which is
 * a design failure whatever the accessible name says. The wordmark is the same
 * drawn artwork, masked the same way, and it reads as the company's name — so
 * there is nothing left to guess at.
 */

function NavList({
  items,
  className,
}: {
  items: readonly NavItem[];
  className?: string;
}) {
  return (
    <ul className={className}>
      {items.map((item) => (
        <li key={item.href}>
          <a
            href={item.href}
            className={cx(
              styles.tap,
              styles.navRow,
              "text-body-sm text-primary",
            )}
            data-cursor="link"
            data-cursor-label={item.label}
          >
            <span className={cx(styles.drawLink)}>{item.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SiteHeader() {
  const sections = liveNav(PRIMARY_NAV);
  const routes = liveNav(SITE_NAV);
  const all = [...sections, ...routes];

  return (
    <header
      className={cx(
        styles.masthead,
        "border-hairline bg-surface/85 px-gutter fixed inset-x-0 top-0 border-b py-2 backdrop-blur",
      )}
      style={{ zIndex: "var(--z-sticky)" }}
    >
      <div className="max-w-page gap-stack mx-auto flex items-center justify-between">
        <a
          href="#top"
          className={cx(styles.tap, "text-primary shrink-0")}
          aria-label={NAV_HOME_LABEL}
        >
          <span
            className={cx(styles.wordmark)}
            style={{ width: "6rem" }}
            aria-hidden="true"
          />
        </a>

        {/* 768 and up: everything, in one row. The section anchors first,
            because on this page they are the nearer destinations. */}
        <nav aria-label="Main" className="hidden min-w-0 md:block">
          <ul className="gap-stack flex flex-wrap items-center justify-end">
            {all.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className={cx(
                    styles.tap,
                    styles.navLink,
                    "text-body-sm text-primary",
                  )}
                  data-cursor="link"
                  data-cursor-label={item.label}
                >
                  <span className={cx(styles.drawLink)}>{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="gap-inline flex items-center">
          {/* Below 768. A disclosure rather than a hamburger: it carries a
              word, it works with scripting off, and the panel it opens is out
              of flow so the masthead keeps the height the hero pads by. */}
          <details className={cx(styles.disclosure, "md:hidden")}>
            <summary
              className={cx(styles.tap, "text-body-sm text-primary px-1")}
            >
              {NAV_MENU_LABEL}
              <span className={cx(styles.disclosureIcon)} aria-hidden="true">
                +
              </span>
            </summary>
            <nav
              aria-label="Sections and pages"
              className={cx(styles.navPanel)}
            >
              <NavList
                items={all}
                className="max-w-page gap-inline mx-auto flex flex-col"
              />
            </nav>
          </details>

          {/* The one call to action in the chrome. It is a control rather than
              a nav item, so it sits outside the list and is styled as one. */}
          <a
            href={HEADER_CTA.href}
            className={cx(
              styles.button,
              styles.buttonPrimary,
              "shrink-0 px-[var(--spacing-stack)]",
            )}
            data-cursor="link"
            data-cursor-label={HEADER_CTA.label}
          >
            {HEADER_CTA.label}
          </a>
        </div>
      </div>
    </header>
  );
}
