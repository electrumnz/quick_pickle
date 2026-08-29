"use client";

import { useSyncExternalStore } from "react";

import { IconMoon, IconSun } from "../ui/icons";
import { THEME_STORAGE_KEY, type Theme } from "./theme";

/**
 * Light and dark, both deliberate.
 *
 * The scheme is not React state — it is a fact about the document, set on
 * `<html>` before first paint and otherwise inherited from the operating
 * system. So it is read as an external store rather than mirrored into state:
 * the OS switching at sunset updates this control without anyone clicking it,
 * and there is no frame where the button shows the wrong icon.
 *
 * Before hydration the store has no answer, and the control renders without an
 * icon rather than guessing one and swapping it.
 */

const THEME_CHANGE_EVENT = "half-sour:theme";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

function readTheme(): Theme {
  const attribute = document.documentElement.dataset["theme"];
  if (attribute === "dark" || attribute === "light") return attribute;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function onServer(): Theme | null {
  return null;
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore<Theme | null>(
    subscribe,
    readTheme,
    onServer,
  );
  const next: Theme = theme === "dark" ? "light" : "dark";

  function choose(): void {
    document.documentElement.dataset["theme"] = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the switch still works for this session.
    }
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      onClick={choose}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      className={`inline-flex size-8 items-center justify-center rounded-md border border-hairline text-muted transition-colors hover:bg-surface-page hover:text-primary ${className}`}
    >
      {theme === null ? null : theme === "dark" ? (
        <IconSun className="size-4" />
      ) : (
        <IconMoon className="size-4" />
      )}
    </button>
  );
}
