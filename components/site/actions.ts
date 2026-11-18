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

/**
 * A review from the shop's form (/review).
 *
 * It lands waiting for a person to read it (Marketing, Reviews, in the back
 * end) and is never shown until somebody publishes it. Nothing typed here is
 * trusted: the fields are checked again by the operation that saves them.
 */

export type ReviewField = "rating" | "body" | "name";

export type ReviewState = {
  /** "slow": too many reviews from one address just now (lib/shop/limit.ts). */
  readonly status: "idle" | "sent" | "invalid" | "failed" | "slow";
  /** Which fields need putting right, with an "invalid". */
  readonly problems?: readonly ReviewField[];
  /** What was typed, handed back with a no so nobody has to type it again. */
  readonly typed?: {
    readonly rating: string;
    readonly body: string;
    readonly name: string;
    readonly order: string;
    readonly email: string;
  };
};

/** At most this many letters of each field are handed back or read. */
const HANDED_BACK = { rating: 1, body: 1500, name: 60, order: 20, email: 254 };

export async function sendReview(
  _previous: ReviewState,
  form: FormData,
): Promise<ReviewState> {
  const trap = form.get("website");
  if (typeof trap === "string" && trap.trim() !== "") {
    return { status: "sent" };
  }

  const text = (name: keyof typeof HANDED_BACK): string => {
    const value = form.get(name);
    return typeof value === "string"
      ? value.slice(0, HANDED_BACK[name] + 1)
      : "";
  };
  const typed = {
    rating: text("rating").trim(),
    body: text("body").replace(/\r\n?/g, "\n").trim(),
    name: text("name").replace(/\s+/g, " ").trim(),
    order: text("order").trim(),
    email: text("email").trim(),
  };

  const rating = /^[1-5]$/.test(typed.rating) ? Number(typed.rating) : null;
  const problems: ReviewField[] = [];
  if (rating === null) problems.push("rating");
  if (typed.body.length < 2 || typed.body.length > HANDED_BACK.body) {
    problems.push("body");
  }
  if (typed.name.length < 1 || typed.name.length > HANDED_BACK.name) {
    problems.push("name");
  }
  if (rating === null || problems.length > 0) {
    return {
      status: "invalid",
      problems,
      typed: { ...typed, body: typed.body.slice(0, HANDED_BACK.body) },
    };
  }

  const counted = await countAsk("review", await headers());
  if (!counted.allowed) return { status: "slow", typed };

  const store = getStore();
  if (store.saveReview === undefined) return { status: "failed", typed };
  try {
    await store.saveReview({
      rating,
      body: typed.body,
      displayName: typed.name,
      ...(typed.order === "" ? {} : { orderNumber: typed.order.slice(0, 20) }),
      ...(typed.email === "" ? {} : { email: typed.email.slice(0, 254) }),
    });
  } catch {
    return { status: "failed", typed };
  }
  return { status: "sent" };
}
