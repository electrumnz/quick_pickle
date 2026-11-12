import type { PartnerDetail } from "@/lib/backstage/marketing/partners";
import {
  PARTNER_KIND_LABEL,
  PARTNER_KINDS,
} from "@/lib/backstage/marketing/status";

import { AreaField, SelectField, TextField } from "../parts";

/** Who a partner is and how to reach them, for the new and the edit form. */
export function PartnerFields({ values }: { readonly values?: PartnerDetail }) {
  return (
    <>
      <TextField
        id="partner-name"
        name="name"
        label="Name"
        required
        maxLength={120}
        defaultValue={values?.name}
        hint="Their full name, as they write it. It is what the copy check looks for."
      />
      <SelectField
        id="partner-kind"
        name="kind"
        label="Kind"
        defaultValue={values?.kind ?? "club"}
        options={PARTNER_KINDS.map((kind) => ({
          value: kind,
          label: PARTNER_KIND_LABEL[kind],
        }))}
      />
      <TextField
        id="partner-contact"
        name="contactName"
        label="Who to talk to"
        maxLength={80}
        defaultValue={values?.contactName}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="partner-email"
          name="email"
          type="email"
          label="Email"
          maxLength={254}
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={values?.email ?? undefined}
        />
        <TextField
          id="partner-phone"
          name="phone"
          type="tel"
          label="Phone"
          maxLength={24}
          defaultValue={values?.phone ?? undefined}
        />
      </div>
      <TextField
        id="partner-region"
        name="region"
        label="Where they are"
        maxLength={80}
        defaultValue={values?.region ?? undefined}
      />
      <AreaField
        id="partner-notes"
        name="notes"
        label="Notes"
        rows={4}
        maxLength={4000}
        defaultValue={values?.notes}
        hint="Only staff see this."
      />
    </>
  );
}
