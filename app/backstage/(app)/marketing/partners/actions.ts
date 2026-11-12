"use server";

import {
  addPartner,
  setPartnerNextStep,
  setPartnerPermission,
  setPartnerStatus,
  updatePartner,
} from "@/lib/backstage/marketing/partners";
import type {
  PartnerKind,
  PartnerStatus,
} from "@/lib/backstage/marketing/status";
import { formText, submit } from "@/lib/backstage/ui/submit";

/** Every button on a partner. */

const LIST = "/backstage/marketing/partners";

const page = (form: FormData) =>
  `${LIST}/${encodeURIComponent(formText(form, "id"))}`;

const details = (form: FormData) => ({
  name: formText(form, "name"),
  kind: formText(form, "kind") as PartnerKind,
  contactName: formText(form, "contactName"),
  email: formText(form, "email"),
  phone: formText(form, "phone"),
  region: formText(form, "region"),
  notes: formText(form, "notes"),
});

export async function addPartnerAction(form: FormData): Promise<void> {
  await submit(
    addPartner,
    { ...details(form), status: formText(form, "status") as PartnerStatus },
    {
      back: `${LIST}#new`,
      done: "Added.",
      to: (made) => `${LIST}/${made.id}`,
    },
  );
}

export async function updatePartnerAction(form: FormData): Promise<void> {
  await submit(
    updatePartner,
    { id: formText(form, "id"), ...details(form) },
    { back: page(form), done: "Saved." },
  );
}

export async function setPartnerStatusAction(form: FormData): Promise<void> {
  await submit(
    setPartnerStatus,
    {
      id: formText(form, "id"),
      status: formText(form, "status") as PartnerStatus,
    },
    { back: page(form), done: "Saved." },
  );
}

export async function setPartnerNextStepAction(form: FormData): Promise<void> {
  const done = formText(form, "done") === "true";
  await submit(
    setPartnerNextStep,
    {
      id: formText(form, "id"),
      nextStep: done ? "" : formText(form, "nextStep"),
      nextStepOn: done ? null : formText(form, "nextStepOn"),
    },
    {
      back: page(form),
      done: done ? "Done. Nothing is next." : "Next step saved.",
    },
  );
}

export async function setPartnerPermissionAction(
  form: FormData,
): Promise<void> {
  const onFile = formText(form, "onFile") === "true";
  await submit(
    setPartnerPermission,
    { id: formText(form, "id"), onFile, note: formText(form, "note") },
    {
      back: page(form),
      done: onFile
        ? "Recorded. They may be named in public."
        : "Recorded. They may not be named in public.",
    },
  );
}
