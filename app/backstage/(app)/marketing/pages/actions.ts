"use server";

import {
  createPage,
  publishPage,
  setPageLive,
  updatePage,
} from "@/lib/backstage/pages/ops";
import { formText, submit } from "@/lib/backstage/ui/submit";

/** Every button on a landing page. */

const LIST = "/backstage/marketing/pages";

const page = (form: FormData) =>
  `${LIST}/${encodeURIComponent(formText(form, "id"))}`;

/** A text box where line breaks matter: the headline. */
function formLines(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

const words = (form: FormData) => ({
  eyebrow: formText(form, "eyebrow"),
  headline: formLines(form, "headline"),
  lead: formText(form, "lead"),
});

export async function createPageAction(form: FormData): Promise<void> {
  await submit(
    createPage,
    {
      slug: formText(form, "slug"),
      name: formText(form, "name"),
      note: formText(form, "note"),
      ...words(form),
    },
    {
      back: `${LIST}#new`,
      done: (made) => `${made.path} is started as a draft.`,
      to: (made) => `${LIST}/${made.id}`,
    },
  );
}

export async function updatePageAction(form: FormData): Promise<void> {
  await submit(
    updatePage,
    {
      id: formText(form, "id"),
      name: formText(form, "name"),
      note: formText(form, "note"),
      ...words(form),
    },
    {
      back: page(form),
      done: (saved) =>
        saved.verdict === "banned"
          ? "Draft saved. The copy check found wording that cannot be published."
          : saved.verdict === "restricted"
            ? "Draft saved. The copy check wants a second look at some wording."
            : "Draft saved. Nothing a customer sees has changed.",
    },
  );
}

export async function publishPageAction(form: FormData): Promise<void> {
  await submit(
    publishPage,
    {
      id: formText(form, "id"),
      acknowledgeRestricted: form.get("acknowledge") === "on",
    },
    {
      back: `${page(form)}#publish`,
      done: (out) => `Published. It is live at ${out.path}.`,
    },
  );
}

export async function setPageLiveAction(form: FormData): Promise<void> {
  const live = formText(form, "live") === "true";
  await submit(
    setPageLive,
    { id: formText(form, "id"), live },
    {
      back: `${page(form)}#publish`,
      done: live
        ? "It is back up."
        : "Taken down. Its address shows the standard page now.",
    },
  );
}
