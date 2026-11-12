import "server-only";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import type { Caller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { changeShop, checkShopChange } from "@/lib/backstage/shop/ops";

/**
 * Changing the shop is two presses, on purpose, and this is the two of
 * them, for any form that changes it (the shop's own, and the label and
 * the company).
 *
 * The first press changes nothing: it says, a sentence for each thing,
 * exactly what would move. The second makes the change, and will only make
 * the one that was shown, to the shop that was shown. Type something else
 * in between, or let somebody else change the shop in between, and it
 * shows what it would do now instead. A price with a slipped digit, or an
 * ingredient typed wrong, is live for every customer the moment it is
 * saved, so it is read back first.
 */

export type ShopFormState = {
  readonly step: "idle" | "checked" | "done";
  /** What was typed, handed back so nothing has to be typed twice. */
  readonly values: Readonly<Record<string, string>>;
  readonly error: string | null;
  /** Which box each problem is about, by the box's name. */
  readonly fields: Readonly<Record<string, string>>;
  /** What would move (after a check) or what did (after a change). */
  readonly changed: readonly string[];
  /** A note that is not a problem: nothing to change, or checked again. */
  readonly note: string | null;
  /** A mark of exactly what the check was for. The second press sends it. */
  readonly checkedFor: string | null;
  /** The shop's word when it was checked. */
  readonly version: string | null;
  /**
   * Set when words need checking against the printed label: a mark of the
   * words the tick box is being shown for. A tick only counts for those.
   */
  readonly tickFor: string | null;
};

/** A form that has just been read, with nothing said about it yet. */
export function blankState(values: Record<string, string>): ShopFormState {
  return {
    step: "idle",
    values,
    error: null,
    fields: {},
    changed: [],
    note: null,
    checkedFor: null,
    version: null,
    tickFor: null,
  };
}

/** A short mark for a value: the same value, the same mark. */
export function markOf(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 32);
}

type Change = z.input<typeof changeShop.input>;

/**
 * The two presses. `asked` is the change as the form has it; `boxFor`
 * turns the operation's name for a field into the form's.
 */
export async function checkThenChange(
  form: FormData,
  asked: Change,
  blank: ShopFormState,
  boxFor: (path: string) => string,
  caller: Caller,
): Promise<ShopFormState> {
  const refused = (error: unknown): ShopFormState => {
    if (!(error instanceof OpError)) throw error;
    const boxes: Record<string, string> = {};
    for (const [path, said] of Object.entries(error.fields)) {
      boxes[boxFor(path)] = said;
    }
    return { ...blank, error: error.message, fields: boxes };
  };

  // What it would do, with nothing saved.
  let shown: { changed: string[]; version: string };
  try {
    shown = await execute(checkShopChange, asked, caller);
  } catch (error) {
    return refused(error);
  }
  if (shown.changed.length === 0) {
    return { ...blank, note: "Nothing to change: it is already like that." };
  }
  const mark = markOf([asked, shown.version]);
  const checked: ShopFormState = {
    ...blank,
    step: "checked",
    changed: shown.changed,
    checkedFor: mark,
    version: shown.version,
  };

  if (form.get("intent") !== "change") return checked;
  // The second press. Only for exactly what the first one showed.
  if (form.get("checkedFor") !== mark) {
    return {
      ...checked,
      note: "Something changed since that was checked, so here it is again as it would be now.",
    };
  }
  try {
    const done = await execute(
      changeShop,
      { ...asked, expectVersion: shown.version },
      caller,
    );
    // The pages in the back end that show what the shop is selling.
    revalidatePath("/backstage", "layout");
    return { ...blank, step: "done", changed: done.changed };
  } catch (error) {
    return refused(error);
  }
}
