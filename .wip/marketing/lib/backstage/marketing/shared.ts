/**
 * Small things every part of the marketing area uses.
 */

import { z } from "zod";

import { conflict } from "../core/errors";
import type { OpContext } from "../core/op";

/** An id as it arrives from a form or a link. A wrong one is "not found". */
export const recordId = z.string().trim().min(1, "Which one?").max(60);

/**
 * For a write that is guarded on what was read a moment ago ("still a draft,
 * and still these words"). When the guard matched nothing, somebody else got
 * there first and nothing was written, so this refuses. It is what stops an
 * approval landing on words that changed underneath it, or a campaign being
 * taken back to draft in the instant it is queued.
 */
export function refuseIfMoved(written: readonly unknown[], what: string): void {
  if (written.length > 0) return;
  throw conflict(
    `${what} was changed by somebody else at the same moment. Open it again and have another look.`,
  );
}

/** The signed-in person or bot behind a change, or null for the system. */
export function userIdOf(ctx: OpContext): string | null {
  return ctx.actor.type === "system" ? null : ctx.actor.userId;
}

/** Escape the characters LIKE treats as wildcards. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** "1 person", "41 people". */
export function people(count: number): string {
  return `${String(count)} ${count === 1 ? "person" : "people"}`;
}

/** "1 email", "3 emails". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The first words of something long, for a list. */
export function excerpt(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The tick a person gives to say they have read the wording a restricted
 * rule picked out, and that it is right.
 */
export const acknowledgeRestricted = z.boolean().default(false);
