/**
 * The last step of a back-end form: run an operation, then go somewhere and
 * say how it went.
 *
 * Every plain form in the back end posts to a Server Action that ends by
 * calling this. On success the browser lands on `to` with a short message; on
 * a refusal it lands back where it was with the reason. Both are ordinary
 * redirects, so the forms work with scripting off and a reload never repeats
 * the change.
 *
 * The sentence travels in the address, sealed (./notice.ts), so that only
 * the back end's own words are ever shown in a notice box.
 */

import "server-only";

import { redirect } from "next/navigation";
import type { z } from "zod";

import { staffCaller } from "../auth/current";
import { OpError } from "../core/errors";
import { execute, type Op } from "../core/op";
import { withNotice } from "./notice";

export async function submit<I extends z.ZodType, O>(
  op: Op<I, O>,
  input: z.input<I>,
  options: {
    /** Where to return on a refusal. */
    readonly back: string;
    /** What to say when it worked. */
    readonly done: string | ((output: O) => string);
    /** Where to go when it worked. Defaults to `back`. */
    readonly to?: string | ((output: O) => string);
  },
): Promise<never> {
  let target: string;
  try {
    const output = await execute(op, input, await staffCaller());
    const to =
      typeof options.to === "function"
        ? options.to(output)
        : (options.to ?? options.back);
    const done =
      typeof options.done === "function" ? options.done(output) : options.done;
    target = withNotice(to, done, "good");
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    // The first field's message is the most useful single thing to say.
    const first = Object.values(error.fields)[0];
    target = withNotice(
      options.back,
      first !== undefined && error.code === "invalid_input"
        ? first
        : error.message,
      "bad",
    );
  }
  redirect(target);
}

/**
 * Go to a page and say something there, for an action that does more than
 * one thing and has to choose its own words. It redirects, so nothing after
 * it runs: never call it from inside a `try` that catches everything.
 */
export function sayAndGo(
  path: string,
  notice: string,
  tone: "good" | "bad",
): never {
  redirect(withNotice(path, notice, tone));
}

export function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** A dollars-and-cents field ("12.50", "$12.5", "12") as integer cents. */
export function formCents(form: FormData, key: string): number {
  const raw = formText(form, key).replace(/[$,\s]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) return Number.NaN;
  const [dollars = "0", fraction = ""] = raw.split(".");
  return Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
}
