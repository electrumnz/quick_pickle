"use server";

import {
  addReview,
  publishReview,
  rejectReview,
  unpublishReview,
} from "@/lib/backstage/marketing/reviews";
import { formText, submit } from "@/lib/backstage/ui/submit";

/** Every button on a review. */

const LIST = "/backstage/marketing/reviews";

const page = (form: FormData) =>
  `${LIST}/${encodeURIComponent(formText(form, "id"))}`;

export async function addReviewAction(form: FormData): Promise<void> {
  await submit(
    addReview,
    {
      rating: Number(formText(form, "rating")),
      body: formText(form, "body"),
      displayName: formText(form, "displayName"),
      orderNumber: formText(form, "orderNumber") || undefined,
      email: formText(form, "email") || undefined,
    },
    {
      back: `${LIST}#by-hand`,
      done: "Review added. It is waiting to be read.",
      to: (made) => `${LIST}/${made.id}`,
    },
  );
}

export async function publishReviewAction(form: FormData): Promise<void> {
  await submit(
    publishReview,
    {
      id: formText(form, "id"),
      acknowledgeRestricted: formText(form, "acknowledge") === "on",
    },
    { back: page(form), done: "Published." },
  );
}

export async function rejectReviewAction(form: FormData): Promise<void> {
  await submit(
    rejectReview,
    { id: formText(form, "id"), reason: formText(form, "reason") },
    { back: page(form), done: "Rejected. It will not be shown." },
  );
}

export async function unpublishReviewAction(form: FormData): Promise<void> {
  await submit(
    unpublishReview,
    { id: formText(form, "id") },
    { back: page(form), done: "Taken down. It is back in the waiting pile." },
  );
}
