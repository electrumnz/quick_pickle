/**
 * FIXTURE — consumer surface, deliberately non-compliant.
 * Expected result: the auditor exits **1** on FTA-04.
 *
 * This is the fixture that matters. It is easy to make "Best before" pass by
 * making FTA-04 toothless; the test that proves the carve-out is narrow is that a
 * genuine superiority claim in consumer marketing copy still fails.
 *
 *   "the best pickle brine in New Zealand"  — a superiority claim needing proof
 *   "the best before you open it"           — "best before" NOT in the shape of a
 *                                             date mark, so NOT excused
 *   "voted best" / "number one"             — the rest of FTA-04's term list
 *
 * Registered in legal/copy-audit-exempt.json so a full-repo run does not fail on
 * a file whose job is to be non-compliant. The self-test scans it with
 * --include-legal --no-exemptions and REQUIRES it to fail.
 */

const strapline = "The best pickle brine in New Zealand.";

export function Hero() {
  return (
    <header>
      <h1>{strapline}</h1>
      <p>Good the day it ships, and the best before you open it.</p>
      <p>{`Voted best brine of 2026 — the number one seller in the range.`}</p>
    </header>
  );
}
