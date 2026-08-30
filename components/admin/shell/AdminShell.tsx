import Link from "next/link";
import type { ReactNode } from "react";

import {
  CommandIconButton,
  CommandPalette,
  CommandTrigger,
} from "../command/CommandPalette";
import { Avatar } from "../ui/primitives";
import { Breadcrumbs } from "./Breadcrumbs";
import { MobileNav } from "./MobileNav";
import { SidebarNav, type NavCounts } from "./SidebarNav";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The frame every admin page hangs in.
 *
 * The persistent sidebar is the whole answer to "I do not want her to be lost
 * as to where to find stuff when she logs in": the same ten destinations in
 * the same order on every screen, the current one marked three ways, and a
 * count beside anything that is waiting for her. Nothing collapses, nothing
 * reorders, nothing is hidden behind a menu on a desktop.
 */
export function AdminShell({
  counts,
  operatorName,
  operatorRole,
  signOut,
  notice,
  dock,
  children,
}: {
  counts: NavCounts;
  operatorName: string;
  operatorRole: string;
  /** The sign-out form, rendered on the server so it carries its CSRF token. */
  signOut: ReactNode;
  /**
   * A standing note above every page, or nothing.
   *
   * One slot rather than one per screen, because the thing it says today —
   * that this is an open demonstration and nobody is signed in — is true of
   * every screen at once, and a notice a page can forget to render is a notice
   * that will be forgotten.
   */
  notice?: ReactNode;
  /**
   * A control that floats over every screen, or nothing.
   *
   * One slot, for the same reason `notice` is one slot: the thing in it today —
   * "ask the team", open from wherever she is standing — is true of every screen
   * at once, and a floating control a page can forget to render is a floating
   * control that is missing from the screen she happened to be on. It is
   * rendered last, outside `main`, so it is not part of the page's reading order
   * and does not sit inside its landmark.
   */
  dock?: ReactNode;
  children: ReactNode;
}) {
  const identity = (
    <div className="flex items-center gap-2.5">
      <Avatar name={operatorName} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-medium text-primary">
          {operatorName}
        </span>
        <span className="block truncate text-caption text-muted">
          {operatorRole}
        </span>
      </span>
    </div>
  );

  return (
    <div
      id="admin-shell"
      className="flex min-h-dvh w-full flex-col bg-surface-page text-primary lg:flex-row"
    >
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[var(--z-toast)] focus:rounded-md focus:border focus:border-hairline focus:bg-surface-raised focus:px-3 focus:py-2 focus:text-body-sm"
      >
        Skip to content
      </a>

      <aside
        // Named because the Today page has a complementary column of its own,
        // and two unnamed <aside>s are two landmarks a screen-reader user
        // cannot tell apart in the landmark list (axe `landmark-unique`).
        aria-label="Admin sidebar"
        className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-hairline bg-surface-raised lg:flex"
      >
        <div className="px-4 pt-4 pb-3">
          <p className="font-display text-body font-semibold tracking-tight text-primary">
            Half Sour
          </p>
          <p className="text-caption text-muted">
            The whole company, one screen at a time
          </p>
        </div>
        <div className="px-3 pb-3">
          <CommandTrigger />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <SidebarNav counts={counts} />
        </div>
        <div className="space-y-3 border-t border-hairline px-3 py-3">
          {identity}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="min-w-0 flex-1">{signOut}</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[var(--z-sticky)] flex items-center gap-3 border-b border-hairline bg-surface-raised px-4 py-2.5 lg:px-8">
          <MobileNav
            counts={counts}
            footer={
              <div className="space-y-3">
                {identity}
                {signOut}
              </div>
            }
          />
          <Breadcrumbs />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/*
              The way out.
              Reported by the founder: once she is in the admin, the only exit
              is typing the storefront address by hand. So there is one
              permanent link to it, in the masthead where it is on every screen
              at every width — not in the sidebar footer, which is where the
              sign-out control lives and which would make leaving to look at
              the shop read as leaving the admin altogether. It navigates in
              this tab, because she goes back and forth.
            */}
            <Link
              href="/"
              className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-caption text-link underline underline-offset-4 hover:no-underline sm:min-h-8"
            >
              {/*
                Two words on a phone, four on anything wider. The masthead is
                shared with the breadcrumb trail, and a fixed-width link this
                far right truncates the trail on a 390px screen. The shorter
                label keeps the full destination in its accessible name.
              */}
              <span className="sm:hidden">
                Shop
                <span className="sr-only"> — view the storefront</span>
              </span>
              <span className="hidden sm:inline">View the shop</span>
            </Link>
            <span className="hidden text-caption text-muted sm:inline">
              New Zealand time
            </span>
            <div className="lg:hidden">
              <CommandIconButton />
            </div>
            <div className="lg:hidden">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main
          id="admin-main"
          className="mx-auto w-full max-w-[78rem] flex-1 px-4 py-6 lg:px-8 lg:py-8"
        >
          {notice === undefined || notice === null ? null : (
            <div className="mb-6">{notice}</div>
          )}
          {children}
        </main>

        <footer className="border-t border-hairline px-4 py-3 text-caption text-muted lg:px-8">
          Half Sour Brine Co Limited · admin · this area is never indexed by
          search engines
        </footer>
      </div>

      <CommandPalette />
      {dock}
    </div>
  );
}
