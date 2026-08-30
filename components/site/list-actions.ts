"use server";

import { redirect } from "next/navigation";

import {
  normaliseEmail,
  normaliseVenue,
  safeSourcePath,
  SIGNUP_PARAM,
  SIGNUP_PROBLEM_PARAM,
  type SignupKind,
} from "./list";
import { recordSignup } from "./list-store";

/**
 * Joining the list, and asking for samples.
 *
 * Two Server Actions posted from plain `<form>` elements, which is what makes
 * them work with JavaScript switched off: the browser posts, the action runs,
 * and the answer comes back as a redirect to a URL that carries the outcome.
 * With scripting on, React intercepts the same form and runs the same action —
 * one code path, two transports, exactly as the buy path in
 * `components/product/actions.ts` does it.
 *
 * The address is written down and nothing else is done with it. There is no
 * third-party pixel on the post, no analytics event and no enrichment call: the
 * Privacy Act 2020's first information privacy principle is that you do not
 * collect what you do not need, and the only thing needed to send somebody an
 * email is the address they gave you.
 */

function readString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/** `/x?signed-up=list#buy`, built so a fragment survives the query. */
function outcomeUrl(
  path: string,
  fragment: string,
  param: string,
  value: string,
): string {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}${param}=${encodeURIComponent(value)}${fragment}`;
}

async function submit(
  form: FormData,
  kind: SignupKind,
  fallbackPath: string,
  fragment: string,
): Promise<void> {
  const path = safeSourcePath(readString(form, "sourcePath"), fallbackPath);
  const email = normaliseEmail(readString(form, "email"));

  if (email === null) {
    redirect(outcomeUrl(path, fragment, SIGNUP_PROBLEM_PARAM, "bad-email"));
  }

  let problem: string | null = null;
  try {
    await recordSignup({
      kind,
      email,
      venue:
        kind === "trade" ? normaliseVenue(readString(form, "venue")) : null,
      sourcePath: path,
    });
  } catch {
    // The raw failure can name a table, a column or a connection string, and
    // none of that belongs on a public page. What the person needs is whether
    // their address was recorded — it was not — and what to do instead.
    problem = "store";
  }

  // redirect() signals by throwing, so it is called outside the try above and
  // is never swallowed by the catch that is there to classify a write failure.
  redirect(
    problem === null
      ? outcomeUrl(path, fragment, SIGNUP_PARAM, kind)
      : outcomeUrl(path, fragment, SIGNUP_PROBLEM_PARAM, problem),
  );
}

export async function joinList(form: FormData): Promise<void> {
  await submit(form, "list", "/", "#buy");
}

export async function requestSamples(form: FormData): Promise<void> {
  await submit(form, "trade", "/wholesale", "#samples");
}
