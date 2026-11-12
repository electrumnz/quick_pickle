import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { backstageIsOpen } from "@/lib/backstage";

export const metadata: Metadata = {
  title: { default: "Backstage", template: "%s | Quick Pickle backstage" },
  robots: { index: false, follow: false, nocache: true },
};

/** Decide per request, so closing the back end never needs a rebuild. */
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/backstage", label: "Go-live list" },
  { href: "/backstage/brand", label: "Brand guide" },
] as const;

/**
 * The back end. Not linked from the public site, never indexed, and shut
 * entirely once the site has launched (see lib/backstage.ts).
 */
export default function BackstageLayout({ children }: { children: ReactNode }) {
  if (!backstageIsOpen()) notFound();

  return (
    <>
      <header className="on-navy bg-navy border-navy-deep sticky top-0 z-40 border-b-[3px]">
        <div className="max-w-page px-gutter mx-auto flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-1 py-1.5">
          <Link
            href="/backstage"
            className="varsity text-cream flex min-h-11 items-center text-[1.4rem] leading-none whitespace-nowrap [text-shadow:2px_2px_0_var(--color-pink)]"
          >
            <span className="cap-trim">Quick Pickle</span>
            <span className="label text-olive ml-3 text-[1rem] [text-shadow:none]">
              Backstage
            </span>
          </Link>
          <nav aria-label="Backstage">
            <ul className="flex items-center gap-2">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="label text-cream hover:text-olive flex min-h-11 items-center px-2 text-[1.1rem]"
                  >
                    <span className="cap-trim">{item.label}</span>
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/"
                  className="label text-olive hover:text-cream flex min-h-11 items-center px-2 text-[1.1rem]"
                >
                  <span className="cap-trim">View site</span>
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" className="bg-cream flex-1">
        {children}
      </main>
    </>
  );
}
