"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The button that puts a task's message on her clipboard.
 *
 * The whole page turns on this one control: she reads what a task is, presses
 * this, and pastes the result into Claude Code. So three things are true of it
 * that are not true of a convenience "copy" affordance.
 *
 *  - **It says what happened.** The result is announced in a live region as
 *    well as written on the button's own line, because a copy that silently
 *    fails is worse than no button — she pastes nothing into a session and
 *    cannot tell why.
 *  - **It is not the only way to get the words.** The clipboard needs a secure
 *    context and a browser permission, and either can be missing. The message
 *    itself is on the page, folded away, so it can always be read and selected
 *    by hand. That fold is also what makes the words available with no
 *    JavaScript at all.
 *  - **It is a full-sized target.** 44px on a phone, where she is when she is
 *    standing in the kitchen reading this.
 */

type Result = "idle" | "copied" | "failed";

const HOW_IT_WENT: Readonly<Record<Result, string>> = {
  idle: "",
  copied: "Copied. Paste it into Claude Code.",
  failed:
    "The clipboard would not open. Use “Read it first” below and copy the words by hand.",
};

export function CopyPrompt({
  prompt,
  taskTitle,
}: {
  prompt: string;
  /** Named in the button's accessible label, so a list of them is navigable. */
  taskTitle: string;
}) {
  const [result, setResult] = useState<Result>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  async function copy(): Promise<void> {
    let outcome: Result = "copied";
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      outcome = "failed";
    }
    setResult(outcome);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setResult("idle");
    }, 6000);
  }

  return (
    <div className="mt-3.5 border-t border-hairline pt-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => {
            void copy();
          }}
          aria-label={`Copy the message for: ${taskTitle}`}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-accent-edge bg-surface-accent px-3.5 py-1.5 text-caption font-medium text-on-accent transition-colors hover:bg-surface-accent/80"
        >
          Copy the message for Claude Code
        </button>
        <p
          role="status"
          className={`text-caption ${result === "failed" ? "text-danger" : "text-muted"}`}
        >
          {HOW_IT_WENT[result]}
        </p>
      </div>

      <details className="group mt-2.5">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md text-caption text-link underline underline-offset-4 hover:no-underline sm:min-h-0">
          <span
            aria-hidden="true"
            className="transition-transform group-open:rotate-90"
          >
            &#8250;
          </span>
          Read it first
        </summary>
        <p className="mt-2 rounded-md border border-hairline bg-surface-sunken px-3 py-2.5 font-mono text-caption whitespace-pre-wrap text-primary">
          {prompt}
        </p>
      </details>
    </div>
  );
}
