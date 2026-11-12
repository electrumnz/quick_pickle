/**
 * The copy gate: every email is read against the copy rules before it is
 * queued, whoever wrote it.
 *
 * Quick Pickle is a food, and a food may not be sold on what it does to a
 * body (legal/COPY-RULES.md). The scanner in legal/scripts/audit-copy.mjs
 * holds the site's own files to that. An email is typed into the back end
 * instead, by a person, a template or a bot, so the same rule table is run
 * over its final words here, inside the operation that queues it. An email
 * with a banned term in it is refused and says which words to change. So is
 * one with an em dash, which this business does not send.
 *
 * Three things differ from the scanner, all on purpose:
 *
 *   1. An email is something a customer reads, so every rule applies, the
 *      "consumer only" ones included.
 *   2. The scanner's inline markers mean nothing here. Typing one into a
 *      reply must not switch the check off.
 *   3. The one sentence COPY-RULES itself tells us to answer a body question
 *      with (section 5, rule 2) is let through, word for word and only word
 *      for word. It names the thing we do not claim in order to decline.
 *
 * It is a net, not a judge: it knows words, not meanings. A restricted
 * finding does not stop an email. It is handed back so a screen can show it.
 *
 * The marketing area has the same check for campaigns and captions
 * (lib/backstage/marketing/copy-check.ts), built from the same generated
 * table. They were written side by side by two hands and want to be one
 * module: keep that one, and have this file call it.
 */

import {
  COPY_RULES,
  COPY_TERMS_OF_ART,
  SEGMENT_BREAK,
} from "./copy-rules.generated";

export type CopyFinding = {
  readonly rule: string;
  readonly severity: "banned" | "restricted";
  /** The words that matched, as written. */
  readonly match: string;
  readonly why: string;
};

export type CopyGateResult = {
  /** True when the email may be queued. */
  readonly ok: boolean;
  readonly banned: readonly CopyFinding[];
  readonly restricted: readonly CopyFinding[];
  readonly emDash: boolean;
};

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

const MAX_FINDINGS = 20;
const MAX_MATCH = 80;
const EM_DASH = "—";

/**
 * The words legal/COPY-RULES.md section 5 gives for answering a question
 * about what the product does to a body. Nothing else is let through.
 */
// copy-audit-ignore-start: the disclaimer from legal/COPY-RULES.md section 5, word for word. It says what we do NOT claim.
const APPROVED_SENTENCE =
  "Quick Pickle is a food and we don't make health claims about it.";
// copy-audit-ignore-end

/**
 * The text as a person would read it, which is what the rules have to see:
 * curly quotes made straight, invisible characters taken out, look-alike
 * letter forms folded to the ordinary ones.
 */
function asRead(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u{2018}\u{2019}\u{201A}\u{201B}\u{2032}]/gu, "'")
    .replace(/[\u{201C}\u{201D}\u{201E}\u{201F}\u{2033}]/gu, '"')
    .replace(/[\u{00AD}\u{200B}-\u{200D}\u{2060}\u{FEFF}]/gu, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}

const escapeForPattern = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace every run that matches with spaces of the same length. */
function blank(text: string, pattern: RegExp): string {
  return text.replace(pattern, (found) => " ".repeat(found.length));
}

type Span = { readonly start: number; readonly end: number };

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

export type CopyGateOptions = {
  /**
   * Words that are the recipient's own and say nothing about the product:
   * their name, the name of their shop. A customer called Mrs Best can be
   * greeted by name.
   */
  readonly personal?: readonly string[];
};

/**
 * Check the parts of an email that are read together (the subject, the
 * body). A rule cannot match across the join between two parts.
 */
export function checkOutgoingCopy(
  parts: readonly string[],
  options: CopyGateOptions = {},
): CopyGateResult {
  const emDash = parts.some((part) => part.includes(EM_DASH));

  let text = parts
    .map(asRead)
    .filter((part) => part.trim() !== "")
    .join(`\n${SEGMENT_BREAK}\n`);

  text = blank(
    text,
    new RegExp(escapeForPattern(APPROVED_SENTENCE).replace(/ /g, "\\s+"), "gi"),
  );
  for (const words of options.personal ?? []) {
    for (const word of asRead(words).split(/[^\p{L}\p{N}'-]+/u)) {
      if (word.length < 2) continue;
      text = blank(
        text,
        new RegExp(
          `(?<![\\p{L}\\p{N}])${escapeForPattern(word)}(?![\\p{L}\\p{N}])`,
          "giu",
        ),
      );
    }
  }

  const found = new Map<string, CopyFinding & { readonly at: number }>();
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
  const all = [...found.values()]
    .sort((a, b) => a.at - b.at || a.rule.localeCompare(b.rule))
    .map(({ rule, severity, match, why }) => ({ rule, severity, match, why }));
  const banned = all
    .filter((finding) => finding.severity === "banned")
    .slice(0, MAX_FINDINGS);
  const restricted = all
    .filter((finding) => finding.severity === "restricted")
    .slice(0, MAX_FINDINGS);

  return { ok: banned.length === 0 && !emDash, banned, restricted, emDash };
}

/** `"cramps" and "60 seconds flat"` */
function named(findings: readonly CopyFinding[], most = 3): string {
  const words = [...new Set(findings.map((finding) => `"${finding.match}"`))];
  const shown = words.slice(0, most);
  const more = words.length - shown.length;
  if (more > 0) shown.push(`${String(more)} more`);
  if (shown.length <= 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1] ?? ""}`;
}

/**
 * Why an email was refused, in words for whoever wrote it, or null if it
 * may go.
 */
export function copyRefusal(result: CopyGateResult): string | null {
  if (result.ok) return null;
  const reasons: string[] = [];
  if (result.banned.length > 0) {
    const one = result.banned.length === 1;
    reasons.push(
      `It says ${named(result.banned)}, which ${one ? "is" : "are"} not ${one ? "something" : "things"} we can say about a food (legal/COPY-RULES.md, ${[...new Set(result.banned.map((finding) => finding.rule))].slice(0, 4).join(", ")}). Reword it and send again.`,
    );
  }
  if (result.emDash) {
    reasons.push(
      "It has an em dash in it. Use a full stop, a comma or a colon.",
    );
  }
  return `This email was not sent. ${reasons.join(" ")}`;
}
