"use client";

import { useEffect, useState, type ReactNode } from "react";

import { IconClose, IconMenu } from "../ui/icons";
import { SidebarNav, type NavCounts } from "./SidebarNav";

/**
 * The same nine destinations, on a phone.
 *
 * She checks orders standing in the kitchen, so the drawer holds the identical
 * list in the identical order — a phone that reorganises the map is a phone
 * that teaches a second map.
 */
export function MobileNav({
  counts,
  footer,
}: {
  counts: NavCounts;
  footer: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Open sections"
        onClick={() => {
          setOpen(true);
        }}
        className="inline-flex size-8 items-center justify-center rounded-md border border-hairline text-muted hover:bg-surface-page hover:text-primary lg:hidden"
      >
        <IconMenu className="size-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[var(--z-overlay)] lg:hidden"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div aria-hidden="true" className="absolute inset-0 bg-black/45" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Sections"
            className="relative flex h-full w-[17rem] max-w-[85vw] flex-col border-r border-hairline bg-surface-raised"
          >
            <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
              <span className="font-display text-body font-semibold tracking-tight text-primary">
                Half Sour
              </span>
              <button
                type="button"
                aria-label="Close sections"
                onClick={() => {
                  setOpen(false);
                }}
                className="inline-flex size-8 items-center justify-center rounded-md border border-hairline text-muted"
              >
                <IconClose className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-3">
              <SidebarNav
                counts={counts}
                onNavigate={() => {
                  setOpen(false);
                }}
              />
            </div>
            <div className="border-t border-hairline px-3 py-3">{footer}</div>
          </div>
        </div>
      )}
    </>
  );
}
