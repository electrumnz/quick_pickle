/**
 * The last check on words that are about to leave.
 *
 * `npm run audit:copy` reads the repository. But not every word a customer
 * sees is in the repository: a reply typed in the inbox, a campaign written
 * on a Tuesday, a template kept in the database, anything a bot drafts. So
 * every operation that sends or publishes words runs them through here
 * first, on the finished text, whoever wrote it. Same rules, same reasons
 * (legal/COPY-RULES.md), applied at the door instead of in the source.
 *
 *   banned       never goes out. No role and no tick-box clears it.
 *   restricted   goes out only if a person has recorded that they checked
 *                the condition the rule names (it is true, it is dated, it
 *                has its terms). A bot cannot record that.
 *   style        the house rules for anything a customer reads. For now,
 *                one: no em dashes.
 */

import { scanText } from "@/legal/scripts/rules.mjs";

import { OpError } from "./errors";

export type OutgoingProblem = {
  /** The rule's id, as in legal/COPY-RULES.md, or STYLE-… for a house rule. */
  readonly rule: string;
  readonly kind: "banned" | "restricted" | "style";
  /** Which part of the message it is in: "subject", "body". */
  readonly part: string;
  /** The words that tripped it, as written. */
  readonly found: string;
  readonly why: string;
};

const EM_DASH = /—/;

/** Every problem in a message, part by part. Finds; does not judge. */
export function checkOutgoing(
  parts: Readonly<Record<string, string>>,
): OutgoingProblem[] {
  const problems: OutgoingProblem[] = [];
  for (const [part, text] of Object.entries(parts)) {
    const seen = new Set<string>();
    for (const finding of scanText(text)) {
      // The same words tripping the same rule twice is one thing to fix.
      const key = `${finding.id}:${finding.match.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push({
        rule: finding.id,
        kind: finding.severity,
        part,
        found: finding.match,
        why: finding.why,
      });
    }
    if (EM_DASH.test(text)) {
      problems.push({
        rule: "STYLE-01",
        kind: "style",
        part,
        found: "—",
        why: "No em dashes in anything a customer reads. Use a full stop, a comma or a colon.",
      });
    }
  }
  return problems;
}

function describe(problem: OutgoingProblem): string {
  return `"${problem.found}" in the ${problem.part}: ${problem.why} (${problem.rule})`;
}

/**
 * Refuse to go on if the message cannot be sent as it stands.
 *
 * `checked` lists the RESTRICTED rules a person has confirmed for this
 * message. It clears those and nothing else: a banned term and a style
 * problem are refused whatever it says. Returns what was cleared, so the
 * caller can write it in the activity log.
 */
export function refuseUnsendable(
  parts: Readonly<Record<string, string>>,
  options: { readonly checked?: readonly string[] } = {},
): { readonly cleared: readonly OutgoingProblem[] } {
  const checked = new Set(options.checked ?? []);
  const problems = checkOutgoing(parts);
  const cleared = problems.filter(
    (problem) => problem.kind === "restricted" && checked.has(problem.rule),
  );
  const standing = problems.filter((problem) => !cleared.includes(problem));
  if (standing.length === 0) return { cleared };

  const banned = standing.filter((problem) => problem.kind !== "restricted");
  const needsCheck = standing.filter(
    (problem) => problem.kind === "restricted",
  );
  const lines = [
    ...(banned.length > 0
      ? [`This cannot go out as written. ${banned.map(describe).join(" ")}`]
      : []),
    ...(needsCheck.length > 0
      ? [
          `${banned.length > 0 ? "And this" : "This"} needs a person to confirm it is true before it goes out: ${needsCheck.map(describe).join(" ")}`,
        ]
      : []),
  ];
  const fields: Record<string, string> = {};
  for (const problem of standing) {
    if (!(problem.part in fields)) fields[problem.part] = describe(problem);
  }
  throw new OpError("invalid_input", lines.join(" "), fields);
}
