"use client";

import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Ask the team from wherever she is.
 *
 * She is standing in Stock, sees a line running down, and wants to ask about
 * it. Navigating to a chat page to do that costs her the screen she was reading
 * and the scroll position she had; when she comes back she has to find her
 * place again. So the same conversation opens over the page, from a button that
 * is in the same corner on every screen, and closing it puts her back exactly
 * where she was.
 *
 * ## It is a dialog, not a div that appears
 *
 * `role="dialog"` with `aria-modal`, an accessible name, focus moved into it on
 * open, `Tab` wrapped inside it while it is open, `Escape` to close, and focus
 * returned to the button afterwards. A floating panel that lets focus wander
 * onto the page behind it is a panel a keyboard user cannot get out of, and one
 * that never receives focus is a panel they never find.
 *
 * The panel's contents are rendered on the server and handed in as `children` —
 * this component only decides whether they are on screen. That is what keeps
 * the conversation identical to the page's, and it is what makes the composer
 * inside it work with the scripting turned off on the page it lives on.
 *
 * ## Clearing the demonstration banner
 *
 * `components/demo/DemoBanner.tsx` is `fixed inset-x-0 bottom-0` at
 * `--z-toast`, which is ABOVE `--z-modal` — so a panel anchored to the bottom
 * of the viewport would be drawn under it, and a button in the bottom-right
 * corner would sit behind it. Rather than fight the stacking order, both sit
 * clear: the offsets below are the banner's own height reserve from
 * `app/layout.tsx` (160px under 640, 80px from 640, 64px from 1024) plus a
 * gutter. With demo mode off there is no bar and the ordinary gutter applies.
 *
 * Measured against that reserve rather than guessed, and it is the reserve that
 * is authoritative: if the banner's copy grows again, `app/layout.tsx` changes
 * and so must this. The middle step came down from `sm:bottom-28` to
 * `sm:bottom-24` when the bar took on the two admin warnings and got shorter
 * rather than taller — the reserve it tracks went from 96px to 80px.
 *
 * The panel's own ceiling is set below the space that is left rather than to a
 * round fraction of the viewport, because a panel anchored above the bar and
 * taller than the room above it runs off the TOP of the screen — where there is
 * no scrollbar and no way back to its heading.
 */

/** Bottom offset when the demo banner is on screen: its reserve, plus a gutter. */
const CLEAR_OF_BANNER = "bottom-44 sm:bottom-24 lg:bottom-20";
/** And when it is not. */
const ORDINARY = "bottom-4";

export function ChatDock({
  children,
  bannerOnScreen,
  waiting,
}: {
  /** The server-rendered conversation. */
  children: ReactNode;
  /** True on a demonstration deployment, where a fixed bar owns the bottom. */
  bannerOnScreen: boolean;
  /**
   * How many turns are parked on a decision she has not made.
   *
   * Rendered on the server with the page, so it is as current as everything
   * else on screen and nothing polls for it. It is a standing state, not a
   * notification: there is no channel by which an answer arrives while she is
   * looking at another page, because every reply lands inside the request that
   * asked for it.
   */
  waiting: number;
}) {
  const pathname = usePathname();
  /**
   * Which page the panel was opened on — not a boolean.
   *
   * "Open" is then derived rather than stored, and the panel closes on
   * navigation for free: the pathname changes, the two stop matching, and the
   * panel is gone. A boolean would need an effect to reset it, and a `setState`
   * inside an effect is a cascading render that React (and this repository's
   * lint) rightly objects to.
   */
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpenedOn(null);
    buttonRef.current?.focus();
  }, []);

  // Move focus in when it opens, and hold the page still behind it.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(
      'textarea, input, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // The chat page IS this conversation. Two of it on one screen would be two
  // composers posting to the same thread.
  if (pathname === "/admin/chat") return null;

  const anchor = bannerOnScreen ? CLEAR_OF_BANNER : ORDINARY;

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        'textarea, input, select, button, [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpenedOn((was) => (was === pathname ? null : pathname));
        }}
        className={`fixed right-4 z-[var(--z-overlay)] inline-flex min-h-11 items-center gap-2 rounded-pill border border-accent-edge bg-surface-accent px-4 py-2 text-caption font-semibold text-on-accent shadow-overlay focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${anchor}`}
      >
        Ask the team
        {waiting > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-pill bg-surface-raised px-1.5 text-caption font-semibold text-primary">
            {waiting}
          </span>
        )}
        {waiting > 0 && (
          <span className="sr-only">
            {waiting === 1
              ? ", 1 thing in here is waiting on your decision"
              : `, ${String(waiting)} things in here are waiting on your decision`}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[var(--z-modal)]" role="presentation">
          {/*
            Tapping the dark part closes it, and the handler is on the dark
            part itself.

            It used to sit on the wrapper above, guarded by
            `event.target === event.currentTarget`. That guard could never be
            true: this backdrop is `inset-0` and covers the wrapper completely,
            so every pointer-down outside the panel landed HERE and the wrapper
            never saw one. Tapping outside did nothing, on every screen this
            has ever run on.

            On a laptop that was a nuisance — `Escape` still worked. On a phone
            there is no `Escape`, and this panel holds the page still
            (`overflow: hidden` above) while intercepting every click behind
            it. So the only way out was the Close button, and to anyone who did
            not find it the whole site was frozen until they reloaded it. That
            is the founder's report, reproduced at 390: three taps outside, the
            panel still open, the page unable to scroll, the menu button
            unreachable.

            `onMouseDown` rather than `onClick`, and only here: a press that
            starts inside the panel and drifts out — selecting the text of an
            answer, dragging the scrollbar — never touches this element, so it
            does not close.
          */}
          <div
            aria-hidden="true"
            onMouseDown={close}
            className="absolute inset-0 bg-black/45"
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Ask the team"
            onKeyDown={onKeyDown}
            className={`absolute right-4 left-4 flex max-h-[min(68vh,38rem)] flex-col overflow-hidden rounded-lg border border-hairline bg-surface-raised shadow-overlay sm:left-auto sm:w-[30rem] ${anchor}`}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
              <p className="text-body-sm font-semibold text-primary">
                Ask the team
              </p>
              <button
                type="button"
                onClick={close}
                className="inline-flex min-h-11 items-center rounded-md border border-hairline px-2.5 text-caption text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current sm:min-h-8"
              >
                Close
              </button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
