"use server";

import {
  approveCampaign,
  cancelCampaign,
  createCampaign,
  scheduleCampaign,
  sendCampaign,
  unapproveCampaign,
  updateCampaign,
} from "@/lib/backstage/marketing/campaigns";
import type { CopyVerdict } from "@/lib/backstage/marketing/copy-check";
import { instantFromFields } from "@/lib/backstage/marketing/dates";
import { people } from "@/lib/backstage/marketing/shared";
import type { CampaignAudience } from "@/lib/backstage/marketing/status";
import { formText, submit } from "@/lib/backstage/ui/submit";

/**
 * Every button on a campaign. Each runs one operation and comes back to the
 * campaign with a line saying what happened.
 */

const LIST = "/backstage/marketing/campaigns";

const page = (form: FormData) =>
  `${LIST}/${encodeURIComponent(formText(form, "id"))}`;

const words = (form: FormData) => ({
  name: formText(form, "name"),
  subject: formText(form, "subject"),
  preheader: formText(form, "preheader"),
  body: formText(form, "body"),
  audience: formText(form, "audience") as CampaignAudience,
});

function saved(verdict: CopyVerdict): string {
  if (verdict === "banned") {
    return "Saved. The copy check found wording that has to change before this can be approved.";
  }
  if (verdict === "restricted") {
    return "Saved. The copy check has something for you to read before this is approved.";
  }
  return "Saved.";
}

/** A count from a hidden field. Anything odd fails the check with a sentence. */
const count = (form: FormData, key: string) => {
  const value = Number(formText(form, key));
  return Number.isInteger(value) ? value : -1;
};

export async function createCampaignAction(form: FormData): Promise<void> {
  await submit(createCampaign, words(form), {
    back: `${LIST}/new`,
    done: (made) => saved(made.verdict),
    to: (made) => `${LIST}/${made.id}`,
  });
}

export async function updateCampaignAction(form: FormData): Promise<void> {
  await submit(
    updateCampaign,
    { id: formText(form, "id"), ...words(form) },
    { back: page(form), done: (made) => saved(made.verdict) },
  );
}

export async function approveCampaignAction(form: FormData): Promise<void> {
  await submit(
    approveCampaign,
    {
      id: formText(form, "id"),
      acknowledgeRestricted: formText(form, "acknowledge") === "on",
    },
    { back: page(form), done: "Approved. It can be sent or given a time now." },
  );
}

export async function unapproveCampaignAction(form: FormData): Promise<void> {
  await submit(
    unapproveCampaign,
    { id: formText(form, "id") },
    { back: page(form), done: "Back to draft. It can be edited again." },
  );
}

export async function sendCampaignAction(form: FormData): Promise<void> {
  await submit(
    sendCampaign,
    { id: formText(form, "id"), recipients: count(form, "recipients") },
    {
      back: page(form),
      done: (sent) =>
        sent.already
          ? "It had already been queued. Nobody was queued twice."
          : `Queued for ${people(sent.queued)}.${sent.skipped > 0 ? ` ${people(sent.skipped)} on the do-not-email list ${sent.skipped === 1 ? "was" : "were"} left out.` : ""} Email is not connected yet, so nothing has left: the emails wait until it is.`,
    },
  );
}

export async function scheduleCampaignAction(form: FormData): Promise<void> {
  const sendAt = instantFromFields(
    formText(form, "date"),
    formText(form, "time"),
  );
  await submit(
    scheduleCampaign,
    {
      id: formText(form, "id"),
      // An unreadable date fails the check with "Pick a day and a time".
      sendAt: sendAt ?? new Date(Number.NaN),
      recipients: count(form, "recipients"),
    },
    { back: page(form), done: "Time set." },
  );
}

export async function cancelCampaignAction(form: FormData): Promise<void> {
  await submit(
    cancelCampaign,
    { id: formText(form, "id") },
    {
      back: page(form),
      done: (cancelled) =>
        cancelled.stopped > 0
          ? `Stopped. ${String(cancelled.stopped)} ${cancelled.stopped === 1 ? "email that was" : "emails that were"} waiting will not go.`
          : "Cancelled.",
    },
  );
}
