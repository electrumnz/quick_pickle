/**
 * The copy check: the scanner's rules, applied to one piece of text at the
 * moment it is saved.
 *
 * Quick Pickle is a food, and a food may not be advertised on what it does to
 * a body (legal/COPY-RULES.md). The scanner in legal/scripts/audit-copy.mjs
 * enforces that on the site's own files. An email, a caption or a review is
 * typed into the back end instead, so it is checked here, with the same rule
 * table (copy-rules.generated.ts is lifted straight out of the scanner and a
 * test fails if the two ever differ).
 *
 * Two things are different from the scanner, both on purpose:
 *
 *   1. Everything checked here is treated as something a customer will read,
 *      so every rule applies, the "consumer only" ones included.
 *   2. The scanner's inline markers (ignore this line, approved by a person)
 *      mean nothing here. Somebody typing one into a caption must not switch
 *      the check off. A restricted finding is cleared by the person approving
 *      ticking that they have read it, and a banned one by rewording.
 *
 * The check is a net, not a guarantee: it knows words, not meanings. The
 * person approving still reads what they approve.
 */

import type { CopyCheck } from "@/db/schema";

import {
  COPY_RULES,
  COPY_TERMS_OF_ART,
  SEGMENT_BREAK,
} from "./copy-rules.generated";

export type CopyFinding = CopyCheck["findings"][number];

/** What a check comes to. `unchecked` is text nobody has run it over yet. */
export type CopyVerdict = "clean" | "restricted" | "banned" | "unchecked";

const withGlobal = (flags: string) =>
  flags.includes("g") ? flags : `${flags}g`;

const RULES = COPY_RULES.map((rule) => ({
  id: rule.id,
  severity: rule.severity,
  why: rule.why,
  re: new RegExp(rule.source, withGlobal(rule.flags)),
}));

const TERMS = COPY_TERMS_OF_ART.map((term) => ({
  rules: term.rules,
  re: new RegExp(term.source, withGlobal(term.flags)),
}));

/** Enough to see what is wrong without storing an essay on every record. */
const MAX_FINDINGS = 40;
const MAX_MATCH = 80;

/**
 * The text as a person would read it, which is what the rules have to see.
 *
 * Phones type curly quotes, and the rules are written with straight ones.
 * Invisible characters (a soft hyphen, a zero-width space) can sit inside a
 * word without showing, and compatibility forms (full-width letters, the "fi"
 * ligature) read as ordinary letters. All of those are folded away first.
 */
function asRead(text: string): string {
  return (
    text
      .normalize("NFKC")
      .replace(/[\u{2018}\u{2019}\u{201A}\u{201B}\u{2032}]/gu, "'")
      .replace(/[\u{201C}\u{201D}\u{201E}\u{201F}\u{2033}]/gu, '"')
      .replace(/[\u{00AD}\u{200B}-\u{200D}\u{2060}\u{FEFF}]/gu, "")
      // Control characters, the scanner's own segment break among them. Tabs
      // and line ends stay.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
  );
}

type Span = { readonly start: number; readonly end: number };

/** Where a term of art excuses a rule ("best before" for the superlative rule). */
function excusedSpans(ruleId: string, text: string): Span[] {
  const spans: Span[] = [];
  for (const term of TERMS) {
    if (!term.rules.includes(ruleId)) continue;
    for (const match of text.matchAll(term.re)) {
      if (match[0].length === 0) continue;
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return spans;
}

/** Every finding in text that has already been folded, banned ones first. */
function findIn(text: string): CopyFinding[] {
  type Found = CopyFinding & { readonly at: number };
  const found = new Map<string, Found>();

  for (const rule of RULES) {
    let excused: Span[] | null = null;
    for (const match of text.matchAll(rule.re)) {
      const phrase = match[0];
      if (phrase.length === 0) continue;
      const start = match.index;
      const end = start + phrase.length;
      excused ??= excusedSpans(rule.id, text);
      if (excused.some((span) => start < span.end && end > span.start)) {
        continue;
      }
      const shown = phrase.replace(/\s+/g, " ").trim().slice(0, MAX_MATCH);
      const key = `${rule.id}|${shown.toLowerCase()}`;
      if (found.has(key)) continue;
      found.set(key, {
        rule: rule.id,
        severity: rule.severity,
        match: shown,
        why: rule.why,
        at: start,
      });
    }
  }

  return [...found.values()]
    .sort(
      (a, b) =>
        Number(b.severity === "banned") - Number(a.severity === "banned") ||
        a.at - b.at ||
        a.rule.localeCompare(b.rule),
    )
    .map(({ rule, severity, match, why }) => ({ rule, severity, match, why }));
}

function scan(text: string, now: Date): CopyCheck {
  const findings = findIn(text).slice(0, MAX_FINDINGS);
  return { at: now.toISOString(), ok: findings.length === 0, findings };
}

/**
 * Every finding in a piece of text, with no cap. `checkCopy` keeps the first
 * forty, which is plenty to act on; this is for comparing with the scanner.
 */
export function allCopyFindings(text: string): CopyFinding[] {
  return findIn(asRead(text));
}

/**
 * Check one piece of customer-facing text against the copy rules.
 *
 * `ok` is true only when nothing at all was found. A `banned` finding must
 * stop the text being approved or published. A `restricted` one may pass once
 * the person approving has read it and said so.
 */
export function checkCopy(text: string, now: Date): CopyCheck {
  return scan(asRead(text), now);
}

/**
 * Check several pieces that are read together (a subject, a preheader and a
 * body) as one. A rule cannot match across the join, the same way the scanner
 * will not match from one string in a file into the next.
 */
export function checkCopyParts(parts: readonly string[], now: Date): CopyCheck {
  return scan(
    parts
      .map(asRead)
      .filter((part) => part.trim() !== "")
      .join(`\n${SEGMENT_BREAK}\n`),
    now,
  );
}

/** Put extra findings (ones the word rules cannot know about) into a check. */
export function withFindings(
  check: CopyCheck,
  extra: readonly CopyFinding[],
): CopyCheck {
  if (extra.length === 0) return check;
  const findings = [...extra, ...check.findings]
    .sort(
      (a, b) =>
        Number(b.severity === "banned") - Number(a.severity === "banned"),
    )
    .slice(0, MAX_FINDINGS);
  return { at: check.at, ok: false, findings };
}

export function bannedIn(
  check: CopyCheck | null | undefined,
): readonly CopyFinding[] {
  return (check?.findings ?? []).filter(
    (finding) => finding.severity === "banned",
  );
}

export function restrictedIn(
  check: CopyCheck | null | undefined,
): readonly CopyFinding[] {
  return (check?.findings ?? []).filter(
    (finding) => finding.severity === "restricted",
  );
}

export function copyVerdict(check: CopyCheck | null | undefined): CopyVerdict {
  if (check === null || check === undefined) return "unchecked";
  if (bannedIn(check).length > 0) return "banned";
  if (restrictedIn(check).length > 0) return "restricted";
  return "clean";
}

/** `"cramps" (rule TH-04) and "60 seconds flat" (rule QP-01)` */
export function nameFindings(
  findings: readonly CopyFinding[],
  most = 3,
): string {
  const named = findings
    .slice(0, most)
    .map((finding) => `"${finding.match}" (rule ${finding.rule})`);
  const more = findings.length - named.length;
  if (more > 0) named.push(`${String(more)} more`);
  if (named.length <= 1) return named[0] ?? "";
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1] ?? ""}`;
}

/**
 * The rule groups that are about what the product does to a body: health
 * effects, conditions, hydration and sport, and the concept deck's own lines.
 */
export function isBodyClaim(finding: CopyFinding): boolean {
  return /^(?:HC|TH|EL|QP|WILD)-/.test(finding.rule);
}
