import { Pill } from "@/components/backstage/ui";
import {
  HEADLINE_LINE_LENGTH,
  HEADLINE_LINES,
  type PageRow,
  type PageState,
} from "@/lib/backstage/pages/ops";

import { AreaField, TextField } from "../parts";

const STATE_LABEL: Readonly<Record<PageState, string>> = {
  draft: "Draft",
  live: "Live",
  off: "Taken down",
};

export function PagePill({ state }: { readonly state: PageState }) {
  return (
    <Pill tone={state === "live" ? "done" : state === "off" ? "off" : "plain"}>
      {STATE_LABEL[state]}
    </Pill>
  );
}

/** The words of a landing page, for the new form and the editor alike. */
export function PageFields({ values }: { readonly values?: PageRow }) {
  const key = values?.id ?? "new";
  return (
    <>
      <TextField
        id={`page-name-${key}`}
        name="name"
        label="What you call it"
        required
        maxLength={60}
        defaultValue={values?.name}
        placeholder="Clubs"
        hint="For your own lists. Customers never see it."
      />
      <TextField
        id={`page-eyebrow-${key}`}
        name="eyebrow"
        label="Small heading"
        maxLength={32}
        defaultValue={values?.draft.eyebrow}
        placeholder="For the whole team"
        hint="The few words in the chip over the headline."
      />
      <AreaField
        id={`page-headline-${key}`}
        name="headline"
        label="Headline"
        required
        rows={3}
        maxLength={120}
        defaultValue={values?.draft.headline}
        placeholder={"One box.\nWhole team."}
        hint={`Press Enter where a line should turn. Up to ${String(HEADLINE_LINES)} lines of ${String(HEADLINE_LINE_LENGTH)} letters: it is set very large, and a longer line is set smaller to fit.`}
      />
      <AreaField
        id={`page-lead-${key}`}
        name="lead"
        label="The sentence under it"
        rows={3}
        maxLength={220}
        defaultValue={values?.draft.lead}
        hint="One or two plain sentences. Say what it is and who it is for. Nothing about what it does to a body: the copy check will stop it."
      />
      <TextField
        id={`page-note-${key}`}
        name="note"
        label="Note"
        maxLength={500}
        defaultValue={values?.note}
        hint="Who it is for and where the link is going. Only staff see this."
      />
    </>
  );
}
