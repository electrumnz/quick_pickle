import { HEADER_CTA, PRIMARY_NAV } from "./data";
import { cx } from "./cx";
import styles from "./home.module.css";
import { liveNav } from "./routes";

/**
 * The storefront masthead.
 *
 * Fixed, hairline-ruled, and carrying only the sections that exist. The
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
 * Every anchor in here is a 44px target. `app/globals.css` sets that floor for
 * buttons and summaries under a coarse pointer but not for anchors, and a nav
 * made of 19px-tall links is the commonest touch failure on a site of this
 * shape. The `.tap` class does it on the anchor while the drawn underline
 * stays on an inner span, so the rule still hugs the word.
 */
export function SiteHeader() {
  const items = liveNav(PRIMARY_NAV);

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
          className={cx(styles.tap, styles.tapSquare, "text-primary shrink-0")}
          aria-label="Half Sour — top of page"
        >
          <span
            className={cx(styles.mark)}
            style={{ width: "1.75rem" }}
            aria-hidden="true"
          />
        </a>

        {/*
          Hidden below 768, and that is a layout decision rather than a
          removal: at 375 these three links plus the mark plus the control
          wrap to three rows and turn the sticky bar into 180px of chrome on a
          667px screen. Every one of them is still reachable — the footer
          carries the same set in full, the hero carries the two that convert,
          and the page is one continuous scroll. Nothing here is display:none
          to a screen reader while visible to a mouse.
        */}
        <nav
          aria-label="Sections of this page"
          className="hidden min-w-0 md:block"
        >
          <ul className="gap-stack flex flex-wrap items-center justify-end">
            {items.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className={cx(styles.tap, "text-body-sm text-primary")}
                  data-cursor="link"
                  data-cursor-label={item.label}
                >
                  <span className={cx(styles.drawLink)}>{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* The one call to action in the chrome. It is a control rather than a
            nav item, so it sits outside the list and is styled as one. */}
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
    </header>
  );
}
