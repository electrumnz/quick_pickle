#!/usr/bin/env node
// copy-audit-ignore-file
/**
 * QUICK PICKLE - copy auditor.
 *
 * Scans files for language QUICK PICKLE may not lawfully publish about its product.
 * The reasoning behind every rule is in legal/COPY-RULES.md; the rule IDs match.
 *
 *   node legal/scripts/audit-copy.mjs <path> [<path>...]
 *   node legal/scripts/audit-copy.mjs --list
 *   node legal/scripts/audit-copy.mjs --json app/ content/
 *
 * Exit codes:  0 clean   1 findings   2 usage/IO error
 *
 * No dependencies. Node >= 16.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, extname, sep, dirname } from "node:path";

const BANNED = "banned";
const RESTRICTED = "restricted";

/* --------------------------------------------------------------- surfaces */

/**
 * SURFACES — where a piece of text is published, and therefore which law reaches it.
 * The long-form reasoning is legal/COPY-RULES.md §8A; keep the two in step.
 *
 *   consumer  a representation made in trade to a customer. Everything applies.
 *   internal  password-gated business tooling, libraries and tests. Not advertising,
 *             so the rules that regulate how an offer, a price, a right, a provenance
 *             story or a process is PRESENTED TO A CUSTOMER do not reach it.
 *
 * Every rule declares which of the two it belongs to:
 *
 *   EVERY_SURFACE   the matched phrase is a claim about what the product IS or DOES —
 *                   health, therapeutic, hydration/sport, nutrition-content,
 *                   certification, absolute-composition. Lifted verbatim out of an
 *                   admin screen into a caption it is a regulated claim on arrival,
 *                   so it is caught wherever it is written.
 *   CONSUMER_ONLY   the rule judges a representation in its selling context —
 *                   superiority, price, guarantees, endorsement, provenance, process
 *                   descriptors. A private dashboard has no selling context, so the
 *                   rule has nothing to bite on there.
 */
const EVERY_SURFACE = "every-surface";
const CONSUMER_ONLY = "consumer-only";

const CONSUMER = "consumer";
const INTERNAL = "internal";

const SURFACES = {
  [CONSUMER]: {
    id: CONSUMER,
    blurb: "published to customers — a representation in trade",
    enforces: new Set([EVERY_SURFACE, CONSUMER_ONLY]),
  },
  [INTERNAL]: {
    id: INTERNAL,
    blurb: "private business tooling — not advertising",
    enforces: new Set([EVERY_SURFACE]),
  },
};

/**
 * SURFACE_MAP — the classification itself, as data. Longest matching prefix wins,
 * so a narrower path can correct a broader one without touching the scanner.
 * Paths are repository-relative and use forward slashes.
 *
 * Anything unlisted defaults to CONSUMER. That is deliberate: a new directory is
 * policed strictly until somebody decides, in writing, that it is not advertising.
 */
const DEFAULT_SURFACE = CONSUMER;

const SURFACE_MAP = [
  { prefix: "app/", surface: CONSUMER, note: "public pages" },
  {
    prefix: "app/backstage/",
    surface: INTERNAL,
    note: "the back end: brand guide and go-live list",
  },
  { prefix: "components/", surface: CONSUMER, note: "storefront components" },
  {
    prefix: "components/backstage/",
    surface: INTERNAL,
    note: "back-end components",
  },
  { prefix: "content/", surface: CONSUMER, note: "the copy library itself" },
  {
    prefix: "content/brand-guide.ts",
    surface: INTERNAL,
    note: "the brand guide, shown only in the back end",
  },
  { prefix: "public/", surface: CONSUMER, note: "served verbatim to browsers" },
  { prefix: "lib/", surface: INTERNAL, note: "libraries and adapters" },
  { prefix: "scripts/", surface: INTERNAL, note: "build tooling" },
  { prefix: "tests/", surface: INTERNAL, note: "unit tests" },
  { prefix: "e2e/", surface: INTERNAL, note: "end-to-end tests" },
  {
    prefix: "legal/scripts/",
    surface: INTERNAL,
    note: "this scanner and its self-test",
  },
  // Fixtures for the self-test. They exist to prove both branches of the model,
  // so they are classified here rather than inheriting legal/'s default.
  {
    prefix: "legal/test-fixtures/consumer/",
    surface: CONSUMER,
    note: "fixture: consumer surface",
  },
  {
    prefix: "legal/test-fixtures/internal/",
    surface: INTERNAL,
    note: "fixture: internal surface",
  },
];

/** Classify a repository-relative path. Longest matching prefix wins. */
function classify(relPath) {
  let best = null;
  for (const entry of SURFACE_MAP) {
    if (!relPath.startsWith(entry.prefix)) continue;
    if (!best || entry.prefix.length > best.prefix.length) best = entry;
  }
  if (best)
    return { surface: best.surface, note: best.note, prefix: best.prefix };
  return {
    surface: DEFAULT_SURFACE,
    note: "unclassified — defaults to the strict consumer rule set",
    prefix: null,
  };
}

function surfaceOf(file) {
  const rel = relative(REPO_ROOT, resolve(file)).split(sep).join("/");
  return classify(rel);
}

/* ----------------------------------------------------------- terms of art */

/**
 * A term of art is a fixed phrase that contains a scanned word but is not the claim
 * the rule exists to catch. It is scoped to the rule it excuses and to the exact
 * shape of the phrase — never to the bare word — so the rule keeps its teeth.
 * Reasoning: legal/COPY-RULES.md §3 Group E, FTA-04.
 */
const TERMS_OF_ART = [
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
];

function termSpansFor(ruleId, text, cache) {
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

const RULES = [
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

/* --------------------------------------------------------------- scanning */

const SCAN_EXT = new Set([
  ".md",
  ".mdx",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".csv",
  ".tsv",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".svelte",
  ".vue",
  ".astro",
  ".svg",
  ".xml",
  ".rss",
]);

/** Source-code extensions. These are PARSED, not pattern-matched: only string
 *  literals, template-literal text and JSX text are scanned. Identifiers,
 *  property keys, import paths and comments are not text addressed to anyone —
 *  a shader uniform called `absorption`, a SHA `digest`, a reduce accumulator
 *  called `best`. Flagging those trains people to ignore the scanner, which is
 *  the real failure mode. */
const AST_EXT = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

/** Single-file component formats. No parser for these is in the dependency tree,
 *  so they fall back to the lexical mask (comments blanked, identifier-shaped
 *  matches skipped) rather than being scanned raw. */
const LEXICAL_EXT = new Set([".svelte", ".vue", ".astro"]);

/** Structured-data files: object KEYS are identifiers, string VALUES are text. */
const JSON_EXT = new Set([".json", ".jsonc"]);

/** Markdown: prose is scanned, fenced code blocks are not. */
const MARKDOWN_EXT = new Set([".md", ".mdx", ".markdown"]);

/** The character every non-scannable byte is replaced with. Not whitespace and
 *  not a word character, so it breaks both `\s+` and `\b` — a rule can never
 *  match across the gap where code used to be. Newlines are always preserved so
 *  file:line:column stays exact. */
const MASK = "\u0001";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".cache",
  ".vercel",
  ".netlify",
  "dist",
  "build",
  "out",
  "coverage",
  "test-results",
  "playwright-report",
  ".pnpm-store",
  "vendor",
  ".venv",
  "__pycache__",
]);

const IGNORE_FILE = "copy-audit-ignore-file";
const IGNORE_START = "copy-audit-ignore-start";
const IGNORE_END = "copy-audit-ignore-end";
const IGNORE_LINE = "copy-audit-ignore";
const APPROVE_RE = /copy-audit-approved:\s*([A-Za-z0-9_\-,\s]+)/i;
const NUL = String.fromCharCode(0);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const EXEMPT_FILE = join(HERE, "..", "copy-audit-exempt.json");

/**
 * Registered exemptions for META-DOCUMENTS: files whose job is to enumerate the
 * forbidden words (this ruleset, the brand guide's prohibition lists, the test
 * fixtures). Scanning those with the marketing ruleset produces noise that
 * trains people to ignore the scanner, which is the real failure mode.
 * Registered in legal/copy-audit-exempt.json so every exemption has a written
 * reason and a review date. `--no-exemptions` ignores the registry.
 */
function loadExemptions() {
  try {
    const raw = JSON.parse(readFileSync(EXEMPT_FILE, "utf8"));
    return Array.isArray(raw.exemptions) ? raw.exemptions : [];
  } catch {
    return [];
  }
}

function exemptionFor(file, exemptions) {
  const rel = relative(REPO_ROOT, resolve(file)).split(sep).join("/");
  return exemptions.find((e) => e.path === rel) || null;
}

function isLegalPath(p) {
  return resolve(p).split(sep).includes("legal");
}

function walk(target, opts, acc) {
  let st;
  try {
    st = statSync(target);
  } catch (e) {
    throw new Error(`cannot read ${target}: ${e.message}`);
  }
  if (st.isFile()) {
    acc.push(target);
    return acc;
  }
  if (!st.isDirectory()) return acc;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const full = join(target, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (!opts.includeLegal && isLegalPath(full)) continue;
      walk(full, opts, acc);
    } else if (entry.isFile()) {
      if (!SCAN_EXT.has(extname(entry.name).toLowerCase())) continue;
      if (!opts.includeLegal && isLegalPath(full)) continue;
      acc.push(full);
    }
  }
  return acc;
}

function approvedIds(line) {
  if (!line) return null;
  const m = line.match(APPROVE_RE);
  if (!m) return null;
  const ids = m[1]
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

/** Nearest preceding non-blank line — markdown formatters insert blank lines
 *  between an HTML-comment marker and the text it governs. */
function precedingSignificantLine(lines, i) {
  for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
    if (lines[j].trim() !== "") return lines[j];
  }
  return "";
}

/** Lines suppressed because they sit under an exempted markdown heading. */
function headingExemptedLines(lines, headings) {
  const skip = new Set();
  if (!headings || headings.length === 0) return skip;
  const wanted = headings.map((h) => h.toLowerCase());
  let activeLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const level = m[1].length;
      const text = m[2]
        .replace(/[*_`#]/g, "")
        .trim()
        .toLowerCase();
      if (activeLevel && level <= activeLevel) activeLevel = 0;
      if (!activeLevel && wanted.some((w) => text.includes(w))) {
        activeLevel = level;
        skip.add(i);
        continue;
      }
    }
    if (activeLevel) skip.add(i);
  }
  return skip;
}

/* ---------------------------------------------------- text extraction */

/**
 * Everything below turns a file into a MASK: a string the same length as the
 * original, in which every character that is not text-addressed-to-a-reader has
 * been replaced by MASK, and every newline preserved. Rules run against the mask,
 * so file:line:column stays exact and no rule can match through the gap where
 * code used to be.
 *
 * What counts as text:
 *   .ts .tsx .js .jsx .mjs .cjs   string literals, template-literal text, JSX text
 *   .json .jsonc                  string VALUES (keys are identifiers)
 *   .md .mdx .markdown            prose (fenced code blocks are code)
 *   everything else               the whole file
 */

function blankRun(n) {
  return MASK.repeat(n);
}

/** Build the mask from a keep-map: 1 = scan this character, 0 = blank it. */
function applyKeep(text, keep) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || c === "\r") out += c;
    else out += keep[i] ? c : MASK;
  }
  return out;
}

/* -- JavaScript / TypeScript, parsed ---------------------------------- */

let tsModule; // resolved once, lazily
let tsLoadAttempted = false;
let tsWarned = false;

async function loadTypeScript() {
  if (tsLoadAttempted) return tsModule;
  tsLoadAttempted = true;
  try {
    const mod = await import("typescript");
    tsModule = mod.default ?? mod;
  } catch {
    tsModule = null;
  }
  return tsModule;
}

/** A string literal that is a NAME, a PATH or a KEY is an identifier, not copy. */
function isIdentifierPosition(ts, node) {
  const p = node.parent;
  if (!p) return false;

  // import "x" / from "x" / export ... from "x" / import("x") / require("x")
  if (p.moduleSpecifier === node) return true;
  if (ts.isExternalModuleReference(p)) return true;
  if (ts.isImportTypeNode(p) && p.argument === node) return true;
  if (ts.isLiteralTypeNode(p) && p.parent && ts.isImportTypeNode(p.parent))
    return true;
  if (
    ts.isCallExpression(p) &&
    p.arguments[0] === node &&
    (p.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(p.expression) && p.expression.escapedText === "require"))
  ) {
    return true;
  }

  // { "a-key": value }, interface { "a-key": T }, enum { "A" = 1 }, class members
  if (p.name === node) {
    if (
      ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isImportSpecifier(p) ||
      ts.isExportSpecifier(p) ||
      ts.isImportAttribute?.(p)
    ) {
      return true;
    }
  }
  if (
    (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) &&
    p.propertyName === node
  ) {
    return true;
  }

  // obj["a-key"]
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node)
    return true;

  return false;
}

/**
 * Mark the inside of a quoted or templated literal, working out the delimiters
 * from the characters themselves so template heads (`` `x${ ``), middles
 * (`` }x${ ``) and tails (`` }x` ``) all land correctly.
 */
function markLiteralInterior(text, keep, start, end) {
  const raw = text.slice(start, end);
  let s = start;
  let e = end;
  if (/^["'`}]/.test(raw)) s += 1;
  if (/\$\{$/.test(raw)) e -= 2;
  else if (/["'`]$/.test(raw) && e - 1 >= s) e -= 1;
  for (let i = s; i < e && i < text.length; i++) keep[i] = 1;
}

function maskWithTypeScript(ts, file, text) {
  const ext = extname(file).toLowerCase();
  const kind =
    ext === ".tsx"
      ? ts.ScriptKind.TSX
      : ext === ".ts" || ext === ".mts" || ext === ".cts"
        ? ts.ScriptKind.TS
        : ext === ".jsx"
          ? ts.ScriptKind.JSX
          : ts.ScriptKind.JS;

  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const keep = new Uint8Array(text.length);

  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
        if (!isIdentifierPosition(ts, node)) {
          markLiteralInterior(text, keep, node.getStart(sf), node.getEnd());
        }
        break;
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        markLiteralInterior(text, keep, node.getStart(sf), node.getEnd());
        break;
      case ts.SyntaxKind.JsxText:
        for (let i = node.getStart(sf); i < node.getEnd(); i++) keep[i] = 1;
        break;
      default:
        break;
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);

  return applyKeep(text, keep);
}

/* -- lexical fallback (no parser available, and .svelte/.vue/.astro) --- */

/** Blank out comment text in a code line, preserving column positions so
 *  file:line:column stays accurate. Returns [maskedLine, nextBlockState]. */
function maskComments(line, inBlock) {
  let out = "";
  let i = 0;
  let block = inBlock;
  let quote = null;
  while (i < line.length) {
    const two = line.slice(i, i + 2);
    if (block) {
      if (two === "*/") {
        block = false;
        out += blankRun(2);
        i += 2;
        continue;
      }
      out += MASK;
      i += 1;
      continue;
    }
    if (quote) {
      out += line[i];
      if (line[i] === "\\") {
        out += line[i + 1] === undefined ? "" : line[i + 1];
        i += 2;
        continue;
      }
      if (line[i] === quote) quote = null;
      i += 1;
      continue;
    }
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      quote = line[i];
      out += line[i];
      i += 1;
      continue;
    }
    if (two === "//") {
      out += blankRun(line.length - i);
      break;
    }
    if (two === "/*") {
      block = true;
      out += blankRun(2);
      i += 2;
      continue;
    }
    out += line[i];
    i += 1;
  }
  if (out.length < line.length) out += blankRun(line.length - out.length);
  return [out, block];
}

/** Identifier-shaped matches in the lexical fallback: `params.absorption`,
 *  `absorption: number`, `--best-practice`, `foo_recovery`. */
function looksLikeIdentifier(line, index, match) {
  const before = index > 0 ? line[index - 1] : "";
  const after = line[index + match.length] || "";
  if (before === "." || before === "_" || before === "$" || before === "#")
    return true;
  if (after === ":" || after === "_" || after === "(" || after === "=")
    return true;
  return false;
}

function maskLexically(text) {
  const lines = text.split("\n");
  let block = false;
  const out = [];
  for (const line of lines) {
    const carriage = line.endsWith("\r");
    const body = carriage ? line.slice(0, -1) : line;
    const [masked, next] = maskComments(body, block);
    block = next;
    out.push(carriage ? masked + "\r" : masked);
  }
  return out.join("\n");
}

/* -- JSON -------------------------------------------------------------- */

/** Keep string VALUES, blank keys, punctuation, numbers and literals. */
function maskJson(text) {
  const keep = new Uint8Array(text.length);
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c !== '"') {
      i += 1;
      continue;
    }
    const start = i;
    i += 1;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i] === '"') break;
      i += 1;
    }
    const end = Math.min(i, text.length); // index of the closing quote
    let j = end + 1;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    const isKey = text[j] === ":";
    if (!isKey) for (let k = start + 1; k < end; k++) keep[k] = 1;
    i = end + 1;
  }
  return applyKeep(text, keep);
}

/* -- Markdown ---------------------------------------------------------- */

/** Keep prose, blank fenced code blocks. A fenced block is a code sample, not
 *  copy — and this file's own ``` examples are the proof. */
function maskMarkdown(text) {
  const keep = new Uint8Array(text.length).fill(1);
  const lines = text.split("\n");
  let offset = 0;
  let fence = null;
  for (const line of lines) {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence === null && m) {
      fence = m[1][0];
      for (let k = 0; k < line.length; k++) keep[offset + k] = 0;
    } else if (fence !== null) {
      for (let k = 0; k < line.length; k++) keep[offset + k] = 0;
      if (m && m[1][0] === fence) fence = null;
    }
    offset += line.length + 1;
  }
  return applyKeep(text, keep);
}

/* -- the dispatcher ---------------------------------------------------- */

/** Returns { masked, mode } for a file. `mode` is reported so a reader can see
 *  how a file was read. */
function maskFor(file, text, ts) {
  const ext = extname(file).toLowerCase();
  if (AST_EXT.has(ext)) {
    if (ts) {
      try {
        return { masked: maskWithTypeScript(ts, file, text), mode: "parsed" };
      } catch {
        return { masked: maskLexically(text), mode: "lexical (parse failed)" };
      }
    }
    if (!tsWarned) {
      tsWarned = true;
      process.stderr.write(
        "warn: typescript is not installed, so .ts/.tsx/.js files are read with the\n" +
          "      lexical fallback instead of being parsed. Run `npm ci` for exact results.\n",
      );
    }
    return { masked: maskLexically(text), mode: "lexical (no parser)" };
  }
  if (LEXICAL_EXT.has(ext))
    return { masked: maskLexically(text), mode: "lexical" };
  if (JSON_EXT.has(ext)) return { masked: maskJson(text), mode: "json values" };
  if (MARKDOWN_EXT.has(ext))
    return { masked: maskMarkdown(text), mode: "markdown prose" };
  return { masked: text, mode: "verbatim" };
}

/* --------------------------------------------------------------- scanning */

/** Byte offset -> 1-based line/column, via the original text's line starts. */
function makeLocator(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: index - starts[lo] + 1 };
  };
}

/**
 * Marker pre-pass over the ORIGINAL lines. Markers live in comments, which the
 * mask blanks out, so they are always read from the raw text.
 */
function markerPass(lines, ex) {
  const suppressed = new Set();
  const approvals = new Map();

  const headingSkip =
    ex && ex.sections ? headingExemptedLines(lines, ex.sections) : new Set();
  const literalSkips = (ex && ex.linePatterns) || [];

  let inIgnoreBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.includes(IGNORE_START)) {
      inIgnoreBlock = true;
      suppressed.add(i);
      continue;
    }
    if (raw.includes(IGNORE_END)) {
      inIgnoreBlock = false;
      suppressed.add(i);
      continue;
    }
    if (
      inIgnoreBlock ||
      headingSkip.has(i) ||
      literalSkips.some((p) => raw.includes(p))
    ) {
      suppressed.add(i);
      continue;
    }

    const prev = precedingSignificantLine(lines, i);
    const marked = (s) =>
      s.includes(IGNORE_LINE) &&
      !s.includes(IGNORE_FILE) &&
      !APPROVE_RE.test(s);
    if (marked(raw) || marked(prev)) {
      suppressed.add(i);
      continue;
    }

    const ids = approvedIds(raw) || approvedIds(prev);
    if (ids) approvals.set(i, ids);
  }
  return { suppressed, approvals };
}

/**
 * @returns {{skipped: boolean, reason?: string, surface?: string, mode?: string}}
 */
function scanFile(file, out, exemptions, opts, ts) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { skipped: false };
  }
  if (text.indexOf(NUL) !== -1) return { skipped: false }; // binary

  const ex = opts.noExemptions ? null : exemptionFor(file, exemptions);
  if (ex && (ex.scope === "file" || !ex.scope))
    return { skipped: true, reason: ex.reason };

  const lines = text.split(/\r?\n/);
  if (lines.slice(0, 20).some((l) => l.includes(IGNORE_FILE)))
    return { skipped: true, reason: "copy-audit-ignore-file marker" };

  const place = surfaceOf(file);
  const surface = SURFACES[place.surface];
  const { masked, mode } = maskFor(file, text, ts);
  const locate = makeLocator(text);
  const { suppressed, approvals } = markerPass(lines, ex);
  const termCache = new Map();

  // Only the lexical fallback needs the identifier heuristic. A parsed file has
  // already had its identifiers removed, and guessing at them again there would
  // start hiding real copy that happens to sit next to a colon or a bracket.
  const lexical = mode.startsWith("lexical");
  const maskedLines = lexical ? masked.split(/\r?\n/) : null;

  for (const rule of RULES) {
    const enforced = surface.enforces.has(rule.applies);
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(masked)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      const { line, column } = locate(m.index);
      const i = line - 1;
      if (suppressed.has(i)) continue;
      if (
        lexical &&
        looksLikeIdentifier(maskedLines[i] ?? "", column - 1, m[0])
      )
        continue;

      const finding = {
        file,
        line,
        column,
        match: m[0],
        id: rule.id,
        severity: rule.severity,
        applies: rule.applies,
        surface: place.surface,
        surfaceNote: place.note,
        why: rule.why,
        source: rule.src,
        excerpt: (lines[i] || "").trim().slice(0, 160),
      };

      // 1. the rule does not reach this surface
      if (!enforced) {
        out.suppressed.push({
          ...finding,
          suppressedBy: "surface",
          suppressedWhy: `${rule.id} regulates a representation made to a consumer; ${place.note} is not advertising`,
        });
        continue;
      }
      // 2. the match is a fixed term of art, not the claim the rule catches
      const span = termSpansFor(rule.id, masked, termCache).find(
        (s) => m.index < s.end && m.index + m[0].length > s.start,
      );
      if (span) {
        out.suppressed.push({
          ...finding,
          suppressedBy: "term-of-art",
          suppressedWhy: `${span.term.id}: ${span.term.why}`,
        });
        continue;
      }
      // 3. a human has recorded that the condition was checked (RESTRICTED only)
      const approved = approvals.get(i);
      if (rule.severity === RESTRICTED && approved && approved.has(rule.id)) {
        out.suppressed.push({
          ...finding,
          suppressedBy: "approved",
          suppressedWhy: `copy-audit-approved: ${rule.id}`,
        });
        continue;
      }

      out.findings.push(finding);
    }
  }
  return { skipped: false, surface: place.surface, mode };
}
/* ------------------------------------------------------------------- main */

const USAGE = `QUICK PICKLE copy auditor

  node legal/scripts/audit-copy.mjs <path> [<path>...]   scan files or directories
  node legal/scripts/audit-copy.mjs --list               print every rule
  node legal/scripts/audit-copy.mjs --surfaces           print the surface model
  node legal/scripts/audit-copy.mjs --json <path>        machine-readable findings

Options
  --json             emit JSON instead of human-readable text
  --include-legal    also scan files under legal/ (excluded by default)
  --no-exemptions    ignore legal/copy-audit-exempt.json (see everything)
  --show-suppressed  list what was NOT raised, and why
  --quiet            print only the summary line

Surfaces
  Consumer surfaces are representations made in trade to customers and get the
  full rule set. Internal surfaces — the admin, libraries, tests — are not
  advertising, so rules about superiority, price, guarantees, provenance and
  process do not reach them. Rules about what the product IS or DOES (health,
  therapeutic, hydration, nutrition content, certification) apply everywhere,
  because such a sentence is a regulated claim the moment anything lifts it into
  a caption. --surfaces prints the classification; COPY-RULES.md §8A is the
  authority for it.

Text, not code
  .ts/.tsx/.js/.jsx/.mjs/.cjs are parsed: only string literals, template text and
  JSX text are scanned. Identifiers, property keys, import paths and comments are
  not. JSON keys are skipped and JSON string values scanned. Markdown prose is
  scanned; fenced code blocks are not.

Inline markers
  copy-audit-ignore-file            skip the whole file (must appear in the first 20 lines)
  copy-audit-ignore-start / -end    skip everything between the two markers
  copy-audit-ignore                 skip this line (or the line immediately below it)
  copy-audit-approved: <RULE-ID>    clear a RESTRICTED finding on this line (or the line below)

Meta-documents that must enumerate the banned words (this ruleset, the brand
guide's prohibition lists, the test fixtures) are registered with a written
reason in legal/copy-audit-exempt.json.

Exit: 0 clean, 1 findings, 2 usage error.
Rules and reasoning: legal/COPY-RULES.md
`;

function list() {
  for (const rule of RULES) {
    const where =
      rule.applies === EVERY_SURFACE
        ? "every surface (consumer + internal)"
        : "consumer surfaces only";
    process.stdout.write(
      `${rule.id}\t${rule.severity.toUpperCase()}\n` +
        `\tapplies: ${where}\n` +
        `\tregex:  ${rule.re.source}\n` +
        `\twhy:    ${rule.why}\n` +
        `\tsource: ${rule.src}\n\n`,
    );
  }
  const banned = RULES.filter((x) => x.severity === BANNED).length;
  const every = RULES.filter((x) => x.applies === EVERY_SURFACE).length;
  process.stdout.write(
    `${RULES.length} rules (${banned} banned, ${RULES.length - banned} restricted; ` +
      `${every} every-surface, ${RULES.length - every} consumer-only).\n`,
  );
  return 0;
}

function listSurfaces() {
  process.stdout.write("Surface model — legal/COPY-RULES.md §8A\n\n");
  for (const id of [CONSUMER, INTERNAL]) {
    const s = SURFACES[id];
    const rules = RULES.filter((r2) => s.enforces.has(r2.applies));
    process.stdout.write(
      `${id.toUpperCase()}  ${s.blurb}\n` +
        `  enforces ${rules.length} of ${RULES.length} rules: ${[...s.enforces].join(", ")}\n`,
    );
    for (const e of SURFACE_MAP.filter((x) => x.surface === id)) {
      process.stdout.write(`    ${e.prefix.padEnd(34)} ${e.note}\n`);
    }
    process.stdout.write("\n");
  }
  process.stdout.write(
    `Anything unlisted is treated as ${DEFAULT_SURFACE.toUpperCase()} — a new directory is\n` +
      "policed strictly until somebody decides, in writing, that it is not advertising.\n\n" +
      "Terms of art (a fixed phrase excused for a named rule, never a bare word):\n",
  );
  for (const t of TERMS_OF_ART) {
    process.stdout.write(
      `  ${t.id.padEnd(26)} ${t.rules.join(", ")}  ${t.why}\n`,
    );
  }
  return 0;
}

async function main(argv) {
  const opts = {
    json: false,
    includeLegal: false,
    quiet: false,
    noExemptions: false,
    showSuppressed: false,
  };
  const paths = [];
  for (const a of argv) {
    if (a === "--json") opts.json = true;
    else if (a === "--include-legal") opts.includeLegal = true;
    else if (a === "--no-exemptions") opts.noExemptions = true;
    else if (a === "--show-suppressed") opts.showSuppressed = true;
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--list") return list();
    else if (a === "--surfaces") return listSurfaces();
    else if (a === "-h" || a === "--help") {
      process.stdout.write(USAGE);
      return 0;
    } else if (a.startsWith("-")) {
      process.stderr.write(`unknown option: ${a}\n`);
      process.stdout.write(USAGE);
      return 2;
    } else paths.push(a);
  }
  if (paths.length === 0) {
    process.stdout.write(USAGE);
    return 2;
  }

  let files = [];
  try {
    for (const p of paths) walk(resolve(p), opts, files);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    return 2;
  }
  files = [...new Set(files)].sort();

  const ts = await loadTypeScript();
  const exemptions = loadExemptions();
  const out = { findings: [], suppressed: [] };
  const exempted = [];
  const scannedBySurface = { [CONSUMER]: 0, [INTERNAL]: 0 };
  for (const f of files) {
    const res = scanFile(f, out, exemptions, opts, ts);
    if (res && res.skipped) exempted.push({ file: f, reason: res.reason });
    else if (res && res.surface) scannedBySurface[res.surface] += 1;
  }

  // Rules are evaluated one at a time over the whole file, so report in reading
  // order rather than rule order — a reader fixes a file top to bottom.
  const inReadingOrder = (a, b) =>
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.column - b.column ||
    a.id.localeCompare(b.id);
  out.findings.sort(inReadingOrder);
  out.suppressed.sort(inReadingOrder);

  const { findings, suppressed } = out;
  const banned = findings.filter((f) => f.severity === BANNED).length;
  const restricted = findings.length - banned;
  const bySurface = (id) => findings.filter((f) => f.surface === id).length;
  const bySuppressor = (k) =>
    suppressed.filter((f) => f.suppressedBy === k).length;
  const cwd = process.cwd();
  const rel = (f) => relative(cwd, f);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: findings.length === 0,
          filesScanned: files.length,
          filesExempted: exempted.length,
          filesBySurface: scannedBySurface,
          banned,
          restricted,
          findingsBySurface: {
            consumer: bySurface(CONSUMER),
            internal: bySurface(INTERNAL),
          },
          notRaised: {
            surface: bySuppressor("surface"),
            termOfArt: bySuppressor("term-of-art"),
            approved: bySuppressor("approved"),
          },
          exempted: exempted.map((e) => ({
            file: rel(e.file),
            reason: e.reason,
          })),
          findings: findings.map((f) => ({ ...f, file: rel(f.file) })),
          suppressed: opts.showSuppressed
            ? suppressed.map((f) => ({ ...f, file: rel(f.file) }))
            : undefined,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    if (!opts.quiet) {
      for (const f of findings) {
        const tag = f.severity === BANNED ? "BANNED    " : "RESTRICTED";
        const reach =
          f.applies === EVERY_SURFACE
            ? "enforced on every surface — a claim about what the product is or does"
            : "enforced here because this is a representation made to a consumer";
        process.stdout.write(
          `${rel(f.file)}:${f.line}:${f.column}  ${tag}  [${f.id}]  "${f.match}"\n` +
            `    surface: ${f.surface} (${f.surfaceNote})\n` +
            `    applies: ${reach}\n` +
            `    ${f.why}\n` +
            `    source:  ${f.source}\n` +
            `    line:    ${f.excerpt}\n\n`,
        );
      }
      if (opts.showSuppressed && suppressed.length) {
        process.stdout.write("Not raised\n");
        for (const f of suppressed) {
          process.stdout.write(
            `  ${rel(f.file)}:${f.line}:${f.column}  [${f.id}]  "${f.match}"  ` +
              `${f.suppressedBy}: ${f.suppressedWhy}\n`,
          );
        }
        process.stdout.write("\n");
      }
    }
    const verdict = findings.length === 0 ? "PASS" : "FAIL";
    process.stdout.write(
      `${verdict}  ${files.length} file(s) scanned ` +
        `(${scannedBySurface[CONSUMER]} consumer, ${scannedBySurface[INTERNAL]} internal), ` +
        `${exempted.length} exempted, ${findings.length} finding(s) ` +
        `(${banned} banned, ${restricted} restricted) — ` +
        `${bySurface(CONSUMER)} on consumer surfaces, ${bySurface(INTERNAL)} internal.\n`,
    );
    if (suppressed.length) {
      process.stdout.write(
        `      not raised: ${bySuppressor("surface")} consumer-only rule hit(s) on internal ` +
          `surfaces, ${bySuppressor("term-of-art")} term(s) of art, ` +
          `${bySuppressor("approved")} human-approved` +
          `${opts.showSuppressed ? "" : "  (--show-suppressed to list)"}\n`,
      );
    }
    if (findings.length) {
      process.stdout.write(
        "See legal/COPY-RULES.md. Restricted findings can be cleared with an inline\n" +
          "copy-audit-approved:<RULE-ID> marker once the condition has actually been checked.\n",
      );
    }
  }
  return findings.length ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
