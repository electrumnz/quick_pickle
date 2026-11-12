"use server";

import { revalidatePath } from "next/cache";

import { staffCaller } from "@/lib/backstage/auth/current";
import { declineApproval } from "@/lib/backstage/connect/approvals";
import { approve } from "@/lib/backstage/connect/approve";
import { OpError } from "@/lib/backstage/core/errors";
import { formText, sayAndGo, submit } from "@/lib/backstage/ui/submit";

/** A person's yes. The button is the yes: what was asked for is done now. */
export async function approveAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  const page = `/backstage/approvals/${id}`;
  let said: { text: string; tone: "good" | "bad" };
  try {
    const done = await approve(id, await staffCaller());
    said = done.ok
      ? { text: "Done.", tone: "good" }
      : { text: `It could not be done. ${done.why}`, tone: "bad" };
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    said = { text: error.message, tone: "bad" };
  }
  // Whatever it changed, the screens that show it are drawn again.
  revalidatePath("/backstage", "layout");
  sayAndGo(page, said.text, said.tone);
}

/** A person's no. Nothing is done. */
export async function declineAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  await submit(
    declineApproval,
    { id },
    {
      back: `/backstage/approvals/${id}`,
      done: "Said no. Nothing was done.",
    },
  );
}
