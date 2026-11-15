"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  requestIp,
  requestIsSecure,
  requestUserAgent,
  staffCaller,
  staffCookieName,
} from "@/lib/backstage/auth/current";
import { signIn } from "@/lib/backstage/auth/sign-in";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  inviteStaff,
  makeProperLogin,
  resetStaffPassword,
  updateStaff,
} from "@/lib/backstage/staff/ops";
import { withNotice } from "@/lib/backstage/ui/notice";
import { getDb } from "@/lib/db/client";

export type InviteState = {
  readonly error: string | null;
  readonly fields: Readonly<Record<string, string>>;
  readonly values: Readonly<Record<string, string>>;
  /** The one-time link, shown once, for the owner to pass on. */
  readonly link: { readonly name: string; readonly url: string } | null;
};

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function origin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost";
  const proto =
    list.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function linkFor(token: string): Promise<string> {
  return `${await origin()}/backstage/password?token=${encodeURIComponent(token)}`;
}

export async function inviteAction(
  _previous: InviteState,
  form: FormData,
): Promise<InviteState> {
  const values = {
    name: text(form, "name"),
    email: text(form, "email"),
    role: text(form, "role"),
    kind: text(form, "kind"),
  };
  try {
    const invited = await execute(
      inviteStaff,
      {
        name: values.name,
        email: values.email,
        role: values.role as "owner" | "staff" | "viewer",
        kind: values.kind === "bot" ? "bot" : "person",
      },
      await staffCaller(),
    );
    return {
      error: null,
      fields: {},
      values: {},
      link: { name: values.name, url: await linkFor(invited.token) },
    };
  } catch (error) {
    if (error instanceof OpError) {
      const hasFields = Object.keys(error.fields).length > 0;
      return {
        error: hasFields ? null : error.message,
        fields: error.fields,
        values,
        link: null,
      };
    }
    return {
      error: "Something went wrong on our side. Give it another go.",
      fields: {},
      values,
      link: null,
    };
  }
}

export async function passwordLinkAction(
  _previous: InviteState,
  form: FormData,
): Promise<InviteState> {
  const name = text(form, "name");
  try {
    const made = await execute(
      resetStaffPassword,
      { id: text(form, "id") },
      await staffCaller(),
    );
    return {
      error: null,
      fields: {},
      values: {},
      link: { name, url: await linkFor(made.token) },
    };
  } catch (error) {
    return {
      error:
        error instanceof OpError
          ? error.message
          : "Something went wrong on our side. Give it another go.",
      fields: {},
      values: {},
      link: null,
    };
  }
}

export type ProperLoginState = {
  readonly error: string | null;
  readonly fields: Readonly<Record<string, string>>;
  /** What was typed, handed back. Never the password. */
  readonly values: Readonly<Record<string, string>>;
};

/**
 * Whoever came in with the PIN gives themselves an email and a password.
 * The PIN stops working and every browser it had signed in is signed out,
 * this one included, so it is signed straight back in the new way.
 */
export async function properLoginAction(
  _previous: ProperLoginState,
  form: FormData,
): Promise<ProperLoginState> {
  const values = { email: text(form, "email") };
  const password = text(form, "password");

  let email: string;
  try {
    const done = await execute(
      makeProperLogin,
      { email: values.email, password },
      await staffCaller(),
    );
    email = done.email;
  } catch (error) {
    if (error instanceof OpError) {
      const hasFields = Object.keys(error.fields).length > 0;
      return {
        error: hasFields ? null : error.message,
        fields: error.fields,
        values,
      };
    }
    return {
      error: "Something went wrong on our side. Give it another go.",
      fields: {},
      values,
    };
  }

  const session = await signIn(
    await getDb(),
    {
      email,
      password,
      ip: await requestIp(),
      userAgent: await requestUserAgent(),
    },
    new Date(),
  );
  if (!session.ok) redirect("/backstage/sign-in");
  const jar = await cookies();
  jar.set(await staffCookieName(), session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await requestIsSecure(),
    path: "/",
    expires: session.expiresAt,
  });
  redirect(
    withNotice(
      "/backstage/settings/staff",
      "Done. From now on you sign in with your email and password, and the PIN no longer works.",
      "good",
    ),
  );
}

/** Role and on/off changes: a plain form post, then back to the list. */
export async function updateStaffAction(form: FormData): Promise<void> {
  const role = text(form, "role");
  const disabled = text(form, "disabled");
  let notice = "Saved.";
  let tone: "good" | "bad" = "good";
  try {
    await execute(
      updateStaff,
      {
        id: text(form, "id"),
        role:
          role === "owner" || role === "staff" || role === "viewer"
            ? role
            : undefined,
        disabled:
          disabled === "true" ? true : disabled === "false" ? false : undefined,
      },
      await staffCaller(),
    );
  } catch (error) {
    notice =
      error instanceof OpError
        ? error.message
        : "Something went wrong on our side. Give it another go.";
    tone = "bad";
  }
  redirect(withNotice("/backstage/settings/staff", notice, tone));
}
