/**
 * FIXTURE — consumer surface, deliberately non-compliant.
 * Expected result: the auditor exits **1** on the Group Q rules.
 *
 * These are the sentences Quick Pickle's own concept deck is built around. They
 * are the most likely banned copy to reach the site, because they are the
 * brand's first words and everybody on the project has read them. The self-test
 * requires every one of them to be caught, wherever it is written.
 *
 * Registered in legal/copy-audit-exempt.json. The self-test scans it with
 * --include-legal --no-exemptions and REQUIRES it to fail.
 */

const meetLucky =
  "That little sequence that gives us the mental strength to get out there and play our best game.";

const barrier =
  "But sometimes, mental strength is no match for the physical barriers that stop us in our tracks.";

export function Deck() {
  return (
    <section>
      <h1>Performance with pickles</h1>
      <p>{meetLucky}</p>
      <p>{barrier}</p>
      <p>
        Our little shot of good luck for the quads, delivering a pickle punch to
        cramps in 60 seconds flat.
      </p>
      <p>So your physical game can keep up with your mental one.</p>
      <p>Fast-acting relief when you need it.</p>
    </section>
  );
}
