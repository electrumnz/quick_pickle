import {
  dateInputValue,
  timeInputValue,
} from "@/lib/backstage/marketing/dates";
import {
  FORMAT_LABEL,
  NETWORK_LABEL,
  SOCIAL_FORMATS,
  SOCIAL_NETWORKS,
  type SocialFormat,
  type SocialNetwork,
} from "@/lib/backstage/marketing/status";

import { AreaField, SelectField, TextField } from "../parts";

/** The fields of a planned post, for the new form and the edit form alike. */
export function SocialFields({
  values,
}: {
  readonly values?: {
    readonly title: string;
    readonly network: SocialNetwork;
    readonly format: SocialFormat;
    readonly caption: string;
    readonly plannedFor: Date | null;
    readonly notes: string;
  };
}) {
  return (
    <>
      <TextField
        id="post-title"
        name="title"
        label="Working title"
        required
        maxLength={120}
        defaultValue={values?.title}
        hint="Only staff see this. It is never posted."
      />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          id="post-network"
          name="network"
          label="Where"
          defaultValue={values?.network ?? "instagram"}
          options={SOCIAL_NETWORKS.map((network) => ({
            value: network,
            label: NETWORK_LABEL[network],
          }))}
        />
        <SelectField
          id="post-format"
          name="format"
          label="What"
          defaultValue={values?.format ?? "post"}
          options={SOCIAL_FORMATS.map((format) => ({
            value: format,
            label: FORMAT_LABEL[format],
          }))}
        />
      </div>
      <AreaField
        id="post-caption"
        name="caption"
        label="Caption"
        rows={6}
        maxLength={2200}
        defaultValue={values?.caption}
        hint="The words people will read, hashtags included. Leave it empty while it is still only an idea. It is checked against the copy rules every time you save."
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          id="post-date"
          name="date"
          type="date"
          label="Day"
          defaultValue={
            values?.plannedFor ? dateInputValue(values.plannedFor) : undefined
          }
        />
        <TextField
          id="post-time"
          name="time"
          type="time"
          label="Time"
          defaultValue={
            values?.plannedFor ? timeInputValue(values.plannedFor) : undefined
          }
        />
      </div>
      <p className="bk-muted -mt-1 text-[0.9375rem] leading-snug">
        New Zealand time. Leave the day empty to keep it on the pile with no
        date. A day with no time is taken as nine in the morning.
      </p>
      <AreaField
        id="post-notes"
        name="notes"
        label="Notes"
        rows={3}
        maxLength={2000}
        defaultValue={values?.notes}
        hint="What to film, who is in it, what is still needed. Only staff see this."
      />
    </>
  );
}
