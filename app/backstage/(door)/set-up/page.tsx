import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { backstageMode } from "@/lib/backstage/mode";
import { countUsers } from "@/lib/backstage/staff/ops";
import { getDb } from "@/lib/db/client";

import { SetUpForm } from "../forms";

export const metadata: Metadata = { title: "Set up" };

/**
 * First-time set-up. Exists only while the back end has no accounts at all;
 * once there is an owner this page sends everyone to sign in.
 */
export default async function SetUpPage() {
  if (backstageMode() === "demo") redirect("/backstage");
  if ((await countUsers(await getDb())) > 0) redirect("/backstage/sign-in");

  const ready = (process.env.BACKSTAGE_SETUP_CODE ?? "").trim().length >= 16;

  return (
    <>
      <h1 className="bk-h1">Set up</h1>
      <p className="bk-muted mt-2 mb-6 leading-snug">
        Nobody has a login yet. This makes the first one, the owner. It works
        once.
      </p>
      {ready ? (
        <SetUpForm />
      ) : (
        <p className="bk-notice bk-notice-bad">
          Set-up is switched off. Save a phrase of 16 characters or more as{" "}
          <code>BACKSTAGE_SETUP_CODE</code> where the site is hosted, then come
          back to this page.
        </p>
      )}
    </>
  );
}
