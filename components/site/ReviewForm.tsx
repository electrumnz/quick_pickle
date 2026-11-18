"use client";

import { useActionState, useState } from "react";

import { StarIcon } from "@/components/brand/Icons";
import { REVIEWS } from "@/content/site";

import { sendReview, type ReviewField, type ReviewState } from "./actions";

const INITIAL: ReviewState = { status: "idle" };

const WORDS = REVIEWS.form;

const PROBLEM: Record<ReviewField, string> = {
  rating: WORDS.problems.rating,
  body: WORDS.problems.body,
  name: WORDS.problems.name,
};

/**
 * The shop's review form. A plain form posting to a Server Action, so it
 * works before the page's script has loaded and with it switched off. What
 * is sent waits for a person to read it before it is ever shown.
 *
 * The stars are five radio buttons, each named in words ("4 stars"), so a
 * keyboard moves through them with the arrow keys and a screen reader says
 * what each one is. With scripting on, the stars up to the one picked fill
 * in; without it, the picked one is ringed.
 */
export function ReviewForm() {
  const [state, action, pending] = useActionState(sendReview, INITIAL);
  const typed = state.typed;
  const [chosen, setChosen] = useState<number>(() =>
    Number(typed?.rating ?? 0),
  );

  if (state.status === "sent") {
    return (
      <p
        role="status"
        className="varsity text-pink-deep mt-8 text-[1.75rem] leading-tight"
      >
        {WORDS.thanks}
      </p>
    );
  }

  const problems = new Set(state.problems ?? []);
  const said =
    state.status === "slow"
      ? WORDS.problems.slow
      : state.status === "failed"
        ? WORDS.problems.failed
        : null;

  return (
    // The key is what was handed back: React empties a form when its action
    // answers, and a field only reads its starting value once.
    <form
      key={JSON.stringify(typed ?? {})}
      action={action}
      className="mt-8 flex flex-col gap-7"
      noValidate
    >
      <fieldset
        aria-describedby={
          problems.has("rating") ? "rv-rating-error" : undefined
        }
      >
        <legend className="field-label">{WORDS.rating}</legend>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="has-[:focus-visible]:ring-navy has-[:checked]:ring-navy/30 relative grid size-12 cursor-pointer place-items-center rounded-full has-[:checked]:ring-2 has-[:focus-visible]:ring-[3px]"
            >
              <input
                type="radio"
                name="rating"
                value={n}
                required
                defaultChecked={typed?.rating === String(n)}
                onChange={() => setChosen(n)}
                aria-invalid={problems.has("rating") ? true : undefined}
                className="peer sr-only"
              />
              <StarIcon filled={n <= chosen} className="text-navy size-9" />
              <span className="sr-only">{WORDS.star(n)}</span>
            </label>
          ))}
        </div>
        {problems.has("rating") ? (
          <p id="rv-rating-error" className="field-error">
            {PROBLEM.rating}
          </p>
        ) : null}
      </fieldset>

      <div>
        <label htmlFor="rv-body" className="field-label">
          {WORDS.body}
        </label>
        <textarea
          id="rv-body"
          name="body"
          rows={6}
          maxLength={1500}
          required
          defaultValue={typed?.body ?? ""}
          aria-invalid={problems.has("body") ? true : undefined}
          aria-describedby={problems.has("body") ? "rv-body-error" : undefined}
          className="field resize-y leading-relaxed"
        />
        {problems.has("body") ? (
          <p id="rv-body-error" className="field-error">
            {PROBLEM.body}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="rv-name" className="field-label">
          {WORDS.name}
        </label>
        <input
          id="rv-name"
          name="name"
          type="text"
          autoComplete="off"
          maxLength={60}
          required
          defaultValue={typed?.name ?? ""}
          aria-invalid={problems.has("name") ? true : undefined}
          aria-describedby={
            problems.has("name") ? "rv-name-error" : "rv-name-hint"
          }
          className="field"
        />
        {problems.has("name") ? (
          <p id="rv-name-error" className="field-error">
            {PROBLEM.name}
          </p>
        ) : (
          <p
            id="rv-name-hint"
            className="text-navy-muted mt-1.5 text-[0.875rem]"
          >
            {WORDS.nameHint}
          </p>
        )}
      </div>

      <fieldset className="card-flat p-5">
        <legend className="field-label float-left mb-2 w-full">
          {WORDS.bought}
        </legend>
        <p className="text-navy-muted clear-both text-[0.9375rem] leading-snug">
          {WORDS.boughtHint}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="rv-order" className="field-label">
              {WORDS.order}
            </label>
            <input
              id="rv-order"
              name="order"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={20}
              defaultValue={typed?.order ?? ""}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="rv-email" className="field-label">
              {WORDS.email}
            </label>
            <input
              id="rv-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={254}
              defaultValue={typed?.email ?? ""}
              className="field"
            />
          </div>
        </div>
      </fieldset>

      {/* Honeypot: people never see or fill this; scripts usually do. */}
      <div aria-hidden="true" className="hidden">
        <label>
          {WORDS.leaveEmpty}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div>
        <button type="submit" disabled={pending} className="btn btn-pink">
          <span className="cap-trim">
            {pending ? WORDS.pending : WORDS.submit}
          </span>
        </button>
        {said !== null ? (
          <p role="alert" className="field-error mt-3 font-semibold">
            {said}
          </p>
        ) : null}
        {problems.size > 0 ? (
          <p role="alert" className="sr-only">
            {[...problems].map((field) => PROBLEM[field]).join(" ")}
          </p>
        ) : null}
      </div>
    </form>
  );
}
