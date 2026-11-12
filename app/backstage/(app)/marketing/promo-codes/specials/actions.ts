"use server";

import { isDateKey } from "@/lib/backstage/marketing/dates";
import { setCrewWelcomeCode } from "@/lib/backstage/marketing/promo-codes";
import {
  createSpecial,
  switchSpecialOff,
  switchSpecialOn,
  updateSpecial,
} from "@/lib/backstage/marketing/specials";
import type { PromoKind } from "@/lib/backstage/marketing/status";
import { formCents, formText, submit } from "@/lib/backstage/ui/submit";
import { addDays, startOfNzDay } from "@/lib/time";

/** Every button on the Specials screen, and the Crew's welcome code. */

const LIST = "/backstage/marketing/promo-codes/specials";

/** A date that cannot be read, so the check answers with "Pick a day". */
const UNREADABLE = () => new Date(Number.NaN);

/**
 * The terms as the form holds them. Money is typed in dollars and stored in
 * cents; days are New Zealand days. A special works from the start of its
 * first day to the end of its last, so the last day is stored as the
 * midnight that follows it.
 */
function terms(form: FormData) {
  const kind = formText(form, "kind") as PromoKind;
  const percent = formText(form, "percent");
  const amount = formCents(form, "amount");
  const min = formText(form, "min");
  const minCents = formCents(form, "min");
  const firstDay = formText(form, "firstDay");
  const lastDay = formText(form, "lastDay");
  const maxUses = formText(form, "maxUses");
  return {
    name: formText(form, "name"),
    kind,
    // Anything unreadable becomes a number the check refuses, in a sentence
    // about the right thing: 0 is no percentage, -1 is no amount of money.
    value:
      kind === "percent"
        ? /^\d{1,3}$/.test(percent)
          ? Number(percent)
          : 0
        : kind === "amount"
          ? Number.isNaN(amount)
            ? -1
            : amount
          : 0,
    minSubtotalCents: min === "" ? 0 : Number.isNaN(minCents) ? -1 : minCents,
    startsAt:
      firstDay === ""
        ? null
        : isDateKey(firstDay)
          ? startOfNzDay(firstDay)
          : UNREADABLE(),
    endsAt:
      lastDay === ""
        ? null
        : isDateKey(lastDay)
          ? startOfNzDay(addDays(lastDay, 1))
          : UNREADABLE(),
    maxUses:
      maxUses === ""
        ? null
        : /^\d{1,7}$/.test(maxUses)
          ? Number(maxUses)
          : Number.NaN,
    note: formText(form, "note"),
  };
}

const anchor = (form: FormData) => `${LIST}#${formText(form, "id")}`;

export async function createSpecialAction(form: FormData): Promise<void> {
  await submit(
    createSpecial,
    { code: formText(form, "code"), ...terms(form) },
    {
      back: `${LIST}#new`,
      done: (made) =>
        `${made.code} is set up and switched off. Nothing has changed for customers yet.`,
      to: (made) => `${LIST}#${made.id}`,
    },
  );
}

export async function updateSpecialAction(form: FormData): Promise<void> {
  await submit(
    updateSpecial,
    { id: formText(form, "id"), ...terms(form) },
    { back: anchor(form), done: "Saved. It is still switched off." },
  );
}

export async function switchSpecialOnAction(form: FormData): Promise<void> {
  await submit(
    switchSpecialOn,
    {
      id: formText(form, "id"),
      acknowledgeRestricted: form.get("acknowledge") === "on",
    },
    {
      back: anchor(form),
      done: (out) =>
        out.state === "not-started"
          ? "Switched on. It starts on its first day, and the shop says so then."
          : "Switched on. The shop is saying it now, give or take a few seconds.",
    },
  );
}

export async function switchSpecialOffAction(form: FormData): Promise<void> {
  await submit(
    switchSpecialOff,
    { id: formText(form, "id") },
    {
      back: anchor(form),
      done: "Switched off. The shop has stopped offering it.",
    },
  );
}

/** On a promo code's own page: hand it to people who join the Crew, or stop. */
export async function setCrewWelcomeAction(form: FormData): Promise<void> {
  const on = formText(form, "on") === "true";
  const back = `/backstage/marketing/promo-codes/${encodeURIComponent(formText(form, "id"))}`;
  await submit(
    setCrewWelcomeCode,
    { id: formText(form, "id"), on },
    {
      back,
      done: (out) =>
        out.on
          ? `${out.code} is now the code people get for joining the Pickle Crew. It works once for each customer.`
          : `${out.code} is no longer handed out to people who join the Pickle Crew.`,
    },
  );
}
