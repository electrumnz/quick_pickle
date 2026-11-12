import {
  AUDIENCE_LABEL,
  CAMPAIGN_AUDIENCES,
  type CampaignAudience,
} from "@/lib/backstage/marketing/status";

import { AreaField, SelectField, TextField } from "../parts";

/** The fields of a campaign, for the new form and the edit form alike. */
export function CampaignFields({
  values,
}: {
  readonly values?: {
    readonly name: string;
    readonly subject: string;
    readonly preheader: string;
    readonly body: string;
    readonly audience: CampaignAudience;
  };
}) {
  return (
    <>
      <TextField
        id="campaign-name"
        name="name"
        label="Working title"
        defaultValue={values?.name}
        required
        maxLength={120}
        hint="Only staff see this. It is how you find the campaign again."
      />
      <SelectField
        id="campaign-audience"
        name="audience"
        label="Who it goes to"
        defaultValue={values?.audience ?? "crew"}
        options={CAMPAIGN_AUDIENCES.map((audience) => ({
          value: audience,
          label: AUDIENCE_LABEL[audience],
        }))}
        hint="Only people who asked to hear from us and are still on the list, worked out at the moment it goes. Buying something does not put anyone on it."
      />
      <TextField
        id="campaign-subject"
        name="subject"
        label="Subject"
        defaultValue={values?.subject}
        maxLength={150}
      />
      <TextField
        id="campaign-preheader"
        name="preheader"
        label="Preview line"
        defaultValue={values?.preheader}
        maxLength={200}
        hint="The line an inbox shows after the subject."
      />
      <AreaField
        id="campaign-body"
        name="body"
        label="What it says"
        rows={14}
        defaultValue={values?.body}
        maxLength={20000}
        hint={
          <>
            Write it plainly. A blank line starts a new paragraph. Two stars
            either side make **bold**, one makes *italic*, a line starting with
            a hyphen is a list item, and [words](https://address) makes a link.
            Put {"{{name}}"} where their first name should go: anyone we have no
            name for gets &ldquo;there&rdquo;, so it works best in a greeting.
          </>
        }
      />
    </>
  );
}
