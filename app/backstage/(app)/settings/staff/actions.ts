"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  inviteStaff,
  resetStaffPassword,
  updateStaff,
} from "@/lib/backstage/staff/ops";
import { withNotice } from "@/lib/backstage/ui/notice";

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
