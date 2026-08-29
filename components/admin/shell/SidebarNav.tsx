"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { DESTINATIONS, destinationFor } from "./destinations";

/**
 * The nine destinations, and which one you are in.
 *
 * "Where am I" is answered three ways at once, because one way is never
 * enough: the row is recessed onto the page ground, it carries a mark in the
 * second accent, and it is the only row marked `aria-current`. A screen reader
 * and a glance get the same answer.
 *
 * The counts are live. A number beside a destination means something is
 * waiting there, so the sidebar doubles as the reason to visit it.
 */

export type NavCounts = Readonly<Record<string, number | undefined>>;

export function SidebarNav({
  counts,
  onNavigate,
}: {
  counts: NavCounts;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const current = destinationFor(pathname);

  return (
    <nav aria-label="Sections" className="px-2">
      <ul className="space-y-0.5">
        {DESTINATIONS.map((destination) => {
          const active = current?.id === destination.id;
          const count = counts[destination.id] ?? 0;
          const { Icon } = destination;
          return (
            <li key={destination.id} className="relative">
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-pill bg-accent-secondary"
                />
              )}
              <Link
                href={destination.href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={`flex items-center gap-2.5 rounded-md py-1.5 pr-2 pl-3 text-body-sm transition-colors ${
                  active
                    ? "bg-surface-page font-medium text-primary"
                    : "text-muted hover:bg-surface-page hover:text-primary"
                }`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {destination.label}
                </span>
                {count > 0 && (
                  <span
                    className={`shrink-0 rounded-pill px-1.5 py-0.5 text-caption leading-none tabular-nums ${
                      destination.id === "today"
                        ? "bg-surface-accent font-semibold text-on-accent"
                        : "text-muted"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
