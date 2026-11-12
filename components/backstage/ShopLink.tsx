import type { ReactNode } from "react";

/**
 * A link from the back end to the shop.
 *
 * It is a plain anchor on purpose. The shop and the back end have separate
 * stylesheets, and a client-side navigation between them would leave the back
 * end's styles loaded on top of the shop's. A full page load swaps one for
 * the other cleanly.
 */
export function ShopLink({
  className,
  children,
  href = "/",
}: {
  readonly className?: string;
  readonly children: ReactNode;
  readonly href?: string;
}) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
