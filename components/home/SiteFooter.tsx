import { FooterAdminLink } from "@/components/auth/footer-admin-link";

import { FOOTER_NAV } from "./data";
import { cx } from "./cx";
import styles from "./home.module.css";
import { liveNav } from "./routes";

/**
 * The storefront footer.
 *
 * Ground and type are `surface-deep` / `text-on-deep` — the one pairing the
 * brand sanctions for footer copy (lib/brand/semantics.ts, "Footer and panel
 * copy"). Note what is NOT here: `text-muted` is not sanctioned on this ground,
 * so hierarchy is carried by size and letterform rather than by fading the
 * contrast away.
 *
 * Columns whose destinations are all still unbuilt drop out entirely rather
 * than rendering dead links — see routes.ts.
 */
export function SiteFooter() {
  const columns = FOOTER_NAV.map((column) => ({
    heading: column.heading,
    items: liveNav(column.items),
  })).filter((column) => column.items.length > 0);

  return (
    <footer className="bg-surface-deep text-on-deep px-gutter pt-section pb-block mt-auto">
      <div className="max-w-page mx-auto">
        <div
          className={cx(styles.mark, "text-on-deep")}
          style={{ width: "2rem" }}
          role="img"
          aria-label="Half Sour"
        />

        {columns.length > 0 ? (
          <nav
            aria-label="Footer"
            className="gap-block mt-block grid grid-cols-2 md:grid-cols-4"
          >
            {columns.map((column) => (
              <div key={column.heading}>
                <h2 className="text-eyebrow font-mono uppercase">
                  {column.heading}
                </h2>
                <ul className="gap-inline mt-stack flex flex-col">
                  {column.items.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className={cx(styles.drawLink, "text-body-sm")}
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        ) : null}

        <div className="mt-section gap-stack text-caption flex flex-wrap items-center justify-between">
          <span>&copy; {new Date().getFullYear()} Half Sour</span>
          {/*
            Deliberately quiet, deliberately not hidden: the staff way in sits
            at the end of the footer row rather than announcing itself, but it
            is a real link with real contrast and a real focus ring. See
            components/auth/footer-admin-link.tsx.
          */}
          <FooterAdminLink />
        </div>
      </div>
    </footer>
  );
}
