/**
 * FIXTURE — internal surface, compliant. Expected result: the auditor exits **0**.
 *
 * Nothing on this screen is a representation made in trade to a consumer. It is a
 * password-gated admin panel that only the founder sees, so FTA-04 (superiority)
 * has nothing to bite on here. Three separate reasons a finding must not appear:
 *
 *   1. `best` as a reduce accumulator is an identifier, not text addressed to
 *      anyone. Parsing rather than pattern-matching is what makes that visible.
 *   2. "Best customers" and "Best day" are text, but on an internal surface, and
 *      they state a sort order rather than claiming a product is superior.
 *   3. "Best before" is the Standard 1.2.5 date mark and is a term of art on every
 *      surface — see legal/test-fixtures/consumer/must-pass-terms-of-art.tsx.
 */

type Day = { date: string; takingsCents: number };

export function TakingsPanel({ days, unit }: { days: Day[]; unit: string }) {
  const busiest = days.reduce((best, entry) =>
    entry.takingsCents > best.takingsCents ? entry : best,
  );

  return (
    <section>
      <h2>Best customers</h2>
      <p>
        Best {unit} {busiest.date}
      </p>
      <table>
        <thead>
          <tr>
            <th>Batch</th>
            <th>Best before</th>
          </tr>
        </thead>
      </table>
    </section>
  );
}
