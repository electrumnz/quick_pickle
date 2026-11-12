"use server";

import type { CostKind } from "@/lib/backstage/marketing/collab-sums";
import {
  addPartnerCost,
  removePartnerCost,
} from "@/lib/backstage/marketing/collabs";
import {
  addPartner,
  setPartnerCut,
  setPartnerNextStep,
  setPartnerPermission,
  setPartnerStatus,
  updatePartner,
} from "@/lib/backstage/marketing/partners";
import type {
  PartnerKind,
  PartnerStatus,
} from "@/lib/backstage/marketing/status";
import { formCents, formText, submit } from "@/lib/backstage/ui/submit";

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

export async function setPartnerCutAction(form: FormData): Promise<void> {
  const raw = formText(form, "commissionPercent");
  // Empty means no cut. Anything that is not a whole number fails the check.
  const commissionPercent =
    raw === "" ? 0 : /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
  await submit(
    setPartnerCut,
    { id: formText(form, "id"), commissionPercent },
    {
      back: `${page(form)}#cut`,
      done: (saved) =>
        saved.commissionPercent === 0
          ? "Saved. They are on no cut."
          : `Saved. They get ${String(saved.commissionPercent)}% of each sale they bring in from now on.`,
    },
  );
}

export async function addPartnerCostAction(form: FormData): Promise<void> {
  await submit(
    addPartnerCost,
    {
      partnerId: formText(form, "id"),
      kind: formText(form, "kind") as CostKind,
      amountCents: formCents(form, "amount"),
      paidOn: formText(form, "paidOn"),
      note: formText(form, "note"),
    },
    { back: `${page(form)}#costs`, done: "Written down." },
  );
}

export async function removePartnerCostAction(form: FormData): Promise<void> {
  await submit(
    removePartnerCost,
    { id: formText(form, "costId") },
    { back: `${page(form)}#costs`, done: "Taken off." },
  );
}
