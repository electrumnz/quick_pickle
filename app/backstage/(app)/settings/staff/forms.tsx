"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/backstage/SubmitButton";

import {
  inviteAction,
  passwordLinkAction,
  properLoginAction,
  type InviteState,
  type ProperLoginState,
} from "./actions";

const EMPTY: InviteState = { error: null, fields: {}, values: {}, link: null };

/** A one-time link, shown once. The owner passes it on however they like. */
function OneTimeLink({
  link,
}: {
  readonly link: NonNullable<InviteState["link"]>;
}) {
  return (
    <div role="status" className="bk-notice mt-4">
      <p className="font-semibold">
        Send this link to {link.name}. It works once and lasts three days.
      </p>
      <label htmlFor="one-time-link" className="sr-only">
        One-time link
      </label>
      <input
        id="one-time-link"
        readOnly
        value={link.url}
        onFocus={(event) => event.currentTarget.select()}
        className="field mt-2 font-mono text-[0.875rem]"
      />
      <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
        It will not be shown again. If it gets lost, make a new one.
      </p>
    </div>
  );
}

export function InviteForm() {
  const [state, action] = useActionState(inviteAction, EMPTY);
  return (
    <div>
      <form
        action={action}
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1fr_1.3fr_auto_auto_auto] lg:items-end"
        noValidate
      >
        <div>
          <label htmlFor="invite-name" className="field-label">
            Name
          </label>
          <input
            id="invite-name"
            name="name"
            autoComplete="off"
            required
            defaultValue={state.values.name ?? ""}
            aria-invalid={state.fields.name ? true : undefined}
            className="field"
          />
          {state.fields.name ? (
            <p className="field-error">{state.fields.name}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="invite-email" className="field-label">
            Email
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            defaultValue={state.values.email ?? ""}
            aria-invalid={state.fields.email ? true : undefined}
            className="field"
          />
          {state.fields.email ? (
            <p className="field-error">{state.fields.email}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="invite-role" className="field-label">
            Role
          </label>
          <select
            id="invite-role"
            name="role"
            defaultValue={state.values.role ?? "staff"}
            className="field"
          >
            <option value="staff">Staff</option>
            <option value="viewer">Viewer</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div>
          <label htmlFor="invite-kind" className="field-label">
            Kind
          </label>
          <select
            id="invite-kind"
            name="kind"
            defaultValue={state.values.kind ?? "person"}
            className="field"
          >
            <option value="person">Person</option>
            <option value="bot">Bot</option>
          </select>
        </div>
        <SubmitButton pending="Inviting">Invite</SubmitButton>
      </form>
      {state.error ? (
        <p role="alert" className="bk-notice bk-notice-bad mt-4">
          {state.error}
        </p>
      ) : null}
      {state.link ? <OneTimeLink link={state.link} /> : null}
    </div>
  );
}

export function PasswordLinkForm({
  id,
  name,
}: {
  readonly id: string;
  readonly name: string;
}) {
  const [state, action] = useActionState(passwordLinkAction, EMPTY);
  return (
    <div>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="name" value={name} />
        <SubmitButton pending="Making link" className="bk-btn bk-btn-quiet">
          New password link
        </SubmitButton>
      </form>
      {state.error ? (
        <p role="alert" className="bk-notice bk-notice-bad mt-3">
          {state.error}
        </p>
      ) : null}
      {state.link ? <OneTimeLink link={state.link} /> : null}
    </div>
  );
}

const NO_LOGIN_YET: ProperLoginState = { error: null, fields: {}, values: {} };

/** For whoever came in with the PIN: an email and a password of their own. */
export function ProperLoginForm() {
  const [state, action] = useActionState(properLoginAction, NO_LOGIN_YET);
  return (
    <form
      action={action}
      className="flex max-w-[26rem] flex-col gap-4"
      noValidate
    >
      <div>
        <label htmlFor="proper-code" className="field-label">
          Set-up code
        </label>
        <input
          id="proper-code"
          name="code"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
          aria-invalid={state.fields.code ? true : undefined}
          aria-describedby={
            state.fields.code ? "proper-code-error" : "proper-code-hint"
          }
          className="field"
        />
        {state.fields.code ? (
          <p id="proper-code-error" className="field-error">
            {state.fields.code}
          </p>
        ) : (
          <p
            id="proper-code-hint"
            className="bk-muted mt-1.5 text-[0.9375rem] leading-snug"
          >
            The phrase saved as BACKSTAGE_SETUP_CODE where the site is hosted.
          </p>
        )}
      </div>
      <div>
        <label htmlFor="proper-email" className="field-label">
          Your email
        </label>
        <input
          id="proper-email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.values.email ?? ""}
          aria-invalid={state.fields.email ? true : undefined}
          aria-describedby={
            state.fields.email ? "proper-email-error" : undefined
          }
          className="field"
        />
        {state.fields.email ? (
          <p id="proper-email-error" className="field-error">
            {state.fields.email}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor="proper-password" className="field-label">
          Choose a password
        </label>
        <input
          id="proper-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-invalid={state.fields.password ? true : undefined}
          aria-describedby={
            state.fields.password
              ? "proper-password-error"
              : "proper-password-hint"
          }
          className="field"
        />
        {state.fields.password ? (
          <p id="proper-password-error" className="field-error">
            {state.fields.password}
          </p>
        ) : (
          <p
            id="proper-password-hint"
            className="bk-muted mt-1.5 text-[0.9375rem] leading-snug"
          >
            At least 12 characters. A few words run together works well.
          </p>
        )}
      </div>
      {state.error ? (
        <p role="alert" className="bk-notice bk-notice-bad">
          {state.error}
        </p>
      ) : null}
      <div>
        <SubmitButton pending="Saving">Make it my login</SubmitButton>
      </div>
    </form>
  );
}
