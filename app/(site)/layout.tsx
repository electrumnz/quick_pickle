import type { ReactNode } from "react";

/**
 * Layout for the public storefront route group.
 *
 * Deliberately bare. The masthead and footer are composed by the page rather
 * than the layout, because the header's navigation is a list of THIS page's
 * sections — rendering it around /lab/* would put anchors in the chrome that
 * resolve to nothing there. See components/home/SiteHeader.tsx.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full flex-col">{children}</div>;
}
