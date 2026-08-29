/**
 * A guard on the one place text arrives from outside the company.
 *
 * Everything else in this library is bytes and metadata the founder typed. The
 * vision model is different: it writes English, that English lands in a
 * database column, and the whole point of the column is that an agent reads it
 * when it is drafting a caption. A model that decides a jar of pickles looks
 * "healthy" has just written a regulated claim into the company's own notes.
 *
 * So a generated description is checked before it is stored, and a draft that
 * trips the check is thrown away rather than shown, edited or filed. The
 * founder gets the honest fallback description instead, plus a note saying the
 * draft was discarded.
 *
 * **This is not the compliance check.** `legal/COPY-RULES.md` is binding and
 * `legal/scripts/audit-copy.mjs` is what enforces it across everything the
 * company publishes. This is a deliberately small, conservative subset of the
 * health, therapeutic and sports-drink rule groups — the classes that are
 * banned on every surface — applied at the moment machine-written text enters
 * the building. When the two disagree, the audit script is right.
 */

export interface ClaimCheck {
  readonly clean: boolean;
  /** The words that tripped it, for the note the founder reads. */
  readonly matched: readonly string[];
}

/* copy-audit-ignore-start
   The list below is the vocabulary the scanner itself looks for. It is data for
   a filter, not copy, and the file is excluded so the scanner does not flag its
   own rule set. */
const CLAIM_PATTERNS: readonly RegExp[] = [
  /\bgut\b/i,
  /\b(?:pro|pre|post|syn)[\s-]?biotics?\b/i,
  /\blive\s+(?:cultures?|bacteria)\b|\bmicrobiome\b/i,
  /\bdigest\w*\b|\bbloat\w*\b/i,
  /\bimmun\w*\b/i,
  /\bdetox\w*\b|\bcleans\w*\b/i,
  /\bmetabolis\w*\b/i,
  /\bboost\w*\b/i,
  /\bnutrient\w*\b|\bnutritious\b|\bnourish\w*\b/i,
  /\bsuper[\s-]?foods?\b|\bwell[\s-]?being\b|\bwellness\b/i,
  /\bhealth(?:y|ier|ful)?\b/i,
  /\bhang[\s-]?overs?\b/i,
  /\bremed(?:y|ies)\b|\bheals?\b|\bhealing\b|\bcurative\b/i,
  /\bcramp\w*\b/i,
  /\bnausea\w*\b|\bheartburn\b|\bindigestion\b/i,
  /\bmedicinal\b|\bmedicines?\b|\btherapeutic\w*\b|\belixir\b|\btonics?\b/i,
  /\belectrolytes?\b/i,
  /\b(?:re)?hydrat\w*\b/i,
  /\breplenish\w*\b/i,
  /\bworkouts?\b|\bgyms?\b|\bathletes?\b|\bendurance\b|\bmuscles?\b/i,
  /\bantioxidants?\b|\banti[\s-]?inflammat\w*\b/i,
  /\bvitamins?\b|\bminerals?\b/i,
  /\borganic(?:ally)?\b/i,
  /\bsustainab\w*\b|\beco[\s-]?friendly\b/i,
  /\bkosher\b(?![\s-]?style)/i,
];
/* copy-audit-ignore-end */

/**
 * Does this machine-written sentence contain a claim we may not publish?
 *
 * Applied to model output only. The founder's own words are hers: she is the
 * one bound by the copy rules and the one who signs off the captions, and a
 * library that silently rewrote what she typed about her own photograph would
 * be worse than useless.
 */
export function checkGeneratedText(text: string): ClaimCheck {
  const matched: string[] = [];
  for (const pattern of CLAIM_PATTERNS) {
    const found = pattern.exec(text);
    if (found !== null) matched.push(found[0].toLowerCase());
  }
  return { clean: matched.length === 0, matched: [...new Set(matched)] };
}
