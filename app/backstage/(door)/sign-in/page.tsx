import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentStaff } from "@/lib/backstage/auth/current";
import { FRONT, safeNext } from "@/lib/backstage/auth/next";
import { backstageMode } from "@/lib/backstage/mode";
import { countUsers, hasNamedLogins, pinDoor } from "@/lib/backstage/staff/ops";
import { getDb } from "@/lib/db/client";

import { PinSignInForm, SignInForm } from "../forms";

export const metadata: Metadata = { title: "Sign in" };

const LINK =
  "inline-flex min-h-11 items-center underline decoration-2 underline-offset-4";

/**
 * The way in. While the door is a PIN door (lib/backstage/auth/pin.ts) it
 * asks for the PIN and nothing else. Anybody with a login of their own
 * signs in with their email and password, as they always did.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; with?: string }>;
}) {
  const { next, with: how } = await searchParams;
  const target = safeNext(next);

  if ((await currentStaff()) !== null) redirect(target);

  let pin = false;
  let named = false;
  if (backstageMode() === "live") {
    const db = await getDb();
    if ((await countUsers(db)) === 0) redirect("/backstage/set-up");
    pin = (await pinDoor(db)) !== null;
    named = pin && (await hasNamedLogins(db));
  }

  // Where they were going rides along when they change how they sign in.
  const going = target === FRONT ? "" : `next=${encodeURIComponent(target)}`;

  if (pin && how !== "email") {
    return (
      <>
        <h1 className="bk-h1">Sign in</h1>
        <p className="bk-muted mt-2 mb-6 leading-snug">
          Staff only. Type the PIN to come in.
        </p>
        <PinSignInForm next={target} />
        <ul className="mt-4 text-[0.9375rem] leading-snug">
          <li>
            <Link href="/backstage/set-up" className={LINK}>
              Forgot the PIN, or locked out?
            </Link>
          </li>
          {named ? (
            <li>
              <Link
                href={`/backstage/sign-in?with=email${going === "" ? "" : `&${going}`}`}
                className={LINK}
              >
                Sign in with an email and password
              </Link>
            </li>
          ) : null}
        </ul>
      </>
    );
  }

  return (
    <>
      <h1 className="bk-h1">Sign in</h1>
      <p className="bk-muted mt-2 mb-6 leading-snug">
        Staff only. Ask an owner if you need an account.
      </p>
      <SignInForm next={target} />
      {pin ? (
        <p className="mt-4 text-[0.9375rem] leading-snug">
          <Link
            href={`/backstage/sign-in${going === "" ? "" : `?${going}`}`}
            className={LINK}
          >
            Use the PIN instead
          </Link>
        </p>
      ) : null}
    </>
  );
}
