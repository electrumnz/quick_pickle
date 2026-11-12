"use client";

import { useActionState } from "react";

import { CREW } from "@/content/site";

import { joinCrew, type CrewState } from "./actions";

const INITIAL: CrewState = { status: "idle" };

/**
 * Pickle Crew sign-up.
 *
 * A plain form posting to a Server Action, so it works before the page's
 * JavaScript has loaded and with it switched off. With JavaScript on, the
 * answer comes back in place and is announced to a screen reader.
 */
export function CrewForm() {
  const [state, action, pending] = useActionState(joinCrew, INITIAL);

  if (state.status === "joined") {
    return (
      <p
        role="status"
        className="varsity text-olive mt-6 text-[1.75rem] leading-tight"
      >
        {CREW.success}
      </p>
    );
  }

  const error =
    state.status === "invalid"
      ? CREW.invalid
      : state.status === "failed"
        ? CREW.failed
        : null;

  return (
    <>
      <p className="mt-4 max-w-[30rem] text-[1.0625rem] leading-relaxed">
        {CREW.body}
      </p>
      <form action={action} className="mt-6 max-w-[30rem]" noValidate>
        <label htmlFor="crew-email" className="field-label text-cream">
          {CREW.label}
        </label>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <input
              id="crew-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder={CREW.placeholder}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "crew-error" : undefined}
              className="field"
            />
          </div>
          {/* Honeypot: people never see or fill this; scripts usually do. */}
          <div aria-hidden="true" className="hidden">
            <label>
              Leave this empty
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="btn btn-on-navy shrink-0"
          >
            <span className="cap-trim">
              {pending ? CREW.pending : CREW.cta}
            </span>
          </button>
        </div>
        {error ? (
          <p
            id="crew-error"
            role="alert"
            className="text-olive mt-3 text-[0.9375rem]"
          >
            {error}
          </p>
        ) : null}
      </form>
    </>
  );
}
