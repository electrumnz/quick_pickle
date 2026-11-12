import type { ReactNode } from "react";

import { Notice, Pill, type PillTone } from "@/components/backstage/ui";
import type { BatchStatus, PurchaseStatus } from "@/db/schema";
import { daysAwayText, formatDateKey } from "@/lib/backstage/stock/dates";
import {
  BATCH_STATUS_LABEL,
  PURCHASE_STATUS_LABEL,
} from "@/lib/backstage/stock/status";

/**
 * The small parts the Stock screens share. Server components, no state: the
 * forms post to the actions beside them and work with scripting off.
 */

/** "1,234". Nothing is always "0", never the "-0" a minus zero prints as. */
export function count(value: number): string {
  return (value === 0 ? 0 : value).toLocaleString("en-NZ");
}

/** "24 shots", "1 shot". */
export function shots(value: number): string {
  return `${count(value)} ${value === 1 ? "shot" : "shots"}`;
}

/**
 * Cents as the dollars a money box takes: 31250 is "312.50". Whole-number
 * arithmetic, so no amount is ever nudged by a float on its way to a form.
 */
export function dollars(cents: number | null): string {
  if (cents === null) return "";
  return `${String(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, "0")}`;
}

const BATCH_TONE: Readonly<Record<BatchStatus, PillTone>> = {
  planned: "plain",
  made: "doing",
  released: "done",
  closed: "off",
  recalled: "todo",
};

export function BatchStatusPill({ status }: { readonly status: BatchStatus }) {
  return <Pill tone={BATCH_TONE[status]}>{BATCH_STATUS_LABEL[status]}</Pill>;
}

const PURCHASE_TONE: Readonly<Record<PurchaseStatus, PillTone>> = {
  draft: "plain",
  sent: "doing",
  received: "done",
  cancelled: "off",
};

export function PurchaseStatusPill({
  status,
  overdue = false,
}: {
  readonly status: PurchaseStatus;
  readonly overdue?: boolean;
}) {
  return (
    <>
      <Pill tone={PURCHASE_TONE[status]}>{PURCHASE_STATUS_LABEL[status]}</Pill>
      {overdue ? <Pill tone="todo">Overdue</Pill> : null}
    </>
  );
}

/** A best-before date and how far off it is, in words. */
export function bestBeforeText(
  date: string | null,
  days: number | null,
): string {
  if (date === null || days === null) return "No best-before date";
  return `Best before ${formatDateKey(date)}, ${daysAwayText(days)}`;
}

/** Flags a batch that is past, or within a month of, its best-before date. */
export function BestBeforePill({
  days,
  within,
}: {
  readonly days: number | null;
  readonly within: number;
}) {
  if (days === null || days > within) return null;
  return days < 0 ? (
    <Pill tone="todo">Past best before</Pill>
  ) : (
    <Pill tone="doing">Best before soon</Pill>
  );
}

/** The line that says how a form went, good or bad. */
export function FormNotice({
  notice,
  tone,
}: {
  readonly notice?: string;
  readonly tone?: string;
}) {
  if (!notice) return null;
  return (
    <div className="mb-4">
      <Notice tone={tone === "bad" ? "bad" : "good"}>{notice}</Notice>
    </div>
  );
}

/** A quiet sentence under a field or a button. */
export function Hint({
  id,
  children,
}: {
  readonly id?: string;
  readonly children: ReactNode;
}) {
  return (
    <p id={id} className="bk-muted mt-1.5 text-[0.9375rem] leading-snug">
      {children}
    </p>
  );
}

type FieldProps = {
  /** A word for the form, so two forms on a page never share an id. */
  readonly form: string;
  readonly name: string;
  readonly label: string;
  readonly hint?: ReactNode;
  readonly defaultValue?: string | number | null;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly maxLength?: number;
};

/** A labelled text box. `kind` picks the keyboard a phone shows. */
export function Field({
  form,
  name,
  label,
  hint,
  defaultValue,
  required,
  placeholder,
  maxLength,
  kind = "text",
}: FieldProps & {
  readonly kind?: "text" | "count" | "money" | "date" | "email" | "tel" | "url";
}) {
  const id = `${form}-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const type =
    kind === "date"
      ? "date"
      : kind === "email"
        ? "email"
        : kind === "tel"
          ? "tel"
          : "text";
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={
          kind === "count"
            ? "numeric"
            : kind === "money"
              ? "decimal"
              : kind === "url"
                ? "url"
                : undefined
        }
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        autoCapitalize={kind === "email" || kind === "url" ? "none" : undefined}
        spellCheck={kind === "email" || kind === "url" ? false : undefined}
        aria-describedby={hintId}
        className="field"
      />
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
    </div>
  );
}

/** A labelled box for more than a line. */
export function TextArea({
  form,
  name,
  label,
  hint,
  defaultValue,
  required,
  placeholder,
  maxLength,
  rows = 3,
}: FieldProps & { readonly rows?: number }) {
  const id = `${form}-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-describedby={hintId}
        className="field"
      />
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
    </div>
  );
}

/** A labelled pick-one. */
export function Choice({
  form,
  name,
  label,
  hint,
  defaultValue,
  required,
  options,
}: Omit<FieldProps, "placeholder" | "maxLength"> & {
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}) {
  const id = `${form}-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        aria-describedby={hintId}
        className="field"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
    </div>
  );
}

/**
 * Something that stays folded away until it is wanted: a form that is not
 * the next step, or one that should not be pressed by a slip of the thumb.
 */
export function Fold({
  summary,
  warn = false,
  children,
}: {
  readonly summary: string;
  readonly warn?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <details>
      <summary
        className={`label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem] ${warn ? "text-pink-deep" : ""}`}
      >
        <span className="cap-trim">{summary}</span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/** What a viewer sees where the buttons would be. */
export function LookOnly() {
  return (
    <p className="bk-muted leading-snug">
      Your account can look but not change things.
    </p>
  );
}

/** A date written as a person would, or a dash of words when there is none. */
export function DateText({
  date,
  none = "Not set",
}: {
  readonly date: string | null;
  readonly none?: string;
}) {
  return date === null ? (
    <span className="bk-muted">{none}</span>
  ) : (
    <time dateTime={date}>{formatDateKey(date)}</time>
  );
}
