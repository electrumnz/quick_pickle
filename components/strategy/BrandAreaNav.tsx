"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The five areas of Brand & Plan.
 *
 * Each label is a plain word and each blurb says what the area answers, because
 * "Messaging" on its own means nothing to somebody who has not read StoryBrand.
 */
export const BRAND_AREAS = [
  {
    id: "identity",
    label: "Identity",
    href: "/admin/brand",
    answers: "Who we are, and the rules the AI team may not break.",
  },
  {
    id: "messaging",
    label: "Messaging",
    href: "/admin/brand/messaging",
    answers: "What we say, and who we say it to.",
  },
  {
    id: "audience",
    label: "Audience",
    href: "/admin/brand/audience",
    answers: "Who we sell to, and what the store currently does for them.",
  },
  {
    id: "plan",
    label: "Plan",
    href: "/admin/brand/plan",
    answers: "How the company runs, in six parts.",
  },
  {
    id: "market",
    label: "Market",
    href: "/admin/brand/market",
    answers: "How big this can get, and what that means this week.",
  },
] as const;

/**
 * `inline-flex`, not `inline-block`, and the reason is not cosmetic. The global
 * base sets `text-wrap: pretty` on `li`, and Chrome mis-computes the max-content
 * width of an inline-block inside such a list item — the tab boxes came out
 * 60px wide whatever the label said, so "Messaging" overlapped "Plan". A flex
 * box measures correctly.
 */
export function BrandAreaNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Brand and plan areas" className="mb-6">
      <ul className="-mx-1 flex flex-wrap gap-1 border-b border-hairline pb-px">
        {BRAND_AREAS.map((area) => {
          const current =
            area.href === "/admin/brand"
              ? pathname === "/admin/brand"
              : pathname.startsWith(area.href);
          return (
            <li key={area.id}>
              <Link
                href={area.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex items-center rounded-t-sm px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors ${
                  current
                    ? "border-b-2 border-accent-edge text-primary"
                    : "border-b-2 border-transparent text-muted hover:text-primary"
                }`}
              >
                {area.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
