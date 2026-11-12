"use server";

import { redirect } from "next/navigation";

import { staffCaller } from "@/lib/backstage/auth/current";
import { addresses } from "@/lib/backstage/connect/http";
import {
  checkConnectRequest,
  grantConnection,
} from "@/lib/backstage/connect/oauth";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { backstageMode } from "@/lib/backstage/mode";
import { formText, sayAndGo } from "@/lib/backstage/ui/submit";

/** Where a person lands when a request cannot be honoured. */
const SETTINGS = "/backstage/settings/claude";

/**
 * A person's answer on the consent screen.
 *
 * Yes hands the app a code and sends the person back to it. No sends them
 * back with a plain refusal. Either way the address they are sent to is
 * checked again here, to the letter, before anybody is sent anywhere: the
 * fields on the form are only what the browser says they were.
 */
export async function decideConnectAction(form: FormData): Promise<void> {
  if (backstageMode() !== "live") {
    sayAndGo(SETTINGS, "There is nothing real here to connect to.", "bad");
  }
  const caller = await staffCaller();
  const asked = {
    clientId: formText(form, "client_id"),
    redirectUri: formText(form, "redirect_uri"),
    codeChallenge: formText(form, "code_challenge"),
    resource: formText(form, "resource") || null,
  };
  const state = formText(form, "state").slice(0, 1000);
  const yes = formText(form, "decision") === "yes";

  let back: URL;
  try {
    // Checked before anybody is sent anywhere, whatever they answered.
    await execute(checkConnectRequest, asked, caller);
    back = new URL(asked.redirectUri);
    if (yes) {
      const { code } = await execute(
        grantConnection,
        {
          ...asked,
          role: formText(form, "role") === "staff" ? "staff" : "viewer",
        },
        caller,
      );
      back.searchParams.set("code", code);
    } else {
      back.searchParams.set("error", "access_denied");
      back.searchParams.set(
        "error_description",
        "The person said no to connecting.",
      );
    }
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    sayAndGo(SETTINGS, error.message, "bad");
  }
  if (state !== "") back.searchParams.set("state", state);
  // So the app can tell the answer came from here and nowhere else.
  back.searchParams.set("iss", addresses().issuer);
  redirect(back.toString());
}
