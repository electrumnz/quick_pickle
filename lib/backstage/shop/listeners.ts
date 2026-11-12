/**
 * What happens after the shop is changed from the back end: every page the
 * site is keeping is thrown away, so the next visitor is shown the new
 * prices at once and not up to a minute later.
 *
 * The offer is on all of them: the page itself, each landing page, the
 * questions, the fine print, and what the site tells search engines. So
 * this throws away everything under the shop's layout, not one address.
 *
 * Safe to run twice, and safe to fail: every kept page is replaced after a
 * minute whatever happens here (the shop layout's `revalidate`), and an
 * order is never priced from a page (lib/shop/place-order.ts). Outside a
 * web request (a test, a script) there are no kept pages, and this does
 * nothing.
 */

import { revalidatePath } from "next/cache";

import type { Handler } from "../core/events";

/** Throw away the kept copy of every page in the shop. */
export function refreshWholeShop(): boolean {
  try {
    revalidatePath("/", "layout");
    revalidatePath("/robots.txt");
    return true;
  } catch {
    // Not in a request. Nothing is being kept, so there is nothing to do.
    return false;
  }
}

/** The shop was changed, or a fact about it was confirmed. */
export function showShopChange(): Handler {
  return async () => {
    refreshWholeShop();
  };
}
