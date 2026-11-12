"use server";

import { instantFromFields } from "@/lib/backstage/marketing/dates";
import {
  addSocialPost,
  approveSocialPost,
  dropSocialPost,
  markSocialPosted,
  unapproveSocialPost,
  updateSocialPost,
} from "@/lib/backstage/marketing/social";
import type {
  SocialFormat,
  SocialNetwork,
} from "@/lib/backstage/marketing/status";
import { formText, submit } from "@/lib/backstage/ui/submit";

/** Every button in the social planner. */

const LIST = "/backstage/marketing/social";

const page = (form: FormData) =>
  `${LIST}/${encodeURIComponent(formText(form, "id"))}`;

/**
 * The day and time typed into the form, read as New Zealand time. No day
 * means the post has no date. A day that cannot be read fails the check with
 * "Pick a day".
 */
function plannedFor(form: FormData): Date | null {
  const date = formText(form, "date");
  if (date === "") return null;
  return (
    instantFromFields(date, formText(form, "time")) ?? new Date(Number.NaN)
  );
}

const fields = (form: FormData) => ({
  title: formText(form, "title"),
  network: formText(form, "network") as SocialNetwork,
  format: formText(form, "format") as SocialFormat,
  caption: formText(form, "caption"),
  plannedFor: plannedFor(form),
  notes: formText(form, "notes"),
});

export async function addSocialPostAction(form: FormData): Promise<void> {
  await submit(addSocialPost, fields(form), {
    back: `${LIST}/new`,
    done: "Added to the planner.",
    to: (made) => `${LIST}/${made.id}`,
  });
}

export async function updateSocialPostAction(form: FormData): Promise<void> {
  await submit(
    updateSocialPost,
    { id: formText(form, "id"), ...fields(form) },
    {
      back: page(form),
      done: (saved) =>
        saved.needsApproval
          ? "Saved. The caption changed, so it needs approving again."
          : "Saved.",
    },
  );
}

/** Notes are the one thing that can still change once a post has gone. */
export async function updateSocialNotesAction(form: FormData): Promise<void> {
  await submit(
    updateSocialPost,
    { id: formText(form, "id"), notes: formText(form, "notes") },
    { back: page(form), done: "Notes saved." },
  );
}

export async function approveSocialPostAction(form: FormData): Promise<void> {
  await submit(
    approveSocialPost,
    {
      id: formText(form, "id"),
      acknowledgeRestricted: formText(form, "acknowledge") === "on",
    },
    { back: page(form), done: "Approved. It is ready to post by hand." },
  );
}

export async function unapproveSocialPostAction(form: FormData): Promise<void> {
  await submit(
    unapproveSocialPost,
    { id: formText(form, "id") },
    { back: page(form), done: "Back to draft." },
  );
}

export async function markSocialPostedAction(form: FormData): Promise<void> {
  await submit(
    markSocialPosted,
    {
      id: formText(form, "id"),
      postUrl: formText(form, "postUrl") || undefined,
    },
    { back: page(form), done: "Marked as posted." },
  );
}

export async function dropSocialPostAction(form: FormData): Promise<void> {
  const undo = formText(form, "undo") === "true";
  await submit(
    dropSocialPost,
    { id: formText(form, "id"), undo },
    { back: page(form), done: undo ? "Picked back up." : "Dropped." },
  );
}
