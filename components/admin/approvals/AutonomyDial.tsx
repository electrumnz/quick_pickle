import {
  Field,
  FormFields,
  Select,
  SubmitButton,
} from "@/components/admin/ui/controls";
import { AUTONOMY_WORDS } from "@/lib/agents/roster";

import { setAgentAutonomyAction } from "./actions";

/**
 * How much this one agent may settle on its own.
 *
 * The dial belongs next to the queue, not buried in settings: the moment she
 * notices she is saying yes to the same thing every night is the moment to
 * move it, and it should take one control to do that where she is standing.
 *
 * The three positions are the only ones offered. `autonomous` exists in the
 * database and is deliberately not on the dial — nothing in this company
 * should act and tell her afterwards while it is a company of one. Below that,
 * the ceiling is the same at every position: a tool whose effect is
 * `storefront_write` or `external` cannot run without an approved row covering
 * its exact arguments, so turning the dial up widens what an agent decides
 * about its own work, never what it can do to the shop or to a person.
 */

const POSITIONS = [
  { value: "observe", label: "Watch only — it changes nothing" },
  { value: "propose", label: "Draft and ask — you decide everything" },
  {
    value: "act_with_limits",
    label: "Act inside its limits — ask for anything bigger",
  },
] as const;

export function AutonomyDial({
  slug,
  name,
  autonomy,
  csrfToken,
  back,
  id = "autonomy",
}: {
  slug: string;
  name: string;
  autonomy: string;
  csrfToken: string;
  back: string;
  id?: string;
}) {
  const known = POSITIONS.some((position) => position.value === autonomy);
  const control = `${id}-${slug}`;
  return (
    <form
      id={id}
      action={setAgentAutonomyAction}
      className="scroll-mt-24 rounded-md border border-hairline bg-surface-sunken px-3 py-3"
    >
      <FormFields csrfToken={csrfToken} back={back} values={{ slug }} />
      <Field
        label={`What ${name} may decide alone`}
        htmlFor={control}
        hint={
          known
            ? AUTONOMY_WORDS[autonomy]
            : `It is on "${autonomy}", which this dial does not offer. Saving will move it to one that is.`
        }
      >
        <Select
          id={control}
          name="autonomy"
          defaultValue={known ? autonomy : "propose"}
          options={POSITIONS.map((position) => ({ ...position }))}
        />
      </Field>
      <div className="mt-2.5">
        <SubmitButton>Save what {name} may decide</SubmitButton>
      </div>
    </form>
  );
}
