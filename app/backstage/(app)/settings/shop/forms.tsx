"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/backstage/SubmitButton";

import { shopAction } from "./actions";
import type { ShopFormState } from "./flow";

/**
 * The shop's settings: one form, two presses. "See what changes" saves
 * nothing and reads the change back; "Change the shop" makes exactly the
 * change that was read back (./actions.ts).
 */

type PackRow = {
  readonly sku: string;
  readonly name: string;
  readonly shots: number;
};

function Money({
  name,
  label,
  hint,
  state,
  optional = false,
}: {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly state: ShopFormState;
  readonly optional?: boolean;
}) {
  const problem = state.fields[name];
  const hintId = `${name}-hint`;
  return (
    <div>
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="bk-muted text-[1.0625rem]">
          $
        </span>
        <input
          id={name}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          // A fresh answer from the server shows in the box.
          key={`${name}-${state.values[name] ?? ""}`}
          defaultValue={state.values[name] ?? ""}
          required={!optional}
          aria-invalid={problem ? true : undefined}
          aria-describedby={hint === undefined ? undefined : hintId}
          className="field max-w-[9rem]"
        />
      </div>
      {hint === undefined ? null : (
        <p id={hintId} className="bk-muted mt-1 text-[0.9375rem] leading-snug">
          {hint}
        </p>
      )}
      {problem ? <p className="field-error">{problem}</p> : null}
    </div>
  );
}

function Choice({
  name,
  legend,
  options,
  state,
}: {
  readonly name: string;
  readonly legend: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly hint: string;
  }[];
  readonly state: ShopFormState;
}) {
  return (
    <fieldset>
      <legend className="field-label">{legend}</legend>
      <div className="grid gap-3 md:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="bk-panel flex min-h-11 cursor-pointer items-start gap-3 p-3"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              key={`${name}-${option.value}-${state.values[name] ?? ""}`}
              defaultChecked={state.values[name] === option.value}
              className="accent-navy mt-1 size-5 shrink-0"
            />
            <span>
              <span className="block font-semibold">{option.label}</span>
              <span className="bk-muted block text-[0.9375rem] leading-snug">
                {option.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A line of what changed, as the start of a sentence. */
const sentence = (line: string) => line.charAt(0).toUpperCase() + line.slice(1);

export function ShopForm({
  packs,
  start,
  canChange,
}: {
  readonly packs: readonly PackRow[];
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
  const [state, action] = useActionState(shopAction, empty);
  const text = (name: string) => state.values[name] ?? "";

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
        <div role="status" data-testid="shop-done" className="bk-notice">
          <p className="font-semibold">The shop is changed.</p>
          <ul className="mt-1 list-disc pl-5">
            {state.changed.map((line) => (
              <li key={line}>{sentence(line)}</li>
            ))}
          </ul>
          <p className="mt-2">
            Customers see it within a minute. Anybody part-way through the
            checkout is shown the new total before they can pay.
          </p>
        </div>
      ) : null}

      <Choice
        name="open"
        legend="Taking orders"
        state={state}
        options={[
          {
            value: "yes",
            label: "Yes, taking orders",
            hint: "The buttons work and the checkout takes orders.",
          },
          {
            value: "no",
            label: "No, stop for now",
            hint: "For a batch that has sold out, or a week away. The page says so and points people to the Pickle Crew.",
          },
        ]}
      />

      <Choice
        name="launchMode"
        legend="Pre-order or live"
        state={state}
        options={[
          {
            value: "preorder",
            label: "Pre-order",
            hint: "People pay now and it ships when the batch is ready. The buttons say pre-order.",
          },
          {
            value: "live",
            label: "Live",
            hint: "It is on the shelf and ships as it is ordered.",
          },
        ]}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="batchName" className="field-label">
            What this batch is called
          </label>
          <input
            id="batchName"
            name="batchName"
            maxLength={40}
            autoComplete="off"
            key={`batch-${text("batchName")}`}
            defaultValue={text("batchName")}
            required
            aria-invalid={state.fields.batchName ? true : undefined}
            className="field"
          />
          {state.fields.batchName ? (
            <p className="field-error">{state.fields.batchName}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="preorderShipsFrom" className="field-label">
            Pre-orders ship from
          </label>
          <input
            id="preorderShipsFrom"
            name="preorderShipsFrom"
            type="date"
            key={`ships-${text("preorderShipsFrom")}`}
            defaultValue={text("preorderShipsFrom")}
            aria-invalid={state.fields.preorderShipsFrom ? true : undefined}
            aria-describedby="ships-hint"
            className="field"
          />
          <p
            id="ships-hint"
            className="bk-muted mt-1 text-[0.9375rem] leading-snug"
          >
            Leave it empty until the date is certain. The site then says the
            date is to be confirmed and never guesses.
          </p>
          {state.fields.preorderShipsFrom ? (
            <p className="field-error">{state.fields.preorderShipsFrom}</p>
          ) : null}
        </div>
      </div>

      <fieldset>
        <legend className="field-label">Prices</legend>
        <div className="grid gap-5 md:grid-cols-3">
          {packs.map((pack) => (
            <Money
              key={pack.sku}
              name={`price:${pack.sku}`}
              label={`${pack.name} (${String(pack.shots)} shots)`}
              state={state}
            />
          ))}
        </div>
        <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
          What a customer pays for the pack. The savings and the price for each
          shot on the page are worked out from these.
        </p>
      </fieldset>

      <fieldset>
        <legend className="field-label">Delivery</legend>
        <div className="grid gap-5 md:grid-cols-3">
          <Money
            name="standard"
            label="Standard delivery"
            hint="For one order, anywhere in New Zealand. 0 makes delivery free for everybody."
            state={state}
          />
          <Money
            name="rural"
            label="Extra for a rural address"
            hint="On top of standard delivery. 0 for no extra."
            state={state}
          />
          <Money
            name="freeOver"
            label="Free delivery on orders of"
            hint="Or more. Leave it empty and no order gets free delivery."
            optional
            state={state}
          />
        </div>
      </fieldset>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="contactEmail" className="field-label">
            The address customers write to
          </label>
          <input
            id="contactEmail"
            name="contactEmail"
            type="email"
            maxLength={254}
            autoComplete="off"
            key={`contact-${text("contactEmail")}`}
            defaultValue={text("contactEmail")}
            aria-invalid={state.fields.contactEmail ? true : undefined}
            aria-describedby="contact-hint"
            className="field"
          />
          <p
            id="contact-hint"
            className="bk-muted mt-1 text-[0.9375rem] leading-snug"
          >
            Shown in the questions, the fine print and on order emails. Empty
            shows no address.
          </p>
          {state.fields.contactEmail ? (
            <p className="field-error">{state.fields.contactEmail}</p>
          ) : null}
        </div>
      </div>

      {state.step === "checked" ? (
        <div
          role="status"
          data-testid="shop-checked"
          className="bk-notice flex flex-col gap-2"
        >
          <p className="font-semibold">This is what would change:</p>
          <ul className="list-disc pl-5">
            {state.changed.map((line) => (
              <li key={line}>{sentence(line)}</li>
            ))}
          </ul>
          <p>
            Every customer sees it and is charged by it from the moment it is
            changed.
          </p>
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
              Change the shop
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
