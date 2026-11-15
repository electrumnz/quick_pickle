/**
 * Who is making this request.
 *
 * Every back-end page and action starts here. `requireStaff()` is the gate:
 * it returns a signed-in member of staff or sends the browser to the sign-in
 * page. Nothing in the back end trusts a layout to have done the check for it,
 * because a Server Action can be called without rendering any layout at all.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { users } from "@/db/schema";
import { getDb } from "@/lib/db/client";

import type { Caller } from "../core/actor";
import { OpError } from "../core/errors";
import { backstageMode } from "../mode";
import { FRONT, safeNext } from "./next";
import { readSession, type StaffUser } from "./sessions";

/**
 * Over HTTPS the cookie carries the `__Host-` prefix, which a browser only
 * accepts with Secure, Path=/ and no Domain, so no sibling site can set or
 * shadow it. Plain HTTP only happens on a developer's own machine.
 */
const SECURE_COOKIE = "__Host-qp_staff";
const PLAIN_COOKIE = "qp_staff";

export const DEMO_USER: StaffUser = {
  id: "usr_demo0000000000000000",
  email: "demo@quickpickle.invalid",
  name: "Demo owner",
  role: "owner",
  kind: "person",
};

export async function requestIsSecure(): Promise<boolean> {
  const list = await headers();
  const proto = list.get("x-forwarded-proto");
  if (proto !== null) return proto.split(",")[0]?.trim() === "https";
  return process.env.VERCEL === "1";
}

export async function staffCookieName(): Promise<string> {
  return (await requestIsSecure()) ? SECURE_COOKIE : PLAIN_COOKIE;
}

/** The caller's address, as the host reports it. Used only to slow guessing. */
export async function requestIp(): Promise<string | null> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first === undefined || first === "" ? null : first.slice(0, 64);
}

export async function requestUserAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

async function ensureDemoUser(): Promise<void> {
  const db = await getDb();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, DEMO_USER.id));
  if (existing !== undefined) return;
  await db
    .insert(users)
    .values({
      id: DEMO_USER.id,
      email: DEMO_USER.email,
      name: DEMO_USER.name,
      role: DEMO_USER.role,
      kind: DEMO_USER.kind,
    })
    .onConflictDoNothing();
}

/** The signed-in member of staff, or null. Looked up once per request. */
export const currentStaff = cache(async (): Promise<StaffUser | null> => {
  if (backstageMode() === "demo") {
    await ensureDemoUser();
    return DEMO_USER;
  }
  const jar = await cookies();
  const token = jar.get(await staffCookieName())?.value;
  if (token === undefined) return null;
  return readSession(await getDb(), token, new Date());
});

/**
 * A signed-in member of staff, or a redirect to the sign-in page that
 * remembers where they were going.
 *
 * The path comes from the caller, or failing that from the header proxy.ts
 * sets on every back-end request. It is only ever used to build a link back
 * into the back end.
 */
export async function requireStaff(next?: string): Promise<StaffUser> {
  const staff = await currentStaff();
  if (staff !== null) return staff;
  const asked = safeNext(next ?? (await headers()).get("x-qp-path"));
  const target = asked === FRONT ? "" : `?next=${encodeURIComponent(asked)}`;
  redirect(`/backstage/sign-in${target}`);
}

/**
 * The caller to hand to `execute()` from a page or a Server Action. A form's
 * button is the person's yes, so `confirmed` is true.
 */
export async function staffCaller(): Promise<Caller> {
  const staff = await currentStaff();
  if (staff === null) {
    throw new OpError("unauthenticated", "Sign in to do that.");
  }
  return {
    actor: {
      type: staff.kind === "bot" ? "bot" : "human",
      userId: staff.id,
      name: staff.name,
      role: staff.role,
    },
    via: "ui",
    confirmed: true,
    requestId: crypto.randomUUID(),
  };
}
