"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconApproval } from "../ui/icons";
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
 *
 * Go live sits under the list, behind a rule, and is not one of it. It is the
 * handover checklist — the page she opens until the last thing on it is done
 * and then never again — and a temporary errand does not belong among the
 * places she works in every day. It is still in the sidebar rather than hidden,
 * because a checklist nobody can find is a checklist nobody finishes.
 */

export type NavCounts = Readonly<Record<string, number | undefined>>;

const GO_LIVE = { href: "/admin/go-live", label: "Go live" } as const;

/** The row shape, shared so the Go live entry cannot drift from the rest. */
const ROW =
  "flex items-center gap-2.5 rounded-md py-1.5 pr-2 pl-3 text-body-sm transition-colors";
const ROW_ACTIVE = "bg-surface-page font-medium text-primary";
const ROW_REST = "text-muted hover:bg-surface-page hover:text-primary";

export function SidebarNav({
  counts,
  onNavigate,
}: {
  counts: NavCounts;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const current = destinationFor(pathname);
  const onGoLive = pathname === GO_LIVE.href;

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
                className={`${ROW} ${active ? ROW_ACTIVE : ROW_REST}`}
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

      <ul className="mt-2 space-y-0.5 border-t border-hairline pt-2">
        <li className="relative">
          {onGoLive && (
            <span
              aria-hidden="true"
              className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-pill bg-accent-secondary"
            />
          )}
          <Link
            href={GO_LIVE.href}
            aria-current={onGoLive ? "page" : undefined}
            onClick={onNavigate}
            className={`${ROW} ${onGoLive ? ROW_ACTIVE : ROW_REST}`}
          >
            <IconApproval className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{GO_LIVE.label}</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
