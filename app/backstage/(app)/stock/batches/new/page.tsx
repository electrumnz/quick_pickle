import type { Metadata } from "next";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { suggestBatchCode } from "@/lib/backstage/stock/ops";

import { planBatchAction } from "../../actions";
import { FLAVOURS } from "@/content/offer";

import {
  Choice,
  Field,
  FormNotice,
  Hint,
  LookOnly,
  TextArea,
} from "../../parts";

export const metadata: Metadata = { title: "Plan a batch" };

/**
 * Plan a batch: give it the code that will be printed on its bottles. If the
 * form is turned away, what was typed comes back in the address so nothing
 * has to be typed twice.
 */
export default async function NewBatchPage({
  searchParams,
}: {
  searchParams: Promise<{
    flavour?: string;
    code?: string;
    name?: string;
    plannedFor?: string;
    shotsPlanned?: string;
    notes?: string;
    notice?: string;
    tone?: string;
  }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const suggested = await execute(suggestBatchCode, {}, await staffCaller());
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title="Plan a batch"
        back={{ href: "/backstage/stock/batches", label: "Batches" }}
        lead="Put the next run of making on the list. Nothing goes into stock until you record that it was made."
      />
      <FormNotice notice={params.notice} tone={params.tone} />

      <Panel className="max-w-[40rem]">
        {canWrite ? (
          <form action={planBatchAction} className="flex flex-col gap-4">
            {/* A select only reads its starting value once: the key makes a
                handed-back form show what was picked. */}
            <Choice
              key={params.flavour ?? ""}
              form="plan"
              name="flavour"
              label="Flavour"
              required
              defaultValue={params.flavour}
              hint="What goes in its bottles. Orders of this flavour are filled from it, and a recall goes by it."
              options={[
                { value: "", label: "Pick a flavour" },
                ...FLAVOURS.map((flavour) => ({
                  value: flavour.key,
                  label: flavour.name,
                })),
              ]}
            />
            <Field
              form="plan"
              name="code"
              label="Batch code"
              required
              maxLength={12}
              defaultValue={params.code ?? suggested.code}
              hint="What will be printed on the bottle. Letters, numbers and dashes. This is the next one in the run: change it if yours is different."
            />
            <Field
              form="plan"
              name="name"
              label="Name"
              maxLength={80}
              defaultValue={params.name}
              placeholder={`Batch ${params.code ?? suggested.code}`}
              hint="What you call this run. Leave it blank to use the code."
            />
            <Field
              form="plan"
              name="plannedFor"
              label="Planned for"
              kind="date"
              defaultValue={params.plannedFor}
              hint="The day you mean to make it, if you know."
            />
            <Field
              form="plan"
              name="shotsPlanned"
              label="Shots planned"
              kind="count"
              defaultValue={params.shotsPlanned}
              hint="How many shots it should make, if you know. The real number is counted when it is made."
            />
            <TextArea
              form="plan"
              name="notes"
              label="Notes"
              maxLength={4000}
              defaultValue={params.notes}
            />
            <div>
              <SubmitButton pending="Saving" className="bk-btn w-full">
                Plan the batch
              </SubmitButton>
              <Hint>
                You can change any of this, the flavour included, until the
                batch is made.
              </Hint>
            </div>
          </form>
        ) : (
          <LookOnly />
        )}
      </Panel>
    </>
  );
}
