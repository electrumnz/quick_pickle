"use server";

import { FLAVOURS } from "@/content/offer";
import { staffCaller } from "@/lib/backstage/auth/current";
import { formText } from "@/lib/backstage/ui/submit";

import {
  blankState,
  checkThenChange,
  markOf,
  type ShopFormState,
} from "../shop/flow";

import { labelField } from "./values";

/**
 * What the label says and who the company is: the same two presses as any
 * change to the shop (../shop/flow.ts), through the same operations.
 *
 * One thing is its own. A word on the ingredients list that has to be
 * checked against the printed label is cleared by a tick, and the tick only
 * counts for the very words it was shown beside. Tick it, then change a
 * line, and it is asked for again.
 */

const LINES = ["ingredients", "contains", "storage"] as const;
const LINE_SAID: Readonly<Record<(typeof LINES)[number], string>> = {
  ingredients: "ingredients list",
  contains: "allergen line",
  storage: "storage line",
};

/** Which box an operation's complaint is about. */
function boxFor(path: string): string {
  if (path.startsWith("label.")) return path.slice(6);
  // flavourLabels.<flavour>.<line>
  const flavoured = /^flavourLabels\.([^.]+)\.(\w+)$/.exec(path);
  if (flavoured !== null) return `${flavoured[2] ?? ""}:${flavoured[1] ?? ""}`;
  if (path.startsWith("company.")) return path.slice(8);
  // The copy rules name the line the way a sentence would: "the ingredients
  // list", or with two flavours "the Mango Chilli Lime ingredients list".
  for (const line of LINES) {
    if (path === `the ${LINE_SAID[line]}`) return line;
    for (const [index, flavour] of FLAVOURS.entries()) {
      if (path === `the ${flavour.name} ${LINE_SAID[line]}`) {
        return labelField(line, flavour.key, index === 0);
      }
    }
  }
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
  // Each other flavour's label, from its own boxes.
  const flavourLabels = Object.fromEntries(
    FLAVOURS.slice(1).map((flavour) => [
      flavour.key,
      {
        ingredients: text(labelField("ingredients", flavour.key, false)),
        contains: text(labelField("contains", flavour.key, false)),
        storage: text(labelField("storage", flavour.key, false)),
      },
    ]),
  );
  const company = {
    legalName: text("legalName"),
    nzbn: text("nzbn"),
    address: text("address"),
    gstNumber: text("gstNumber"),
  };
  const gst = text("gst");
  // The tick is for the label's lines exactly as they were when it was
  // asked for. Any other words and it has not been given.
  const linesMark = markOf({ label, flavourLabels });
  const ticked =
    formText(form, "labelChecked") === "yes" &&
    formText(form, "tickFor") === linesMark;
  if (ticked) values.labelChecked = "yes";

  const state = await checkThenChange(
    form,
    {
      label,
      flavourLabels,
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
