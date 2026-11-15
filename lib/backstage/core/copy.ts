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
 *
 * One narrow thing is read differently: the label's own ingredients list
 * (see `ON_A_LABEL`).
 */

import { scanText } from "@/legal/scripts/rules.mjs";
import { STRUCK_OUT } from "@/lib/mail/compose";

import { OpError } from "./errors";
import { asRead } from "./reading";

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

/**
 * Words the Food Standards Code itself puts on an ingredients list: the
 * class name of an additive ("antioxidant (300)", "mineral salt (509)"),
 * and a vitamin or mineral that has been added, by its name. On the label's
 * own list they say what is in the bottle, and the law says they must be
 * there. Anywhere else they read as a claim, and the rules refuse them.
 *
 * So in a part handed in as the label's ingredients list, and nowhere
 * else, these exact words are for a person to confirm against the printed
 * label where they would otherwise be refused outright. Nothing else about
 * the list is read differently: "antioxidant" may be confirmed there, and
 * "anti-inflammatory" under the same rule may not.
 */
const ON_A_LABEL: Readonly<Record<string, RegExp>> = {
  "HC-11": /^antioxidants?$/i,
  "NCC-18": /^(?:vitamins?|minerals?|folic\s+acid)$/i,
};

const ON_A_LABEL_WHY =
  "On the ingredients list this can be the label's own word. A person has to confirm it is exactly what the printed label says.";

export type CheckOptions = {
  /**
   * The names of the parts that are the label's own ingredients list,
   * word for word. See `ON_A_LABEL`.
   */
  readonly labelList?: readonly string[];
  /**
   * The parts are an email written as pieces, with everything that is not
   * our own words struck out (lib/mail/compose.ts). The mark a struck piece
   * leaves is kept where it is, so no rule reads our words on one side of
   * somebody's name into our words on the other. Anywhere else that
   * character is one nobody can see, and is taken out like the rest.
   */
  readonly struckOut?: boolean;
};

/** Every problem in a message, part by part. Finds; does not judge. */
export function checkOutgoing(
  parts: Readonly<Record<string, string>>,
  options: CheckOptions = {},
): OutgoingProblem[] {
  const labelList = new Set(options.labelList ?? []);
  const problems: OutgoingProblem[] = [];
  for (const [part, text] of Object.entries(parts)) {
    const seen = new Set<string>();
    // Read as a person reads it: a word is the same word with a curly
    // quote in it, or with a character nobody can see.
    const read =
      options.struckOut === true
        ? text.split(STRUCK_OUT).map(asRead).join(STRUCK_OUT)
        : asRead(text);
    for (const finding of scanText(read)) {
      // The same words tripping the same rule twice is one thing to fix.
      const key = `${finding.id}:${finding.match.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const labelWord =
        labelList.has(part) &&
        finding.severity === "banned" &&
        (ON_A_LABEL[finding.id]?.test(finding.match.trim()) ?? false);
      problems.push({
        rule: finding.id,
        kind: labelWord ? "restricted" : finding.severity,
        part,
        found: finding.match,
        why: labelWord ? ON_A_LABEL_WHY : finding.why,
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
  options: { readonly checked?: readonly string[] } & CheckOptions = {},
): { readonly cleared: readonly OutgoingProblem[] } {
  const checked = new Set(options.checked ?? []);
  const problems = checkOutgoing(parts, options);
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
