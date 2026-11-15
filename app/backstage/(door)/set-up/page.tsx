import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { backstageMode } from "@/lib/backstage/mode";
import { countUsers, pinDoor } from "@/lib/backstage/staff/ops";
import { getDb } from "@/lib/db/client";

import { NewPinForm, SetUpForm, SetUpPinForm } from "../forms";

export const metadata: Metadata = { title: "Set up" };

const LINK =
  "inline-flex min-h-11 items-center underline decoration-2 underline-offset-4";

function SwitchedOff() {
  return (
    <p className="bk-notice bk-notice-bad">
      Set-up is switched off. Save a phrase of 16 characters or more as{" "}
      <code>BACKSTAGE_SETUP_CODE</code> where the site is hosted, then come back
      to this page.
    </p>
  );
}

/**
 * First-time set-up. It makes the first login, the owner, and works once:
 * with a PIN for now (lib/backstage/auth/pin.ts), or with an email and a
 * password.
 *
 * Once there is an owner this page sends everyone to sign in, with one
 * exception. While the owner comes in with a PIN, this is where a new PIN
 * is set, with the same set-up code: there is no email to send a link to.
 */
export default async function SetUpPage({
  searchParams,
}: {
  searchParams: Promise<{ with?: string }>;
}) {
  if (backstageMode() === "demo") redirect("/backstage");

  const db = await getDb();
  const ready = (process.env.BACKSTAGE_SETUP_CODE ?? "").trim().length >= 16;

  if ((await countUsers(db)) > 0) {
    if ((await pinDoor(db)) === null) redirect("/backstage/sign-in");
    return (
      <>
        <h1 className="bk-h1">Set a new PIN</h1>
        <p className="bk-muted mt-2 mb-6 leading-snug">
          For when the PIN is forgotten, or the door is locked after too many
          wrong tries. It takes the set-up code, signs out every browser that
          was in, and cuts off any Claude connected under the old PIN.
        </p>
        {ready ? <NewPinForm /> : <SwitchedOff />}
        <p className="mt-4 text-[0.9375rem] leading-snug">
          <Link href="/backstage/sign-in" className={LINK}>
            Back to sign in
          </Link>
        </p>
      </>
    );
  }

  const { with: how } = await searchParams;
  const withEmail = how === "email";

  return (
    <>
      <h1 className="bk-h1">Set up</h1>
      <p className="bk-muted mt-2 mb-6 leading-snug">
        Nobody has a login yet. This makes the first one, the owner. It works
        once.
      </p>
      {!ready ? <SwitchedOff /> : withEmail ? <SetUpForm /> : <SetUpPinForm />}
      {ready ? (
        <p className="mt-4 text-[0.9375rem] leading-snug">
          {withEmail ? (
            <Link href="/backstage/set-up" className={LINK}>
              Use a PIN instead
            </Link>
          ) : (
            <Link href="/backstage/set-up?with=email" className={LINK}>
              Use an email and a password instead
            </Link>
          )}
        </p>
      ) : null}
    </>
  );
}
