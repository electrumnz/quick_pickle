"use client";

import { useFormStatus } from "react-dom";

/**
 * The button, and what it says while the agent is thinking.
 *
 * A run is several model calls against a real API and takes seconds, so the
 * gap between the press and the answer is long enough for the page to look
 * broken. Two things stop that, and neither of them is a spinner on its own.
 *
 * **The button says what is happening.** `useFormStatus` reads the pending
 * state of the enclosing form, so this is the same pattern
 * `components/product/SubmitButton.tsx` established for the shop's buy button
 * and for the same reason: the loading state belongs on the control that was
 * pressed, not in a route-level `loading.tsx` that would swap out a page which
 * has already been rendered and sent. With scripting off, `pending` is never
 * true and the browser's own progress indicator does the job, which is correct
 * — the admin has to work without JavaScript.
 *
 * **A screen reader is told, in words.** The a11y suite is at zero axe
 * violations and a control that changes state needs a live region, not a
 * spinning graphic. The `role="status"` paragraph below is polite and separate
 * from the button, so its text changing is announced without stealing focus and
 * without the announcement being tangled up in the button's own accessible
 * name.
 *
 * **It cannot be pressed twice.** Disabled while pending is the courtesy;
 * `agent_runs_one_live_manual_run` in the database is the guarantee, and it
 * holds for a second tab, a replayed POST and a browser with scripting off.
 */
export function RunNowButton({ name }: { name: string }) {
  const { pending } = useFormStatus();

  return (
    <>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-hairline bg-surface-sunken px-3 py-1.5 text-caption font-semibold text-primary transition-colors hover:bg-surface-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:cursor-progress disabled:opacity-70"
      >
        {pending ? `${name} is working…` : `Run ${name} now`}
      </button>
      <p role="status" className="mt-2 text-caption text-muted">
        {pending
          ? `${name} is working. It is reading the business, deciding what to do and writing down why, which takes a few seconds. This page lands on what it did as soon as it stops.`
          : ""}
      </p>
    </>
  );
}
