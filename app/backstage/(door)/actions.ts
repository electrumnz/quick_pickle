"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  currentStaff,
  requestIp,
  requestIsSecure,
  requestUserAgent,
  staffCookieName,
} from "@/lib/backstage/auth/current";
import { revokeSession } from "@/lib/backstage/auth/sessions";
import { signIn } from "@/lib/backstage/auth/sign-in";
import { lockedUntil, recordFailure } from "@/lib/backstage/auth/throttle";
import { sameSecret } from "@/lib/backstage/auth/tokens";
import { systemCaller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { backstageMode } from "@/lib/backstage/mode";
import {
  countUsers,
  createFirstOwner,
  setPasswordWithToken,
} from "@/lib/backstage/staff/ops";
import { getDb } from "@/lib/db/client";
import { formatNzTime } from "@/lib/time";

export type DoorState = {
  readonly error: string | null;
  readonly fields: Readonly<Record<string, string>>;
  /** What was typed, handed back so a failed try loses nothing but the password. */
  readonly values: Readonly<Record<string, string>>;
};

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/** Only ever send someone on to a page inside the back end. */
function safeNext(next: string): string {
  return next.startsWith("/backstage") &&
    !next.startsWith("//") &&
    !next.includes("\\")
    ? next
    : "/backstage";
}

/** Every answer takes at least this long, right or wrong. */
async function atLeast(startedAt: number, ms = 450): Promise<void> {
  const left = ms - (Date.now() - startedAt);
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
}

async function setStaffCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(await staffCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await requestIsSecure(),
    path: "/",
    expires: expiresAt,
  });
}

const WRONG = "That email and password don't match an account.";

export async function signInAction(
  _previous: DoorState,
  form: FormData,
): Promise<DoorState> {
  const startedAt = Date.now();
  const email = text(form, "email");
  const password = text(form, "password");
  const next = safeNext(text(form, "next"));
  const values = { email, next };

  if (backstageMode() === "demo") redirect(next);

  if (email.trim() === "" || password === "") {
    await atLeast(startedAt);
    return {
      error: null,
      fields: {
        ...(email.trim() === "" ? { email: "Your email is needed" } : {}),
        ...(password === "" ? { password: "Your password is needed" } : {}),
      },
      values,
    };
  }

  let result;
  try {
    result = await signIn(
      await getDb(),
      {
        email,
        password,
        ip: await requestIp(),
        userAgent: await requestUserAgent(),
      },
      new Date(),
    );
  } catch {
    await atLeast(startedAt);
    return {
      error: "Something went wrong on our side. Give it another go.",
      fields: {},
      values,
    };
  }

  await atLeast(startedAt);

  if (!result.ok) {
    return {
      error:
        result.reason === "locked"
          ? `Too many wrong tries. Have another go after ${formatNzTime(result.until)}.`
          : WRONG,
      fields: {},
      values,
    };
  }

  await setStaffCookie(result.token, result.expiresAt);
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const name = await staffCookieName();
  const token = jar.get(name)?.value;
  if (token !== undefined && backstageMode() === "live") {
    await revokeSession(await getDb(), token, new Date());
  }
  jar.delete(name);
  redirect("/backstage/sign-in");
}

/**
 * First-time set-up. Works only while there are no accounts, and only with
 * the code from BACKSTAGE_SETUP_CODE, which whoever deploys the site sets.
 */
export async function setUpAction(
  _previous: DoorState,
  form: FormData,
): Promise<DoorState> {
  const startedAt = Date.now();
  const values = {
    name: text(form, "name"),
    email: text(form, "email"),
  };
  const code = text(form, "code");
  const password = text(form, "password");

  const db = await getDb();
  const expected = (process.env.BACKSTAGE_SETUP_CODE ?? "").trim();
  if (backstageMode() === "demo" || (await countUsers(db)) > 0) {
    redirect("/backstage/sign-in");
  }
  if (expected.length < 16) {
    await atLeast(startedAt);
    return {
      error:
        "Set-up is switched off. BACKSTAGE_SETUP_CODE needs to be set (16 characters or more) where the site is hosted.",
      fields: {},
      values,
    };
  }

  const ip = await requestIp();
  const keys = ["email:__setup__", ...(ip === null ? [] : [`ip:${ip}`])];
  const now = new Date();
  const until = await lockedUntil(db, keys, now);
  if (until !== null) {
    await atLeast(startedAt);
    return {
      error: `Too many wrong tries. Have another go after ${formatNzTime(until)}.`,
      fields: {},
      values,
    };
  }
  if (!sameSecret(code.trim(), expected)) {
    await recordFailure(db, keys, now);
    await atLeast(startedAt);
    return {
      error: null,
      fields: { code: "That is not the set-up code" },
      values,
    };
  }

  try {
    await execute(
      createFirstOwner,
      { name: values.name, email: values.email, password },
      systemCaller("Set-up", "ui"),
    );
  } catch (error) {
    await atLeast(startedAt);
    if (error instanceof OpError) {
      // A problem with one field is said once, beside that field.
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
    db,
    {
      email: values.email,
      password,
      ip,
      userAgent: await requestUserAgent(),
    },
    new Date(),
  );
  await atLeast(startedAt);
  if (session.ok) await setStaffCookie(session.token, session.expiresAt);
  redirect(session.ok ? "/backstage" : "/backstage/sign-in");
}

/** Choose a password from a one-time link (an invitation, or a reset). */
export async function choosePasswordAction(
  _previous: DoorState,
  form: FormData,
): Promise<DoorState> {
  const startedAt = Date.now();
  const token = text(form, "token");
  const password = text(form, "password");
  const again = text(form, "again");
  const values = { token };

  if (password !== again) {
    await atLeast(startedAt);
    return {
      error: null,
      fields: { again: "Those two don't match" },
      values,
    };
  }

  let email: string;
  try {
    const done = await execute(
      setPasswordWithToken,
      { token, password },
      systemCaller("One-time link", "ui"),
    );
    email = done.email;
  } catch (error) {
    await atLeast(startedAt);
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

  // Straight in: they have just proved who they are and chosen the password.
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
  await atLeast(startedAt);
  if (session.ok) await setStaffCookie(session.token, session.expiresAt);
  redirect(session.ok ? "/backstage" : "/backstage/sign-in");
}

/** For pages that should bounce someone who is already signed in. */
export async function alreadySignedIn(): Promise<boolean> {
  return (await currentStaff()) !== null;
}
