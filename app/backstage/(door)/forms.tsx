"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/backstage/SubmitButton";

import {
  choosePasswordAction,
  setUpAction,
  signInAction,
  type DoorState,
} from "./actions";

const EMPTY: DoorState = { error: null, fields: {}, values: {} };

function Field({
  id,
  label,
  type = "text",
  autoComplete,
  state,
  hint,
  defaultValue,
  minLength,
}: {
  readonly id: string;
  readonly label: string;
  readonly type?: string;
  readonly autoComplete: string;
  readonly state: DoorState;
  readonly hint?: string;
  readonly defaultValue?: string;
  readonly minLength?: number;
}) {
  const error = state.fields[id];
  const describedBy =
    [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        autoCapitalize={type === "email" ? "none" : undefined}
        spellCheck={false}
        required
        minLength={minLength}
        defaultValue={defaultValue ?? state.values[id] ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="field"
      />
      {hint ? (
        <p
          id={`${id}-hint`}
          className="bk-muted mt-1.5 text-[0.9375rem] leading-snug"
        >
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FormError({ state }: { readonly state: DoorState }) {
  if (state.error === null) return null;
  return (
    <p role="alert" className="bk-notice bk-notice-bad">
      {state.error}
    </p>
  );
}

export function SignInForm({ next }: { readonly next: string }) {
  const [state, action] = useActionState(signInAction, EMPTY);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={state.values.next ?? next} />
      <FormError state={state} />
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="username"
        state={state}
      />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        state={state}
      />
      <SubmitButton pending="Signing in" className="btn btn-block mt-1">
        Sign in
      </SubmitButton>
    </form>
  );
}

export function SetUpForm() {
  const [state, action] = useActionState(setUpAction, EMPTY);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError state={state} />
      <Field
        id="code"
        label="Set-up code"
        type="password"
        autoComplete="off"
        state={state}
        hint="The phrase saved as BACKSTAGE_SETUP_CODE where the site is hosted."
      />
      <Field id="name" label="Your name" autoComplete="name" state={state} />
      <Field
        id="email"
        label="Your email"
        type="email"
        autoComplete="username"
        state={state}
      />
      <Field
        id="password"
        label="Choose a password"
        type="password"
        autoComplete="new-password"
        state={state}
        minLength={12}
        hint="At least 12 characters. A few words run together works well."
      />
      <SubmitButton pending="Setting up" className="btn btn-block mt-1">
        Create my login
      </SubmitButton>
    </form>
  );
}

export function ChoosePasswordForm({ token }: { readonly token: string }) {
  const [state, action] = useActionState(choosePasswordAction, EMPTY);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="token" value={state.values.token ?? token} />
      <FormError state={state} />
      <Field
        id="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        state={state}
        minLength={12}
        hint="At least 12 characters. A few words run together works well."
      />
      <Field
        id="again"
        label="And once more"
        type="password"
        autoComplete="new-password"
        state={state}
      />
      <SubmitButton pending="Saving" className="btn btn-block mt-1">
        Save and sign in
      </SubmitButton>
    </form>
  );
}
