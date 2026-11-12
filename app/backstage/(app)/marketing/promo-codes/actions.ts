"use server";

import { isDateKey } from "@/lib/backstage/marketing/dates";
import {
  createPromoCode,
  setPromoCodeActive,
  updatePromoCode,
} from "@/lib/backstage/marketing/promo-codes";
import type { PromoKind } from "@/lib/backstage/marketing/status";
import { formCents, formText, submit } from "@/lib/backstage/ui/submit";
import { addDays, startOfNzDay } from "@/lib/time";

/** Every button on a promo code. */

const LIST = "/backstage/marketing/promo-codes";

const page = (form: FormData) =>
  `${LIST}/${encodeURIComponent(formText(form, "id"))}`;

/** A date that cannot be read, so the check answers with "Pick a day". */
const UNREADABLE = () => new Date(Number.NaN);

/**
 * The terms as the form holds them. Money is typed in dollars and stored in
 * cents; days are New Zealand days. A code works from the start of its first
 * day to the end of its last, so the last day is stored as the midnight that
 * follows it.
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

export async function createPromoCodeAction(form: FormData): Promise<void> {
  await submit(
    createPromoCode,
    { code: formText(form, "code"), ...terms(form) },
    {
      back: `${LIST}/new`,
      done: (made) => `${made.code} is made.`,
      to: (made) => `${LIST}/${made.id}`,
    },
  );
}

export async function updatePromoCodeAction(form: FormData): Promise<void> {
  await submit(
    updatePromoCode,
    { id: formText(form, "id"), ...terms(form) },
    { back: page(form), done: "Saved." },
  );
}

export async function setPromoCodeActiveAction(form: FormData): Promise<void> {
  const active = formText(form, "active") === "true";
  await submit(
    setPromoCodeActive,
    { id: formText(form, "id"), active },
    { back: page(form), done: active ? "Switched on." : "Switched off." },
  );
}
