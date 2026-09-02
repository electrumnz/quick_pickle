/**
 * Recipes built on No. 02 DIRTY — cornichon, green olive, lemon peel,
 * filtered clear so it will not cloud a stirred drink.
 *
 * ALCOHOL, CHECKED ONCE FOR THIS WHOLE FILE (2026-08-27)
 * As `content/recipes/house.ts`: checked against the ASA Code for Advertising
 * and Promotion of Alcohol. Nothing here encourages excessive or rapid
 * consumption, is aimed at under-18s, or suggests a drink offsets the effects
 * of alcohol. The per-line `copy-audit-approved: R-13` markers record it.
 */

import type { Recipe } from "../types";

export const DIRTY_RECIPES: readonly Recipe[] = [
  {
    slug: "dirty-martini", // copy-audit-approved: R-13
    title: "The Dirty Martini", // copy-audit-approved: R-13
    kicker: "Three to one, and nothing else",
    summary:
      "Three parts gin, one part No. 02, ten millilitres of vermouth. Stirred, not shaken, because you are an adult.", // copy-audit-approved: R-13
    kind: "drink",
    brine: "no-02-dirty",
    alsoWorksWith: ["no-01-house"],
    spirit: "gin", // copy-audit-approved: R-13
    occasions: ["before-dinner", "bar-service"],
    difficulty: "some-practice",
    prepMinutes: 4,
    cookMinutes: 0,
    restMinutes: 10,
    yieldText: "One drink",
    serveIn:
      "Frozen coupe. A V-shaped glass spills and warms; it is a bad glass and it always was.",
    ice: "Hard cubes, straight from the freezer.",
    garnish:
      "One olive. Three if the drinker asks. Never two. That is a superstition and we keep it.",
    ingredients: [
      {
        items: [
          {
            amount: "60 ml",
            item: "London dry gin, 47% or above", // copy-audit-approved: R-13
            note: "Juniper-forward. A soft, floral gin disappears under the olive.", // copy-audit-approved: R-13
            metricMl: 60,
          },
          {
            amount: "20 ml",
            item: "No. 02 DIRTY",
            note: "Filtered clear at the plant, so it goes in cold and the drink stays transparent.",
            metricMl: 20,
          },
          {
            amount: "10 ml",
            item: "Dry vermouth, refrigerated",
            note: "Ten, not fifteen. The brine is already carrying salinity and lemon peel.", // copy-audit-approved: EL-06
            metricMl: 10,
          },
        ],
      },
    ],
    steps: [
      {
        text: "Glass into the freezer. Ten minutes minimum, an hour is better.",
      },
      {
        text: "Mixing glass three-quarters up with hard ice. Gin, brine, vermouth.", // copy-audit-approved: R-13
      },
      {
        text: "Stir twenty-two seconds. Slightly longer than a plain martini: the salt sharpens the perception of alcohol, so the drink wants a touch more water in it.", // copy-audit-approved: EL-06 R-13
        seconds: 22,
      },
      {
        text: "Double-strain into the frozen glass. Any olive fragment that gets through will sit on the surface and go grey.",
      },
      {
        text: "One olive, on a pick, dropped in rather than balanced on the rim.",
      },
    ],
    notes: [
      "Three to one is the ratio that reads as dirty rather than filthy. Two to one is filthy and some people want that; say so on the menu rather than making them guess.", // copy-audit-approved: R-13
      "The reason a house dirty martini usually goes cloudy is that bars use olive jar water, which carries suspended solids and a lactic haze. No. 02 is filtered for exactly this drink.", // copy-audit-approved: R-13
      "Never shake it. Shaking a stirred drink puts air in it, drops the temperature too fast and leaves ice shards floating on top.",
      "Taste the vermouth before you build. If it smells of sherry, it is oxidised and it will make the drink taste of old apples.",
    ],
    swaps: [
      "Vodka: 65 ml, 20 ml brine, skip the vermouth entirely. The drink has nothing to hide behind, so the brine has to be cold and the glass has to be frozen.", // copy-audit-approved: R-13
      "Filthy: 30 ml of brine, 55 ml of gin, no vermouth.", // copy-audit-approved: R-13
    ],
    batch: {
      headline: "Bottled for service: fourteen drinks",
      rows: [
        { label: "Gin, 47%", value: "700 ml" }, // copy-audit-approved: R-13
        { label: "No. 02 DIRTY", value: "235 ml" },
        { label: "Dry vermouth", value: "115 ml" },
        { label: "Filtered water", value: "215 ml" },
        { label: "Pour", value: "90 ml, from the freezer, no ice" },
      ],
      note: "Freeze it in the bottle you will pour from. It will not freeze solid at this strength. Label it with the date. The vermouth is the clock and it gives you four days.",
    },
    tools: [
      "Mixing glass",
      "Bar spoon",
      "Julep strainer",
      "Fine strainer",
      "Jigger",
    ],
    published: "2026-07-30",
    keywords: ["dirty martini", "gin", "olive", "stirred"], // copy-audit-approved: R-13
  },

  {
    slug: "the-gibson",
    title: "The Gibson", // copy-audit-approved: R-13
    kicker: "Onion, not olive",
    summary:
      "A martini with a pickled onion in it, and a bar spoon of No. 02 to bridge the gap between the onion and the gin.", // copy-audit-approved: R-13
    kind: "drink",
    brine: "no-02-dirty",
    alsoWorksWith: ["no-01-house"],
    spirit: "gin", // copy-audit-approved: R-13
    occasions: ["before-dinner", "bar-service"],
    difficulty: "some-practice",
    prepMinutes: 4,
    cookMinutes: 0,
    restMinutes: 10,
    yieldText: "One drink",
    serveIn: "Frozen Nick and Nora",
    ice: "Hard cubes",
    garnish:
      "Two small silverskin onions on a pick. Cocktail onions from a jar with sulphites in it will taste of sulphites.", // copy-audit-approved: R-13
    ingredients: [
      {
        items: [
          { amount: "60 ml", item: "London dry gin", metricMl: 60 }, // copy-audit-approved: R-13
          {
            amount: "15 ml",
            item: "Dry vermouth, refrigerated",
            note: "More than the dirty martini gets, because the onion is sweeter than an olive.", // copy-audit-approved: R-13
            metricMl: 15,
          },
          {
            amount: "5 ml",
            item: "No. 02 DIRTY",
            note: "One bar spoon. This is a seasoning, not an ingredient.",
            metricMl: 5,
          },
        ],
      },
    ],
    steps: [
      { text: "Freeze the glass." },
      {
        text: "Build over hard ice in a mixing glass. Stir twenty seconds.",
        seconds: 20,
      },
      { text: "Strain. Two onions on a pick, in the glass." },
    ],
    notes: [
      "The Gibson's problem has always been that a pickled onion is doing all the work from the garnish, which means the first sip and the last sip are different drinks. Five millilitres of brine puts the onion in solution from the start.", // copy-audit-approved: R-13
      "Its origin is disputed and every bar tells a different story about a man called Gibson. We are not going to settle it.",
      "If your onions came in a sweet malt vinegar, rinse them and hold them in 30 ml of No. 02 in a small container overnight. It is a better onion by morning.",
    ],
    tools: ["Mixing glass", "Bar spoon", "Julep strainer"],
    published: "2026-08-13",
    keywords: ["gibson", "martini", "pickled onion", "gin"], // copy-audit-approved: R-13
  },

  {
    slug: "reverse-dirty",
    title: "The Reverse Dirty",
    kicker: "Vermouth-led, 14% ABV",
    summary:
      "Two parts vermouth to one part gin, and 15 ml of No. 02 to stop it going soft. A long, low-strength drink you can have before you order food.", // copy-audit-approved: R-13
    kind: "drink",
    brine: "no-02-dirty",
    alsoWorksWith: ["no-01-house"],
    spirit: "gin", // copy-audit-approved: R-13
    occasions: ["before-dinner", "at-the-table"],
    difficulty: "easy",
    prepMinutes: 4,
    cookMinutes: 0,
    restMinutes: 10,
    yieldText: "One drink",
    serveIn: "Small wine glass or a coupe, chilled",
    ice: "One large cube, if you are drinking it slowly. None, if you are not.",
    garnish: "A strip of lemon peel, expressed and dropped.",
    ingredients: [
      {
        items: [
          {
            amount: "60 ml",
            item: "Dry vermouth, cold",
            note: "This is now the main ingredient. Buy a better one than you would to make a martini.", // copy-audit-approved: R-13
            metricMl: 60,
          },
          { amount: "30 ml", item: "London dry gin", metricMl: 30 }, // copy-audit-approved: R-13
          { amount: "15 ml", item: "No. 02 DIRTY", metricMl: 15 },
        ],
      },
    ],
    steps: [
      {
        text: "Stir over hard ice for fifteen seconds. It needs less dilution than a spirit-forward drink because it starts lower.",
        seconds: 15,
      }, // copy-audit-approved: R-13
      {
        text: "Strain into a chilled glass, over one big cube if you want it to last.",
      },
      { text: "Lemon peel over the top, oils expressed, peel in." },
    ],
    notes: [
      "This lands around 14% ABV, which is roughly a glass of wine, and it is the drink to put first on a menu so a table can have one before they have decided anything.", // copy-audit-approved: R-13
      "Vermouth-led drinks live and die on how fresh the vermouth is. If the bottle has been open a fortnight, this is not the drink to make with it.",
      "It also works with the vermouth swapped for a dry sherry: fino, cold, and drop the brine to 10 ml.",
    ],
    tools: ["Mixing glass", "Bar spoon"],
    published: "2026-08-20",
    keywords: ["reverse martini", "vermouth", "low abv", "aperitif"], // copy-audit-approved: R-13
  },

  {
    slug: "salted-sour",
    title: "The Salted Sour", // copy-audit-approved: EL-06
    kicker: "Shaken hard, one egg white",
    summary:
      "A whiskey sour with 10 ml of No. 02 in it. The salt pulls the sugar down and the drink stops tasting like a dessert.", // copy-audit-approved: EL-06 R-13
    kind: "drink",
    brine: "no-02-dirty",
    alsoWorksWith: ["no-01-house"],
    spirit: "whiskey", // copy-audit-approved: R-13
    occasions: ["bar-service", "party"],
    difficulty: "practised",
    prepMinutes: 6,
    cookMinutes: 0,
    restMinutes: 0,
    yieldText: "One drink",
    serveIn: "Coupe, chilled",
    ice: "Hard cubes for the shake. None in the glass.",
    garnish:
      "Three drops of bitters on the foam, drawn through once with a pick.",
    ingredients: [
      {
        items: [
          { amount: "50 ml", item: "Bourbon or a soft rye", metricMl: 50 }, // copy-audit-approved: R-13
          {
            amount: "25 ml",
            item: "Lemon juice, squeezed within the hour",
            metricMl: 25,
          },
          {
            amount: "18 ml",
            item: "Sugar syrup, 1:1",
            note: "Less than the classic 20 to 25, because the brine will make what is left read as sweeter.",
            metricMl: 18,
          },
          { amount: "10 ml", item: "No. 02 DIRTY", metricMl: 10 },
          {
            amount: "1",
            item: "Egg white, or 20 ml aquafaba",
            note: "Aquafaba foams tighter and holds longer. It is the better ingredient, not the compromise.",
          },
          { amount: "3 drops", item: "Angostura bitters, to finish" },
        ],
      },
    ],
    steps: [
      {
        text: "Dry shake everything except the ice for fifteen seconds. Hard. You are building the protein network that holds the foam.",
        seconds: 15,
      },
      {
        text: "Add ice and shake again for twelve seconds. Short and violent. A long wet shake melts the foam you just made.",
        seconds: 12,
      },
      {
        text: "Double-strain into a chilled coupe and leave it alone for thirty seconds to let the foam set before you garnish.",
        seconds: 30,
      },
      {
        text: "Three drops of bitters across the foam, then draw a pick through them once, in one direction. Twice and it turns to mud.",
      },
    ],
    notes: [
      "Salt suppresses bitterness and raises the perception of sweetness, which is why the syrup comes down to 18 ml. Put 25 ml in with the brine and you will get a sour that tastes like lemonade.", // copy-audit-approved: EL-06
      "The brine also cuts the eggy smell that puts people off a sour. It is doing the job a couple of dashes of bitters usually does, more thoroughly.",
      "If the foam splits, you under-shook the dry shake. There is no rescue; make another one.",
    ],
    swaps: [
      "Pisco, 50 ml, lime instead of lemon, and it is a very good sour indeed.",
    ],
    tools: [
      "Shaking tins",
      "Hawthorne strainer",
      "Fine strainer",
      "Garnish pick",
    ], // copy-audit-approved: R-13
    published: "2026-08-27",
    keywords: ["whiskey sour", "egg white", "salted", "foam"], // copy-audit-approved: R-13
  },

  {
    slug: "martini-olives", // copy-audit-approved: R-13
    title: "Martini Olives, Brined Twice", // copy-audit-approved: FTA-12 R-13
    kicker: "Overnight, then keeps a month",
    summary:
      "Drain the olives, throw the packing liquid away and hold them in No. 02 overnight. They stop tasting of the tin and start tasting like the drink.", // copy-audit-approved: R-13
    kind: "dish",
    brine: "no-02-dirty",
    alsoWorksWith: ["no-01-house", "no-03-smoke"],
    spirit: "none",
    occasions: ["bar-service", "before-dinner", "party"],
    difficulty: "easy",
    prepMinutes: 10,
    cookMinutes: 0,
    restMinutes: 720,
    yieldText: "Makes a 500 g jar",
    ingredients: [
      {
        items: [
          {
            amount: "400 g",
            item: "Green olives in brine, pitted or not",
            note: "Nocellara if you can get them. Anything sold in oil is the wrong olive for this.",
            metricG: 400,
          },
          {
            amount: "250 ml",
            item: "No. 02 DIRTY",
            note: "Half a bottle. What you pour off after a week is a working martini brine and should not be thrown away.", // copy-audit-approved: R-13
            metricMl: 250,
          },
          { amount: "2", item: "Wide strips of lemon peel, no pith" },
          { amount: "1 tsp", item: "Fennel seed, lightly cracked" },
          { amount: "2", item: "Bay leaves" },
        ],
      },
    ],
    steps: [
      {
        text: "Drain the olives and rinse them under cold water for thirty seconds. The packing liquid is the reason tinned olives taste tinned.",
        seconds: 30,
      },
      {
        text: "Bruise the lemon peel between your fingers over the jar so the oil goes in, then drop it in with the fennel and bay.",
      },
      {
        text: "Pack the olives in and cover with the brine. They must be under the surface. A folded strip of baking paper on top will hold the floaters down.",
      },
      {
        text: "Twelve hours in the fridge before you serve any. They are better at day three and they keep a month, covered.",
      },
    ],
    notes: [
      "This is the cheapest thing on this list and the one a bar will notice first, because the same jar seasons the drink and garnishes it.",
      "Pour off 20 ml of the jar liquid to build a dirty martini and it is fractionally rounder than the bottle on its own. The olive has given something back.", // copy-audit-approved: R-13
      "Do not add salt. There is no version of this where it needs salt.", // copy-audit-approved: EL-06
    ],
    swaps: [
      "No. 03 SMOKE, with the fennel swapped for a strip of orange peel, makes an olive for a mezcal drink.", // copy-audit-approved: R-13
    ],
    tools: ["A 500 ml jar with a lid"],
    published: "2026-06-11",
    keywords: ["olives", "bar snack", "garnish", "make ahead"],
  },

  {
    slug: "cornichon-vinaigrette",
    title: "Cornichon Vinaigrette",
    kicker: "Five minutes, keeps a week",
    summary:
      "No vinegar in it at all. The brine is the acid and the salt in one. Shake it in the jar you will store it in.", // copy-audit-approved: EL-06
    kind: "dish",
    brine: "no-02-dirty",
    alsoWorksWith: ["no-01-house"],
    spirit: "none",
    occasions: ["at-the-table", "sunday-lunch"],
    difficulty: "easy",
    prepMinutes: 5,
    cookMinutes: 0,
    restMinutes: 0,
    yieldText: "Makes 200 ml",
    ingredients: [
      {
        items: [
          { amount: "60 ml", item: "No. 02 DIRTY", metricMl: 60 },
          {
            amount: "120 ml",
            item: "Extra virgin olive oil",
            note: "A 2:1 oil-to-acid ratio. Brine is less aggressive than vinegar, so this is looser than a standard vinaigrette and it should be.",
            metricMl: 120,
          },
          {
            amount: "1 tsp",
            item: "Dijon mustard",
            note: "The emulsifier. Not optional.",
          },
          { amount: "20 g", item: "Cornichons, chopped fine", metricG: 20 },
          { amount: "1", item: "Small shallot, diced as small as you can" },
          { amount: "1 tbsp", item: "Tarragon or dill, chopped" },
          { amount: "8 turns", item: "Black pepper" },
        ],
      },
    ],
    steps: [
      {
        text: "Put the shallot in the brine on its own for five minutes first. It takes the raw edge off and it will not shout over everything else.", // copy-audit-approved: R-11
        seconds: 300,
      },
      {
        text: "Add the mustard and shake, then the oil, then shake hard for twenty seconds.",
        seconds: 20,
      },
      { text: "Fold in the cornichons and herbs last so they stay in pieces." },
    ],
    notes: [
      "Use it on a green salad, on warm potatoes, over a slice of ham, or as the sauce for cold roast chicken. It is not a dressing so much as a condiment that pours.",
      "It splits in the fridge and comes back with a hard shake. That is normal for a mustard emulsion and it is not broken.",
      "It keeps a week. The shallot is the limiting ingredient, not the brine.",
    ],
    tools: ["A 250 ml jar with a tight lid"],
    published: "2026-07-06",
    keywords: ["vinaigrette", "dressing", "salad", "no vinegar"],
  },

  {
    slug: "brine-beurre-blanc",
    title: "Brine Beurre Blanc",
    kicker: "Twelve minutes, no wine",
    summary:
      "Reduce 100 ml of No. 02 with a shallot, then mount 150 g of cold butter into it a cube at a time, off the direct heat.",
    kind: "dish",
    brine: "no-02-dirty",
    alsoWorksWith: ["no-04-wild"],
    spirit: "none",
    occasions: ["at-the-table", "sunday-lunch"],
    difficulty: "practised",
    prepMinutes: 5,
    cookMinutes: 12,
    restMinutes: 0,
    yieldText: "Serves four, over fish",
    ingredients: [
      {
        items: [
          { amount: "100 ml", item: "No. 02 DIRTY", metricMl: 100 },
          { amount: "1", item: "Banana shallot, sliced thin" },
          {
            amount: "150 g",
            item: "Butter, cold, cut into 15 g cubes",
            note: "The kind without salt in it, and mean it. The brine is bringing the salt.", // copy-audit-approved: EL-06
            metricG: 150,
          },
          {
            amount: "30 ml",
            item: "Cream",
            note: "Insurance. It makes the emulsion much harder to break.",
            metricMl: 30,
          },
          { amount: "1 tbsp", item: "Chives, sliced, to finish" },
        ],
      },
    ],
    steps: [
      {
        text: "Simmer the brine and the shallot in a small heavy pan until there is about 30 ml left and it looks syrupy. Six or seven minutes.",
        seconds: 400,
      },
      { text: "Add the cream and bring it back to a bare simmer." },
      {
        text: "Take the pan off the heat. Whisk in the butter one cube at a time, adding the next only when the last has gone. Put the pan back on the lowest heat for a few seconds if it stops taking the butter.",
      },
      {
        text: "Strain out the shallot if you want it smooth, or leave it if you do not. Chives at the last moment. Serve inside ten minutes. This sauce does not wait.",
      },
    ],
    notes: [
      "A classic beurre blanc reduces white wine and vinegar. The brine does both jobs and brings lemon peel and cornichon with it, which is why it goes with fish without needing a squeeze of anything.",
      "If it splits, take it off the heat, drop in an ice cube and whisk hard. That works about three times out of four.",
      "Too hot and it breaks; too cold and it seizes. The pan should be too warm to hold and no warmer.",
    ],
    swaps: [
      "No. 04 WILD makes a version to put under a whole flounder. Same method, drop the chives.",
    ],
    tools: ["Small heavy saucepan", "Balloon whisk", "Fine sieve"],
    published: "2026-07-13",
    keywords: ["beurre blanc", "butter sauce", "fish", "emulsion"],
  },
];
