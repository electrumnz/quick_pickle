import Link from "next/link";

// Straight at the module rather than through `@/lib/agents`. This component is
// rendered from the ROOT layout, so it is on the storefront too, and the
// barrel would pull the whole runtime — the tool registry, the approval gate,
// the cost meter — into the graph of a page about pickles. `roster-models.ts`
// imports nothing at all: it reads the environment and a date.
import { rosterModelNotice } from "@/lib/agents/model/roster-models";
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
 * pointed at a real database is not. Promising a reader there is no password
 * and then showing them one is worse than saying nothing — and dropping the
 * line only makes the bar shorter, which the body's reserve already clears.
 *
 * ## The two admin warnings live here now
 *
 * The admin used to open every screen with two standing `Callout`s: one saying
 * the door was open and nobody was signed in, one saying how long the team's
 * models stay free. The founder asked for both to come down into this bar —
 * *"move the two warnings, admin and model running, down to the footer
 * warning"* — and, in the same breath, *"dont make the footer any larger"*.
 *
 * So this is a fold, not a stack. Every clause was rewritten short enough that
 * the bar is the same height it was at every width that matters: 140px at 390,
 * 80px at 768, 59px at 1280 and 60px at 1920, measured before and after. The
 * reserve in `app/layout.tsx` is unchanged for the same reason, and
 * `components/admin/chat/ChatDock.tsx` clears the same offsets it always did.
 *
 * The model line is a link because the short form deliberately keeps only the
 * date — the part that is useless if it is missing — and sends anyone who wants
 * the model ids, the reason and the environment variable to The Team, where
 * `rosterModelNotice().body` is rendered whole.
 *
 * `rosterModelNotice()` reads the environment and the clock and returns `null`
 * when there is nothing worth saying, so the line is absent unless something is
 * actually true. Outside demo mode there is no bar at all, which is why
 * `app/(admin)/admin/layout.tsx` still renders the full notice above every
 * admin screen there: the warning moves, it never disappears.
 */
export function DemoBanner() {
  const adminOpen = demoOpensAdmin();
  // Only alongside the admin sentence: a bar that does not invite a reader into
  // the admin has no business telling them about the admin's model billing, and
  // the link would point at a door that wants a password.
  const models = adminOpen ? rosterModelNotice() : null;
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
        {models === null ? null : (
          <Link
            href={DEMO_BANNER.modelHref}
            className="underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            {models.short}
          </Link>
        )}
      </p>
    </aside>
  );
}
