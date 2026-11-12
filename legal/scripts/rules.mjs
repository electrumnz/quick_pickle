// copy-audit-ignore-file
/**
 * QUICK PICKLE - the copy rules, as data.
 *
 * Every rule the auditor enforces, and the one function that applies them to
 * a piece of finished text. Two things use this file:
 *
 *   legal/scripts/audit-copy.mjs   scans the repository's files (npm run audit:copy)
 *   lib/copy/outgoing.ts           checks words at the moment they are about to
 *                                  leave: an email, a campaign, a post, a reply
 *
 * The second matters because not every word is in the repository. A template
 * kept in the database, or a reply drafted by a person or a bot, never passes
 * the file scan. It passes this instead, or it is not sent.
 *
 * The reasoning behind every rule is in legal/COPY-RULES.md; the rule IDs match.
 * No dependencies, and nothing here touches the file system.
 */

export const BANNED = "banned";
export const RESTRICTED = "restricted";

/** Which surfaces a rule reaches. The model is set out in audit-copy.mjs. */
export const EVERY_SURFACE = "every-surface";
export const CONSUMER_ONLY = "consumer-only";

/* ----------------------------------------------------------- terms of art */

/**
 * A term of art is a fixed phrase that contains a scanned word but is not the claim
 * the rule exists to catch. It is scoped to the rule it excuses and to the exact
 * shape of the phrase — never to the bare word — so the rule keeps its teeth.
 * Reasoning: legal/COPY-RULES.md §3 Group E, FTA-04.
 */
export const TERMS_OF_ART = [
  {
    id: "best-before-date-mark",
    rules: ["FTA-04"],
    // "Best before" in the shape a date mark actually takes: followed by a date, by
    // the word date/end, by punctuation, or by nothing at all — the end of the text
    // segment (\u0001 is the mask, so the JSX cell <th>Best before</th>
    // qualifies), the end of a line, a table heading, a label row.
    //
    // The hyphenated compound "best-before" is excused outright: it is a noun, and
    // there is no grammar in which "the best-before brine" reads as a superiority
    // claim. The spaced form is excused only in the shapes above, so "the best
    // before you open it" is NOT excused and still fails as a superiority claim.
    re: /\bbest-+before\b|\bbest[\s]+before\b(?=\s*(?:$|[:;,.)\]}<>"'`|\u0001]|\d|dates?\b|end\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/im,
    why: "Mandatory date mark on packaged food — FSC Standard 1.2.5-4. Flagging it pushes a writer toward deleting vocabulary the law requires.",
  },
  {
    id: "best-practice",
    rules: ["FTA-04"],
    re: /\bbest[\s-]+practices?\b/i,
    why: "Engineering term of art, not a claim about the product (e.g. the Lighthouse `best-practices` category).",
  },
  {
    id: "no-health-claims-answer",
    rules: ["HC-14"],
    // The one answer COPY-RULES.md section 5 gives to a customer's question about
    // what the product does to a body, in the shape it is written there: "we don't
    // make health claims". Only the denial is excused, and only the word inside it.
    // "Health claims" on its own, "we make health claims", and whatever is said
    // before or after the sentence are all still read, by every rule.
    re: /\bwe\s+(?:don['’]t|do\s+not)\s+make\s+health\s+claims\b/i,
    why: "The answer COPY-RULES.md section 5 prescribes for a health question. It denies a claim and makes none. Refusing it would stop staff giving the one reply the rules tell them to give.",
  },
];

export function termSpansFor(ruleId, text, cache) {
  if (cache.has(ruleId)) return cache.get(ruleId);
  const spans = [];
  for (const term of TERMS_OF_ART) {
    if (!term.rules.includes(ruleId)) continue;
    const re = new RegExp(
      term.re.source,
      term.re.flags.includes("g") ? term.re.flags : term.re.flags + "g",
    );
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      spans.push({ start: m.index, end: m.index + m[0].length, term });
    }
  }
  cache.set(ruleId, spans);
  return spans;
}

/* ------------------------------------------------------------------ rules */

/**
 * @param id        rule id, matching the heading in legal/COPY-RULES.md
 * @param severity  BANNED (never passes) or RESTRICTED (passes with a recorded check)
 * @param applies   EVERY_SURFACE or CONSUMER_ONLY — see the surface model above
 */
function r(id, severity, applies, re, why, src) {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  return { id, severity, applies, re: new RegExp(re.source, flags), why, src };
}

export const RULES = [
  // ---- Group A: health effects / health claims -------------------------
  r(
    "HC-01",
    BANNED,
    EVERY_SURFACE,
    /\bgut[\s-]?(?:health|friendly|biome)\b|\bgut\b/i,
    "Health claim about a functional/physiological outcome.",
    'FSC Std 1.2.7-18; definition of "health effect", Std 1.1.2-2',
  ),
  r(
    "HC-02",
    BANNED,
    EVERY_SURFACE,
    /\bpro[\s-]?biotics?\b/i,
    "Probiotic language is a health claim and an unsubstantiated composition claim.",
    "FSC Std 1.2.7-18; FTA 1986 s 12A",
  ),
  r(
    "HC-03",
    BANNED,
    EVERY_SURFACE,
    /\b(?:pre|post|syn)[\s-]?biotics?\b/i,
    'Same class of implied health claim as "probiotic".',
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-04",
    BANNED,
    EVERY_SURFACE,
    /\blive\s+(?:cultures?|bacteria)\b|\b(?:good|friendly|beneficial)\s+bacteria\b|\bmicrobiome\b|\bmicrobiota\b|\bgut\s+flora\b/i,
    "Implied probiotic / health claim.",
    "FSC Std 1.2.7-2 (definition of *claim* includes implied statements and designs)",
  ),
  r(
    "HC-05",
    BANNED,
    EVERY_SURFACE,
    /\bdigestions?\b|\bdigestive\b|\beas(?:y|ier)\s+to\s+digest\b|\b(?:aids?|helps?|supports?|improves?)\s+(?:you\s+)?digest\w*\b|\bbloat(?:ing|ed|s)?\b|\bregularity\b/i,
    "Health claim about a functional process.",
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-06",
    BANNED,
    EVERY_SURFACE,
    /\bimmun\w*\b/i,
    "Health claim.",
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-07",
    BANNED,
    EVERY_SURFACE,
    /\bdetox\w*\b|\bcleanse[sd]?\b|\bcleansing\b/i,
    "Health claim and unsubstantiable.",
    "FSC Std 1.2.7-18; FTA 1986 s 12A",
  ),
  r(
    "HC-08",
    BANNED,
    EVERY_SURFACE,
    /\bmetabolis\w*\b|\bmetabolic\b|\bburns?\s+fat\b|\bfat[\s-]burning\b/i,
    "Health claim about a biochemical process.",
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-09",
    BANNED,
    EVERY_SURFACE,
    /\bblood\s+(?:pressure|sugar|glucose)\b|\binsulin\b|\bcholesterol\b/i,
    "Biomarker of a serious disease - a HIGH LEVEL health claim, only available from the S4-4 table.",
    "FSC Std 1.2.7-18(2); Schedule 4, S4-4",
  ),
  r(
    "HC-10",
    BANNED,
    EVERY_SURFACE,
    /\bboost\w*\b|\bpick[\s-]me[\s-]up\b|\balertness\b|\bmental\s+(?:focus|clarity|performance)\b/i,
    'Health claim about mental or physical performance ("boost" in any form).',
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-11",
    BANNED,
    EVERY_SURFACE,
    /\banti[\s-]?inflammat\w*\b|\binflammation\b|\bantioxidants?\b|\bfree\s+radicals?\b/i,
    "Health claim; antioxidant claims additionally need a permitted food-health relationship.",
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-12",
    BANNED,
    EVERY_SURFACE,
    /\bnutrients?\b|\bnutrient[\s-]dense\b|\bnourish\w*\b|\bnutritious\b/i,
    "Reads as a nutrition/health claim without meeting any Schedule 4 condition.",
    "FSC Std 1.2.7-12, 1.2.7-13; FTA 1986 s 12A",
  ),
  r(
    "HC-13",
    BANNED,
    EVERY_SURFACE,
    /\bsuper[\s-]?foods?\b|\bfunctional\s+(?:food|beverage|drink)\b|\bwell[\s-]?being\b|\bwellness\b/i,
    "Implied health claim; unsubstantiable.",
    "FSC Std 1.2.7-2; FTA 1986 s 12A",
  ),
  r(
    "HC-14",
    BANNED,
    EVERY_SURFACE,
    /\bgood\s+for\s+(?:you|your|me|us|the\s+body)\b|\bdoes\s+you\s+good\b|\bhealth(?:y|ier|iest|ful)?\b/i,
    'Implied health claim ("healthy", "good for you").',
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-15",
    BANNED,
    EVERY_SURFACE,
    /\bguilt[\s-]?free\b|\bno\s+guilt\b|\bsin[\s-]?free\b|\bvirtuous\b/i,
    "Implied nutrition/health claim about energy or sugar with no Schedule 4 basis.",
    "FSC Std 1.2.7-12; S4-3",
  ),
  r(
    "HC-16",
    BANNED,
    EVERY_SURFACE,
    /\bbioavailab\w*\b|\b(?:nutrient|mineral|iron|calcium|magnesium|potassium|water|electrolyte)\s+absorption\b|\babsorption\s+(?:of|by)\s+(?:nutrients?|minerals?|iron|calcium)\b/i,
    "Health claim about a biochemical process.",
    "FSC Std 1.2.7-18",
  ),

  // ---- Group B: therapeutic --------------------------------------------
  r(
    "TH-01",
    BANNED,
    EVERY_SURFACE,
    /\bhang[\s-]?overs?\b|\bmorning\s+after\b/i,
    "A hangover is a condition; alleviating it is a therapeutic claim. Absolutely prohibited, no exceptions.",
    "FSC Std 1.2.7-8(a)",
  ),
  r(
    "TH-02",
    BANNED,
    EVERY_SURFACE,
    /\bcure[\s-]?all\b|\bcure\s+for\b|\bcures?\s+(?:your|you|the\s+body)\b|\bcures?\s+(?:for\s+)?(?:your|the|a|an|any)?\s*(?:hangover|cramp|nausea|headache|ailment|illness|sickness|symptom|bloat|indigestion|heartburn|cold|flu|soreness)\w*\b|\bcurative\b|\bremed(?:y|ies)\b|\bheals?\b|\bhealing\b|\b(?:medical|therapeutic|natural)\s+treatments?\b|\btreatments?\s+for\s+(?:cramp|hangover|nausea|illness|ailment|symptom)\w*\b|\btreats?\b(?=\s+(?:your|the|a|an|any|symptom|illness|condition|cramp|hangover))/i,
    "Therapeutic claim - the MEDICAL sense of cure/heal/remedy only. The FOOD-PROCESS sense ('cured in brine', 'a three-week cure', 'cure time', 'curing salt') is approved brand vocabulary and is deliberately NOT matched.",
    "FSC Std 1.2.7-8(a)",
  ),
  r(
    "TH-03",
    BANNED,
    EVERY_SURFACE,
    /\bprevent(?!Default)\w*\b|\bprotects?\s+against\b|\bwards?\s+off\b|\bfights?\s+off\b/i,
    "Therapeutic claim (prevention).",
    "FSC Std 1.2.7-8(a)",
  ),
  r(
    "TH-04",
    BANNED,
    EVERY_SURFACE,
    /\bcramp(?:s|ing|ed)?\b/i,
    "A condition. The classic pickle-juice claim - the one we will never make.",
    "FSC Std 1.2.7-8(a)",
  ),
  r(
    "TH-05",
    BANNED,
    EVERY_SURFACE,
    /\bnausea\w*\b|\bmorning\s+sickness\b|\bheartburn\b|\breflux\b|\bindigestion\b|\bupset\s+stomach\b|\bsettles?\s+(?:your|the)\s+stomach\b/i,
    "Named conditions.",
    "FSC Std 1.2.7-8(a)",
  ),
  r(
    "TH-06",
    BANNED,
    EVERY_SURFACE,
    /\bmedicinal\b|\bmedicines?\b|\btherapeutic\w*\b|\belixir\b|\btonics?\b|\bwellness\s+shot\b|\bapothecary\b/i,
    "Therapeutic framing; in NZ also risks the product being treated as a medicine under the Medicines Act 1981.",
    "FSC Std 1.2.7-8(b)",
  ),
  r(
    "TH-07",
    BANNED,
    EVERY_SURFACE,
    /\b(?:doctor|dietitian|dietician|nutritionist|physio\w*|naturopath\w*|herbalist)[\s-]+(?:recommended|approved|endorsed|backed|formulated)\b|\bclinically\s+(?:proven|tested|shown)\b|\bscientifically\s+proven\b|\bstudies\s+show\b|\bresearch\s+shows\b/i,
    "Therapeutic/endorsement claim and unsubstantiated representation.",
    "FSC Std 1.2.7-8; FTA 1986 ss 12A, 13(e)",
  ),
  r(
    "TH-08",
    BANNED,
    EVERY_SURFACE,
    /\bdosages?\b|\bdaily\s+dose\b|\bprescri(?:be|bed|bing|ption)\w*\b/i,
    "Therapeutic framing.",
    "FSC Std 1.2.7-8(b)",
  ),

  // ---- Group C: electrolytes / hydration / sport ------------------------
  r(
    "EL-01",
    BANNED,
    EVERY_SURFACE,
    /\belectrolytes?\b/i,
    '"Electrolyte drink" is a PRESCRIBED NAME with a mandatory composition (>=10 mmol/L sodium and 20-100 g/L of specified sugars) that QUICK PICKLE does not meet. This is a compositional breach, not just a marketing risk.',
    "FSC Std 2.6.2-11(1)-(2), 2.6.2-12(1), 2.6.2-15",
  ),
  r(
    "EL-02",
    BANNED,
    EVERY_SURFACE,
    /\b(?:re)?hydrat(?:e|es|ed|ing|ion)\b|\bdehydration\b/i,
    "Health claim about a physiological process.",
    "FSC Std 1.2.7-18",
  ),
  r(
    "EL-03",
    BANNED,
    EVERY_SURFACE,
    /\breplenish\w*\b|\breplaces?\s+(?:salts?|minerals?|what\s+you\s+lose)\b|\brestores?\s+(?:balance|salts?|minerals?)\b/i,
    "Implied electrolyte / health claim.",
    "FSC Std 1.2.7-18; Std 2.6.2-15",
  ),
  r(
    "EL-04",
    BANNED,
    EVERY_SURFACE,
    /\b(?:muscle|workout|exercise|training|post[\s-]?workout|sports?)\s+recover(?:y|ies)\b|\b(?:aids?|speeds?|helps?|supports?|boosts?)\s+recover(?:y|ies)\b|\brecover(?:y|ies)\s+(?:drink|shot|aid|after\s+(?:a\s+)?(?:workout|run|game|match|session))\b|\brecover\s+(?:faster|quicker)\b|\b(?:post|pre)[\s-]?workout\b|\bworkouts?\b|\bgyms?\b|\bathletes?\b|\bathletic\b|\bsports?\s+(?:drink|beverage|nutrition)\b|\bisotonic\b/i,
    "Health claim about physical performance; also drags us toward Std 2.9.4 (formulated supplementary sports foods) and Std 2.6.2.",
    "FSC Std 1.2.7-18; Std 2.9.4; Std 2.6.2",
  ),
  r(
    "EL-05",
    BANNED,
    EVERY_SURFACE,
    /\bendurance\b|\bstamina\b|\bmuscles?\b|\bsoreness\b|\bDOMS\b|\b(?:physical|athletic|sporting|sports|exercise)\s+performance\b|\bperformance\s+(?:gains?|boost|edge|drink)\b/i,
    "Health claim about physical performance.",
    "FSC Std 1.2.7-18",
  ),

  // ---- Group Q: the lines in Quick Pickle's own concept deck ---------------
  // The brand was born with a claim in its mouth. These rules exist so that the
  // exact sentences from the deck cannot drift back on to the site.
  r(
    "QP-01",
    BANNED,
    EVERY_SURFACE,
    /\b(?:in|within|under)\s+(?:\d+|sixty|thirty|ten|five)\s+(?:seconds?|secs?|minutes?|mins?)\b|\b\d+\s+seconds?\s+flat\b|\bfast[\s-]acting\b|\bworks?\s+(?:fast|quick(?:ly)?|instantly|in\s+(?:seconds|minutes))\b|\binstant\s+relief\b|\brelie(?:f|ve[sd]?|ving)\b/i,
    "Speed-of-effect or relief language. It only means something if the product is doing something to a body, which is the claim a food may not make.",
    "FSC Std 1.2.7-8(a); Std 1.2.7-18; FTA 1986 s 12A",
  ),
  r(
    "QP-02",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bperformance\b/i,
    "The concept deck is titled with this word. Next to a food it reads as a physical-performance claim. Do not publish it without advice and a recorded decision.",
    'FSC Std 1.2.7-18; definition of "health effect", Std 1.1.2-2',
  ),
  r(
    "QP-03",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bquads?\b|\bhamstrings?\b|\bcalves\b|\bglutes?\b|\bhammies\b/i,
    "Naming a muscle next to the product implies the product does something for it.",
    "FSC Std 1.2.7-18; Std 1.1.2-2 (implied claims)",
  ),
  r(
    "QP-04",
    BANNED,
    EVERY_SURFACE,
    /\bphysical\s+barriers?\b|\bmental\s+strength\b|\bphysical\s+game\b|\bmental\s+(?:game|one)\b|\bstops?\s+(?:us|you|them)\s+in\s+(?:our|your|their)\s+tracks\b|\bplay\s+(?:our|your)\s+best\s+game\b/i,
    "The set-up lines around the deck's claim. Each one frames the product as the answer to a body letting you down.",
    "FSC Std 1.2.7-18; Std 1.1.2-2 (implied claims)",
  ),
  r(
    "QP-05",
    BANNED,
    CONSUMER_ONLY,
    /\bpickle[\s-]+punch(?:es|ed|ing)?\b/i,
    "Half of the deck's banned sentence. On its own it still points at the other half, so it stays off anything a customer reads.",
    "FSC Std 1.2.7-8(a); Std 1.1.2-2 (implied claims)",
  ),
  r(
    "QP-06",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bpickle[\s-]+power(?:ed|s)?\b/i,
    'The end of Lucky\'s full title in the mascot file. "Power" next to a food can read as a claim about what it gives you. Use "Lucky, the superhero cat" until there is advice and a recorded decision.',
    "FSC Std 1.2.7-18; Std 1.1.2-2 (implied claims)",
  ),

  // ---- Group D: nutrition content claims --------------------------------
  r(
    "NCC-01",
    BANNED,
    EVERY_SURFACE,
    /\blow[\s-](?:in[\s-])?sugars?\b/i,
    "Requires <= 2.5 g sugars/100 mL for a liquid food.",
    'FSC S4-3 (Sugar or sugars, "Low")',
  ),
  r(
    "NCC-02",
    BANNED,
    EVERY_SURFACE,
    /\bsugar[\s-]?free\b|\bno\s+sugars?\b|\b(?:0|zero)\s*%?\s*sugars?\b/i,
    'The "% Free" descriptor for sugars requires the food to meet the LOW SUGAR condition (<= 2.5 g/100 mL). "Sugar free" is not a synonym for "contains no sugar".',
    'FSC S4-3 (Sugar or sugars, "% Free")',
  ),
  r(
    "NCC-03",
    BANNED,
    EVERY_SURFACE,
    /\bno\s+added\s+sugars?\b/i,
    "Four cumulative conditions including <= 7.5 g sugars/100 mL for liquid food and no hydrolysis-driven increase in hexose sugars.",
    'FSC S4-3 (Sugar or sugars, "No added"), as varied by Proposal P1063',
  ),
  r(
    "NCC-04",
    BANNED,
    EVERY_SURFACE,
    /\blow[\s-](?:in[\s-])?(?:calorie|kilojoule|energy|kj)s?\b/i,
    "Requires <= 80 kJ/100 mL for a liquid food.",
    'FSC S4-3 (Energy, "Low")',
  ),
  r(
    "NCC-05",
    BANNED,
    EVERY_SURFACE,
    /\b(?:zero|no|0)\s+(?:calories?|kilojoules?|kj)\b|\bcalorie[\s-]?free\b/i,
    "Not a listed descriptor for energy; unlisted descriptors are constrained by Std 1.2.7-12(8) and 1.2.7-13(2).",
    "FSC Std 1.2.7-12(8), 1.2.7-13(2)",
  ),
  r(
    "NCC-06",
    RESTRICTED,
    EVERY_SURFACE,
    /\bdiet\b/i,
    'As a product descriptor, "diet" requires the food to MEET THE NPSC and be <= 80 kJ/100 mL or 40% lower energy than a named reference food. Approve only for clearly non-descriptor uses.',
    'FSC S4-3 (Energy, "Diet"); Std 1.2.7-15; Std 1.2.7-16',
  ),
  r(
    "NCC-07",
    BANNED,
    EVERY_SURFACE,
    /\blow[\s-](?:in[\s-])?(?:salt|sodium)\b/i,
    "Requires <= 120 mg sodium/100 mL. A cucumber brine will not meet this.",
    'FSC S4-3 (Salt or sodium, "Low")',
  ),
  r(
    "NCC-08",
    BANNED,
    EVERY_SURFACE,
    /\bno\s+added\s+(?:salt|sodium)\b|\bunsalted\b|\bsalt[\s-]?free\b/i,
    "Requires no added sodium compound in the food AND in its ingredients.",
    'FSC S4-3 (Salt or sodium, "No added" / "Unsalted")',
  ),
  r(
    "NCC-09",
    BANNED,
    EVERY_SURFACE,
    /\breduced[\s-](?:sugars?|salt|sodium|calories?|fat|carbs?|carbohydrates?|energy)\b/i,
    "Requires >= 25% less than a NAMED reference food, and the reference food and the size of the difference must be stated together with the claim.",
    "FSC S4-3; Std 1.2.7-16(1)",
  ),
  r(
    "NCC-10",
    BANNED,
    EVERY_SURFACE,
    /\b(?:light|lite)\b(?=[\s-]*(?:in\s+)?(?:sugars?|salt|sodium|fat|calories?|kilojoules?|kj|energy|carbs?|carbohydrates?))/i,
    '"Light"/"lite" is a comparative descriptor carrying the same conditions as "reduced".',
    "FSC S4-3; Std 1.2.7-16(2)(a)(ii)(A)",
  ),
  r(
    "NCC-11",
    BANNED,
    EVERY_SURFACE,
    /\blow[\s-](?:carb|carbohydrate)s?\b|\bketo(?:[\s-]?friendly)?\b/i,
    'S4-3 lists NO "low" descriptor for carbohydrate - only "reduced" and "increased". The claim is simply unavailable.',
    "FSC S4-3 (Carbohydrate); Std 1.2.7-12",
  ),
  r(
    "NCC-12",
    BANNED,
    EVERY_SURFACE,
    /\b(?:high|rich|packed|loaded|full|bursting|brimming)\s+(?:in|with|of)\b/i,
    '"High"/"rich in" is only a listed descriptor for gluten and glycaemic index; elsewhere it is an unlisted descriptor used with a Column 1 property.',
    "FSC Std 1.2.7-12(1)-(3); S4-3",
  ),
  r(
    "NCC-13",
    BANNED,
    EVERY_SURFACE,
    /\b(?:good|excellent)\s+sources?\s+of\b|\bsources?\s+of\s+(?:vitamins?|minerals?|calcium|iron|potassium|magnesium|sodium|protein|fibre|fiber|antioxidants?|omega[\s-]?\d?|zinc|folate|electrolytes?|nutrients?|energy|goodness)\b/i,
    'Vitamin/mineral: >= 10% RDI/ESADDI per serving (>= 25% for "good source"). Protein: >= 5 g/serving (>= 10 g "good source"). Fibre: >= 2 g (>= 4 g "good source", >= 7 g "excellent source").',
    "FSC S4-3 (Vitamin or mineral; Protein; Dietary fibre)",
  ),
  r(
    "NCC-14",
    BANNED,
    EVERY_SURFACE,
    /\bfat[\s-]?free\b|\b\d{1,3}\s*%\s*fat[\s-]?free\b|\blow[\s-](?:in[\s-])?fat\b/i,
    'The "% Free" descriptor for fat requires the food to meet the LOW FAT condition (<= 1.5 g/100 mL for liquid food).',
    "FSC S4-3 (Fat)",
  ),
  r(
    "NCC-15",
    BANNED,
    EVERY_SURFACE,
    /\bgluten[\s-]?free\b/i,
    "Requires NO DETECTABLE gluten, no oats or oat products, and no malted gluten-containing cereals. Needs analysis, not an assumption.",
    'FSC S4-3 (Gluten, "Free")',
  ),
  r(
    "NCC-16",
    BANNED,
    EVERY_SURFACE,
    /\blow\s+GI\b|\bglycaemic\b|\bglycemic\b/i,
    "Requires GI testing, the numerical GI stated on the claim or in the NIP, and the food to meet the NPSC.",
    "FSC S4-3 (Glycaemic Index)",
  ),
  r(
    "NCC-17",
    BANNED,
    EVERY_SURFACE,
    /\bslimming\b|\bskinny\b|\bwaistlines?\b|\bweight[\s-](?:loss|management)\b|\bslim\s+down\b/i,
    'Slimming descriptors are prohibited alongside a "diet" claim; weight framing is otherwise a health or therapeutic claim.',
    "FSC Std 1.2.7-15; Std 1.2.7-18; Std 1.2.7-8",
  ),
  r(
    "NCC-18",
    BANNED,
    EVERY_SURFACE,
    /\bvitamins?\b|\bminerals?\b|\bfolic\s+acid\b|\bcholine\b|\bfluoride\b/i,
    "Claims about choline, fluoride or folic acid are only permitted alongside a health claim we cannot make; vitamin/mineral claims must clear S4-3 Column 2 in full.",
    "FSC Std 1.2.7-14(3); S4-3 (Vitamin or mineral)",
  ),
  r(
    "NCC-19",
    BANNED,
    EVERY_SURFACE,
    /\bmore\s+(?:potassium|sodium|magnesium|calcium|iron|vitamin\w*)\s+than\b/i,
    "A claim that directly or indirectly compares the vitamin or mineral content of a food with another food is prohibited unless the Code permits it. It does not.",
    "FSC Std 1.2.7-9",
  ),

  // ---- Group E: Fair Trading Act exposure --------------------------------
  r(
    "FTA-01",
    BANNED,
    EVERY_SURFACE,
    /\bclean\s+(?:label|eating|living|ingredients?)\b|\bno\s+nast(?:y|ies)\b|\bnothing\s+(?:artificial|nasty)\b/i,
    "Undefined, unverifiable composition/health framing.",
    "FTA 1986 ss 9, 12A, 13(a)",
  ),
  r(
    "FTA-02",
    BANNED,
    EVERY_SURFACE,
    /\b(?:100\s*%|all)[\s-]?natural\b|\bpurest?\b/i,
    "Unsubstantiated composition claim.",
    "FTA 1986 ss 12A, 13(a)",
  ),
  r(
    "FTA-03",
    BANNED,
    EVERY_SURFACE,
    /\b(?:chemical|preservative|additive|nasty)[\s-]?free\b|\bno\s+(?:chemicals?|preservatives?|additives?)\b/i,
    "Unverifiable absolutes - salt and acetic acid are preservatives.",
    "FTA 1986 ss 9, 12A",
  ),
  r(
    "FTA-04",
    BANNED,
    CONSUMER_ONLY,
    /\bbest\b|\bworld'?s\s+finest\b|\bnumber\s+one\b|\bno\.?\s?1\b|\bvoted\s+best\b/i,
    'Superiority claim requiring proof. The term-of-art table excuses the "best before" date mark (FSC Std 1.2.5) and "best practice"; it does not excuse a bare "best".',
    "FTA 1986 ss 12A, 13(a), 13(e)",
  ),
  r(
    "FTA-05",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bguarantee[ds]?\b|\bwarrant(?:y|ies)\b|\brisk[\s-]?free\b|\bno\s+questions\s+asked\b/i,
    "Misrepresenting a right or remedy - including a CGA right - is an offence. Must match the published policies exactly.",
    "FTA 1986 s 13(i); CGA 1993 s 43(4)",
  ),
  r(
    "FTA-06",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bfree\s+(?:shipping|delivery|gift|sample|bottle)\b/i,
    "Every condition (spend threshold, region, exclusions) must appear in the same sentence.",
    "FTA 1986 ss 9, 13(g)",
  ),
  r(
    "FTA-07",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bwas\s*\$|\bRRP\b|\b\d{1,3}\s*%\s*off\b/i,
    "Reference pricing requires a genuine prior selling price.",
    "FTA 1986 ss 9, 13(g)",
  ),
  r(
    "FTA-08",
    BANNED,
    EVERY_SURFACE,
    /\bsustainab\w*\b|\beco[\s-]?friendly\b|\bcarbon[\s-](?:neutral|negative|zero)\b|\bplastic[\s-]?free\b|\bzero[\s-]waste\b|\bclimate[\s-]positive\b|\benvironmentally\s+friendly\b|\bplanet[\s-]friendly\b/i,
    "Environmental claims require evidence held at the time of publication.",
    "FTA 1986 ss 9, 12A, 13(a)",
  ),
  r(
    "FTA-09",
    BANNED,
    EVERY_SURFACE,
    /\borganic(?:ally)?\b|\bbiodynamic\b|\bspray[\s-]?free\b/i,
    "Certification claim; NZ organic claims sit under the Organic Products and Production Act 2023.",
    "FTA 1986 ss 12A, 13(e)-(f)",
  ),
  r(
    "FTA-10",
    BANNED,
    EVERY_SURFACE,
    /\bkosher\b(?![\s-]?style)|\bhechsher\b|\bpar[ev]ve\b/i,
    'Certification/endorsement claim. "Kosher-style" is permitted; bare "kosher" is not.',
    "FTA 1986 s 13(e)-(f)",
  ),
  r(
    "FTA-11",
    RESTRICTED,
    CONSUMER_ONLY,
    /\btraditional(?:ly)?\b|\bauthentic\b|\boriginal\s+recipe\b|\bcentur\w+[\s-]old\b|\bsince\s+(?:18|19|20)\d{2}\b/i,
    "Only usable if literally true and evidenced.",
    "FTA 1986 ss 12A, 13(a)",
  ),
  r(
    "FTA-12",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bhand[\s-]?(?:made|crafted|packed|picked)\b|\bartisan\w*\b|\bsmall[\s-]batch\b|\bcraft(?:ed)?\b/i,
    "Only if literally accurate for the current production method. Re-verify on any move to a co-packer.",
    "FTA 1986 ss 12A, 13(a)",
  ),
  r(
    "FTA-14",
    BANNED,
    CONSUMER_ONLY,
    /\bas\s+seen\s+(?:in|on)\b|\bfeatured\s+in\b|\bthousands\s+of\s+(?:customers|happy)\b|\bbest[\s-]?sell(?:er|ing)\b/i,
    "Unsubstantiated representation about acceptance or endorsement.",
    "FTA 1986 ss 12A, 13(e)",
  ),

  // ---- Group F: endorsements ---------------------------------------------
  r(
    "END-04",
    BANNED,
    EVERY_SURFACE,
    /\bhealth\s+star\s+rating\b|\bHSR\s+(?:score|rating)\b/i,
    "Only a *permitted* Health Star Rating symbol is exempt from Standard 1.2.7.",
    "FSC Std 1.2.7-6(d)",
  ),

  // ---- Group G: place of origin and provenance ---------------------------
  r(
    "PROV-01",
    RESTRICTED,
    CONSUMER_ONLY,
    /\b(?:made|bottled|brewed|produced|manufactured|packed)\s+in\s+(?:new\s+zealand|aotearoa|nz|australia)\b|\bnz[\s-]made\b|\b(?:product|produce)\s+of\s+(?:new\s+zealand|aotearoa|nz|australia)\b/i,
    'ORIGIN CLAIM. "Made in" is about where the goods were substantially transformed, not where the idea or the brand lives. Approve only with a note of what is actually made where.',
    "FTA 1986 s 13(j); for AU sale, the ACL country-of-origin information standard",
  ),
  r(
    "PROV-02",
    RESTRICTED,
    CONSUMER_ONLY,
    /\b(?:grown|harvested|foraged|wild[\s-]?harvested|gathered|picked|sourced|farmed|fished|cultivated)\s+(?:in|on|at|by|from|near|around)\b|\bsingle[\s-]origin\b|\bestate[\s-]grown\b/i,
    "PROVENANCE CLAIM. Must be literally true of the batch on sale before it ships. Clear it with copy-audit-approved: PROV-02 and NAME the supplier and the date the relationship was confirmed.",
    "FTA 1986 ss 12A, 13(a), 13(j)",
  ),
  r(
    "PROV-03",
    RESTRICTED,
    CONSUMER_ONLY,
    /\b(?:our|the|a|from\s+our)\s+(?:growers?|farmers?|orchardists?|suppliers?|partner\s+farms?|whanau|wh[āa]nau)\b|\bfamily\s+farm\b|\bwe\s+(?:work|partner)\s+with\b/i,
    "NAMED-RELATIONSHIP CLAIM. A supplier relationship that does not yet exist is a false representation the moment it is published, even if it is planned.",
    "FTA 1986 ss 9, 12A, 13(a)",
  ),
  r(
    "PROV-04",
    RESTRICTED,
    CONSUMER_ONLY,
    /\b(?:tair[āa]whiti|gisborne|northland|te\s+tai\s+tokerau|kaitaia|coromandel|waikato|bay\s+of\s+plenty|hawke'?s\s+bay|taranaki|manawat[ūu]|wairarapa|marlborough|nelson|canterbury|otago|southland|west\s+coast|banks\s+peninsula|waiheke)\b/i,
    "NAMED PLACE. A specific NZ place name in product copy reads as a provenance claim. Approve with the supplier and confirmation date, or remove the place name.",
    "FTA 1986 s 13(j)",
  ),
  r(
    "PROV-05",
    BANNED,
    CONSUMER_ONLY,
    /\b(?:TODO|TBC|TBD|PLACEHOLDER|FIXME|LOREM)\b(?=.*\b(?:grown|harvest\w*|sourc\w*|grower|farmer|supplier|forag\w*|made\s+in|product\s+of)\b)|\b(?:grown|harvest\w*|sourc\w*|grower|farmer|supplier|forag\w*|made\s+in|product\s+of)\w*\b(?=.*\b(?:TODO|TBC|TBD|PLACEHOLDER|FIXME|LOREM)\b)/i,
    "ASPIRATIONAL PROVENANCE. Draft or placeholder sourcing copy must never reach a published surface. Delete it or finish it - do not ship it with a TODO beside it.",
    "FTA 1986 ss 9, 12A, 13(j)",
  ),

  // ---- Group H: No 04 WILD and native botanicals -------------------------
  r(
    "WILD-01",
    BANNED,
    EVERY_SURFACE,
    /\brongo[āa]\b|\brongoa\b|\btraditional\s+(?:m[āa]ori\s+)?medicine\b|\bmedicinal\s+(?:plant|herb|leaf)\b|\bhealing\s+(?:plant|herb|leaf)\b|\bbush\s+medicine\b/i,
    "Rongoa framing is a therapeutic claim, prohibited outright, and it appropriates matauranga Maori into a sales pitch. Never write it.",
    "FSC Std 1.2.7-8(a)-(b); FTA 1986 s 12A",
  ),
  r(
    "WILD-02",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bkawakawa\b|\bkelp\b|\bseaweed\b|\bkarengo\b|\bhoropito\b|\bharakeke\b|\bkumarahou\b|\bm[āa]nuka\b|\bmanuka\b|\bpiko?piko\b/i,
    "Native botanical. Permitted ONLY as an ingredient name or a flavour note, never with any health, wellness or rongoa framing (WILD-01). Also confirm the ingredient is not a novel food requiring pre-approval.",
    "FSC Std 1.5.1 (novel food / non-traditional food); Std 1.2.7-8",
  ),

  // ---- Restricted: context checks ----------------------------------------
  r(
    "EL-06",
    RESTRICTED,
    CONSUMER_ONLY,
    /\b(?:sodium|potassium|magnesium|salts)\b/i,
    "Fine inside the mandatory nutrition information panel; NOT fine as a selling point. Approve only for factual or NIP use.",
    "FSC Std 1.1.2-9(2)-(3); S4-3 (Salt or sodium)",
  ),
  r(
    "R-02",
    RESTRICTED,
    EVERY_SURFACE,
    /\bvegan\b|\bplant[\s-]based\b|\bvegetarian\b|\b(?:dairy|nut|egg|soy)[\s-]?free\b/i,
    "Verify against the actual ingredient AND processing-aid list, and against cross-contact risk in the production environment.",
    "FTA 1986 s 12A; FSC Std 1.2.3",
  ),
  r(
    "R-03",
    RESTRICTED,
    CONSUMER_ONLY,
    /\baward[\s-]winning\b|\bgold\s+medal\b|\bmedal[\s-]winning\b|\bfinalist\b/i,
    "Name the award and the year in the same sentence.",
    "FTA 1986 s 13(e)",
  ),
  r(
    "R-04",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bselling\s+fast\b|\bonly\s+\d+\s+left\b|\balmost\s+gone\b|\blimited\s+edition\b/i,
    "Must be true at the moment of display; scarcity counters not wired to real stock are misleading conduct.",
    "FTA 1986 s 9",
  ),
  r(
    "R-07",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bsubscri\w*\b|\bauto[\s-]?renew\w*\b/i,
    "Price, frequency and cancellation terms must be disclosed before payment.",
    "FTA 1986 ss 9, 11",
  ),
  r(
    "R-10",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bferment\w*\b|\bcultured\b/i,
    "Only if genuinely fermented, and never alongside any Group A term - that becomes an implied probiotic claim.",
    "FTA 1986 s 12A; FSC Std 1.2.7-2",
  ),
  r(
    "R-11",
    RESTRICTED,
    CONSUMER_ONLY,
    /\braw\b|\bunpasteuri[sz]ed\b|\bunfiltered\b/i,
    "Accurate process descriptors only; they carry Food Act 2014 consequences and must match the food safety programme.",
    "Food Act 2014 (NZ)",
  ),
  r(
    "R-13",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bpicklebacks?\b|\bmartinis?\b|\bcocktails?\b|\bvodka\b|\bgin\b|\bwhisk(?:e)?y\b|\bbourbon\b|\btequila\b|\bmezcal\b/i,
    "Core positioning and ALLOWED. Flagged so a human checks context: no encouragement of excessive or rapid consumption, no under-18 targeting, and no implication that it offsets the effects of alcohol (that is TH-01).",
    "ASA Code for Advertising and Promotion of Alcohol, where alcohol is featured",
  ),
  r(
    "R-15",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bclean\b/i,
    '"Clean-finishing" as a flavour note is fine; "clean" as a virtue claim about composition is not.',
    "FTA 1986 ss 9, 12A",
  ),
  r(
    "R-16",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bnatural(?:ly)?\b/i,
    '"Naturally fermented" may be defensible; "natural" as a virtue claim is not. "100% natural" and "all natural" are banned outright (FTA-02).',
    "FTA 1986 ss 12A, 13(a)",
  ),
  r(
    "R-17",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bnutrition(?:al|ally)?\b/i,
    'Fine when naming the mandatory "Nutrition Information" panel; not fine as a benefit.',
    "FSC Std 1.1.2-9(2); Std 1.2.8-5",
  ),
  r(
    "R-18",
    RESTRICTED,
    CONSUMER_ONLY,
    /\benergy\b/i,
    'Fine as the mandatory NIP row label ("Energy, kJ"); banned as a benefit ("energy boost" - HC-10).',
    "FSC Std 1.2.8-6(1)(d)(i); Std 1.2.7-18",
  ),
  r(
    "R-19",
    RESTRICTED,
    CONSUMER_ONLY,
    /\bref(?:und|unds|unded)\b|\bmoney[\s-]back\b|\breturns?\s+policy\b/i,
    "Must match shipping-returns.md and terms-of-sale.md exactly.",
    "FTA 1986 s 13(i); CGA 1993 s 43",
  ),
];

/* ------------------------------------------------------------ finished text */

/**
 * Check a piece of finished text the way a customer will receive it.
 *
 * Every rule applies: text that is about to be sent or published is a
 * representation made to a customer, whoever wrote it. Terms of art are
 * honoured. There are no inline markers to clear anything, because text
 * written at run time has no source line to put one on; a RESTRICTED finding
 * is cleared by the caller recording that a person checked it.
 *
 * @param {string} text
 * @returns {{id: string, severity: string, match: string, index: number, why: string, source: string}[]}
 */
export function scanText(text) {
  const findings = [];
  const termCache = new Map();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      const excused = termSpansFor(rule.id, text, termCache).some(
        (span) => start < span.end && end > span.start,
      );
      if (excused) continue;
      findings.push({
        id: rule.id,
        severity: rule.severity,
        match: m[0],
        index: start,
        why: rule.why,
        source: rule.src,
      });
    }
    rule.re.lastIndex = 0;
  }
  return findings;
}
