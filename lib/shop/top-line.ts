/**
 * The line across the top of the shop: short lines running right to left,
 * with a sparkle between them.
 *
 * The site ships with its own (TICKER in content/site.ts). The back end can
 * put other words there (lib/backstage/shop/top-line.ts): a draft, the copy
 * rules, and a publish that needs a yes, the way a landing page has them.
 *
 * This file is the part both sides read: how many lines there may be and
 * how long each may be. It imports nothing, so a page can use it without
 * pulling anything in. (How the band is laid out so that it is always full
 * is components/ui/ticker-fit.ts.)
 */

/** The most lines the band holds. */
export const TOP_LINE_MOST = 8;

/** The longest one line may be. It is set small, in capitals. */
export const TOP_LINE_LETTERS = 60;

/**
 * What was typed, a line to a row: runs of spaces squeezed to one, nothing
 * at either end, and empty rows dropped.
 */
export function tidyTopLines(typed: string | readonly string[]): string[] {
  const rows = typeof typed === "string" ? typed.split(/\r?\n/) : typed;
  return rows
    .map((row) => row.replace(/\s+/g, " ").trim())
    .filter((row) => row !== "");
}

/**
 * What stops a set of lines going across the top as they stand, each as a
 * sentence. None means they fit. (Whether the words may be said at all is
 * the copy rules' question, asked in the back end.)
 */
export function topLineProblems(lines: readonly string[]): string[] {
  const problems: string[] = [];
  if (lines.length === 0) {
    problems.push("There are no words in it yet.");
  }
  if (lines.length > TOP_LINE_MOST) {
    problems.push(
      `There are ${String(lines.length)} lines. Keep it to ${String(TOP_LINE_MOST)}.`,
    );
  }
  lines.forEach((line, index) => {
    if (line.length > TOP_LINE_LETTERS) {
      problems.push(
        `Line ${String(index + 1)} is ${String(line.length)} letters long. Keep each line to ${String(TOP_LINE_LETTERS)}.`,
      );
    }
  });
  return problems;
}

/** True when two sets of lines are the same words in the same order. */
export function sameTopLines(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}
