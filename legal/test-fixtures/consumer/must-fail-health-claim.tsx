/**
 * FIXTURE — consumer surface, deliberately non-compliant.
 * Expected result: the auditor exits **1** on the Group A / Group C rules.
 *
 * The point of this file is that parsing must not turn into leniency. The claims
 * below sit in three different node types — a string literal, a template literal
 * and JSX text — and every one of them has to be caught, because all three are
 * rendered to a customer.
 *
 * Registered in legal/copy-audit-exempt.json. The self-test scans it with
 * --include-legal --no-exemptions and REQUIRES it to fail.
 */

const blurb =
  "Gut health in a bottle: probiotics and live cultures in every sip.";

const serve = (ml: number) =>
  `${ml} ml of electrolytes to keep you hydrated and aid recovery after a workout.`;

export function Benefits() {
  return (
    <ul>
      <li>{blurb}</li>
      <li>{serve(30)}</li>
      <li>Boosts your immune system and settles an upset stomach.</li>
      <li>A natural hangover cure that stops muscle cramp.</li>
    </ul>
  );
}
