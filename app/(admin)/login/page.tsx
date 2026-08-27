import type { Metadata } from "next";

import {
  CSRF_FIELD_NAME,
  LOGIN_SUBMIT_PATH,
  PASSWORD_FIELD_NAME,
  RETURN_TO_PARAM,
} from "@/lib/auth/config";
import { challengeFieldsFor } from "@/lib/auth/factors/render";
import { REGISTERED_FACTORS } from "@/lib/auth/factors/registry";
import type { FactorField } from "@/lib/auth/factors/types";
import { GENERIC_LOGIN_FAILURE_MESSAGE } from "@/lib/auth/errors";
import {
  LOGIN_CHALLENGE_PARAM,
  LOGIN_ERROR_PARAM,
} from "@/lib/auth/http/login-handler";
import { safeReturnPath } from "@/lib/auth/http/redirects";
import { sessionDependencies } from "@/lib/auth/runtime";
import { getLoginCsrfToken } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false, nocache: true },
};

/** Reading a per-request header means this page can never be cached. */
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

/**
 * The admin sign-in page.
 *
 * One field. No username, no email, no "forgot your password", no account
 * chooser — the founder asked for a single secret on the front door and there
 * is nothing else here to type. That absence is also a security property: with
 * no identifier to submit there is no user enumeration surface to leak, and
 * every failure is the same failure.
 *
 * The form is a plain `<form method="post">`. It works with JavaScript
 * disabled, and it carries the CSRF token the proxy minted alongside the sealed
 * cookie it must match.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const failed = firstValue(params[LOGIN_ERROR_PARAM]) !== null;
  const returnTo = safeReturnPath(firstValue(params[RETURN_TO_PARAM]));
  const csrfToken = await getLoginCsrfToken();

  const challenge = await resolveChallenge(
    firstValue(params[LOGIN_CHALLENGE_PARAM]),
  );

  const action = `${LOGIN_SUBMIT_PATH}?${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`;

  return (
    <section className="mx-auto w-full max-w-sm space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Staff sign in</h1>
        <p className="text-sm opacity-70">
          Half Sour operations. Authorised access only.
        </p>
      </header>

      <form method="post" action={action} className="space-y-5">
        <input
          type="hidden"
          name={CSRF_FIELD_NAME}
          value={csrfToken ?? ""}
          readOnly
        />

        <div className="space-y-2">
          <label htmlFor="admin-password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="admin-password"
            name={PASSWORD_FIELD_NAME}
            type="password"
            required
            autoComplete="current-password"
            autoFocus
            aria-describedby={failed ? "admin-signin-error" : undefined}
            aria-invalid={failed ? true : undefined}
            className="w-full rounded-md border border-black/20 bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 dark:border-white/25"
          />
        </div>

        {challenge === null ? null : (
          <fieldset className="space-y-4 border-t border-black/10 pt-5 dark:border-white/15">
            <legend className="text-sm opacity-70">{challenge.prompt}</legend>
            {challenge.fields.map((field) => (
              <ChallengeField key={field.name} field={field} />
            ))}
          </fieldset>
        )}

        {/*
          One message for every failure — wrong password, locked out, stale
          token, all of it. The reason lives in `audit_log`, where the founder
          can read it and an attacker cannot. The second sentence is constant,
          so it tells her the rule without telling anyone the current state.
        */}
        <p
          id="admin-signin-error"
          role="alert"
          aria-live="polite"
          className={failed ? "text-sm font-medium" : "sr-only"}
        >
          {failed ? GENERIC_LOGIN_FAILURE_MESSAGE : ""}
        </p>

        <button
          type="submit"
          className="w-full rounded-md border border-current px-4 py-2 text-sm font-semibold tracking-wide uppercase outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2"
        >
          Sign in
        </button>
      </form>
    </section>
  );
}

function ChallengeField({ field }: { field: FactorField }) {
  const inputId = `factor-${field.name}`;
  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {field.label}
      </label>
      <input
        id={inputId}
        name={field.name}
        type={field.type === "password" ? "password" : "text"}
        inputMode={field.type === "otp" ? "numeric" : undefined}
        autoComplete={field.autoComplete ?? "off"}
        maxLength={field.maxLength}
        required
        className="w-full rounded-md border border-black/20 bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 dark:border-white/25"
      />
    </div>
  );
}

/**
 * Ask the named factor what it wants, if it is registered and enrolled.
 *
 * Dead code today by design: the only registered factor is enrolled for nobody.
 * It is here so that the first real factor needs no page change at all.
 */
async function resolveChallenge(factorId: string | null) {
  if (factorId === null) return null;
  try {
    const deps = sessionDependencies();
    const now = deps.clock.now();
    const operator = await deps.store.ensureOwnerOperator({
      email: process.env.ADMIN_OPERATOR_EMAIL ?? "owner@halfsour.co.nz",
      fullName: process.env.ADMIN_OPERATOR_NAME ?? "Half Sour Owner",
      now,
    });
    return await challengeFieldsFor(REGISTERED_FACTORS, factorId, {
      operator: { id: operator.id, email: operator.email },
      submitted: new Map(),
      ipAddress: null,
      userAgent: null,
      requestId: "login-page",
      now,
    });
  } catch {
    // A factor that cannot describe itself must not take the login page down.
    return null;
  }
}
