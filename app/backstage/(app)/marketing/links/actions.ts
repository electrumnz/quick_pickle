"use server";

import {
  createLink,
  setLinkActive,
  updateLink,
} from "@/lib/backstage/marketing/links";
import { formText, submit } from "@/lib/backstage/ui/submit";

/** Every button on the short links screen. */

const PAGE = "/backstage/marketing/links";

/** Empty hides it from the public page. Anything unreadable fails the check. */
function showOrder(form: FormData): number | null {
  const raw = formText(form, "showOrder");
  if (raw === "") return null;
  return /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
}

const utm = (form: FormData) => ({
  source: formText(form, "utmSource"),
  medium: formText(form, "utmMedium"),
  campaign: formText(form, "utmCampaign"),
});

/** A drop-down whose first choice ("Ours", "None") means nobody. */
const chosen = (form: FormData, key: string): string | null =>
  formText(form, key) === "" ? null : formText(form, key);

const owner = (form: FormData) => ({
  partnerId: chosen(form, "partnerId"),
  promoCodeId: chosen(form, "promoCodeId"),
});

export async function createLinkAction(form: FormData): Promise<void> {
  await submit(
    createLink,
    {
      slug: formText(form, "slug"),
      target: formText(form, "target"),
      label: formText(form, "label"),
      utm: utm(form),
      showOrder: showOrder(form),
      ...owner(form),
    },
    {
      back: `${PAGE}#new`,
      done: (made) => `${made.path} is ready to use.`,
      to: PAGE,
    },
  );
}

export async function updateLinkAction(form: FormData): Promise<void> {
  await submit(
    updateLink,
    {
      id: formText(form, "id"),
      target: formText(form, "target"),
      label: formText(form, "label"),
      utm: utm(form),
      showOrder: showOrder(form),
      ...owner(form),
    },
    { back: PAGE, done: "Link saved." },
  );
}

export async function setLinkActiveAction(form: FormData): Promise<void> {
  const active = formText(form, "active") === "true";
  await submit(
    setLinkActive,
    { id: formText(form, "id"), active },
    { back: PAGE, done: active ? "Switched on." : "Switched off." },
  );
}
