"use server";

import { staffCaller } from "@/lib/backstage/auth/current";
import { formText } from "@/lib/backstage/ui/submit";

import {
  blankState,
  checkThenChange,
  markOf,
  type ShopFormState,
} from "../shop/flow";

/**
 * What the label says and who the company is: the same two presses as any
 * change to the shop (../shop/flow.ts), through the same operations.
 *
 * One thing is its own. A word on the ingredients list that has to be
 * checked against the printed label is cleared by a tick, and the tick only
 * counts for the very words it was shown beside. Tick it, then change a
 * line, and it is asked for again.
 */

/** Which box an operation's complaint is about. */
function boxFor(path: string): string {
  if (path.startsWith("label.")) return path.slice(6);
  if (path.startsWith("company.")) return path.slice(8);
  // The copy rules name the line the way a sentence would.
  if (path === "the ingredients list") return "ingredients";
  if (path === "the allergen line") return "contains";
  if (path === "the storage line") return "storage";
  if (path === "gstRegistered") return "gst";
  return path;
}

export async function labelAction(
  _previous: ShopFormState,
  form: FormData,
): Promise<ShopFormState> {
  const caller = await staffCaller();
  const values: Record<string, string> = {};
  const text = (key: string) => {
    const value = formText(form, key);
    values[key] = value;
    return value;
  };
  const label = {
    ingredients: text("ingredients"),
    contains: text("contains"),
    storage: text("storage"),
  };
  const company = {
    legalName: text("legalName"),
    nzbn: text("nzbn"),
    address: text("address"),
    gstNumber: text("gstNumber"),
  };
  const gst = text("gst");
  // The tick is for the label's lines exactly as they were when it was
  // asked for. Any other words and it has not been given.
  const linesMark = markOf(label);
  const ticked =
    formText(form, "labelChecked") === "yes" &&
    formText(form, "tickFor") === linesMark;
  if (ticked) values.labelChecked = "yes";

  const state = await checkThenChange(
    form,
    {
      label,
      company,
      gstRegistered: gst === "yes" ? true : gst === "no" ? false : null,
      labelChecked: ticked,
    },
    blankState(values),
    boxFor,
    caller,
  );
  // Keep the tick box on the screen while it is doing its job, and put it
  // there when the label's words are what the change is waiting on.
  return ticked || "labelChecked" in state.fields
    ? { ...state, tickFor: linesMark }
    : state;
}
