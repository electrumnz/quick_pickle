import Link from "next/link";

import { JarButton } from "@/components/cart/JarButton";
import { HEADER } from "@/content/site";

/**
 * The header: wordmark, the page's own sections (wide screens only), and the
 * jar. Sticky, slim, and never taller than a thumb needs.
 *
 * There is no hamburger. On a phone this is a one-page site you scroll, and
 * a menu that hides four links to places already on the page is a tap spent
 * on nothing. The sticky buy bar is the phone's shortcut to the shop.
 */
export function SiteHeader({
  minimal = false,
}: {
  readonly minimal?: boolean;
}) {
  return (
    <header className="on-navy bg-navy border-navy-deep sticky top-0 z-40 border-b-[3px]">
      <div className="max-w-page px-gutter mx-auto flex h-14 items-center justify-between gap-4 md:h-16">
        <Link
          href="/"
          prefetch={false}
          aria-label={HEADER.home}
          className="varsity text-cream flex min-h-11 items-center text-[1.55rem] leading-none whitespace-nowrap [text-shadow:2px_2px_0_var(--color-pink)] md:text-[1.8rem]"
        >
          <span className="cap-trim">Quick Pickle</span>
        </Link>

        {minimal ? null : (
          <nav aria-label="Sections" className="hidden md:block">
            <ul className="flex items-center gap-5">
              {HEADER.nav.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="label text-cream hover:text-olive flex min-h-11 min-w-11 items-center justify-center px-1 text-[1.15rem] transition-colors duration-150"
                  >
                    <span className="cap-trim">{item.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {/* The jar button draws a cream disc so the navy-outlined icon reads
            on the navy bar. */}
        <div className="bg-cream border-navy-deep -mr-1 rounded-full border-2">
          <JarButton />
        </div>
      </div>
    </header>
  );
}
