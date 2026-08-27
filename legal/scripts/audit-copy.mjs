#!/usr/bin/env node
// copy-audit-ignore-file
/**
 * HALF SOUR - copy auditor.
 *
 * Scans files for language HALF SOUR may not lawfully publish about its product.
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
import { join, relative, resolve, extname, sep } from "node:path";

const BANNED = "banned";
const RESTRICTED = "restricted";

function r(id, severity, re, why, src) {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  return { id, severity, re: new RegExp(re.source, flags), why, src };
}

/* ------------------------------------------------------------------ rules */

const RULES = [
  // ---- Group A: health effects / health claims -------------------------
  r(
    "HC-01",
    BANNED,
    /\bgut[\s-]?(?:health|friendly|biome)\b|\bgut\b/i,
    "Health claim about a functional/physiological outcome.",
    'FSC Std 1.2.7-18; definition of "health effect", Std 1.1.2-2',
  ),
  r(
    "HC-02",
    BANNED,
    /\bpro[\s-]?biotics?\b/i,
    "Probiotic language is a health claim and an unsubstantiated composition claim.",
    "FSC Std 1.2.7-18; FTA 1986 s 12A",
  ),
  r(
    "HC-03",
    BANNED,
    /\b(?:pre|post|syn)[\s-]?biotics?\b/i,
    'Same class of implied health claim as "probiotic".',
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-04",
    BANNED,
    /\blive\s+(?:cultures?|bacteria)\b|\b(?:good|friendly|beneficial)\s+bacteria\b|\bmicrobiome\b|\bmicrobiota\b|\bgut\s+flora\b/i,
    "Implied probiotic / health claim.",
    "FSC Std 1.2.7-2 (definition of *claim* includes implied statements and designs)",
  ),
  r(
    "HC-05",
    BANNED,
    /\bdigestions?\b|\bdigestive\b|\bdigest(?:s|ing|ed)\b|\bbloat(?:ing|ed|s)?\b|\bregularity\b/i,
    "Health claim about a functional process.",
    "FSC Std 1.2.7-18",
  ),
  r("HC-06", BANNED, /\bimmun\w*\b/i, "Health claim.", "FSC Std 1.2.7-18"),
  r(
    "HC-07",
    BANNED,
    /\bdetox\w*\b|\bcleanse[sd]?\b|\bcleansing\b/i,
    "Health claim and unsubstantiable.",
    "FSC Std 1.2.7-18; FTA 1986 s 12A",
  ),
  r(
    "HC-08",
    BANNED,
    /\bmetabolis\w*\b|\bmetabolic\b|\bburns?\s+fat\b|\bfat[\s-]burning\b/i,
    "Health claim about a biochemical process.",
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-09",
    BANNED,
    /\bblood\s+(?:pressure|sugar|glucose)\b|\binsulin\b|\bcholesterol\b/i,
    "Biomarker of a serious disease - a HIGH LEVEL health claim, only available from the S4-4 table.",
    "FSC Std 1.2.7-18(2); Schedule 4, S4-4",
  ),
  r(
    "HC-10",
    BANNED,
    /\bboost\w*\b|\bpick[\s-]me[\s-]up\b|\balertness\b|\bmental\s+(?:focus|clarity|performance)\b/i,
    'Health claim about mental or physical performance ("boost" in any form).',
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-11",
    BANNED,
    /\banti[\s-]?inflammat\w*\b|\binflammation\b|\bantioxidants?\b|\bfree\s+radicals?\b/i,
    "Health claim; antioxidant claims additionally need a permitted food-health relationship.",
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-12",
    BANNED,
    /\bnutrients?\b|\bnutrient[\s-]dense\b|\bnourish\w*\b|\bnutritious\b/i,
    "Reads as a nutrition/health claim without meeting any Schedule 4 condition.",
    "FSC Std 1.2.7-12, 1.2.7-13; FTA 1986 s 12A",
  ),
  r(
    "HC-13",
    BANNED,
    /\bsuper[\s-]?foods?\b|\bfunctional\s+(?:food|beverage|drink)\b|\bwell[\s-]?being\b|\bwellness\b/i,
    "Implied health claim; unsubstantiable.",
    "FSC Std 1.2.7-2; FTA 1986 s 12A",
  ),
  r(
    "HC-14",
    BANNED,
    /\bgood\s+for\s+(?:you|your|me|us|the\s+body)\b|\bdoes\s+you\s+good\b|\bhealth(?:y|ier|iest|ful)?\b/i,
    'Implied health claim ("healthy", "good for you").',
    "FSC Std 1.2.7-18",
  ),
  r(
    "HC-15",
    BANNED,
    /\bguilt[\s-]?free\b|\bno\s+guilt\b|\bsin[\s-]?free\b|\bvirtuous\b/i,
    "Implied nutrition/health claim about energy or sugar with no Schedule 4 basis.",
    "FSC Std 1.2.7-12; S4-3",
  ),
  r(
    "HC-16",
    BANNED,
    /\bbioavailab\w*\b|\babsorption\b/i,
    "Health claim about a biochemical process.",
    "FSC Std 1.2.7-18",
  ),

  // ---- Group B: therapeutic --------------------------------------------
  r(
    "TH-01",
    BANNED,
    /\bhang[\s-]?overs?\b|\bmorning\s+after\b/i,
    "A hangover is a condition; alleviating it is a therapeutic claim. Absolutely prohibited, no exceptions.",
    "FSC Std 1.2.7-8(a)",
  ),
  r(
    "TH-02",
    BANNED,
    /\bcure[sd]?\b|\bcurative\b|\bremed(?:y|ies)\b|\bheals?\b|\bhealing\b|\btreatments?\b|\btreats?\b(?=\s+(?:your|the|a|an|any|symptom|illness|condition|cramp|hangover))/i,
    'Therapeutic claim. (Plain "treats" as in snacks is not matched.)',
    "FSC Std 1.2.7-8(a)",
  ),
  r(
    "TH-03",
    BANNED,
    /\bprevent(?!Default)\w*\b|\bprotects?\s+against\b|\bwards?\s+off\b|\bfights?\s+off\b/i,
    "Therapeutic claim (prevention).",
    "FSC Std 1.2.7-8(a)",
  ),
  r(
    "TH-04",
    BANNED,
    /\bcramp(?:s|ing|ed)?\b/i,
    "A condition. The classic pickle-juice claim - the one we will never make.",
    "FSC Std 1.2.7-8(a)",
  ),
  r(
    "TH-05",
    BANNED,
    /\bnausea\w*\b|\bmorning\s+sickness\b|\bheartburn\b|\breflux\b|\bindigestion\b|\bupset\s+stomach\b|\bsettles?\s+(?:your|the)\s+stomach\b/i,
    "Named conditions.",
    "FSC Std 1.2.7-8(a)",
  ),
  r(
    "TH-06",
    BANNED,
    /\bmedicinal\b|\bmedicines?\b|\btherapeutic\w*\b|\belixir\b|\btonics?\b|\bwellness\s+shot\b|\bapothecary\b/i,
    "Therapeutic framing; in NZ also risks the product being treated as a medicine under the Medicines Act 1981.",
    "FSC Std 1.2.7-8(b)",
  ),
  r(
    "TH-07",
    BANNED,
    /\b(?:doctor|dietitian|dietician|nutritionist|physio\w*|naturopath\w*|herbalist)[\s-]+(?:recommended|approved|endorsed|backed|formulated)\b|\bclinically\s+(?:proven|tested|shown)\b|\bscientifically\s+proven\b|\bstudies\s+show\b|\bresearch\s+shows\b/i,
    "Therapeutic/endorsement claim and unsubstantiated representation.",
    "FSC Std 1.2.7-8; FTA 1986 ss 12A, 13(e)",
  ),
  r(
    "TH-08",
    BANNED,
    /\bdosages?\b|\bdaily\s+dose\b|\bprescri(?:be|bed|bing|ption)\w*\b/i,
    "Therapeutic framing.",
    "FSC Std 1.2.7-8(b)",
  ),

  // ---- Group C: electrolytes / hydration / sport ------------------------
  r(
    "EL-01",
    BANNED,
    /\belectrolytes?\b/i,
    '"Electrolyte drink" is a PRESCRIBED NAME with a mandatory composition (>=10 mmol/L sodium and 20-100 g/L of specified sugars) that HALF SOUR does not meet. This is a compositional breach, not just a marketing risk.',
    "FSC Std 2.6.2-11(1)-(2), 2.6.2-12(1), 2.6.2-15",
  ),
  r(
    "EL-02",
    BANNED,
    /\b(?:re)?hydrat(?:e|es|ed|ing|ion)\b|\bdehydration\b/i,
    "Health claim about a physiological process.",
    "FSC Std 1.2.7-18",
  ),
  r(
    "EL-03",
    BANNED,
    /\breplenish\w*\b|\breplaces?\s+(?:salts?|minerals?|what\s+you\s+lose)\b|\brestores?\s+(?:balance|salts?|minerals?)\b/i,
    "Implied electrolyte / health claim.",
    "FSC Std 1.2.7-18; Std 2.6.2-15",
  ),
  r(
    "EL-04",
    BANNED,
    /\brecover(?:y|ies|ing|ed|s)?\b|\b(?:post|pre)[\s-]?workout\b|\bworkouts?\b|\bgyms?\b|\bathletes?\b|\bathletic\b|\bsports?\s+(?:drink|beverage|nutrition|recovery)\b|\bisotonic\b/i,
    "Health claim about physical performance; also drags us toward Std 2.9.4 (formulated supplementary sports foods) and Std 2.6.2.",
    "FSC Std 1.2.7-18; Std 2.9.4; Std 2.6.2",
  ),
  r(
    "EL-05",
    BANNED,
    /\bendurance\b|\bstamina\b|\bmuscles?\b|\bsoreness\b|\bDOMS\b|\bperformance\b(?!\s*\.)/i,
    "Health claim about physical performance.",
    "FSC Std 1.2.7-18",
  ),

  // ---- Group D: nutrition content claims --------------------------------
  r(
    "NCC-01",
    BANNED,
    /\blow[\s-](?:in[\s-])?sugars?\b/i,
    "Requires <= 2.5 g sugars/100 mL for a liquid food.",
    'FSC S4-3 (Sugar or sugars, "Low")',
  ),
  r(
    "NCC-02",
    BANNED,
    /\bsugar[\s-]?free\b|\bno\s+sugars?\b|\b(?:0|zero)\s*%?\s*sugars?\b/i,
    'The "% Free" descriptor for sugars requires the food to meet the LOW SUGAR condition (<= 2.5 g/100 mL). "Sugar free" is not a synonym for "contains no sugar".',
    'FSC S4-3 (Sugar or sugars, "% Free")',
  ),
  r(
    "NCC-03",
    BANNED,
    /\bno\s+added\s+sugars?\b/i,
    "Four cumulative conditions including <= 7.5 g sugars/100 mL for liquid food and no hydrolysis-driven increase in hexose sugars.",
    'FSC S4-3 (Sugar or sugars, "No added"), as varied by Proposal P1063',
  ),
  r(
    "NCC-04",
    BANNED,
    /\blow[\s-](?:in[\s-])?(?:calorie|kilojoule|energy|kj)s?\b/i,
    "Requires <= 80 kJ/100 mL for a liquid food.",
    'FSC S4-3 (Energy, "Low")',
  ),
  r(
    "NCC-05",
    BANNED,
    /\b(?:zero|no)\s+(?:calories?|kilojoules?|kj)\b|\bcalorie[\s-]?free\b/i,
    "Not a listed descriptor for energy; unlisted descriptors are constrained by Std 1.2.7-12(8) and 1.2.7-13(2).",
    "FSC Std 1.2.7-12(8), 1.2.7-13(2)",
  ),
  r(
    "NCC-06",
    RESTRICTED,
    /\bdiet\b/i,
    'As a product descriptor, "diet" requires the food to MEET THE NPSC and be <= 80 kJ/100 mL or 40% lower energy than a named reference food. Approve only for clearly non-descriptor uses.',
    'FSC S4-3 (Energy, "Diet"); Std 1.2.7-15; Std 1.2.7-16',
  ),
  r(
    "NCC-07",
    BANNED,
    /\blow[\s-](?:in[\s-])?(?:salt|sodium)\b/i,
    "Requires <= 120 mg sodium/100 mL. A cucumber brine will not meet this.",
    'FSC S4-3 (Salt or sodium, "Low")',
  ),
  r(
    "NCC-08",
    BANNED,
    /\bno\s+added\s+(?:salt|sodium)\b|\bunsalted\b|\bsalt[\s-]?free\b/i,
    "Requires no added sodium compound in the food AND in its ingredients.",
    'FSC S4-3 (Salt or sodium, "No added" / "Unsalted")',
  ),
  r(
    "NCC-09",
    BANNED,
    /\breduced[\s-](?:sugars?|salt|sodium|calories?|fat|carbs?|carbohydrates?|energy)\b/i,
    "Requires >= 25% less than a NAMED reference food, and the reference food and the size of the difference must be stated together with the claim.",
    "FSC S4-3; Std 1.2.7-16(1)",
  ),
  r(
    "NCC-10",
    BANNED,
    /\b(?:light|lite)\b(?=[\s-]*(?:in\s+)?(?:sugars?|salt|sodium|fat|calories?|kilojoules?|kj|energy|carbs?|carbohydrates?))/i,
    '"Light"/"lite" is a comparative descriptor carrying the same conditions as "reduced".',
    "FSC S4-3; Std 1.2.7-16(2)(a)(ii)(A)",
  ),
  r(
    "NCC-11",
    BANNED,
    /\blow[\s-](?:carb|carbohydrate)s?\b|\bketo(?:[\s-]?friendly)?\b/i,
    'S4-3 lists NO "low" descriptor for carbohydrate - only "reduced" and "increased". The claim is simply unavailable.',
    "FSC S4-3 (Carbohydrate); Std 1.2.7-12",
  ),
  r(
    "NCC-12",
    BANNED,
    /\b(?:high|rich|packed|loaded|full|bursting|brimming)\s+(?:in|with|of)\b/i,
    '"High"/"rich in" is only a listed descriptor for gluten and glycaemic index; elsewhere it is an unlisted descriptor used with a Column 1 property.',
    "FSC Std 1.2.7-12(1)-(3); S4-3",
  ),
  r(
    "NCC-13",
    BANNED,
    /\b(?:good|excellent)?\s*sources?\s+of\b(?!\s+(?:truth|record|income|revenue|inspiration))/i,
    'Vitamin/mineral: >= 10% RDI/ESADDI per serving (>= 25% for "good source"). Protein: >= 5 g/serving (>= 10 g "good source"). Fibre: >= 2 g (>= 4 g "good source", >= 7 g "excellent source").',
    "FSC S4-3 (Vitamin or mineral; Protein; Dietary fibre)",
  ),
  r(
    "NCC-14",
    BANNED,
    /\bfat[\s-]?free\b|\b\d{1,3}\s*%\s*fat[\s-]?free\b|\blow[\s-](?:in[\s-])?fat\b/i,
    'The "% Free" descriptor for fat requires the food to meet the LOW FAT condition (<= 1.5 g/100 mL for liquid food).',
    "FSC S4-3 (Fat)",
  ),
  r(
    "NCC-15",
    BANNED,
    /\bgluten[\s-]?free\b/i,
    "Requires NO DETECTABLE gluten, no oats or oat products, and no malted gluten-containing cereals. Needs analysis, not an assumption.",
    'FSC S4-3 (Gluten, "Free")',
  ),
  r(
    "NCC-16",
    BANNED,
    /\blow\s+GI\b|\bglycaemic\b|\bglycemic\b/i,
    "Requires GI testing, the numerical GI stated on the claim or in the NIP, and the food to meet the NPSC.",
    "FSC S4-3 (Glycaemic Index)",
  ),
  r(
    "NCC-17",
    BANNED,
    /\bslimming\b|\bskinny\b|\bwaistlines?\b|\bweight[\s-](?:loss|management)\b|\bslim\s+down\b/i,
    'Slimming descriptors are prohibited alongside a "diet" claim; weight framing is otherwise a health or therapeutic claim.',
    "FSC Std 1.2.7-15; Std 1.2.7-18; Std 1.2.7-8",
  ),
  r(
    "NCC-18",
    BANNED,
    /\bvitamins?\b|\bminerals?\b|\bfolic\s+acid\b|\bcholine\b|\bfluoride\b/i,
    "Claims about choline, fluoride or folic acid are only permitted alongside a health claim we cannot make; vitamin/mineral claims must clear S4-3 Column 2 in full.",
    "FSC Std 1.2.7-14(3); S4-3 (Vitamin or mineral)",
  ),
  r(
    "NCC-19",
    BANNED,
    /\bmore\s+(?:potassium|sodium|magnesium|calcium|iron|vitamin\w*)\s+than\b/i,
    "A claim that directly or indirectly compares the vitamin or mineral content of a food with another food is prohibited unless the Code permits it. It does not.",
    "FSC Std 1.2.7-9",
  ),

  // ---- Group E: Fair Trading Act exposure --------------------------------
  r(
    "FTA-01",
    BANNED,
    /\bclean\s+(?:label|eating|living|ingredients?)\b|\bno\s+nast(?:y|ies)\b|\bnothing\s+(?:artificial|nasty)\b/i,
    "Undefined, unverifiable composition/health framing.",
    "FTA 1986 ss 9, 12A, 13(a)",
  ),
  r(
    "FTA-02",
    BANNED,
    /\b(?:100\s*%|all)[\s-]?natural\b|\bpurest?\b/i,
    "Unsubstantiated composition claim.",
    "FTA 1986 ss 12A, 13(a)",
  ),
  r(
    "FTA-03",
    BANNED,
    /\b(?:chemical|preservative|additive|nasty)[\s-]?free\b|\bno\s+(?:chemicals?|preservatives?|additives?)\b/i,
    "Unverifiable absolutes - salt and acetic acid are preservatives.",
    "FTA 1986 ss 9, 12A",
  ),
  r(
    "FTA-04",
    BANNED,
    /\bbest\b(?![\s-]?before)|\bworld'?s\s+finest\b|\bnumber\s+one\b|\bno\.?\s?1\b|\bvoted\s+best\b/i,
    'Superiority claim requiring proof. ("Best before" is exempt so the mandatory date mark is not flagged.)',
    "FTA 1986 ss 12A, 13(a), 13(e)",
  ),
  r(
    "FTA-05",
    RESTRICTED,
    /\bguarantee[ds]?\b|\bwarrant(?:y|ies)\b|\brisk[\s-]?free\b|\bno\s+questions\s+asked\b/i,
    "Misrepresenting a right or remedy - including a CGA right - is an offence. Must match the published policies exactly.",
    "FTA 1986 s 13(i); CGA 1993 s 43(4)",
  ),
  r(
    "FTA-06",
    RESTRICTED,
    /\bfree\s+(?:shipping|delivery|gift|sample|bottle)\b/i,
    "Every condition (spend threshold, region, exclusions) must appear in the same sentence.",
    "FTA 1986 ss 9, 13(g)",
  ),
  r(
    "FTA-07",
    RESTRICTED,
    /\bwas\s*\$|\bRRP\b|\b\d{1,3}\s*%\s*off\b/i,
    "Reference pricing requires a genuine prior selling price.",
    "FTA 1986 ss 9, 13(g)",
  ),
  r(
    "FTA-08",
    BANNED,
    /\bsustainab\w*\b|\beco[\s-]?friendly\b|\bcarbon[\s-](?:neutral|negative|zero)\b|\bplastic[\s-]?free\b|\bzero[\s-]waste\b|\bclimate[\s-]positive\b|\benvironmentally\s+friendly\b|\bplanet[\s-]friendly\b/i,
    "Environmental claims require evidence held at the time of publication.",
    "FTA 1986 ss 9, 12A, 13(a)",
  ),
  r(
    "FTA-09",
    BANNED,
    /\borganic(?:ally)?\b|\bbiodynamic\b|\bspray[\s-]?free\b/i,
    "Certification claim; NZ organic claims sit under the Organic Products and Production Act 2023.",
    "FTA 1986 ss 12A, 13(e)-(f)",
  ),
  r(
    "FTA-10",
    BANNED,
    /\bkosher\b(?![\s-]?style)|\bhechsher\b|\bpar[ev]ve\b/i,
    'Certification/endorsement claim. "Kosher-style" is permitted; bare "kosher" is not.',
    "FTA 1986 s 13(e)-(f)",
  ),
  r(
    "FTA-11",
    RESTRICTED,
    /\btraditional(?:ly)?\b|\bauthentic\b|\boriginal\s+recipe\b|\bcentur\w+[\s-]old\b|\bsince\s+(?:18|19|20)\d{2}\b/i,
    "Only usable if literally true and evidenced.",
    "FTA 1986 ss 12A, 13(a)",
  ),
  r(
    "FTA-12",
    RESTRICTED,
    /\bhand[\s-]?(?:made|crafted|packed|picked)\b|\bartisan\w*\b|\bsmall[\s-]batch\b|\bcraft(?:ed)?\b/i,
    "Only if literally accurate for the current production method. Re-verify on any move to a co-packer.",
    "FTA 1986 ss 12A, 13(a)",
  ),
  r(
    "FTA-14",
    BANNED,
    /\bas\s+seen\s+(?:in|on)\b|\bfeatured\s+in\b|\bthousands\s+of\s+(?:customers|happy)\b|\bbest[\s-]?sell(?:er|ing)\b/i,
    "Unsubstantiated representation about acceptance or endorsement.",
    "FTA 1986 ss 12A, 13(e)",
  ),

  // ---- Group F: endorsements ---------------------------------------------
  r(
    "END-04",
    BANNED,
    /\bhealth\s+star\s+rating\b|\bHSR\s+(?:score|rating)\b/i,
    "Only a *permitted* Health Star Rating symbol is exempt from Standard 1.2.7.",
    "FSC Std 1.2.7-6(d)",
  ),

  // ---- Group G: place of origin and provenance ---------------------------
  r(
    "PROV-01",
    RESTRICTED,
    /\b(?:made|bottled|brewed|produced|manufactured|packed)\s+in\s+(?:new\s+zealand|aotearoa|nz|australia)\b|\bnz[\s-]made\b|\b(?:product|produce)\s+of\s+(?:new\s+zealand|aotearoa|nz|australia)\b/i,
    'ORIGIN CLAIM. "Made in" is about where the goods were substantially transformed, not where the idea or the brand lives. Approve only with a note of what is actually made where.',
    "FTA 1986 s 13(j); for AU sale, the ACL country-of-origin information standard",
  ),
  r(
    "PROV-02",
    RESTRICTED,
    /\b(?:grown|harvested|foraged|wild[\s-]?harvested|gathered|picked|sourced|farmed|fished|cultivated)\s+(?:in|on|at|by|from|near|around)\b|\bsingle[\s-]origin\b|\bestate[\s-]grown\b/i,
    "PROVENANCE CLAIM. Must be literally true of the batch on sale before it ships. Clear it with copy-audit-approved: PROV-02 and NAME the supplier and the date the relationship was confirmed.",
    "FTA 1986 ss 12A, 13(a), 13(j)",
  ),
  r(
    "PROV-03",
    RESTRICTED,
    /\b(?:our|the|a|from\s+our)\s+(?:growers?|farmers?|orchardists?|suppliers?|partner\s+farms?|whanau|wh[āa]nau)\b|\bfamily\s+farm\b|\bwe\s+(?:work|partner)\s+with\b/i,
    "NAMED-RELATIONSHIP CLAIM. A supplier relationship that does not yet exist is a false representation the moment it is published, even if it is planned.",
    "FTA 1986 ss 9, 12A, 13(a)",
  ),
  r(
    "PROV-04",
    RESTRICTED,
    /\b(?:tair[āa]whiti|gisborne|northland|te\s+tai\s+tokerau|kaitaia|coromandel|waikato|bay\s+of\s+plenty|hawke'?s\s+bay|taranaki|manawat[ūu]|wairarapa|marlborough|nelson|canterbury|otago|southland|west\s+coast|banks\s+peninsula|waiheke)\b/i,
    "NAMED PLACE. A specific NZ place name in product copy reads as a provenance claim. Approve with the supplier and confirmation date, or remove the place name.",
    "FTA 1986 s 13(j)",
  ),
  r(
    "PROV-05",
    BANNED,
    /\b(?:TODO|TBC|TBD|PLACEHOLDER|FIXME|LOREM)\b(?=.*\b(?:grown|harvest\w*|sourc\w*|grower|farmer|supplier|forag\w*|made\s+in|product\s+of)\b)|\b(?:grown|harvest\w*|sourc\w*|grower|farmer|supplier|forag\w*|made\s+in|product\s+of)\w*\b(?=.*\b(?:TODO|TBC|TBD|PLACEHOLDER|FIXME|LOREM)\b)/i,
    "ASPIRATIONAL PROVENANCE. Draft or placeholder sourcing copy must never reach a published surface. Delete it or finish it - do not ship it with a TODO beside it.",
    "FTA 1986 ss 9, 12A, 13(j)",
  ),

  // ---- Group H: No 04 WILD and native botanicals -------------------------
  r(
    "WILD-01",
    BANNED,
    /\brongo[āa]\b|\brongoa\b|\btraditional\s+(?:m[āa]ori\s+)?medicine\b|\bmedicinal\s+(?:plant|herb|leaf)\b|\bhealing\s+(?:plant|herb|leaf)\b|\bbush\s+medicine\b/i,
    "Rongoa framing is a therapeutic claim, prohibited outright, and it appropriates matauranga Maori into a sales pitch. Never write it.",
    "FSC Std 1.2.7-8(a)-(b); FTA 1986 s 12A",
  ),
  r(
    "WILD-02",
    RESTRICTED,
    /\bkawakawa\b|\bkelp\b|\bseaweed\b|\bkarengo\b|\bhoropito\b|\bharakeke\b|\bkumarahou\b|\bm[āa]nuka\b|\bmanuka\b|\bpiko?piko\b/i,
    "Native botanical. Permitted ONLY as an ingredient name or a flavour note, never with any health, wellness or rongoa framing (WILD-01). Also confirm the ingredient is not a novel food requiring pre-approval.",
    "FSC Std 1.5.1 (novel food / non-traditional food); Std 1.2.7-8",
  ),

  // ---- Restricted: context checks ----------------------------------------
  r(
    "EL-06",
    RESTRICTED,
    /\b(?:sodium|potassium|magnesium|salts)\b/i,
    "Fine inside the mandatory nutrition information panel; NOT fine as a selling point. Approve only for factual or NIP use.",
    "FSC Std 1.1.2-9(2)-(3); S4-3 (Salt or sodium)",
  ),
  r(
    "R-02",
    RESTRICTED,
    /\bvegan\b|\bplant[\s-]based\b|\bvegetarian\b|\b(?:dairy|nut|egg|soy)[\s-]?free\b/i,
    "Verify against the actual ingredient AND processing-aid list, and against cross-contact risk in the production environment.",
    "FTA 1986 s 12A; FSC Std 1.2.3",
  ),
  r(
    "R-03",
    RESTRICTED,
    /\baward[\s-]winning\b|\bgold\s+medal\b|\bmedal[\s-]winning\b|\bfinalist\b/i,
    "Name the award and the year in the same sentence.",
    "FTA 1986 s 13(e)",
  ),
  r(
    "R-04",
    RESTRICTED,
    /\bselling\s+fast\b|\bonly\s+\d+\s+left\b|\balmost\s+gone\b|\blimited\s+edition\b/i,
    "Must be true at the moment of display; scarcity counters not wired to real stock are misleading conduct.",
    "FTA 1986 s 9",
  ),
  r(
    "R-07",
    RESTRICTED,
    /\bsubscri\w*\b|\bauto[\s-]?renew\w*\b/i,
    "Price, frequency and cancellation terms must be disclosed before payment.",
    "FTA 1986 ss 9, 11",
  ),
  r(
    "R-10",
    RESTRICTED,
    /\bferment\w*\b|\bcultured\b/i,
    "Only if genuinely fermented, and never alongside any Group A term - that becomes an implied probiotic claim.",
    "FTA 1986 s 12A; FSC Std 1.2.7-2",
  ),
  r(
    "R-11",
    RESTRICTED,
    /\braw\b|\bunpasteuri[sz]ed\b|\bunfiltered\b/i,
    "Accurate process descriptors only; they carry Food Act 2014 consequences and must match the food safety programme.",
    "Food Act 2014 (NZ)",
  ),
  r(
    "R-13",
    RESTRICTED,
    /\bpicklebacks?\b|\bmartinis?\b|\bcocktails?\b|\bchasers?\b|\bvodka\b|\bgin\b|\bwhisk(?:e)?y\b|\bbourbon\b|\btequila\b|\bmezcal\b|\bshots?\b/i,
    "Core positioning and ALLOWED. Flagged so a human checks context: no encouragement of excessive or rapid consumption, no under-18 targeting, and no implication that it offsets the effects of alcohol (that is TH-01).",
    "ASA Code for Advertising and Promotion of Alcohol, where alcohol is featured",
  ),
  r(
    "R-15",
    RESTRICTED,
    /\bclean\b/i,
    '"Clean-finishing" as a flavour note is fine; "clean" as a virtue claim about composition is not.',
    "FTA 1986 ss 9, 12A",
  ),
  r(
    "R-16",
    RESTRICTED,
    /\bnatural(?:ly)?\b/i,
    '"Naturally fermented" may be defensible; "natural" as a virtue claim is not. "100% natural" and "all natural" are banned outright (FTA-02).',
    "FTA 1986 ss 12A, 13(a)",
  ),
  r(
    "R-17",
    RESTRICTED,
    /\bnutrition(?:al|ally)?\b/i,
    'Fine when naming the mandatory "Nutrition Information" panel; not fine as a benefit.',
    "FSC Std 1.1.2-9(2); Std 1.2.8-5",
  ),
  r(
    "R-18",
    RESTRICTED,
    /\benergy\b/i,
    'Fine as the mandatory NIP row label ("Energy, kJ"); banned as a benefit ("energy boost" - HC-10).',
    "FSC Std 1.2.8-6(1)(d)(i); Std 1.2.7-18",
  ),
  r(
    "R-19",
    RESTRICTED,
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
  ".pnpm-store",
  "vendor",
  ".venv",
  "__pycache__",
]);

const IGNORE_FILE = "copy-audit-ignore-file";
const IGNORE_LINE = "copy-audit-ignore";
const APPROVE_RE = /copy-audit-approved:\s*([A-Za-z0-9_\-,\s]+)/i;
const NUL = String.fromCharCode(0);

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

function scanFile(file, findings) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  if (text.indexOf(NUL) !== -1) return; // binary
  const lines = text.split(/\r?\n/);
  if (lines.slice(0, 20).some((l) => l.includes(IGNORE_FILE))) return;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : "";
    const skipThis =
      (line.includes(IGNORE_LINE) &&
        !line.includes(IGNORE_FILE) &&
        !APPROVE_RE.test(line)) ||
      (prev.includes(IGNORE_LINE) &&
        !prev.includes(IGNORE_FILE) &&
        !APPROVE_RE.test(prev));
    if (skipThis) continue;

    const approvals = approvedIds(line) || approvedIds(prev);

    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (m[0].length === 0) {
          rule.re.lastIndex++;
          continue;
        }
        if (rule.severity === RESTRICTED && approvals && approvals.has(rule.id))
          continue;
        findings.push({
          file,
          line: i + 1,
          column: m.index + 1,
          match: m[0],
          id: rule.id,
          severity: rule.severity,
          why: rule.why,
          source: rule.src,
          excerpt: line.trim().slice(0, 160),
        });
      }
    }
  }
}

/* ------------------------------------------------------------------- main */

function usage(code) {
  process.stdout.write(`HALF SOUR copy auditor

  node legal/scripts/audit-copy.mjs <path> [<path>...]   scan files or directories
  node legal/scripts/audit-copy.mjs --list               print every rule
  node legal/scripts/audit-copy.mjs --json <path>        machine-readable findings

Options
  --json            emit JSON instead of human-readable text
  --include-legal   also scan files under legal/ (excluded by default)
  --quiet           print only the summary line

Inline markers
  copy-audit-ignore-file            skip the whole file (must appear in the first 20 lines)
  copy-audit-ignore                 skip this line (or the line immediately below it)
  copy-audit-approved: <RULE-ID>    clear a RESTRICTED finding on this line (or the line below)

Exit: 0 clean, 1 findings, 2 usage error.
Rules and reasoning: legal/COPY-RULES.md
`);
  process.exit(code);
}

function list() {
  for (const rule of RULES) {
    process.stdout.write(
      `${rule.id}\t${rule.severity.toUpperCase()}\n\tregex:  ${rule.re.source}\n\twhy:    ${rule.why}\n\tsource: ${rule.src}\n\n`,
    );
  }
  const banned = RULES.filter((x) => x.severity === BANNED).length;
  process.stdout.write(
    `${RULES.length} rules (${banned} banned, ${RULES.length - banned} restricted).\n`,
  );
}

function main(argv) {
  const opts = { json: false, includeLegal: false, quiet: false };
  const paths = [];
  for (const a of argv) {
    if (a === "--json") opts.json = true;
    else if (a === "--include-legal") opts.includeLegal = true;
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--list") {
      list();
      return 0;
    } else if (a === "-h" || a === "--help") usage(0);
    else if (a.startsWith("-")) {
      process.stderr.write(`unknown option: ${a}\n`);
      usage(2);
    } else paths.push(a);
  }
  if (paths.length === 0) usage(2);

  let files = [];
  try {
    for (const p of paths) walk(resolve(p), opts, files);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    return 2;
  }
  files = [...new Set(files)].sort();

  const findings = [];
  for (const f of files) scanFile(f, findings);

  const banned = findings.filter((f) => f.severity === BANNED).length;
  const restricted = findings.length - banned;
  const cwd = process.cwd();

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: findings.length === 0,
          filesScanned: files.length,
          banned,
          restricted,
          findings: findings.map((f) => ({
            ...f,
            file: relative(cwd, f.file),
          })),
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    if (!opts.quiet) {
      for (const f of findings) {
        const tag = f.severity === BANNED ? "BANNED    " : "RESTRICTED";
        process.stdout.write(
          `${relative(cwd, f.file)}:${f.line}:${f.column}  ${tag}  [${f.id}]  "${f.match}"\n` +
            `    ${f.why}\n` +
            `    source: ${f.source}\n` +
            `    line:   ${f.excerpt}\n\n`,
        );
      }
    }
    const verdict = findings.length === 0 ? "PASS" : "FAIL";
    process.stdout.write(
      `${verdict}  ${files.length} file(s) scanned, ${findings.length} finding(s) ` +
        `(${banned} banned, ${restricted} restricted).\n`,
    );
    if (findings.length) {
      process.stdout.write(
        "See legal/COPY-RULES.md. Restricted findings can be cleared with an inline\n" +
          "copy-audit-approved:<RULE-ID> marker once the condition has actually been checked.\n",
      );
    }
  }
  return findings.length ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
