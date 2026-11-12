"use client";

import { useActionState, useEffect } from "react";

import { useCart } from "@/components/cart/CartProvider";
import { crewProblem } from "@/components/checkout/problem";
import { CREW, WELCOME } from "@/content/site";

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
  const { carriedCode, carryCode } = useCart();

  // A new member's code is kept for the checkout, so they never have to
  // type it. If they arrived carrying another code, that one stays.
  const welcome = state.status === "joined" ? state.welcome : undefined;
  const welcomeCode = welcome?.code;
  useEffect(() => {
    if (welcomeCode !== undefined) carryCode(welcomeCode);
  }, [welcomeCode, carryCode]);

  if (state.status === "joined") {
    return (
      <div role="status">
        <p className="varsity text-olive mt-6 text-[1.75rem] leading-tight">
          {CREW.success}
        </p>
        {welcome === undefined ? null : (
          <p
            data-testid="crew-welcome-code"
            className="bg-cream text-navy mt-4 max-w-[30rem] rounded-[14px] px-4 py-3 leading-snug"
          >
            <strong>
              {WELCOME.lead} {welcome.code}: {welcome.label}.
            </strong>{" "}
            {/* Said as saved only once it is: with scripting off, or with
                another code already in hand, it has to be typed. */}
            {carriedCode === welcome.code ? WELCOME.saved : WELCOME.typeIt}
          </p>
        )}
      </div>
    );
  }

  const error = crewProblem(state.status);

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
              // React empties a form when its action answers. On a no, what
              // was typed goes back in, so there is only the fix to make.
              defaultValue={state.email ?? ""}
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
            className="text-cream mt-3 text-[0.9375rem] font-semibold"
          >
            {error}
          </p>
        ) : null}
      </form>
    </>
  );
}
