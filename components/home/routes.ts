/**
 * Which of the homepage's destinations exist in the deployed app today.
 *
 * `data.ts` is the finished view model: it names every link the homepage is
 * designed to carry, including the ones pointing at routes that are still
 * being built — /products, /recipes, /stockists, /story, /suppliers,
 * /wholesale. Shipping a live homepage that links to eight 404s is worse than
 * shipping one that links to fewer places, so the nav data stays untouched and
 * the page filters through `liveNav` on the way to the DOM.
 *
 * This module is the ONLY place that knows what is deployed. When a route
 * ships, add it to LIVE_ROUTES. When they have all shipped, delete this file
 * and drop the filter — nothing else has to change.
 */

import type { NavItem } from "./data";

/**
 * Off-page routes that resolve today. Empty on purpose: the storefront
 * currently consists of this page. `app/(site)` has no /products, /recipes,
 * /stockists, /story, /suppliers or /wholesale segment yet.
 */
const LIVE_ROUTES: ReadonlySet<string> = new Set<string>();

/** True when following this link lands somewhere real. */
export function isLive(item: NavItem): boolean {
  // In-page anchors resolve by construction — the section is on this page.
  if (item.local) return true;
  // A mailto needs no route.
  if (item.href.startsWith("mailto:")) return true;
  return LIVE_ROUTES.has(item.href);
}

/** The subset of a nav list that can actually be followed. */
export function liveNav(items: readonly NavItem[]): readonly NavItem[] {
  return items.filter(isLive);
}
