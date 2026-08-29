/**
 * FIXTURE — consumer surface, compliant. Expected result: the auditor exits **0**.
 *
 * This is the strict surface: every rule applies here. It still passes, because
 * nothing below is a claim.
 *
 *   "Best before" is the date mark that Standard 1.2.5 REQUIRES on packaged food.
 *   A scanner that flags it pushes a writer toward deleting vocabulary the law
 *   demands, which is the opposite of a compliance tool. It is excused as a term
 *   of art in the shapes a date mark actually takes — and only those shapes. The
 *   superiority claim "the best before you open it" is NOT excused; it lives in
 *   must-fail-superiority.tsx and it still fails.
 *
 *   The identifiers are the second half: `hydrate`, `absorption`, `digest` and
 *   `recovery` collide with EL-02, HC-16, HC-05 and EL-04, and none of them is
 *   text addressed to a reader. Renaming them would make the code worse for no
 *   compliance gain.
 */

const HYDRATE_MS = 120;

function absorption(depth: number): number {
  return Math.exp(-depth);
}

function digest(input: string): number {
  let recovery = 0;
  for (const ch of input) recovery = (recovery * 31 + ch.charCodeAt(0)) | 0;
  return recovery;
}

export function BottleLabel({ date }: { date: string }) {
  const shade = absorption(digest(date) % 3) * HYDRATE_MS;
  return (
    <dl style={{ opacity: shade > 0 ? 1 : 1 }}>
      <dt>Best before</dt>
      <dd>{date}</dd>
      <dt>Best before date</dt>
      <dd>Best before 12/2026</dd>
      <dd>Best-before printed on the shoulder of every bottle.</dd>
      <dd>Best before end of March 2027.</dd>
    </dl>
  );
}
