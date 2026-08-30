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
 */
export function DemoBanner() {
  return (
    <aside
      aria-label={DEMO_BANNER.regionLabel}
      className="border-accent-edge/20 bg-surface-accent text-on-accent px-gutter fixed inset-x-0 bottom-0 border-t py-2"
      style={{ zIndex: "var(--z-toast)" }}
    >
      <p className="text-caption mx-auto flex max-w-5xl flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 text-center">
        <strong className="font-semibold tracking-wide uppercase">
          {DEMO_BANNER.tag}
        </strong>
        <span>{DEMO_BANNER.body}</span>
        <span className="opacity-80">{DEMO_BANNER.reset}</span>
      </p>
    </aside>
  );
}
