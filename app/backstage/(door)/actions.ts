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
import { safeNext } from "@/lib/backstage/auth/next";
import { revokeSession } from "@/lib/backstage/auth/sessions";
import {
  lockEnds,
  setUpCodeRefused,
  type Refusal,
} from "@/lib/backstage/auth/set-up-code";
import {
  signIn,
  signInProven,
  signInWithPin,
} from "@/lib/backstage/auth/sign-in";
import { systemCaller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { backstageMode } from "@/lib/backstage/mode";
import {
  countUsers,
  createFirstOwner,
  createPinOwner,
  pinDoor,
  setNewPin,
  setPasswordWithToken,
} from "@/lib/backstage/staff/ops";
import { withNotice } from "@/lib/backstage/ui/notice";
import { getDb } from "@/lib/db/client";

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
const WRONG_PIN = "That PIN isn't right.";
const OUR_FAULT = "Something went wrong on our side. Give it another go.";

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
    return { error: OUR_FAULT, fields: {}, values };
  }

  await atLeast(startedAt);

  if (!result.ok) {
    return {
      error:
        result.reason === "locked"
          ? `Too many wrong tries. Have another go after ${lockEnds(result.until)}.`
          : WRONG,
      fields: {},
      values,
    };
  }

  await setStaffCookie(result.token, result.expiresAt);
  redirect(next);
}

/** Signing in with the PIN, while the door is a PIN door. */
export async function pinSignInAction(
  _previous: DoorState,
  form: FormData,
): Promise<DoorState> {
  const startedAt = Date.now();
  const pin = text(form, "pin");
  const next = safeNext(text(form, "next"));
  // The PIN is never handed back, right or wrong.
  const values = { next };

  if (backstageMode() === "demo") redirect(next);

  if (pin.trim() === "") {
    await atLeast(startedAt);
    return { error: null, fields: { pin: "The PIN is needed" }, values };
  }

  let result;
  try {
    result = await signInWithPin(
      await getDb(),
      {
        pin,
        ip: await requestIp(),
        userAgent: await requestUserAgent(),
      },
      new Date(),
    );
  } catch {
    await atLeast(startedAt);
    return { error: OUR_FAULT, fields: {}, values };
  }

  await atLeast(startedAt);

  if (!result.ok) {
    return {
      error:
        result.reason === "locked"
          ? `Too many wrong tries. Have another go after ${lockEnds(result.until)}, or set a new PIN with the set-up code.`
          : WRONG_PIN,
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

/** What a form shows when an operation said no. */
function saidBy(error: unknown): Refusal {
  if (error instanceof OpError) {
    // A problem with one field is said once, beside that field.
    const hasFields = Object.keys(error.fields).length > 0;
    return { error: hasFields ? null : error.message, fields: error.fields };
  }
  return { error: OUR_FAULT, fields: {} };
}

/**
 * First-time set-up with a PIN: the door for now (lib/backstage/auth/pin.ts).
 * Works only while there are no accounts, and only with the set-up code.
 */
export async function setUpPinAction(
  _previous: DoorState,
  form: FormData,
): Promise<DoorState> {
  const startedAt = Date.now();
  const values = { name: text(form, "name") };
  const code = text(form, "code");
  const pin = text(form, "pin").trim();
  const again = text(form, "again").trim();

  const db = await getDb();
  if (backstageMode() === "demo" || (await countUsers(db)) > 0) {
    redirect("/backstage/sign-in");
  }

  const ip = await requestIp();
  const refused = await setUpCodeRefused(db, code, ip);
  if (refused !== null) {
    await atLeast(startedAt);
    return { ...refused, values };
  }
  if (pin !== again) {
    await atLeast(startedAt);
    return { error: null, fields: { again: "Those two don't match" }, values };
  }

  let made;
  try {
    made = await execute(
      createPinOwner,
      { name: values.name, pin },
      systemCaller("Set-up", "ui"),
    );
  } catch (error) {
    await atLeast(startedAt);
    return { ...saidBy(error), values };
  }

  // Straight in, on the strength of the set-up code. Not by way of the PIN
  // door: its counter is anybody's to run up.
  const session = await signInProven(
    db,
    made.id,
    { ip, userAgent: await requestUserAgent() },
    new Date(),
  );
  await atLeast(startedAt);
  if (session.ok) await setStaffCookie(session.token, session.expiresAt);
  redirect(session.ok ? "/backstage" : "/backstage/sign-in");
}

/**
 * A new PIN, for when the old one is forgotten or the door has been locked
 * by wrong tries. The set-up code is the proof: whoever is asking is not
 * signed in. Works only while a login comes in with a PIN.
 */
export async function newPinAction(
  _previous: DoorState,
  form: FormData,
): Promise<DoorState> {
  const startedAt = Date.now();
  const values = {};
  const code = text(form, "code");
  const pin = text(form, "pin").trim();
  const again = text(form, "again").trim();

  const db = await getDb();
  if (backstageMode() === "demo" || (await pinDoor(db)) === null) {
    redirect("/backstage/sign-in");
  }

  const ip = await requestIp();
  const refused = await setUpCodeRefused(db, code, ip);
  if (refused !== null) {
    await atLeast(startedAt);
    return { ...refused, values };
  }
  if (pin !== again) {
    await atLeast(startedAt);
    return { error: null, fields: { again: "Those two don't match" }, values };
  }

  let done;
  try {
    done = await execute(setNewPin, { pin }, systemCaller("Set-up", "ui"));
  } catch (error) {
    await atLeast(startedAt);
    return { ...saidBy(error), values };
  }

  // Straight in, on the strength of the set-up code. If this went by way
  // of the PIN door, a flood of wrong PINs could fill its counter again in
  // the instant after the new PIN wiped it, and keep the owner out.
  const session = await signInProven(
    db,
    done.id,
    { ip, userAgent: await requestUserAgent() },
    new Date(),
  );
  await atLeast(startedAt);
  if (!session.ok) redirect("/backstage/sign-in");
  await setStaffCookie(session.token, session.expiresAt);
  // To the staff list, not the front page. If the PIN was set again because
  // somebody else had it, this is where what they left behind would show.
  redirect(
    withNotice(
      "/backstage/settings/staff",
      "New PIN saved. Every browser was signed out, and any Claude connected under the old PIN was cut off. Look down this list for anybody you do not know.",
      "good",
    ),
  );
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
  if (backstageMode() === "demo" || (await countUsers(db)) > 0) {
    redirect("/backstage/sign-in");
  }

  const ip = await requestIp();
  const refused = await setUpCodeRefused(db, code, ip);
  if (refused !== null) {
    await atLeast(startedAt);
    return { ...refused, values };
  }

  let made;
  try {
    made = await execute(
      createFirstOwner,
      { name: values.name, email: values.email, password },
      systemCaller("Set-up", "ui"),
    );
  } catch (error) {
    await atLeast(startedAt);
    return { ...saidBy(error), values };
  }

  const session = await signInProven(
    db,
    made.id,
    { ip, userAgent: await requestUserAgent() },
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

  let done;
  try {
    done = await execute(
      setPasswordWithToken,
      { token, password },
      systemCaller("One-time link", "ui"),
    );
  } catch (error) {
    await atLeast(startedAt);
    return { ...saidBy(error), values };
  }

  // Straight in: they have just proved who they are and chosen the
  // password. The link is the proof, so no counter is asked: somebody who
  // was locked out for forgetting the old password is exactly who is here.
  const session = await signInProven(
    await getDb(),
    done.userId,
    { ip: await requestIp(), userAgent: await requestUserAgent() },
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
