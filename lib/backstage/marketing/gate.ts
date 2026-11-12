/**
 * The check every piece of public copy goes through before a person can
 * approve it: the copy rules, the partner permission gate, and one rule of
 * house style.
 *
 * The copy rules know words. They cannot know that "Ōtaki Rovers" is a club
 * we are talking to and that nobody there has agreed, in writing, to be named
 * by us. The partners table does, so that is checked here too: copy that
 * names a partner with no permission on file gets a banned finding, the same
 * as a banned word, and cannot be approved until the permission is recorded
 * or the name comes out.
 *
 * The house style rule is the one the scanner does not carry: no long dashes
 * in what we write for customers. It is a banned finding too, on our own
 * words only. A customer's review is theirs and is left as they wrote it.
 */

import { eq } from "drizzle-orm";

import { partners, type CopyCheck } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

import { conflict, OpError } from "../core/errors";
import {
  bannedIn,
  checkCopyParts,
  nameFindings,
  restrictedIn,
  withFindings,
  type CopyFinding,
} from "./copy-check";

/** The rule id a partner finding carries, beside the scanner's own ids. */
export const PARTNER_RULE = "NAME-01";

/** Shorter names than this match too much ordinary writing to be useful. */
const SHORTEST_NAME = 4;

/** Lower case, no macrons or accents, single spaces: how names are compared. */
export function foldName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `name` appears in `text` as whole words. Both already folded. */
export function namesIn(text: string, name: string): boolean {
  if (name.length < SHORTEST_NAME) return false;
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,
    "u",
  ).test(text);
}

/** The names of every partner who has not agreed to be named in public. */
export async function loadUnpermittedPartners(db: DbOrTx): Promise<string[]> {
  const rows = await db
    .select({ name: partners.name })
    .from(partners)
    .where(eq(partners.permissionOnFile, false));
  return rows.map((row) => row.name);
}

/** A banned finding for each of those names that appears in the text. */
export function partnerFindings(
  names: readonly string[],
  text: string,
): CopyFinding[] {
  const folded = foldName(text);
  if (folded === "") return [];
  const seen = new Set<string>();
  const findings: CopyFinding[] = [];
  for (const shown of names) {
    const name = foldName(shown);
    if (seen.has(name) || !namesIn(folded, name)) continue;
    seen.add(name);
    findings.push({
      rule: PARTNER_RULE,
      severity: "banned",
      match: shown,
      why: `${shown} has not agreed in writing to be named in public. Record their permission on their page in Partners first, or take the name out.`,
    });
  }
  return findings;
}

/** The rule id for the house style rule below. */
export const STYLE_RULE = "STYLE-01";

/**
 * One rule of our own that the scanner does not carry: no long dashes in
 * anything we write for customers. It applies to our words (an email, a
 * caption), not to a customer's own (a review).
 */
export function styleFindings(text: string): CopyFinding[] {
  return /\u{2014}/u.test(text)
    ? [
        {
          rule: STYLE_RULE,
          severity: "banned",
          match: "a long dash",
          why: "No long dashes in anything we write for customers. Use a full stop, a comma or a colon.",
        },
      ]
    : [];
}

/**
 * Check pieces of customer-facing text that are read together: the copy
 * rules over all of them, then the partner gate, then (for words that are
 * ours) the house style rule.
 *
 * `voice` is whose words they are. `unpermitted` saves reading the partners
 * again when many things are checked in a row.
 */
export async function checkPublicCopy(
  db: DbOrTx,
  parts: readonly string[],
  now: Date,
  options: {
    readonly voice?: "ours" | "theirs";
    readonly unpermitted?: readonly string[];
  } = {},
): Promise<CopyCheck> {
  const whole = parts.join("\n");
  return withFindings(checkCopyParts(parts, now), [
    ...partnerFindings(
      options.unpermitted ?? (await loadUnpermittedPartners(db)),
      whole,
    ),
    ...(options.voice === "theirs" ? [] : styleFindings(whole)),
  ]);
}

/**
 * Refuse to let copy through while it has a banned finding. `what` and
 * `done` make the sentence: "This campaign cannot be approved: ...".
 */
export function refuseBanned(
  check: CopyCheck,
  what: string,
  done: string,
): void {
  const banned = bannedIn(check);
  if (banned.length === 0) return;
  throw conflict(
    `${what} cannot be ${done}: ${nameFindings(banned)} ${banned.length === 1 ? "is" : "are"} not allowed. The copy check says why. Change the wording and save it again.`,
  );
}

/**
 * Refuse to let copy with a restricted finding through until the person
 * approving has ticked that they have read it.
 */
export function requireRestrictedRead(
  check: CopyCheck,
  acknowledged: boolean,
): readonly string[] {
  const restricted = restrictedIn(check);
  if (restricted.length > 0 && !acknowledged) {
    const message = `Some of the wording needs a second look: ${nameFindings(restricted)}. Read what the copy check says about it, then tick the box to say it is right.`;
    throw new OpError("invalid_input", message, {
      acknowledgeRestricted: message,
    });
  }
  return [...new Set(restricted.map((finding) => finding.rule))];
}
