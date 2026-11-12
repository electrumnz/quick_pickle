"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * A form's button. While the form is on its way it says so and cannot be
 * pressed twice. With scripting off it is an ordinary submit button.
 */
export function SubmitButton({
  children,
  pending,
  className = "bk-btn",
  name,
  value,
}: {
  readonly children: ReactNode;
  /** What it says while working, e.g. "Saving". */
  readonly pending: string;
  readonly className?: string;
  readonly name?: string;
  readonly value?: string;
}) {
  const status = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={className}
      aria-disabled={status.pending || undefined}
      onClick={(event) => {
        if (status.pending) event.preventDefault();
      }}
    >
      <span className="cap-trim">{status.pending ? pending : children}</span>
    </button>
  );
}
