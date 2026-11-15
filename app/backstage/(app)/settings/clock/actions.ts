"use server";

import { redirect } from "next/navigation";

import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { dropStep, retryStep } from "@/lib/backstage/clock/ops";
import { tick } from "@/lib/backstage/clock/tick";
import { OpError } from "@/lib/backstage/core/errors";
import { processEvents } from "@/lib/backstage/core/events";
import { execute } from "@/lib/backstage/core/op";
import { registerHandlers } from "@/lib/backstage/handlers";
import { withNotice } from "@/lib/backstage/ui/notice";
import { formText, submit } from "@/lib/backstage/ui/submit";
import { getDb } from "@/lib/db/client";

/**
 * The buttons on the clock's page. Everything exported from this file can be
 * called from a browser, so each one checks who is asking before it does
 * anything.
 */

const PAGE = "/backstage/settings/clock";

const say = (notice: string, tone: "good" | "bad") =>
  withNotice(PAGE, notice, tone);

const count = (n: number, one: string, many: string) =>
  `${String(n)} ${n === 1 ? one : many}`;

/**
 * Ring the clock by hand. The same thing the timer does, now: every change
 * it makes is still an operation, with its own line in the activity log.
 */
export async function tickNowAction(): Promise<void> {
  const staff = await requireStaff(PAGE);
  if (staff.role === "viewer") {
    redirect(say("Your account can look but not change things.", "bad"));
  }
  let target: string;
  try {
    const summary = await tick();
    const failed = summary.events.failed + summary.events.gaveUp;
    const parts = [
      summary.events.handled === 0 && failed === 0
        ? "nothing was waiting"
        : `${count(summary.events.handled, "step", "steps")} done`,
      ...(failed > 0 ? [`${String(failed)} failed again`] : []),
      ...(summary.orders.paid > 0
        ? [`${count(summary.orders.paid, "order", "orders")} found paid`]
        : []),
      ...(summary.orders.closed > 0
        ? [
            `${count(summary.orders.closed, "unpaid order", "unpaid orders")} closed`,
          ]
        : []),
    ];
    target = say(
      `The clock ran: ${parts.join(", ")}.`,
      failed > 0 ? "bad" : "good",
    );
  } catch {
    target = say(
      "The clock could not run just now. Try again in a minute.",
      "bad",
    );
  }
  redirect(target);
}

/** Give one failed step a fresh set of tries, and try it straight away. */
export async function retryStepAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  let target: string;
  try {
    await execute(retryStep, { id }, await staffCaller());
    // Tried now, rather than leaving it for the clock's next round.
    registerHandlers();
    const result = await processEvents(await getDb(), { ids: [id] });
    target =
      result.handled === 1
        ? say("Sent round again, and this time it worked.", "good")
        : say(
            "Sent round again, and it failed again. The reason is below.",
            "bad",
          );
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    target = say(error.message, "bad");
  }
  redirect(target);
}

export async function dropStepAction(form: FormData): Promise<void> {
  await submit(
    dropStep,
    { id: formText(form, "id"), reason: formText(form, "reason") },
    { back: PAGE, done: "That step will not be tried again." },
  );
}
