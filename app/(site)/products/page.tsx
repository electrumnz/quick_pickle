import { permanentRedirect } from "next/navigation";

import { SHOP_PATH } from "@/components/product/copy";

/**
 * `/products` is not a second collection page.
 *
 * The homepage links here (`components/home/data.ts` SHOP_HREF) and so do older
 * drafts, so the address has to resolve — but two URLs serving the same list of
 * five products is duplicate content that splits its own ranking. One
 * permanent redirect, one canonical collection page at /shop.
 */
export default function ProductsIndex(): never {
  permanentRedirect(SHOP_PATH);
}
