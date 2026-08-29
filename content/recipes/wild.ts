/**
 * Recipes built on No. 04 WILD — kawakawa, kelp, lemon.
 *
 * ALCOHOL, CHECKED ONCE FOR THIS WHOLE FILE (2026-08-27)
 * As `content/recipes/house.ts`: checked against the ASA Code for Advertising
 * and Promotion of Alcohol.
 *
 * NATIVE BOTANICALS — READ THIS BEFORE EDITING
 * Kawakawa and kelp appear here ONLY as ingredient names and flavour notes:
 * peppery, faintly numbing, maritime, lemon at the end. `legal/COPY-RULES.md`
 * section 3A Group H is absolute about the rest — rongoā framing, "traditional
 * medicine", anything therapeutic or restorative is banned outright under
 * Standard 1.2.7-8, with no exception for quoting a tradition. Kelp brings the
 * same problem through iodine and "mineral" language, so that vocabulary is
 * out too. Nothing below says what the plant does to a person, because
 * nothing may.
 *
 * PROVENANCE: no recipe on this page states where the kawakawa or the kelp
 * comes from. That is deliberate. Those statements live in
 * `content/suppliers.ts`, where they carry a confirmation state, and none of
 * them has been confirmed yet.
 */

import type { Recipe } from "../types";

export const WILD_RECIPES: readonly Recipe[] = [
  {
    slug: "snapper-ceviche",
    title: "Snapper Ceviche",
    kicker: "Twelve minutes in the cure", // copy-audit-approved: FTA-12
    summary:
      "Half brine, half lime, twelve minutes, and take it out while the middle of each piece is still translucent. Fifteen minutes and it goes chalky.",
    kind: "dish",
    brine: "no-04-wild",
    alsoWorksWith: ["no-02-dirty"],
    spirit: "none",
    occasions: ["at-the-table", "before-dinner", "party"],
    difficulty: "some-practice",
    prepMinutes: 20,
    cookMinutes: 0,
    restMinutes: 12,
    yieldText: "Serves four as a starter",
    ingredients: [
      {
        heading: "The fish",
        items: [
          {
            amount: "400 g",
            item: "Snapper fillet, skinned, pin-boned, ice cold",
            note: "Kahawai, trevally, kingfish and gurnard all work. It has to be fish you would eat raw, from someone who knows when it was caught.", // copy-audit-approved: R-11
            metricG: 400,
          },
          { amount: "60 ml", item: "No. 04 WILD", metricMl: 60 },
          {
            amount: "60 ml",
            item: "Lime juice, squeezed at the last minute",
            metricMl: 60,
          },
        ],
      },
      {
        heading: "Everything else",
        items: [
          {
            amount: "1",
            item: "Small red onion, sliced as thin as you can make it",
          },
          { amount: "1", item: "Green chilli, deseeded, sliced fine" },
          { amount: "½", item: "Telegraph cucumber, deseeded, diced small" },
          { amount: "2 tbsp", item: "Coriander leaves" },
          {
            amount: "30 ml",
            item: "Coconut cream, optional",
            note: "Fiji-style. It rounds the acid and it is not cheating.",
            metricMl: 30,
          },
          { amount: "1 tbsp", item: "Olive oil, to finish" },
        ],
      },
    ],
    steps: [
      {
        text: "Put a metal bowl in the freezer for ten minutes. Everything about this dish is better cold and the bowl is the easiest part to control.",
      },
      {
        text: "Cut the fish across the grain into pieces about 15 mm square. Even sizes matter more than small ones — uneven pieces cure at different rates and the small ones go chalky first.", // copy-audit-approved: FTA-12
      },
      {
        text: "Soak the red onion in cold water for five minutes and drain it. This takes the aggression out and it is the difference between a starter and an ordeal.",
        seconds: 300,
      },
      {
        text: "Fish, brine and lime into the cold bowl. Stir once. Twelve minutes in the fridge, and set a timer.",
        seconds: 720,
      },
      {
        text: "Drain most of the liquid off — keep four tablespoons — and fold through the onion, chilli, cucumber and coriander.",
      },
      {
        text: "Coconut cream if you are using it, olive oil over the top, and on the table inside two minutes. Ceviche does not wait for anyone.",
      },
    ],
    notes: [
      "Straight lime juice cures fast and hard. Cutting it 1:1 with brine slows the acid down and puts salt in at the same time, so the outside firms while the middle stays soft.", // copy-audit-approved: EL-06 FTA-12
      "The liquid left in the bowl is worth keeping. Strain it, chill it and drink it, or use it as the acid in a dressing the same day.",
      "Do not cure fish in a metal bowl for longer than about twenty minutes and never in aluminium. Glass or steel, and steel only briefly.", // copy-audit-approved: FTA-12
      "Kawakawa is peppery and it lands in the same place a grind of black pepper would. There is no black pepper in this recipe for that reason.", // copy-audit-approved: WILD-02
    ],
    swaps: [
      "No. 02 DIRTY makes a sharper, more European version — swap the coriander for dill and drop the coconut cream.",
    ],
    tools: ["Metal or glass bowl", "A very sharp knife", "A timer"],
    published: "2026-08-17",
    keywords: ["ceviche", "snapper", "raw fish", "starter"], // copy-audit-approved: R-11
  },

  {
    slug: "oysters-wild-mignonette",
    title: "Oysters, WILD Mignonette",
    kicker: "Five minutes, thirty resting",
    summary:
      "No vinegar. Brine, shallot, a grind of pepper and nothing else, rested half an hour so the shallot softens.",
    kind: "dish",
    brine: "no-04-wild",
    alsoWorksWith: ["no-02-dirty"],
    spirit: "none",
    occasions: ["before-dinner", "at-the-table", "party"],
    difficulty: "easy",
    prepMinutes: 5,
    cookMinutes: 0,
    restMinutes: 30,
    yieldText: "Dresses two dozen oysters",
    ingredients: [
      {
        items: [
          {
            amount: "24",
            item: "Oysters, opened to order",
            note: "Opened more than ten minutes before they are eaten is a waste of an oyster.",
          },
          { amount: "80 ml", item: "No. 04 WILD", metricMl: 80 },
          { amount: "1", item: "Small shallot, diced to 2 mm" },
          { amount: "10 turns", item: "Black pepper, coarse" },
          { amount: "1 tsp", item: "Lemon zest, fine" },
        ],
      },
    ],
    steps: [
      {
        text: "Dice the shallot as small as your knife and your patience allow. Big shallot in a mignonette is the mark of someone who did not care.",
      },
      {
        text: "Everything into a small bowl. Stir. Thirty minutes in the fridge before it goes anywhere near an oyster.",
        seconds: 1800,
      },
      {
        text: "Half a teaspoon per oyster, no more. The oyster is the dish; this is punctuation.",
      },
    ],
    notes: [
      "A classic mignonette is red wine vinegar and shallot. The brine here is less aggressive than vinegar and already carries lemon and salt, so it does not flatten the oyster the way a sharp vinegar can.", // copy-audit-approved: EL-06
      "It keeps five days covered, and it is better on day two.",
      "Serve the oysters on ice with the bowl in the middle and a small spoon. Do not dress them for people; some of them will want the oyster on its own and they are right.",
    ],
    tools: ["A small sharp knife", "A small bowl and a teaspoon"],
    published: "2026-08-24",
    keywords: ["oysters", "mignonette", "shellfish", "no vinegar"],
  },

  {
    slug: "rock-pool-martini", // copy-audit-approved: R-13
    title: "The Rock Pool", // copy-audit-approved: R-13
    kicker: "Stirred, then a lemon oil",
    summary:
      "A martini built on No. 04 — vodka, a dry sherry in place of vermouth, and 12 ml of brine. It tastes like the smell of a beach at low tide, which is a compliment.", // copy-audit-approved: R-13
    kind: "drink",
    brine: "no-04-wild",
    alsoWorksWith: ["no-02-dirty"],
    spirit: "vodka", // copy-audit-approved: R-13
    occasions: ["before-dinner", "bar-service"],
    difficulty: "some-practice",
    prepMinutes: 4,
    cookMinutes: 0,
    restMinutes: 10,
    yieldText: "One drink",
    serveIn: "Frozen coupe",
    ice: "Hard cubes.",
    garnish:
      "A wide strip of lemon peel, expressed hard over the surface and discarded.",
    ingredients: [
      {
        items: [
          { amount: "55 ml", item: "Vodka, clean and neutral", metricMl: 55 }, // copy-audit-approved: R-13 R-15
          {
            amount: "20 ml",
            item: "Fino or manzanilla sherry, cold",
            note: "Manzanilla is aged by the sea and it belongs in this drink more than vermouth does.",
            metricMl: 20,
          },
          { amount: "12 ml", item: "No. 04 WILD", metricMl: 12 },
        ],
      },
    ],
    steps: [
      {
        text: "Freeze the glass properly. This drink is served at around minus four and it needs the glass to hold that.",
      },
      {
        text: "Stir over hard ice for eighteen seconds. Less than a gin martini — there is less alcohol to soften.",
        seconds: 18,
      }, // copy-audit-approved: R-13
      {
        text: "Strain. Express the lemon peel over the whole surface from about 10 cm, wipe the rim, throw the peel away.",
      },
    ],
    notes: [
      "Sherry oxidises faster than vermouth. A half bottle of manzanilla, refrigerated, is good for about five days and then it is cooking sherry.",
      "Twelve millilitres, not twenty. WILD is more aromatic than the other three and it takes over a stirred drink if you let it.",
      "This is the drink to put next to a dozen oysters, and it is the reason we made a fourth brine at all.",
    ],
    swaps: [
      "Gin instead of vodka: 50 ml, and take the sherry down to 15 ml.", // copy-audit-approved: R-13
    ],
    tools: ["Mixing glass", "Bar spoon", "Julep strainer"],
    published: "2026-08-21",
    keywords: ["martini", "sherry", "vodka", "coastal"], // copy-audit-approved: R-13
  },

  {
    slug: "cured-kingfish-crudo",
    title: "Cured Kingfish Crudo", // copy-audit-approved: FTA-12
    kicker: "Forty minutes in the fridge",
    summary:
      "A whole fillet sits in brine for forty minutes, then gets sliced thin and dressed with the brine it came out of, reduced.", // copy-audit-approved: FTA-12
    kind: "dish",
    brine: "no-04-wild",
    alsoWorksWith: ["no-02-dirty"],
    spirit: "none",
    occasions: ["before-dinner", "at-the-table"],
    difficulty: "practised",
    prepMinutes: 25,
    cookMinutes: 5,
    restMinutes: 40,
    yieldText: "Serves four as a starter",
    ingredients: [
      {
        items: [
          {
            amount: "300 g",
            item: "Kingfish loin, skinned, bloodline trimmed out",
            note: "Trim the bloodline properly. It is the strong-tasting dark strip and leaving it in ruins the dish.",
            metricG: 300,
          },
          { amount: "200 ml", item: "No. 04 WILD", metricMl: 200 },
          {
            amount: "1",
            item: "Lemon, half juiced, half in wide strips of peel",
          },
          {
            amount: "3 tbsp",
            item: "Extra virgin olive oil, the best you have open",
          },
          { amount: "1", item: "Small green chilli, sliced into rings" },
          { amount: "1 tbsp", item: "Chives, sliced fine" },
          { amount: "1 tsp", item: "Sea salt flakes, to finish" }, // copy-audit-approved: EL-06
        ],
      },
    ],
    steps: [
      {
        text: "Sit the whole loin in 150 ml of the brine with the lemon peel, covered, in the fridge for forty minutes. Turn it once at twenty.",
        seconds: 2400,
      },
      {
        text: "While it cures, reduce the remaining 50 ml of brine in a small pan to about 15 ml. Let it cool. This is the dressing.", // copy-audit-approved: FTA-12
      },
      {
        text: "Lift the fish out, pat it dry and put it in the freezer for ten minutes. Slightly firm fish slices cleanly; soft fish tears.",
        seconds: 600,
      },
      {
        text: "Slice across the loin at about 3 mm, with the knife pulled through in one stroke each time. No sawing.",
      },
      {
        text: "Lay the slices flat on a cold plate, barely overlapping. Spoon the reduction over, then the olive oil, then lemon juice, then chilli and chives. Salt flakes last, from a height.", // copy-audit-approved: EL-06
      },
    ],
    notes: [
      "Forty minutes at this strength firms the outside 2 mm and seasons the whole slice. It is a cure, not a pickle — the fish is still raw in the middle and should be.", // copy-audit-approved: FTA-12 R-11
      "The reduction is what makes this taste finished. Un-reduced brine just makes a puddle on the plate.",
      "Cold plate, straight from the fridge. A warm plate will start softening the fish before it reaches the table.",
      "Kawakawa is peppery on its own account, so the chilli here is for heat and colour, not for pepper.", // copy-audit-approved: WILD-02
    ],
    tools: [
      "A long, thin, very sharp knife",
      "Small saucepan",
      "A plate that has been in the fridge",
    ],
    published: "2026-08-14",
    keywords: ["crudo", "kingfish", "cured fish", "starter"], // copy-audit-approved: FTA-12
  },

  {
    slug: "clams-in-wild-brine",
    title: "Clams in WILD Brine",
    kicker: "One pan, eight minutes",
    summary:
      "Clams, garlic, butter and 120 ml of brine instead of white wine. Lid on, high heat, and take them off the moment they open.",
    kind: "dish",
    brine: "no-04-wild",
    alsoWorksWith: ["no-01-house"],
    spirit: "none",
    occasions: ["at-the-table", "sunday-lunch"],
    difficulty: "easy",
    prepMinutes: 15,
    cookMinutes: 8,
    restMinutes: 0,
    yieldText: "Serves two as a main, four to share",
    ingredients: [
      {
        items: [
          {
            amount: "1 kg",
            item: "Littleneck clams or tuatua, purged",
            note: "Purge them for an hour in cold salted water so they spit their sand out. Skip this and the dish is gritty and unfixable.", // copy-audit-approved: EL-06
            metricG: 1000,
          },
          { amount: "120 ml", item: "No. 04 WILD", metricMl: 120 },
          { amount: "40 g", item: "Butter, cold, cubed", metricG: 40 },
          { amount: "3", item: "Garlic cloves, sliced thin" },
          { amount: "1", item: "Long red chilli, sliced" },
          { amount: "3 tbsp", item: "Flat parsley, chopped" },
          { amount: "1 tbsp", item: "Olive oil" },
          { amount: "4", item: "Thick slices of sourdough, grilled, to serve" },
        ],
      },
    ],
    steps: [
      {
        text: "Discard any clam that is open and does not close when you tap it. That one is not going to get better in the pan.",
      },
      {
        text: "Oil into a wide pan on a high heat, garlic and chilli in for thirty seconds — moving, not colouring.",
        seconds: 30,
      },
      {
        text: "Clams in, brine in, lid on. Four to six minutes on high, shaking the pan twice.",
      },
      {
        text: "The moment most of them are open, lid off, clams into a warm bowl. Any that stayed shut go in the bin, not back on the heat.",
      },
      {
        text: "Whisk the cold butter into the liquid left in the pan, off the heat, so it thickens rather than splits. Parsley in, pour it over the clams.",
      },
      {
        text: "Grilled sourdough on the side. The liquid is the reason the bread is there.",
      },
    ],
    notes: [
      "Brine instead of wine is not a substitution, it is a better idea for this dish: the kelp and lemon are already doing what the wine was there to do and the salt is already correct.", // copy-audit-approved: EL-06 WILD-02
      "Do not add salt at any point. Clams bring their own liquor and it is salty.", // copy-audit-approved: EL-06
      "A wide pan, not a deep pot. The clams want one layer so they all open at the same time.",
    ],
    swaps: [
      "Mussels: same method, seven minutes, and pull the beards first.",
      "No. 01 HOUSE with dill instead of parsley is a completely reasonable version of this.",
    ],
    tools: ["A wide pan with a lid", "A warm bowl"],
    published: "2026-06-14",
    keywords: ["clams", "shellfish", "one pan", "quick"],
  },
];
