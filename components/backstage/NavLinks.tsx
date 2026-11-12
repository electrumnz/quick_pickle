"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { DESTINATIONS, isCurrent, type Destination } from "./nav";

/**
 * The two navigations. They are client components for one reason: knowing
 * which page you are on. They render on the server too, so the highlight is
 * in the HTML and the links work with scripting off.
 */

type Counts = Readonly<Record<string, number>>;

function visible(isOwner: boolean): readonly Destination[] {
  return DESTINATIONS.filter((item) => isOwner || item.ownerOnly !== true);
}

export function RailNav({
  isOwner,
  counts,
}: {
  readonly isOwner: boolean;
  readonly counts: Counts;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Back end" className="bk-nav">
      {visible(isOwner).map((item) => {
        const count = counts[item.href] ?? 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
            className="bk-nav-link"
          >
            <span className="cap-trim">{item.label}</span>
            {count > 0 ? (
              <span className="bk-count">
                <span className="cap-trim">{count > 99 ? "99+" : count}</span>
                <span className="sr-only"> waiting</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function TabNav({ isOwner }: { readonly isOwner: boolean }) {
  const pathname = usePathname();
  const tabs = visible(isOwner)
    .filter((item) => item.tab === true)
    .slice(0, 4);
  const onTab = tabs.some((item) => isCurrent(pathname, item.href));
  return (
    <nav aria-label="Back end" className="bk-tabs">
      {tabs.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
          className="bk-tab"
        >
          <span className="cap-trim">{item.label}</span>
        </Link>
      ))}
      <Link
        href="/backstage/more"
        aria-current={onTab ? undefined : "page"}
        className="bk-tab"
      >
        <span className="cap-trim">More</span>
      </Link>
    </nav>
  );
}
