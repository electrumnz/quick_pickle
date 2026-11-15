"use server";

import { redirect } from "next/navigation";

import { leaveBy } from "./leave";

/**
 * The button on the unsubscribe page. A plain form posts here, so it works
 * with scripting off, and a reload never asks twice: it ends by going back
 * to the page, which then says how things stand.
 */
export async function leaveAction(form: FormData): Promise<void> {
  const said = form.get("token");
  const token = typeof said === "string" ? said : "";
  let failed = false;
  try {
    await leaveBy(token);
  } catch (error) {
    failed = true;
    console.error(
      JSON.stringify({
        event: "crew.unsubscribe_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
  redirect(
    `/unsubscribe/${encodeURIComponent(token)}${failed ? "?failed=1" : ""}`,
  );
}
