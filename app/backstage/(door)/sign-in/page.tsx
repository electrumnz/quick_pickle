import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { currentStaff } from "@/lib/backstage/auth/current";
import { backstageMode } from "@/lib/backstage/mode";
import { countUsers } from "@/lib/backstage/staff/ops";
import { getDb } from "@/lib/db/client";

import { SignInForm } from "../forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target =
    next !== undefined &&
    next.startsWith("/backstage") &&
    !next.startsWith("//")
      ? next
      : "/backstage";

  if ((await currentStaff()) !== null) redirect(target);
  if (backstageMode() === "live" && (await countUsers(await getDb())) === 0) {
    redirect("/backstage/set-up");
  }

  return (
    <>
      <h1 className="bk-h1">Sign in</h1>
      <p className="bk-muted mt-2 mb-6 leading-snug">
        Staff only. Ask an owner if you need an account.
      </p>
      <SignInForm next={target} />
    </>
  );
}
