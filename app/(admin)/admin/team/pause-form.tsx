import { ADMIN_CSRF_FIELD_NAME } from "@/lib/auth/server";

import { setAgentPausedAction } from "./actions";

/**
 * Stop one agent, or put it back on duty.
 *
 * A form rather than a link, because it is a state change: a `GET` that pauses
 * an agent is something any page on the internet could trigger with an image
 * tag. It carries the session's CSRF token for the same reason, and the server
 * action checks the session again before it writes.
 *
 * The wording is deliberate. "Pause" is not "delete" and not "stop everything" —
 * the founder needs to know exactly how much this button does, which is: this
 * one agent, from now, including whatever it is in the middle of.
 */
export function PauseForm({
  slug,
  name,
  isEnabled,
  csrfToken,
}: {
  slug: string;
  name: string;
  isEnabled: boolean;
  csrfToken: string;
}) {
  return (
    <form action={setAgentPausedAction} className="inline-flex">
      <input
        type="hidden"
        name={ADMIN_CSRF_FIELD_NAME}
        value={csrfToken}
        readOnly
      />
      <input type="hidden" name="slug" value={slug} readOnly />
      <input
        type="hidden"
        name="intent"
        value={isEnabled ? "pause" : "resume"}
        readOnly
      />
      <button
        type="submit"
        className="rounded-md border border-hairline px-2.5 py-1 text-caption font-medium text-primary transition-colors hover:bg-surface-page focus-visible:bg-surface-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        {isEnabled ? `Pause ${name}` : `Put ${name} back on duty`}
      </button>
    </form>
  );
}
