"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DESTINATIONS } from "../shell/destinations";
import { IconSearch } from "../ui/icons";

/**
 * One box that reaches everything.
 *
 * Cmd-K on a Mac, Ctrl-K everywhere else, or the search field in the sidebar.
 * It searches two things at once: the ten destinations, matched here without a
 * round trip, and the nouns of the business — orders, customers, products,
 * batches, suppliers, the team, settings — matched on the server.
 *
 * Every result names the section it lives in, so using the palette teaches the
 * map rather than replacing it. Nothing here is a command that changes data:
 * the palette navigates, and the pages that would act on something say plainly
 * that acting is not built yet.
 */

export const OPEN_COMMAND_EVENT = "half-sour:open-command";

type Hit = {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly subtitle: string;
  readonly section: string;
  readonly href: string;
};

type SearchResponse = { readonly hits?: readonly Hit[] };

function isHit(value: unknown): value is Hit {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    typeof record["kind"] === "string" &&
    typeof record["title"] === "string" &&
    typeof record["href"] === "string"
  );
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The results are stored with the term they answer, so "what is on screen"
  // is derived rather than synchronised. Nothing has to reset anything.
  const [answer, setAnswer] = useState<{
    readonly term: string;
    readonly list: readonly Hit[];
  }>({ term: "", list: [] });
  const [caret, setCaret] = useState<{
    readonly term: string;
    readonly index: number;
  }>({ term: "", index: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const term = query.trim();
  const busy = term.length >= 2 && answer.term !== term;
  const cursor = caret.term === term ? caret.index : 0;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setAnswer({ term: "", list: [] });
    setCaret({ term: "", index: 0 });
  }, []);

  // Opening: the keyboard shortcut, and the buttons that dispatch the event.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((was) => !was);
        return;
      }
      if (event.key === "/" && !typing) {
        event.preventDefault();
        setOpen(true);
      }
    }
    function onOpenRequest(): void {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpenRequest);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Searching the business. Destinations are matched locally, below.
  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/admin/api/search?q=${encodeURIComponent(term)}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      })
        .then((response) => (response.ok ? response.json() : { hits: [] }))
        .then((payload: SearchResponse) => {
          const list = Array.isArray(payload.hits) ? payload.hits : [];
          setAnswer({ term, list: list.filter(isHit) });
        })
        .catch(() => {
          // An aborted or failed search leaves the destinations, which is
          // still a useful palette rather than an error she has to read.
          setAnswer({ term, list: [] });
        });
    }, 140);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [term]);

  const destinationHits = useMemo<readonly Hit[]>(() => {
    const needle = term.toLowerCase();
    return DESTINATIONS.filter((destination) => {
      if (needle === "") return true;
      return (
        destination.label.toLowerCase().includes(needle) ||
        destination.blurb.toLowerCase().includes(needle) ||
        destination.keywords.some((word) => word.includes(needle))
      );
    }).map((destination) => ({
      id: `go-${destination.id}`,
      kind: "Go to",
      title: destination.label,
      subtitle: destination.blurb,
      section: "Sections",
      href: destination.href,
    }));
  }, [term]);

  const items = useMemo<readonly Hit[]>(() => {
    // Results are only shown against the term they answer, so a stale list
    // from the previous keystroke never appears under a newer query.
    const hits = answer.term === term ? answer.list : [];
    const all = [...destinationHits, ...hits];
    if (term.length >= 2) {
      all.push({
        id: "see-all",
        kind: "Search",
        title: `See every match for “${term}”`,
        subtitle: "Opens the full search results page",
        section: "Search",
        href: `/admin/search?q=${encodeURIComponent(term)}`,
      });
    }
    return all;
  }, [answer, destinationHits, term]);

  useEffect(() => {
    if (!open) return;
    const element = listRef.current?.children[cursor];
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [cursor, open]);

  if (!open) return null;

  function go(item: Hit | undefined): void {
    if (item === undefined) return;
    close();
    router.push(item.href);
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    // Tab stays inside the dialog. A modal that lets focus wander onto the
    // page behind it is a modal a keyboard user cannot get back out of.
    if (event.key === "Tab") {
      const dialog = dialogRef.current;
      if (dialog !== null) {
        const focusable = [
          ...dialog.querySelectorAll<HTMLElement>(
            'input, button, [href], [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((element) => element.offsetParent !== null);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first !== undefined && last !== undefined) {
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCaret({
        term,
        index: items.length === 0 ? 0 : (cursor + 1) % items.length,
      });
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCaret({
        term,
        index:
          items.length === 0 ? 0 : (cursor - 1 + items.length) % items.length,
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      go(items[cursor]);
    }
  }

  let lastSection = "";

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center px-4 py-[8vh]"
      role="presentation"
    >
      {/*
        On the backdrop, because the backdrop is what the pointer lands on: it
        covers this element completely, so the
        `event.target === event.currentTarget` guard that used to live on the
        parent could never be true and clicking outside the palette did
        nothing. See `components/admin/chat/ChatDock.tsx` for the whole
        account — the palette is the third overlay in this admin that shipped
        with the same dead check.
      */}
      <div
        aria-hidden="true"
        onMouseDown={close}
        className="fixed inset-0 bg-black/45"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search Half Sour"
        onKeyDown={onKeyDown}
        className="relative flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-hairline bg-surface-raised shadow-overlay"
      >
        <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
          <IconSearch className="size-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search orders, customers, batches, the team…"
            aria-label="Search"
            className="min-w-0 flex-1 bg-transparent text-body-sm text-primary outline-none placeholder:text-muted"
          />
          {busy && <span className="text-caption text-muted">Searching…</span>}
          <button
            type="button"
            onClick={close}
            className="rounded-sm border border-hairline px-1.5 py-0.5 text-caption text-muted hover:text-primary"
          >
            Esc
          </button>
        </div>

        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {items.length === 0 && (
            <li className="px-4 py-6 text-center">
              <p className="text-body-sm font-medium text-primary">
                Nothing matched “{term}”
              </p>
              <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
                Search covers order numbers, customer names and emails,
                products, batch codes, suppliers, ingredients, the AI team,
                social posts and settings.
              </p>
            </li>
          )}
          {items.map((item, index) => {
            const heading = item.section !== lastSection ? item.section : null;
            lastSection = item.section;
            const active = index === cursor;
            return (
              <li key={item.id}>
                {heading !== null && (
                  <p className="px-4 pt-2.5 pb-1 text-eyebrow uppercase text-muted">
                    {heading}
                  </p>
                )}
                <button
                  type="button"
                  onMouseEnter={() => {
                    setCaret({ term, index });
                  }}
                  onClick={() => {
                    go(item);
                  }}
                  className={`flex w-full items-baseline gap-3 px-4 py-2 text-left ${
                    active ? "bg-surface-page" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm text-primary">
                      {item.title}
                    </span>
                    <span className="block truncate text-caption text-muted">
                      {item.subtitle}
                    </span>
                  </span>
                  <span className="shrink-0 text-caption text-muted">
                    {item.kind}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-2 text-caption text-muted">
          <span>
            <kbd className="font-mono">↑</kbd>{" "}
            <kbd className="font-mono">↓</kbd> to move,{" "}
            <kbd className="font-mono">↵</kbd> to open
          </span>
          <span>Nothing here changes anything</span>
        </div>
      </div>
    </div>
  );
}

/** The sidebar's search field. Opens the palette; it is not an input itself. */
export function CommandTrigger({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new CustomEvent(OPEN_COMMAND_EVENT));
      }}
      className={`flex w-full items-center gap-2 rounded-md border border-hairline px-2.5 py-1.5 text-left text-caption text-muted transition-colors hover:bg-surface-page hover:text-primary ${className}`}
    >
      <IconSearch className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Search everything</span>
      <kbd className="hidden shrink-0 rounded-sm border border-hairline px-1 font-mono text-caption lg:inline">
        ⌘K
      </kbd>
    </button>
  );
}

/** The icon-only trigger for the top bar on a phone. */
export function CommandIconButton() {
  return (
    <button
      type="button"
      aria-label="Search everything"
      onClick={() => {
        window.dispatchEvent(new CustomEvent(OPEN_COMMAND_EVENT));
      }}
      className="inline-flex size-8 items-center justify-center rounded-md border border-hairline text-muted hover:bg-surface-page hover:text-primary"
    >
      <IconSearch className="size-4" />
    </button>
  );
}
