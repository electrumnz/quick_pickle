"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * Shows its children until an instant has passed, then shows `otherwise`.
 *
 * For a special on a page that is built once and kept: the kept copy may
 * outlive the special's last day by a few minutes, and the page must not go
 * on saying it. The server always renders the children (the page was built
 * while the special was on); the browser checks its own clock once it has
 * the page, and swaps if the moment has gone.
 */
const never = () => () => {};

export function WhileOn({
  until,
  children,
  otherwise = null,
}: {
  /** An ISO instant, or null for no end. */
  readonly until: string | null;
  readonly children: ReactNode;
  readonly otherwise?: ReactNode;
}) {
  const over = useSyncExternalStore(
    never,
    () => until !== null && Date.now() >= Date.parse(until),
    () => false,
  );
  return <>{over ? otherwise : children}</>;
}
