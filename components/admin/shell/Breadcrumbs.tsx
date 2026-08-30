"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { destinationFor } from "./destinations";

/** Pages that are somewhere without being one of the nine destinations. */
const BESIDE_THE_NINE: Readonly<Record<string, string | undefined>> = {
  "/admin/search": "Search",
  "/admin/go-live": "Go live",
};

/**
 * The trail in the top bar: Half Sour, then where you are.
 *
 * It reads the path rather than being passed a list, so a page cannot forget
 * to declare its own location. A search term shows as its own crumb, which is
 * what makes "I came here from the search box" recoverable.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const destination = destinationFor(pathname);
  const query = params.get("q");
  // /admin/search and /admin/go-live are not among the nine, but they are
  // somewhere, and a trail that stops at "Half Sour" leaves her without a name
  // for where she is.
  const label = destination?.label ?? BESIDE_THE_NINE[pathname] ?? null;
  const back = destination?.href ?? "/admin/search";

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-caption text-muted">
        <li className="shrink-0">
          <Link
            href="/admin"
            className="rounded-sm hover:text-primary hover:underline hover:underline-offset-4"
          >
            Half Sour
          </Link>
        </li>
        {label !== null && (
          <>
            <li aria-hidden="true" className="shrink-0 opacity-60">
              /
            </li>
            <li className="min-w-0 truncate">
              {query === null || query === "" ? (
                <span className="font-medium text-primary">{label}</span>
              ) : (
                <Link
                  href={back}
                  className="rounded-sm hover:text-primary hover:underline hover:underline-offset-4"
                >
                  {label}
                </Link>
              )}
            </li>
          </>
        )}
        {query !== null && query !== "" && (
          <>
            <li aria-hidden="true" className="shrink-0 opacity-60">
              /
            </li>
            <li className="min-w-0 truncate font-medium text-primary">
              &ldquo;{query}&rdquo;
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}
