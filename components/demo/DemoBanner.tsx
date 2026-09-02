// No model-window link and no roster notice. The banner only says this is a
// demonstration. Grok Bot work shows up in the activity log once someone uses
// this admin from the Bot computer.

import { demoOpensAdmin } from "@/lib/demo/mode";

import { DEMO_BANNER } from "./copy";

/**
 * The demo notice, on every page.
 *
 * Rendered from `app/layout.tsx`, which is the only layout both the storefront
 * and the admin pass through, so there is one insertion point rather than one
 * per route group and no page can be added that misses it.
 *
 * Three decisions worth stating.
 *
 * **Fixed to the bottom, not the top.** The storefront's masthead is
 * `fixed … top-0` so that the full-height hero can sit under it, and the admin
 * shell has its own sticky header. A bar at the top would have to fight both.
 * The bottom is empty on every screen in the build, and a bottom bar stays on
 * screen while someone scrolls — which a static one at the top does not.
 *
 * **An `aside`, not a `div`.** Content outside a landmark is invisible to
 * anyone navigating by region, and axe reports it. `aside` is a complementary
 * landmark and this is exactly that: related to the page, not part of it.
 *
 * **`bg-surface-accent` on `text-on-accent`.** A sanctioned pair from the
 * semantic layer, measured for contrast in both schemes by
 * `tests/unit/brand-contrast.test.ts`. Loud is the point; unsanctioned is not.
 *
 * `app/layout.tsx` pads the body by the bar's height so it never covers the
 * last line of a page.
 *
 * The sentence about the admin is conditional, and on a narrower predicate
 * than the banner itself. The banner appears whenever this is a demonstration;
 * the sentence appears only when the admin is actually open, which a demo
 * pointed at a real database is not.
 */
export function DemoBanner() {
  const adminOpen = demoOpensAdmin();
  return (
    <aside
      aria-label={DEMO_BANNER.regionLabel}
      className="border-accent-edge/20 bg-surface-accent text-on-accent px-gutter fixed inset-x-0 bottom-0 border-t py-2"
      style={{ zIndex: "var(--z-toast)" }}
    >
      <p className="text-caption mx-auto flex max-w-5xl flex-wrap items-baseline justify-center gap-x-2 gap-y-px text-center">
        <strong className="font-semibold tracking-wide uppercase">
          {DEMO_BANNER.tag}
        </strong>
        <span>{DEMO_BANNER.body}</span>
        {adminOpen ? <span>{DEMO_BANNER.admin}</span> : null}
        <span className="opacity-80">{DEMO_BANNER.reset}</span>
      </p>
    </aside>
  );
}
