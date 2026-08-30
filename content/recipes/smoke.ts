/**
 * Recipes built on No. 03 SMOKE — chipotle and manzano, smoked over manuka.
 *
 * ALCOHOL, CHECKED ONCE FOR THIS WHOLE FILE (2026-08-27)
 * As `content/recipes/house.ts`: checked against the ASA Code for Advertising
 * and Promotion of Alcohol. Nothing here encourages excessive or rapid
 * consumption, is aimed at under-18s, or suggests a drink offsets the effects
 * of alcohol.
 *
 * NATIVE BOTANICALS: manuka is named as the wood the chillies are smoked over
 * and nowhere else. COPY-RULES section 3A Group H permits the name as an
 * ingredient or flavour note only, never with a wellness frame. It is not
 * used as one here.
 */

import type { Recipe } from "../types";

export const SMOKE_RECIPES: readonly Recipe[] = [
  {
    slug: "michelada",
    title: "The Michelada",
    kicker: "Built in the glass, sixty seconds",
    summary:
      "Season the glass, then the brine, then the lager, poured down the side. The beer goes in last and it goes in slowly.", // copy-audit-approved: R-13
    kind: "drink",
    brine: "no-03-smoke",
    alsoWorksWith: ["no-01-house"],
    spirit: "beer", // copy-audit-approved: R-13
    occasions: ["party", "sunday-lunch", "bar-service", "hair-of-the-dog"],
    difficulty: "easy",
    prepMinutes: 4,
    cookMinutes: 0,
    restMinutes: 0,
    yieldText: "One tall drink",
    serveIn: "Pint glass or a schooner, chilled",
    ice: "Cubes to the top. The drink is diluting from the moment you build it and that is fine.",
    garnish: "A lime wedge on the rim and a second one squeezed in.",
    ingredients: [
      {
        heading: "The rim",
        items: [
          {
            amount: "1 tbsp",
            item: "Flaky salt mixed with 1 tsp chilli powder",
          }, // copy-audit-approved: EL-06
          { amount: "1", item: "Lime wedge, to wet the rim" },
        ],
      },
      {
        heading: "The drink",
        items: [
          { amount: "35 ml", item: "No. 03 SMOKE", metricMl: 35 },
          { amount: "20 ml", item: "Lime juice, fresh", metricMl: 20 },
          {
            amount: "2 dashes",
            item: "Worcestershire sauce",
            note: "Contains anchovy.",
          },
          {
            amount: "1 dash",
            item: "Soy sauce",
            note: "Contains wheat unless it is tamari.",
          },
          {
            amount: "330 ml",
            item: "Mexican-style lager, very cold", // copy-audit-approved: R-13
            note: "A crisp pale lager. An IPA will fight the smoke and win, unpleasantly.", // copy-audit-approved: R-13
            metricMl: 330,
          },
        ],
      },
    ],
    steps: [
      {
        text: "Rub a lime wedge round the outside of the rim only, then roll the outside through the salt. Salt on the inside of the rim falls into the drink and oversalts the last third.", // copy-audit-approved: EL-06
      },
      {
        text: "Ice to the top, then brine, lime, Worcestershire and soy straight into the glass. Stir once with a long spoon.",
      },
      {
        text: "Top with the lager, poured down the inside of the tilted glass, in two goes. Leave the rest of the bottle beside the glass — that is the correct service and it is not laziness.", // copy-audit-approved: R-13
      },
    ],
    notes: [
      "No. 03 replaces the tomato-and-chilli mixes that make a michelada heavy. This one stays a beer drink, which is the point of a michelada in the first place.", // copy-audit-approved: R-13
      "Thirty-five millilitres into 330 ml of lager is about a 1:9 ratio. Go past 45 ml and you are drinking brine with beer in it.", // copy-audit-approved: R-13
      "Pre-mix the brine, lime and sauces in a squeezy bottle for service. Sixty millilitres per drink, one squeeze, done. It keeps three days.",
      "The smoke sits in the aroma rather than the finish, so it reads before the first sip. Do not add liquid smoke to it and do not let anyone else either.",
    ],
    swaps: [
      "No alcohol: 35 ml brine, 20 ml lime, top with a good bitter soda or a lager-style zero. It still works; it is a genuinely different, lighter drink.", // copy-audit-approved: R-13
    ],
    tools: ["Long bar spoon", "A saucer for the salt"], // copy-audit-approved: EL-06
    published: "2026-06-04",
    keywords: ["michelada", "beer", "lime", "chelada"], // copy-audit-approved: R-13
  },

  {
    slug: "bloody-maria",
    title: "The Bloody Maria",
    kicker: "Tequila, smoke, no hot sauce", // copy-audit-approved: R-13
    summary:
      "The Bloody Mary rebuilt around tequila and No. 03. Pull the hot sauce and the horseradish out entirely — the brine is doing both jobs.", // copy-audit-approved: R-13
    kind: "drink",
    brine: "no-03-smoke",
    alsoWorksWith: ["no-01-house"],
    spirit: "tequila", // copy-audit-approved: R-13
    occasions: ["sunday-lunch", "bar-service", "hair-of-the-dog"],
    difficulty: "some-practice",
    prepMinutes: 6,
    cookMinutes: 0,
    restMinutes: 0,
    yieldText: "One tall drink",
    serveIn: "Highball",
    ice: "Fresh cubes in the serving glass.",
    garnish:
      "A charred spring onion, a lime cheek, and a pinch of the rim salt on top of the drink.", // copy-audit-approved: EL-06
    ingredients: [
      {
        items: [
          {
            amount: "45 ml",
            item: "Blanco tequila", // copy-audit-approved: R-13
            note: "100% agave. A mixto will taste of vanilla essence under all this.",
            metricMl: 45,
          },
          {
            amount: "90 ml",
            item: "Tomato juice, thick and cold",
            metricMl: 90,
          },
          { amount: "25 ml", item: "No. 03 SMOKE", metricMl: 25 },
          { amount: "12 ml", item: "Lime juice", metricMl: 12 },
          {
            amount: "2 dashes",
            item: "Worcestershire sauce",
            note: "Contains anchovy.",
          },
          { amount: "6 turns", item: "Black pepper" },
        ],
      },
    ],
    steps: [
      {
        text: "Char a spring onion over a flame or in a dry pan until it blackens in patches. Set it aside.",
      },
      { text: "Everything into a tin, pepper first so you can see it go in." },
      {
        text: "Add ice and roll it between two tins four times. Do not shake it.",
      },
      {
        text: "Strain over fresh ice. Spring onion in, lime cheek on the rim, pinch of salt on the surface.",
      }, // copy-audit-approved: EL-06
    ],
    notes: [
      "Tequila and smoked chilli are a better match than vodka and horseradish, and this is the drink that proves it. The agave gives the smoke something sweet to sit against.", // copy-audit-approved: R-13
      "Half tequila, half mezcal takes it somewhere harder and is worth doing once to see where the line is.", // copy-audit-approved: R-13
      "The charred spring onion is not decoration. It goes in the drink and by the third sip it has given up its char to the tomato.",
    ],
    tools: ["Two shaking tins", "Hawthorne strainer"],
    published: "2026-07-20",
    keywords: ["bloody maria", "tequila", "tomato", "smoked chilli"], // copy-audit-approved: R-13
  },

  {
    slug: "mezcal-pickleback", // copy-audit-approved: R-13
    title: "The Mezcal Pickleback", // copy-audit-approved: R-13
    kicker: "Smoke against smoke",
    summary:
      "The pickleback with mezcal on one side and No. 03 on the other. Two kinds of smoke that were made in different hemispheres and get on anyway.", // copy-audit-approved: R-13
    kind: "drink",
    brine: "no-03-smoke",
    alsoWorksWith: ["no-01-house"],
    spirit: "mezcal", // copy-audit-approved: R-13
    occasions: ["bar-service", "party"],
    difficulty: "easy",
    prepMinutes: 2,
    cookMinutes: 0,
    restMinutes: 60,
    yieldText: "One round, for one",
    serveIn: "Two heavy-base 45 ml glasses",
    ice: "None.",
    ingredients: [
      {
        items: [
          {
            amount: "30 ml",
            item: "Espadín mezcal, room temperature", // copy-audit-approved: R-13
            note: "Thirty, not forty-five. Mezcal is louder than whiskey and the balance shifts.", // copy-audit-approved: R-13
            metricMl: 30,
          },
          {
            amount: "45 ml",
            item: "No. 03 SMOKE, from the fridge",
            note: "Full measure. The brine is the longer half of this one.",
            metricMl: 45,
          },
          {
            amount: "1",
            item: "Wedge of orange, dusted with chilli salt, on the side",
          }, // copy-audit-approved: EL-06
        ],
      },
    ],
    steps: [
      {
        // copy-audit-approved: R-13 (names a spirit serve; §5.3 safe vocabulary)
        text: "Brine in the fridge an hour ahead. Same rule as every pickleback: the temperature gap is the drink.",
      },
      { text: "Mezcal first, then the brine inside two seconds.", seconds: 2 }, // copy-audit-approved: R-13
      {
        text: "The orange afterwards, if you want it. In Oaxaca it would be orange and sal de gusano; this is not that, and it is not pretending to be.",
      },
    ],
    notes: [
      "Manuka smoke and agave smoke are different things — one is wood, one is roasted plant — and putting them next to each other is why this works rather than doubling up.", // copy-audit-approved: WILD-02
      "If the mezcal is over 45%, drop to 25 ml. The brine cannot carry more than that.", // copy-audit-approved: R-13
      "This is the one to pour for someone who says they do not like pickle juice. It has worked more often than it has not.",
    ],
    tools: ["Two matched glasses"],
    published: "2026-08-03",
    keywords: ["pickleback", "mezcal", "smoke", "chaser"], // copy-audit-approved: R-13
  },

  {
    slug: "smoke-pulled-pork",
    title: "Pulled Pork, Brined and Braised", // copy-audit-approved: FTA-12
    kicker: "One night, six hours",
    summary:
      "A whole bottle of No. 03 does two jobs: twelve hours as a cure, then the braise the shoulder cooks in. Nothing else goes in but onion and a bay leaf.", // copy-audit-approved: FTA-12
    kind: "dish",
    brine: "no-03-smoke",
    alsoWorksWith: ["no-01-house"],
    spirit: "none",
    occasions: ["long-cook", "party", "sunday-lunch"],
    difficulty: "easy",
    prepMinutes: 25,
    cookMinutes: 360,
    restMinutes: 750,
    yieldText: "Serves eight to ten",
    ingredients: [
      {
        heading: "The cure",
        items: [
          {
            amount: "2.5 kg",
            item: "Pork shoulder, bone in, skin off",
            note: "Bone in. It holds the meat together for the first four hours and gives the braise body.",
            metricG: 2500,
          },
          { amount: "350 ml", item: "No. 03 SMOKE", metricMl: 350 },
          { amount: "350 ml", item: "Cold water", metricMl: 350 },
        ],
      },
      {
        heading: "The braise",
        items: [
          {
            amount: "150 ml",
            item: "No. 03 SMOKE — the rest of the bottle",
            metricMl: 150,
          },
          { amount: "2", item: "Brown onions, halved" },
          { amount: "2", item: "Bay leaves" },
          { amount: "1 tbsp", item: "Black pepper, cracked" },
          {
            amount: "2 tbsp",
            item: "Dark brown sugar",
            note: "For the glaze at the end, not the braise.",
          },
        ],
      },
    ],
    steps: [
      {
        text: "Cure the shoulder overnight in the brine cut 1:1 with water, in a bag or a snug container, in the fridge. Twelve hours. It will not take more salt than it wants at this strength.", // copy-audit-approved: EL-06 FTA-12
      },
      {
        text: "Lift it out, throw the cure away, and dry it well. Heat the oven to 140°C.",
      },
      {
        text: "Brown the shoulder hard on all sides in a heavy casserole. Take your time; this is fifteen minutes of work and it is where the colour comes from.",
      },
      {
        text: "Onions, bay, pepper and the remaining 150 ml of brine into the pot. The liquid should come no more than a third of the way up — this is a braise, not a boil.",
      },
      {
        text: "Lid on, into the oven for six hours. Turn the shoulder once at the three-hour mark. It is ready when a fork twists in it with no resistance at all.",
      },
      {
        text: "Lift the meat out and rest it. Skim the fat off the braising liquid, add the brown sugar and reduce it hard on the hob until it coats a spoon.",
      },
      {
        text: "Pull the pork with two forks, discarding anything grey, then fold the reduced liquid back through it a ladle at a time until it is glossy rather than wet.",
      },
    ],
    notes: [
      "Do not add salt at any stage. The cure has seasoned the meat all the way through and the reduction concentrates what is left in the pot.", // copy-audit-approved: EL-06
      "The chipotle heat comes up slowly over the six hours and finishes much gentler than the bottle tastes cold. If you want it hotter, add a whole dried chipotle to the braise rather than more brine.",
      "It is better the next day. Cool it fast, refrigerate, and reheat covered at 150°C with a splash of water.",
      "Buns, slaw dressed with the cornichon vinaigrette, and nothing else on the plate.",
    ],
    swaps: [
      "Beef short rib: same cure, four hours instead of six, and skip the sugar.",
      "Whole chicken thighs: cure four hours, braise ninety minutes.",
    ],
    tools: [
      "Heavy lidded casserole",
      "Two forks",
      "Fat separator or a ladle and patience",
    ],
    published: "2026-06-28",
    keywords: ["pulled pork", "braise", "brining", "low and slow"], // copy-audit-approved: FTA-12
  },

  {
    slug: "smoke-glazed-wings",
    title: "Smoke-Glazed Wings",
    kicker: "Four hours in brine, twenty-five minutes hot",
    summary:
      "Brine the wings for four hours, dry them properly, roast them at 220°C and glaze them twice in the last six minutes.",
    kind: "dish",
    brine: "no-03-smoke",
    alsoWorksWith: ["no-01-house"],
    spirit: "none",
    occasions: ["party", "bar-service", "at-the-table"],
    difficulty: "easy",
    prepMinutes: 15,
    cookMinutes: 30,
    restMinutes: 300,
    yieldText: "Serves four as a snack",
    ingredients: [
      {
        heading: "The brine",
        items: [
          {
            amount: "1 kg",
            item: "Chicken wings, split at the joint, tips kept for stock",
            metricG: 1000,
          },
          { amount: "250 ml", item: "No. 03 SMOKE", metricMl: 250 },
          { amount: "250 ml", item: "Cold water", metricMl: 250 },
        ],
      },
      {
        heading: "The glaze",
        items: [
          { amount: "100 ml", item: "No. 03 SMOKE", metricMl: 100 },
          { amount: "40 g", item: "Honey", metricG: 40 },
          { amount: "20 g", item: "Butter", metricG: 20 },
          { amount: "1 tsp", item: "Smoked paprika" },
          { amount: "1", item: "Lime, juice only" },
        ],
      },
      {
        heading: "To finish",
        items: [
          { amount: "2 tbsp", item: "Coriander, roughly torn" },
          { amount: "1 tsp", item: "Toasted sesame seeds" },
        ],
      },
    ],
    steps: [
      {
        text: "Brine the wings four hours in the fridge, no longer. Wings are small and they take salt fast.",
      }, // copy-audit-approved: EL-06
      {
        text: "Drain them, then dry them on a rack, uncovered in the fridge, for an hour if you have it. Wet wings steam and stay pale.",
      },
      {
        text: "Oven to 220°C. Wings on a rack over a tray, spaced apart, twenty-five minutes, turning once.",
      },
      {
        text: "While they cook, simmer the glaze ingredients together until they reduce by half and go sticky. Six or seven minutes.",
        seconds: 400,
      },
      {
        text: "Brush the wings with glaze, back in for three minutes, brush again, three more. Twice, briefly — glaze on for the whole roast just burns.",
      },
      { text: "Coriander and sesame over the top, straight out of the oven." },
    ],
    notes: [
      "Four hours is the maximum for wings in a brine at this strength. Overnight and they cure into something with the texture of ham.", // copy-audit-approved: EL-06 FTA-12
      "There is no salt anywhere in this recipe and none is needed. Taste one before you reach for the flakes.", // copy-audit-approved: EL-06
      "The glaze keeps two weeks in the fridge and is worth making double. It goes on roast carrots as happily as it goes on chicken.",
    ],
    tools: ["Wire rack", "Roasting tray", "Pastry brush", "Small saucepan"],
    published: "2026-07-27",
    keywords: ["chicken wings", "glaze", "party food", "smoked chilli"],
  },

  {
    slug: "charred-corn-smoke-butter",
    title: "Charred Corn, Smoke Butter",
    kicker: "Fifteen minutes, one pan",
    summary:
      "Butter beaten with reduced brine, chilli and lime, melted over corn that has been charred properly rather than warmed through.",
    kind: "dish",
    brine: "no-03-smoke",
    alsoWorksWith: ["no-01-house"],
    spirit: "none",
    occasions: ["party", "at-the-table", "sunday-lunch"],
    difficulty: "easy",
    prepMinutes: 10,
    cookMinutes: 12,
    restMinutes: 0,
    yieldText: "Serves four",
    ingredients: [
      {
        items: [
          { amount: "4", item: "Corn cobs, husked" },
          {
            amount: "80 ml",
            item: "No. 03 SMOKE, reduced to 25 ml",
            note: "Reduce it first, in a small pan, until it is syrupy. Un-reduced brine will split the butter.",
            metricMl: 80,
          },
          { amount: "120 g", item: "Butter, soft", metricG: 120 },
          { amount: "1", item: "Lime, zest and half the juice" },
          {
            amount: "40 g",
            item: "Feta or a hard sheep's cheese, crumbled",
            metricG: 40,
          },
          { amount: "2 tbsp", item: "Coriander, chopped" },
        ],
      },
    ],
    steps: [
      {
        text: "Reduce the brine to about 25 ml and let it cool completely. Warm brine into soft butter gives you a broken mess.",
      },
      {
        text: "Beat the reduced brine, lime zest and juice into the butter. It will look wrong for thirty seconds and then come together.",
      },
      {
        text: "Char the corn on a barbecue or in a dry, ripping-hot cast iron pan, turning until there are black patches on every side. Ten to twelve minutes. Black patches, not brown.",
      },
      {
        text: "Corn straight into a bowl, butter over it while it is too hot to touch, then the cheese and coriander.",
      },
    ],
    notes: [
      "The reduction is the whole technique. It concentrates the smoke and takes the water out, which is what lets it go into butter without splitting.",
      "The butter freezes in a log, wrapped, for three months. Cut a coin off it for grilled fish, a steak, or a jacket potato.",
      "If you can only get frozen corn kernels: char them dry in a hot pan in one layer, do not stir for two minutes, then toss.",
    ],
    tools: ["Cast iron pan or a barbecue", "Small saucepan", "Wooden spoon"],
    published: "2026-08-10",
    keywords: ["corn", "compound butter", "barbecue", "side"],
  },
];
