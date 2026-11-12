"use server";

import { z } from "zod";

import { getStore } from "@/lib/shop/store";

/**
 * Pickle Crew sign-up.
 *
 * A Server Action is reachable by a direct POST, not only through the form,
 * so everything is validated here and nothing from the request is trusted.
 */

export type CrewState = {
  readonly status: "idle" | "joined" | "invalid" | "failed";
};

const emailSchema = z.string().trim().toLowerCase().max(254).email();

export async function joinCrew(
  _previous: CrewState,
  form: FormData,
): Promise<CrewState> {
  // A filled honeypot is a script. Say yes and store nothing.
  const trap = form.get("website");
  if (typeof trap === "string" && trap.trim() !== "") {
    return { status: "joined" };
  }

  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { status: "invalid" };

  try {
    await getStore().saveSignup({
      email: parsed.data,
      source: "crew-form",
      joinedAt: new Date().toISOString(),
    });
    return { status: "joined" };
  } catch {
    return { status: "failed" };
  }
}
