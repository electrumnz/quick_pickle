"use client";

import Link from "next/link";
import { useActionState } from "react";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  ANOTHER_COURIER,
  KNOWN_COURIERS,
} from "@/lib/backstage/orders/couriers";

import { trackingBackAction, type TrackingState } from "./actions";

/**
 * Tracking numbers back from the courier: paste them, check them, and only
 * then mark the orders shipped. The checking and the shipping both happen on
 * the server (./actions.ts); this is the form around them.
 */
export function TrackingBackForm({
  startWith,
}: {
  /** The courier used last, so it is already chosen. */
  readonly startWith: string;
}) {
  const empty: TrackingState = {
    step: "idle",
    text: "",
    courier: startWith,
    courierName: "",
    error: null,
    checkedFor: null,
    rows: [],
    unread: [],
    results: [],
  };
  const [state, action] = useActionState(trackingBackAction, empty);

  const ready = state.rows.filter((row) => row.problem === null);
  const held = state.rows.filter((row) => row.problem !== null);
  const shipped = state.results.filter((result) => result.ok);
  const failed = state.results.filter((result) => !result.ok);
  const courierSaid =
    KNOWN_COURIERS.find((known) => known.key === state.courier)?.name ??
    state.courierName;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error !== null ? (
        <p role="alert" className="bk-notice bk-notice-bad">
          {state.error}
        </p>
      ) : null}

      {state.step === "done" ? (
        <div
          role="status"
          data-testid="tracking-done"
          className="bk-notice flex flex-col gap-2"
        >
          <p className="font-semibold">
            {shipped.length === 0
              ? "Nothing was marked shipped."
              : `${String(shipped.length)} order${shipped.length === 1 ? "" : "s"} marked shipped with ${courierSaid}: ${shipped.map((result) => result.number).join(", ")}.`}
          </p>
          {failed.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {failed.map((result) => (
                <li key={result.number}>
                  <strong>{result.number}</strong> was not: {result.said}
                </li>
              ))}
            </ul>
          ) : null}
          {state.text.trim() !== "" ? (
            <p>What is still in the box below is what is left to sort.</p>
          ) : null}
        </div>
      ) : null}

      {/* The name box is put away by the stylesheet while a courier on the
          list is picked (.bk-other-choice in backstage.css). */}
      <div className="bk-other-choice grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="courier" className="field-label">
            Which courier
          </label>
          <select
            id="courier"
            name="courier"
            // The key makes a fresh answer from the server show in the box.
            key={`courier-${state.courier}`}
            defaultValue={state.courier}
            className="field"
          >
            {KNOWN_COURIERS.map((known) => (
              <option key={known.key} value={known.key}>
                {known.name}
              </option>
            ))}
            <option value={ANOTHER_COURIER}>Another courier</option>
          </select>
        </div>
        <div className="bk-when-other">
          <label htmlFor="courierName" className="field-label">
            Its name
          </label>
          <input
            id="courierName"
            name="courierName"
            maxLength={60}
            autoComplete="off"
            defaultValue={state.courierName}
            className="field"
          />
          <p className="bk-muted mt-1 text-[0.9375rem] leading-snug">
            For a courier not on the list the customer gets the tracking number
            with no link: we do not know where its tracking page is.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="lines" className="field-label">
          The tracking numbers
        </label>
        <textarea
          id="lines"
          name="lines"
          rows={6}
          key={`lines-${state.step}-${String(state.text.length)}`}
          defaultValue={state.text}
          spellCheck={false}
          aria-describedby="lines-help"
          placeholder={"QP-7K2M9X, 00794210392605965283"}
          className="field font-mono text-[0.9375rem]"
        />
        <p
          id="lines-help"
          className="bk-muted mt-1 text-[0.9375rem] leading-snug"
        >
          One order to a line: the order number, then its tracking number. Or
          paste the courier&apos;s own file, headings and all, and the two
          columns are found by their headings.
        </p>
      </div>

      <div>
        <label htmlFor="file" className="field-label">
          Or choose the courier&apos;s file
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="field"
        />
      </div>

      {state.step === "checked" ? (
        <div data-testid="tracking-checked" className="flex flex-col gap-4">
          <p role="status" className="bk-notice">
            <strong>
              {ready.length === 0
                ? "None of these can be marked shipped."
                : `${String(ready.length)} order${ready.length === 1 ? "" : "s"} will be marked shipped with ${courierSaid}.`}
            </strong>
            {held.length + state.unread.length > 0
              ? ` ${String(held.length + state.unread.length)} line${held.length + state.unread.length === 1 ? " needs" : "s need"} a look and will be left alone.`
              : ""}
          </p>

          {ready.length > 0 ? (
            <ul className="bk-rows">
              {ready.map((row) => (
                <li
                  key={row.number}
                  className="grid gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[8rem_1.2fr_1.4fr]"
                >
                  <span className="font-semibold tabular-nums">
                    <Link
                      href={`/backstage/orders/${row.number}`}
                      className="underline decoration-2 underline-offset-4"
                    >
                      {row.number}
                    </Link>
                    {row.test ? " (test)" : ""}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{row.who}</span>
                    <span className="bk-muted block truncate text-[0.9375rem]">
                      {row.items}
                    </span>
                  </span>
                  <span className="min-w-0 font-mono text-[0.9375rem] break-all">
                    {row.tracking}
                    {row.link === null ? (
                      <span className="bk-muted block font-sans">
                        No tracking page known, so no link.
                      </span>
                    ) : (
                      <a
                        href={row.link}
                        target="_blank"
                        rel="noreferrer"
                        className="block font-sans underline decoration-2 underline-offset-4"
                      >
                        Open its tracking page
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {held.length + state.unread.length > 0 ? (
        <div data-testid="tracking-held">
          <h3 className="field-label">Left alone</h3>
          <ul className="flex flex-col gap-2">
            {held.map((row) => (
              <li key={row.number} className="leading-snug">
                <strong>{row.number}</strong>
                {row.who === null ? "" : ` (${row.who})`}: {row.problem}
              </li>
            ))}
            {state.unread.map((line, index) => (
              <li
                key={`${String(index)}-${line.line}`}
                className="leading-snug"
              >
                <span className="font-mono text-[0.9375rem] break-all">
                  {line.line}
                </span>
                : {line.why}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <input type="hidden" name="checkedFor" value={state.checkedFor ?? ""} />

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          name="intent"
          value="check"
          pending="Checking"
          className={
            state.step === "checked" && ready.length > 0
              ? "bk-btn bk-btn-quiet"
              : "bk-btn"
          }
        >
          {state.step === "checked" ? "Check again" : "Check them"}
        </SubmitButton>
        {state.step === "checked" && ready.length > 0 ? (
          <SubmitButton name="intent" value="ship" pending="Marking shipped">
            {`Mark ${String(ready.length)} as shipped`}
          </SubmitButton>
        ) : null}
      </div>
      {state.step === "checked" && ready.length > 0 ? (
        <p className="bk-muted text-[0.9375rem] leading-snug">
          This tells each customer their order is on its way and cannot be
          undone.
        </p>
      ) : (
        <p className="bk-muted text-[0.9375rem] leading-snug">
          Checking changes nothing. It shows which orders these are before
          anything is marked shipped.
        </p>
      )}
    </form>
  );
}
