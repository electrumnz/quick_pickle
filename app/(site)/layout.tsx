import type { ReactNode } from "react";

/**
 * Layout for the public storefront route group.
 *
 * Deliberately bare. The masthead and footer are composed by each page from
 * components/product/StoreChrome — one header and one footer for the whole
 * storefront — so /lab/* and the checkout can choose not to carry them.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full flex-col">{children}</div>;
}
