"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/backstage/SubmitButton";

import type { ShopFormState } from "../shop/flow";

import { labelAction } from "./actions";

/**
 * What the label says and who the company is: one form, two presses, like
 * the shop's own (./actions.ts). "See what changes" saves nothing and reads
 * the change back; "Change the site" makes exactly the change that was
 * read back.
 */

function Line({
  name,
  label,
  hint,
  state,
  rows,
  maxLength,
  inputMode,
}: {
  readonly name: string;
  readonly label: string;
  readonly hint: string;
  readonly state: ShopFormState;
  /** More than one makes it a box for a run of words. */
  readonly rows?: number;
  readonly maxLength: number;
  readonly inputMode?: "numeric";
}) {
  const problem = state.fields[name];
  const value = state.values[name] ?? "";
  const shared = {
    id: name,
    name,
    maxLength,
    autoComplete: "off",
    // A fresh answer from the server shows in the box.
    defaultValue: value,
    "aria-invalid": problem ? (true as const) : undefined,
    "aria-describedby": `${name}-hint`,
    className: "field",
  };
  return (
    <div>
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      {rows === undefined ? (
        <input key={`${name}-${value}`} inputMode={inputMode} {...shared} />
      ) : (
        <textarea key={`${name}-${value}`} rows={rows} {...shared} />
      )}
      <p
        id={`${name}-hint`}
        className="bk-muted mt-1 text-[0.9375rem] leading-snug"
      >
        {hint}
      </p>
      {problem ? <p className="field-error">{problem}</p> : null}
    </div>
  );
}

/** A line of what changed, as the start of a sentence. */
const sentence = (line: string) => line.charAt(0).toUpperCase() + line.slice(1);

export function LabelForm({
  start,
  canChange,
}: {
  /** The boxes as the shop has them now (./values.ts). */
  readonly start: Readonly<Record<string, string>>;
  /** False for somebody who can only look. */
  readonly canChange: boolean;
}) {
  const empty: ShopFormState = {
    step: "idle",
    values: start,
    error: null,
    fields: {},
    changed: [],
    note: null,
    checkedFor: null,
    version: null,
    tickFor: null,
  };
  const [state, action] = useActionState(labelAction, empty);
  const gst = state.values.gst ?? "unknown";
  const askTick = state.tickFor !== null && state.step !== "done";

  return (
    <form action={action} className="flex flex-col gap-8" noValidate>
      {state.error !== null ? (
        <p role="alert" className="bk-notice bk-notice-bad">
          {state.error}
        </p>
      ) : null}
      {state.note !== null ? (
        <p role="status" className="bk-notice">
          {state.note}
        </p>
      ) : null}
      {state.step === "done" ? (
        <div role="status" data-testid="label-done" className="bk-notice">
          <p className="font-semibold">It is changed.</p>
          <ul className="mt-1 list-disc pl-5">
            {state.changed.map((line) => (
              <li key={line}>{sentence(line)}</li>
            ))}
          </ul>
          <p className="mt-2">Customers see it within a minute.</p>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-5">
        <legend className="bk-h2 mb-4">
          <span className="cap-trim">What the label says</span>
        </legend>
        <Line
          name="ingredients"
          label="The ingredients list"
          hint="Word for word, as the printed label has it. Leave it empty until the label is in your hand: until then the site says the list is on its way, and never guesses."
          rows={4}
          maxLength={800}
          state={state}
        />
        <Line
          name="contains"
          label="The allergen line"
          hint="Only if the label has one, exactly as printed. Empty says nothing about allergens either way."
          maxLength={200}
          state={state}
        />
        <Line
          name="storage"
          label="The storage line"
          hint="As printed. Empty shows none."
          maxLength={200}
          state={state}
        />
        {askTick ? (
          <label
            data-testid="label-tick"
            className="bk-panel flex min-h-11 cursor-pointer items-start gap-3 p-3"
          >
            <input
              type="checkbox"
              name="labelChecked"
              value="yes"
              key={`tick-${state.tickFor ?? ""}-${state.values.labelChecked ?? ""}`}
              defaultChecked={state.values.labelChecked === "yes"}
              className="accent-navy mt-1 size-5 shrink-0"
            />
            <span>
              <span className="block font-semibold">
                These lines are word for word what the printed label says
              </span>
              <span className="bk-muted block text-[0.9375rem] leading-snug">
                Your name goes beside it. Change a line after ticking and it is
                asked for again.
              </span>
            </span>
          </label>
        ) : null}
        <input type="hidden" name="tickFor" value={state.tickFor ?? ""} />
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="bk-h2 mb-4">
          <span className="cap-trim">Who is behind the shop</span>
        </legend>
        <Line
          name="legalName"
          label="The legal name"
          hint="The company's registered name, or your own if you trade as yourself. It goes in the terms of sale, on receipts and on purchase orders."
          maxLength={120}
          state={state}
        />
        <div className="grid gap-5 md:grid-cols-2">
          <Line
            name="nzbn"
            label="NZBN"
            hint="The New Zealand Business Number: 13 digits. Empty if there is none."
            maxLength={20}
            inputMode="numeric"
            state={state}
          />
          <Line
            name="address"
            label="The business address"
            hint="One line. It goes in the terms of sale."
            maxLength={200}
            state={state}
          />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label htmlFor="gst" className="field-label">
              Registered for GST
            </label>
            <select
              id="gst"
              name="gst"
              key={`gst-${gst}`}
              defaultValue={gst}
              aria-invalid={state.fields.gst ? true : undefined}
              aria-describedby="gst-hint"
              className="field"
            >
              <option value="unknown">Not known yet</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
            <p
              id="gst-hint"
              className="bk-muted mt-1 text-[0.9375rem] leading-snug"
            >
              Yes makes the terms of sale say prices include GST, and the budget
              work it out.
            </p>
            {state.fields.gst ? (
              <p className="field-error">{state.fields.gst}</p>
            ) : null}
          </div>
          <Line
            name="gstNumber"
            label="GST number"
            hint="Only if registered: 8 or 9 digits. With it in, a receipt says how much of the total is GST."
            maxLength={20}
            inputMode="numeric"
            state={state}
          />
        </div>
      </fieldset>

      {state.step === "checked" ? (
        <div
          role="status"
          data-testid="label-checked"
          className="bk-notice flex flex-col gap-2"
        >
          <p className="font-semibold">This is what would change:</p>
          <ul className="list-disc pl-5">
            {state.changed.map((line) => (
              <li key={line}>{sentence(line)}</li>
            ))}
          </ul>
          <p>Every customer sees it from the moment it is changed.</p>
        </div>
      ) : null}

      <input type="hidden" name="checkedFor" value={state.checkedFor ?? ""} />

      {canChange ? (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            name="intent"
            value="check"
            pending="Checking"
            className={
              state.step === "checked" ? "bk-btn bk-btn-quiet" : "bk-btn"
            }
          >
            {state.step === "checked" ? "Check again" : "See what changes"}
          </SubmitButton>
          {state.step === "checked" ? (
            <SubmitButton name="intent" value="change" pending="Changing">
              Change the site
            </SubmitButton>
          ) : null}
        </div>
      ) : (
        <p className="bk-muted text-[0.9375rem] leading-snug">
          You can look at this and not change it.
        </p>
      )}
      {canChange && state.step !== "checked" ? (
        <p className="bk-muted text-[0.9375rem] leading-snug">
          Checking changes nothing. It reads the change back before anything is
          saved.
        </p>
      ) : null}
    </form>
  );
}
