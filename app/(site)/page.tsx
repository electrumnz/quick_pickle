import { ShopPage } from "@/components/site/ShopPage";

/**
 * The standard page. What is on it, and why in that order, is in
 * components/site/ShopPage.tsx, which the landing pages share.
 *
 * Statically rendered: nothing on it reads a cookie, a header or a database.
 */
export default function HomePage() {
  return <ShopPage />;
}
