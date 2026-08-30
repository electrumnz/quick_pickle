/**
 * The four bottles, as the content layer sees them.
 *
 * Handles, prices and volumes mirror the live Shopify catalogue (checked
 * 2026-08-27). Commerce owns the cart; this file owns the words, so that a
 * recipe can say "No. 02 DIRTY" and link to the right product without the
 * content layer importing a provider.
 */

import type { Brine, BrineId } from "./types";

export const BRINES: Readonly<Record<BrineId, Brine>> = {
  "no-01-house": {
    id: "no-01-house",
    number: "01",
    name: "HOUSE",
    descriptor: "Dill and Peppercorn Brine",
    handle: "no-01-house",
    priceNzd: 18,
    volumeMl: 500,
    // copy-audit-approved: R-13 (names a spirit serve; §5.3 safe vocabulary — no claim about a person)
    line: "The everyday one. Reach for it without thinking.",
    notes: ["Dill", "Black peppercorn", "Garlic", "Bay", "A long salt finish"],
    run: ["Cucumber", "Dill", "Black peppercorn", "Garlic", "Bay", "Sea salt"],
    supplyLimited: false,
  },
  "no-02-dirty": {
    id: "no-02-dirty",
    number: "02",
    name: "DIRTY",
    descriptor: "Martini Brine", // copy-audit-approved: R-13 (product name; §5.3)
    handle: "no-02-dirty",
    priceNzd: 20,
    volumeMl: 500,
    // copy-audit-approved: R-13 (§5.3 lists "dirty martini" as safe use-and-occasion vocabulary)
    line: "Built for the martini. Filtered clear so it will not cloud a stirred drink.",
    notes: ["Cornichon", "Green olive", "Lemon peel", "Salt, then salt again"],
    run: [
      "Cornichon",
      "Green olive",
      "Lemon peel",
      "Coriander seed",
      "Sea salt",
    ],
    supplyLimited: false,
  },
  "no-03-smoke": {
    id: "no-03-smoke",
    number: "03",
    name: "SMOKE",
    descriptor: "Smoked Chilli Brine",
    handle: "no-03-smoke",
    priceNzd: 22,
    volumeMl: 500,
    // copy-audit-approved: R-13 WILD-02 (§5.3 michelada; WILD-02 mānuka as a flavour note only)
    line: "Chipotle and manzano, smoked over manuka. Heat that arrives late.",
    notes: [
      "Smoke first",
      "Chipotle",
      "Manzano",
      "Cumin",
      "Heat, three seconds later",
    ],
    run: [
      "Chipotle",
      "Manzano chilli",
      // copy-audit-approved: WILD-02 (mānuka named as the smoking wood, an ingredient fact)
      "Manuka smoke",
      "Cumin",
      "Bay",
      "Sea salt",
    ],
    supplyLimited: false,
  },
  "no-04-wild": {
    id: "no-04-wild",
    number: "04",
    name: "WILD",
    descriptor: "Coastal Brine",
    handle: "no-04-wild",
    priceNzd: 26,
    volumeMl: 500,
    // copy-audit-approved: WILD-02 (kawakawa and kelp named as ingredients and flavour notes only, per Group H)
    line: "Kawakawa, kelp and lemon. For anything that came out of the sea.",
    // copy-audit-approved: WILD-02 (flavour notes; no wellness or rongoā frame — Group H)
    notes: ["Peppery", "Faintly numbing", "Maritime", "Lemon at the end"],
    // copy-audit-approved: WILD-02 (ingredient run as printed on the label)
    run: ["Cucumber", "Kawakawa", "Kelp", "Lemon peel", "Sea salt"],
    supplyLimited: true,
  },
};

export const BRINE_ORDER: readonly BrineId[] = [
  "no-01-house",
  "no-02-dirty",
  "no-03-smoke",
  "no-04-wild",
];

export const ALL_BRINES: readonly Brine[] = BRINE_ORDER.map((id) => BRINES[id]);

export function brine(id: BrineId): Brine {
  return BRINES[id];
}

/** "No. 02 DIRTY" — the form used everywhere except the label itself. */
export function brineLabel(id: BrineId): string {
  const b = BRINES[id];
  return `No. ${b.number} ${b.name}`;
}

/** Short form for chips and filter pills, where the number carries it. */
export function brineShort(id: BrineId): string {
  return `No. ${BRINES[id].number}`;
}

export function productHref(id: BrineId): string {
  return `/products/${BRINES[id].handle}`;
}
