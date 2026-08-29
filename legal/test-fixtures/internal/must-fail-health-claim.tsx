/**
 * FIXTURE — internal surface, deliberately non-compliant.
 * Expected result: the auditor exits **1** on the Group A / Group C rules.
 *
 * This is the other half of the surface model, and the reason it is not simply
 * "skip the admin". A superiority claim in a private dashboard is not advertising
 * and is dropped. A HEALTH claim in a private dashboard is not dropped, because
 * the sentence is a regulated claim the moment anything lifts it out — and this
 * company's admin is full of agents that draft captions from what they read on
 * screen (COPY-RULES.md §9). The sentence below would be unlawful on arrival.
 *
 * Registered in legal/copy-audit-exempt.json. The self-test scans it with
 * --include-legal --no-exemptions and REQUIRES it to fail.
 */

const CAPTION_SEED = "Probiotics for gut health — hydrates better than water.";

export function DraftCaption() {
  return (
    <form>
      <label htmlFor="caption">Caption</label>
      <textarea id="caption" defaultValue={CAPTION_SEED} />
      <p>Suggested angle: electrolytes for recovery after a workout.</p>
    </form>
  );
}
