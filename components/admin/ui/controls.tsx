import type { ReactNode } from "react";

import { ADMIN_CSRF_FIELD_NAME } from "@/lib/auth/server";

/**
 * The controls that change something.
 *
 * Every other file in `components/admin/ui` draws things she reads. This one
 * draws the things she presses, and it exists for the same reason `primitives`
 * does: nine screens that each invented their own button would teach her nine
 * products. There is one button here, one field, one way of asking "are you
 * sure", and every write in the admin is made of them.
 *
 * Three rules, all of them load-bearing:
 *
 *  - **No JavaScript is required for any of it.** These are plain forms posting
 *    to server actions. A `confirm()` dialog would be a script; a `<details>`
 *    that has to be opened before the button is reachable is not, and it can
 *    hold a paragraph saying exactly what the button will do, which a dialog
 *    cannot.
 *  - **Every form carries the session's CSRF token**, through
 *    {@link FormFields}, so no form can be posted from another site.
 *  - **Semantic tokens only.** No pigment names, no hex.
 */

/**
 * The hidden half of every admin form: the CSRF token, and where to come back
 * to.
 *
 * `back` is checked server-side against a path inside the admin, so it cannot
 * be turned into an open redirect by editing the markup.
 */
export function FormFields({
  csrfToken,
  back,
  values,
}: {
  csrfToken: string;
  back?: string;
  /** Anything else the action needs: an id, an intent, a slug. */
  values?: Readonly<Record<string, string>>;
}) {
  return (
    <>
      <input
        type="hidden"
        name={ADMIN_CSRF_FIELD_NAME}
        value={csrfToken}
        readOnly
      />
      {back !== undefined && (
        <input type="hidden" name="back" value={back} readOnly />
      )}
      {Object.entries(values ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} readOnly />
      ))}
    </>
  );
}

type ButtonTone = "primary" | "quiet" | "danger";

const BUTTON_TONES: Record<ButtonTone, string> = {
  primary:
    "border-accent-edge bg-surface-accent text-on-accent hover:bg-surface-accent/80",
  quiet:
    "border-hairline bg-surface-raised text-primary hover:bg-surface-sunken",
  danger: "border-danger/50 bg-danger/10 text-danger hover:bg-danger/20",
};

/** The one button. It submits a form; it never navigates. */
export function SubmitButton({
  children,
  tone = "quiet",
  name,
  value,
  form,
  full = false,
}: {
  children: ReactNode;
  tone?: ButtonTone;
  name?: string;
  value?: string;
  /** Associates the button with a form declared elsewhere on the page. */
  form?: string;
  full?: boolean;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      form={form}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current sm:min-h-0 sm:py-1 ${
        full ? "w-full" : ""
      } ${BUTTON_TONES[tone]}`}
    >
      {children}
    </button>
  );
}

/** A label and the thing it labels, stacked. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={htmlFor} className="block text-caption text-muted">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint !== undefined && (
        <p className="mt-1 text-caption text-muted">{hint}</p>
      )}
    </div>
  );
}

const CONTROL =
  "block w-full min-h-11 rounded-md border border-hairline bg-surface-page px-2.5 py-1.5 text-body-sm text-primary placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current sm:min-h-0";

export function TextInput({
  id,
  name,
  defaultValue,
  placeholder,
  required = false,
  inputMode,
  pattern,
  maxLength,
  type = "text",
  min,
  max,
  step,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: "text" | "numeric" | "decimal";
  pattern?: string;
  maxLength?: number;
  type?: "text" | "date" | "datetime-local" | "number";
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <input
      id={id}
      name={name}
      type={type}
      defaultValue={defaultValue}
      placeholder={placeholder}
      required={required}
      inputMode={inputMode}
      pattern={pattern}
      maxLength={maxLength}
      min={min}
      max={max}
      step={step}
      className={CONTROL}
    />
  );
}

export function Select({
  id,
  name,
  options,
  defaultValue,
  required = false,
}: {
  id: string;
  name: string;
  options: readonly { readonly value: string; readonly label: string }[];
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      required={required}
      className={CONTROL}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Textarea({
  id,
  name,
  defaultValue,
  placeholder,
  rows = 3,
  required = false,
  maxLength,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <textarea
      id={id}
      name={name}
      rows={rows}
      defaultValue={defaultValue}
      placeholder={placeholder}
      required={required}
      maxLength={maxLength}
      className={`${CONTROL} min-h-24 resize-y`}
    />
  );
}

/** A checkbox with its wording beside it. */
export function Checkbox({
  id,
  name,
  label,
  hint,
  defaultChecked = false,
  form,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  form?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        name={name}
        form={form}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
      />
      <label htmlFor={id} className="min-w-0 text-caption text-primary">
        {label}
        {hint !== undefined && (
          <span className="mt-0.5 block text-muted">{hint}</span>
        )}
      </label>
    </div>
  );
}

/**
 * A fold that has to be opened before anything can be pressed.
 *
 * This is how every form in the admin that is not a single safe click is
 * drawn: the summary says what it is, and the panel underneath holds the
 * fields and the button. Nothing is armed until she has opened it, and the
 * page is not covered in inputs she did not ask for.
 */
export function Disclosure({
  label,
  children,
  tone = "quiet",
  id,
}: {
  label: string;
  children: ReactNode;
  tone?: "quiet" | "danger";
  id?: string;
}) {
  return (
    <details id={id} className="group min-w-0">
      <summary
        className={`inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 py-1.5 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current sm:min-h-0 sm:py-1 ${
          tone === "danger"
            ? "border-danger/50 text-danger hover:bg-danger/10"
            : "border-hairline text-primary hover:bg-surface-sunken"
        }`}
      >
        <span
          aria-hidden="true"
          className="transition-transform group-open:rotate-90"
        >
          &#8250;
        </span>
        {label}
      </summary>
      <div className="mt-2.5 rounded-md border border-hairline bg-surface-sunken px-3 py-3">
        {children}
      </div>
    </details>
  );
}

/**
 * "This is what will happen, and it cannot be taken back."
 *
 * A refund and a cancellation are not undoable, so neither is reachable in one
 * click. `consequence` is written as a sentence about her business — "Dana
 * Whitiora will be told her order is cancelled and the four bottles go back on
 * the shelf" — rather than as a warning about a database row.
 */
export function Confirm({
  label,
  consequence,
  children,
}: {
  /** The words on the fold, e.g. "Cancel this order". */
  label: string;
  /** Exactly what pressing the button will do, in plain words. */
  consequence: ReactNode;
  /** The fields and the submit button. */
  children: ReactNode;
}) {
  return (
    <Disclosure label={label} tone="danger">
      <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5">
        <p className="text-caption font-semibold text-danger">
          This cannot be undone
        </p>
        <div className="mt-1 text-caption text-primary">{consequence}</div>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </Disclosure>
  );
}
