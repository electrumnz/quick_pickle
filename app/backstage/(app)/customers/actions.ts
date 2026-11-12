"use server";

import { updateCustomer } from "@/lib/backstage/customers/ops";
import { formText, submit } from "@/lib/backstage/ui/submit";

export async function updateCustomerAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  const tags = formText(form, "tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
  await submit(
    updateCustomer,
    {
      id,
      firstName: formText(form, "firstName"),
      lastName: formText(form, "lastName"),
      phone: formText(form, "phone"),
      tags,
      notes: formText(form, "notes"),
    },
    { back: `/backstage/customers/${encodeURIComponent(id)}`, done: "Saved." },
  );
}
