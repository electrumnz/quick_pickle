import type { ReactNode } from "react";

/**
 * The form furniture this area needs, and nothing else.
 *
 * The admin's shared primitives cover reading — cards, rows, stats, badges —
 * because until now nothing in it could change anything. This is the first
 * area that has to accept typing, so the inputs are here rather than pushed
 * into `components/admin/ui`, which other units are working in right now.
 *
 * Same rules as everything else on screen: semantic tokens only, never a
 * pigment name, never a hex. `surface-accent` with `text-on-accent` is the one
 * sanctioned pairing for a primary button, and `border-strong` is the one that
 * is allowed to carry meaning on an input's edge.
 */

const INPUT =
  "block w-full rounded-md border border-strong bg-surface-raised px-3 py-2 text-body-sm text-primary placeholder:text-muted";

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  /** The sentence that says why this field matters. Not a tooltip. */
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-caption font-medium text-primary"
      >
        {label}
      </label>
      {hint !== undefined && <p className="text-caption text-muted">{hint}</p>}
      {children}
    </div>
  );
}

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { id: string },
) {
  const { className = "", ...rest } = props;
  return <input {...rest} className={`${INPUT} ${className}`} />;
}

export function TextArea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { id: string },
) {
  const { className = "", rows = 3, ...rest } = props;
  return <textarea {...rest} rows={rows} className={`${INPUT} ${className}`} />;
}

export function Select({
  id,
  name,
  value,
  defaultValue,
  options,
  onChange,
}: {
  id: string;
  name: string;
  value?: string;
  defaultValue?: string;
  options: readonly { readonly value: string; readonly label: string }[];
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
}) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      className={INPUT}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  id,
  name,
  label,
  hint,
  defaultChecked,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <div className="flex gap-2.5">
      <input
        type="checkbox"
        id={id}
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 rounded-sm border border-strong"
      />
      <label htmlFor={id} className="text-body-sm text-primary">
        {label}
        {hint !== undefined && (
          <span className="mt-0.5 block text-caption text-muted">{hint}</span>
        )}
      </label>
    </div>
  );
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-body-sm font-medium";

export function PrimaryButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`${BUTTON_BASE} border border-accent-edge bg-surface-accent text-on-accent`}
    >
      {children}
    </button>
  );
}

export function QuietButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`${BUTTON_BASE} border border-strong bg-surface-raised text-primary`}
    >
      {children}
    </button>
  );
}

export function DangerButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`${BUTTON_BASE} border border-danger/40 bg-surface-raised text-danger`}
    >
      {children}
    </button>
  );
}
