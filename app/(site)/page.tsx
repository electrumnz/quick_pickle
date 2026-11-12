import { ShopPage } from "@/components/site/ShopPage";

/**
 * The standard page. What is on it, and why in that order, is in
 * components/site/ShopPage.tsx, which the landing pages share.
 *
 * Built once and kept: nothing on it reads a cookie or a header. The one
 * thing it looks up is whether a special is on (lib/shop/special-now.ts),
 * and only when the kept copy is replaced, never on a visit and never while
 * the site is being built.
 */
export default function HomePage() {
  return <ShopPage />;
}
