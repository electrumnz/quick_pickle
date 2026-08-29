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
 * Off-page routes that resolve today, checked against `app/(site)` on
 * 2026-08-29: the collection page, the legacy redirect that points at it, and
 * every product page under it. Still missing, and so still filtered out:
 * /recipes, /stockists, /story, /suppliers and /wholesale.
 */
const LIVE_ROUTES: ReadonlySet<string> = new Set<string>([
  "/shop",
  "/products",
]);

/**
 * Route prefixes where every child resolves. `/products/[handle]` is a dynamic
 * segment backed by the commerce provider, so the individual bottles cannot be
 * enumerated here without this file importing the catalogue — which is exactly
 * the coupling it exists to avoid.
 */
const LIVE_PREFIXES: readonly string[] = ["/products/"];

/** True when following this link lands somewhere real. */
export function isLive(item: NavItem): boolean {
  // In-page anchors resolve by construction — the section is on this page.
  if (item.local) return true;
  // A mailto needs no route.
  if (item.href.startsWith("mailto:")) return true;
  if (LIVE_ROUTES.has(item.href)) return true;
  return LIVE_PREFIXES.some((prefix) => item.href.startsWith(prefix));
}

/** The subset of a nav list that can actually be followed. */
export function liveNav(items: readonly NavItem[]): readonly NavItem[] {
  return items.filter(isLive);
}
