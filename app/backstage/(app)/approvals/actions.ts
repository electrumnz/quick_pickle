"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { staffCaller } from "@/lib/backstage/auth/current";
import { declineApproval } from "@/lib/backstage/connect/approvals";
import { approve } from "@/lib/backstage/connect/approve";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { formText } from "@/lib/backstage/ui/submit";

import type { Outcome } from "./shared";

/**
 * Back to the request's page, with a word for how the press went.
 *
 * A word and never a sentence: the page says its own sentence for it (see
 * `outcomeSaid`). The link to that page is one a bot hands to a person, so
 * nothing the address carries is printed as it stands.
 */
function back(id: string, outcome: Outcome): never {
  redirect(`/backstage/approvals/${encodeURIComponent(id)}?said=${outcome}`);
}

const refusedAs = (error: OpError): Outcome =>
  error.code === "forbidden"
    ? "forbidden"
    : error.code === "conflict"
      ? "decided"
      : "error";

/** A person's yes. The button is the yes: what was asked for is done now. */
export async function approveAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  let outcome: Outcome;
  try {
    const done = await approve(id, await staffCaller());
    outcome = done.ok ? "done" : "failed";
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    outcome = refusedAs(error);
  }
  // Whatever it changed, the screens that show it are drawn again.
  revalidatePath("/backstage", "layout");
  back(id, outcome);
}

/** A person's no. Nothing is done. */
export async function declineAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  let outcome: Outcome;
  try {
    const { status } = await execute(
      declineApproval,
      { id },
      await staffCaller(),
    );
    outcome = status === "declined" ? "declined" : "decided";
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    outcome = refusedAs(error);
  }
  revalidatePath("/backstage", "layout");
  back(id, outcome);
}
