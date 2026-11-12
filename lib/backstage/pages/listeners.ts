/**
 * What happens after a landing page is published or taken down: the copy of
 * it the site is keeping is thrown away, so the next visitor sees the change
 * at once and not up to a minute later.
 *
 * Safe to run twice, and safe to fail: the kept copy is checked again every
 * minute whatever happens here. Outside a web request (a test, a script)
 * there is no kept copy to throw away, and this does nothing.
 */

import { revalidatePath } from "next/cache";

import type { Handler } from "../core/events";

export function refreshPublicPage(): Handler {
  return async (event) => {
    const slug = (event.payload as { slug?: unknown } | null)?.slug;
    if (typeof slug !== "string" || !/^[a-z0-9-]{2,40}$/.test(slug)) return;
    try {
      revalidatePath(`/for/${slug}`);
    } catch {
      // Not in a request. Nothing is being kept, so there is nothing to do.
    }
  };
}
