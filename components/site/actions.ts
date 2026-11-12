"use server";

import { headers } from "next/headers";

import { z } from "zod";

import { countAsk } from "@/lib/shop/caller";
import { getStore } from "@/lib/shop/store";

/**
 * Pickle Crew sign-up.
 *
 * A Server Action is reachable by a direct POST, not only through the form,
 * so everything is validated here and nothing from the request is trusted.
 */

export type CrewState = {
  /** "slow": too many sign-ups from one address just now (lib/shop/limit.ts). */
  readonly status: "idle" | "joined" | "invalid" | "failed" | "slow";
  /**
   * The code a new member is given, when one is set up and could be used
   * right now: the word, and what it gives in a few words.
   */
  readonly welcome?: { readonly code: string; readonly label: string };
  /** What was typed, handed back with a no so nobody has to type it again. */
  readonly email?: string;
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

  const typed = form.get("email");
  const email = typeof typed === "string" ? typed.slice(0, 254) : "";
  const parsed = emailSchema.safeParse(typed);
  if (!parsed.success) return { status: "invalid", email };

  const counted = await countAsk("crew", await headers());
  if (!counted.allowed) return { status: "slow", email };

  try {
    await getStore().saveSignup({
      email: parsed.data,
      source: "crew-form",
      joinedAt: new Date().toISOString(),
    });
  } catch {
    return { status: "failed", email };
  }
  // They are in. A welcome code is a nicety on top: not being able to read
  // it must never turn a sign-up that worked into one that looks failed.
  try {
    const welcome = await getStore().welcomeCode?.();
    if (welcome?.ok === true) {
      return {
        status: "joined",
        welcome: { code: welcome.code, label: welcome.label },
      };
    }
  } catch {
    // No code to give. They are still in.
  }
  return { status: "joined" };
}
