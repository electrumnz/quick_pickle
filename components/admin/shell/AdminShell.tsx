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
 * as to where to find stuff when she logs in": the same nine destinations in
 * the same order on every screen, the current one marked three ways, and a
 * count beside anything that is waiting for her. Nothing collapses, nothing
 * reorders, nothing is hidden behind a menu on a desktop.
 */
export function AdminShell({
  counts,
  operatorName,
  operatorRole,
  signOut,
  children,
}: {
  counts: NavCounts;
  operatorName: string;
  operatorRole: string;
  /** The sign-out form, rendered on the server so it carries its CSRF token. */
  signOut: ReactNode;
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
          {children}
        </main>

        <footer className="border-t border-hairline px-4 py-3 text-caption text-muted lg:px-8">
          Half Sour Brine Co Limited · admin · this area is never indexed by
          search engines
        </footer>
      </div>

      <CommandPalette />
    </div>
  );
}
