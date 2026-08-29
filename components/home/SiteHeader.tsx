import { PRIMARY_NAV } from "./data";
import { cx } from "./cx";
import styles from "./home.module.css";
import { liveNav } from "./routes";

/**
 * The storefront masthead.
 *
 * Sticky, hairline-ruled, and carrying only the sections that exist. The
 * translucent ground is deliberate: the hero runs underneath it for three
 * screens, and a solid band would cut the bottle in half at the top of the
 * viewport.
 */
export function SiteHeader() {
  const items = liveNav(PRIMARY_NAV);

  return (
    <header
      className="border-hairline bg-surface/85 px-gutter sticky top-0 border-b py-4 backdrop-blur"
      style={{ zIndex: "var(--z-sticky)" }}
    >
      <div className="max-w-page mx-auto flex items-center justify-between gap-4">
        <a
          href="#top"
          className="text-primary shrink-0"
          aria-label="Half Sour — top of page"
        >
          <div
            className={cx(styles.mark)}
            style={{ width: "1.75rem" }}
            aria-hidden="true"
          />
        </a>

        <nav aria-label="Sections of this page">
          <ul className="gap-stack flex flex-wrap items-center justify-end">
            {items.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className={cx(styles.drawLink, "text-body-sm text-primary")}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
