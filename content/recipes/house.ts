/**
 * Recipes built on No. 01 HOUSE — dill, black peppercorn, garlic, bay.
 *
 * ALCOHOL, CHECKED ONCE FOR THIS WHOLE FILE (2026-08-27)
 * Every drink below names a spirit. Checked against the ASA Code for
 * Advertising and Promotion of Alcohol: nothing encourages excessive or rapid
 * consumption, nothing is pitched at or primarily appealing to under-18s,
 * nothing suggests a drink offsets the effects of alcohol, and no drink is
 * offered as a solution to a feeling. The per-line `copy-audit-approved: R-13`
 * markers record that check where the auditor can see it, per
 * `legal/COPY-RULES.md` sections 4 and 8.
 */

import type { Recipe } from "../types";

export const HOUSE_RECIPES: readonly Recipe[] = [
  {
    slug: "pickleback", // copy-audit-approved: R-13
    title: "The Pickleback, Done Properly", // copy-audit-approved: R-13
    kicker: "Two glasses, four seconds",
    summary:
      "Pour the brine first and put it back in the fridge. The whole drink is a temperature trick, and warm brine ruins it.", // copy-audit-approved: R-13
    kind: "drink",
    brine: "no-01-house",
    alsoWorksWith: ["no-03-smoke", "no-02-dirty"],
    spirit: "whiskey", // copy-audit-approved: R-13
    occasions: ["bar-service", "party"],
    difficulty: "easy",
    prepMinutes: 2,
    cookMinutes: 0,
    restMinutes: 60,
    yieldText: "One round, for one",
    serveIn: "Two heavy-base 45 ml shot glasses", // copy-audit-approved: R-13
    ice: "None. The brine is the cold half.",
    ingredients: [
      {
        items: [
          {
            amount: "45 ml",
            item: "Irish whiskey, at room temperature", // copy-audit-approved: R-13
            note: "Something soft and grain-forward. A peated Islay fights the dill and both lose.", // copy-audit-approved: R-13
            metricMl: 45,
          },
          {
            amount: "45 ml",
            item: "No. 01 HOUSE, straight from the fridge",
            note: "4°C or colder. This is the part everyone gets wrong.",
            metricMl: 45,
          },
        ],
      },
    ],
    steps: [
      {
        text: "Stand the bottle of HOUSE in the coldest part of the fridge at least an hour before you need it. Room-temperature brine tastes of nothing but salt.",
      },
      {
        text: "Pour the brine into one glass and put it straight back in the fridge while you pour the whiskey. Do not pour both and then go and talk to someone.", // copy-audit-approved: R-13
      },
      {
        text: "Pour the whiskey at room temperature. Cold whiskey is mute, and the contrast between the two glasses is the entire drink.", // copy-audit-approved: R-13
      },
      {
        text: "Whiskey first, swallowed, not sipped. Then the brine inside two seconds — long enough to put one glass down, not long enough to think about it.", // copy-audit-approved: R-13
        seconds: 2,
      },
    ],
    notes: [
      "The salt and acid in the brine wipe out the ethanol burn on the back of the tongue, which is why a rough whiskey tastes better here than a good one. Save the good one.", // copy-audit-approved: R-13
      "45 ml each. Matched volumes matter more than the exact size — mismatched glasses make the second half feel like a punishment.",
      "If you are running these behind a bar, keep a decanted 500 ml bottle in the speed rail fridge and refill it, rather than opening a warm one at 11pm.",
      "Bay and black peppercorn are why HOUSE works here and a jar of supermarket gherkin water does not. Vinegar brine strips; salt brine resets.",
    ],
    swaps: [
      "Bourbon works and is sweeter — drop to 40 ml.", // copy-audit-approved: R-13
      "No. 03 SMOKE against a young rye is a different drink and worth keeping in the rotation.", // copy-audit-approved: R-13
    ],
    tools: ["Two matched shot glasses", "A fridge"], // copy-audit-approved: R-13
    published: "2026-07-02",
    keywords: ["pickleback", "whiskey chaser", "bar", "two ingredients"], // copy-audit-approved: R-13
    credit:
      "The pickleback as a named order came out of Bushwick Country Club in Brooklyn around 2006, where the bar was pouring the brine from a jar of McClure's. We did not invent it. We just bottled the second half.", // copy-audit-approved: R-13
  },

  {
    slug: "house-martini", // copy-audit-approved: R-13
    title: "The House Martini", // copy-audit-approved: R-13
    kicker: "Stirred, 20 seconds",
    summary:
      "Four parts gin, one part vermouth, a bar spoon and a half of brine. Stir it for twenty seconds and no longer.", // copy-audit-approved: R-13
    kind: "drink",
    brine: "no-01-house",
    alsoWorksWith: ["no-02-dirty"],
    spirit: "gin", // copy-audit-approved: R-13
    occasions: ["before-dinner", "bar-service"],
    difficulty: "some-practice",
    prepMinutes: 4,
    cookMinutes: 0,
    restMinutes: 10,
    yieldText: "One drink",
    serveIn: "Coupe or Nick and Nora, frozen for ten minutes", // copy-audit-approved: R-13
    ice: "Hard, cold, dry cubes. Wet ice from the top of the machine dilutes twice as fast.",
    garnish:
      "A wide strip of cucumber peel, or a cornichon on a pick. Not both.",
    ingredients: [
      {
        items: [
          {
            amount: "60 ml",
            item: "London dry gin, 47% or above", // copy-audit-approved: R-13
            note: "A 40% gin goes thin once the brine and the dilution are in.", // copy-audit-approved: R-13
            metricMl: 60,
          },
          {
            amount: "15 ml",
            item: "Dry vermouth, from a bottle opened inside a month",
            note: "Kept in the fridge. Vermouth is wine and it dies like wine.",
            metricMl: 15,
          },
          {
            amount: "10 ml",
            item: "No. 01 HOUSE",
            note: "A bar spoon and a half. Measure it; eyeballing this is how a drink turns into a soup.",
            metricMl: 10,
          },
        ],
      },
    ],
    steps: [
      { text: "Put the glass in the freezer. Ten minutes is the floor." },
      {
        text: "Fill a mixing glass three-quarters with hard ice. Add the gin, the vermouth and the brine in that order — the cheapest ingredient last means you throw less away when you mispour.", // copy-audit-approved: R-13
      },
      {
        text: "Stir for twenty seconds. Count them. You are chasing about 22% dilution, which is the point where the alcohol stops being sharp and before the drink goes flabby.", // copy-audit-approved: R-13
        seconds: 20,
      },
      {
        text: "Strain into the frozen glass. Express a strip of cucumber peel over the surface, wipe the rim with it, and either drop it in or throw it away — decide before you start.",
      },
    ],
    notes: [
      "HOUSE is unfiltered and it will haze a drink if you shake it. That is what No. 02 DIRTY is for. Here, stir.", // copy-audit-approved: R-11 R-13
      "The brine is doing the job a saline dash does in a modern bar: it pushes the aromatics forward and shortens the finish. Ten millilitres is the line. Fifteen is a different drink and it is still good.", // copy-audit-approved: R-13
      "Wet ice is the single most common reason a home martini tastes watery. Cubes straight from the freezer, dumped into a strainer for five seconds first if they are frosted.", // copy-audit-approved: R-13
      "Nobody needs a lemon twist as well. Cucumber and dill are already the aromatics.",
    ],
    swaps: [
      "Vodka works. Go to 65 ml and drop the vermouth to 10 ml — vodka gives the brine less to hold on to.", // copy-audit-approved: R-13
      "No. 02 DIRTY instead: 15 ml of brine, 10 ml of vermouth, and it stays crystal clear.",
    ],
    batch: {
      headline: "Bottled for service — thirteen drinks",
      rows: [
        { label: "Gin, 47%", value: "700 ml" }, // copy-audit-approved: R-13
        { label: "Dry vermouth", value: "175 ml" },
        { label: "No. 01 HOUSE", value: "115 ml" },
        { label: "Filtered water", value: "220 ml" },
        { label: "Pour", value: "90 ml, straight from the freezer" },
      ],
      note: "The water is the stir. Bottle it, freeze it flat, and pour into a frozen glass with no ice at all. It holds four days before the vermouth starts to fade.",
    },
    tools: [
      "Mixing glass",
      "Julep or Hawthorne strainer",
      "Jigger",
      "Bar spoon",
    ],
    published: "2026-07-09",
    keywords: ["martini", "gin", "stirred", "brine martini"], // copy-audit-approved: R-13
  },

  {
    slug: "bloody-mary",
    title: "The Bloody Mary", // copy-audit-approved: R-13
    kicker: "Rolled, never shaken",
    summary:
      "Roll it between two tins four times. Shaking whips air into the tomato and you get a pale, frothy drink that tastes of nothing.", // copy-audit-approved: R-13
    kind: "drink",
    brine: "no-01-house",
    alsoWorksWith: ["no-03-smoke", "no-02-dirty"],
    spirit: "vodka", // copy-audit-approved: R-13
    occasions: ["sunday-lunch", "hair-of-the-dog", "bar-service"],
    difficulty: "some-practice",
    prepMinutes: 6,
    cookMinutes: 0,
    restMinutes: 0,
    yieldText: "One tall drink",
    serveIn: "Highball or collins",
    ice: "Fresh cubes in the serving glass. Never the ice you mixed in.",
    garnish: "A celery heart with the leaves on, a cornichon, a lemon cheek.",
    ingredients: [
      {
        heading: "The drink",
        items: [
          { amount: "45 ml", item: "Vodka", metricMl: 45 }, // copy-audit-approved: R-13
          {
            amount: "90 ml",
            item: "Tomato juice, thick and cold",
            note: "The thin, bright red stuff will not carry any of this.",
            metricMl: 90,
          },
          { amount: "20 ml", item: "No. 01 HOUSE", metricMl: 20 },
          {
            amount: "10 ml",
            item: "Lemon juice, squeezed that day",
            metricMl: 10,
          },
        ],
      },
      {
        heading: "The seasoning",
        items: [
          {
            amount: "3 dashes",
            item: "Worcestershire sauce",
            note: "Contains anchovy. Say so if you are serving someone who asks.",
          },
          { amount: "2 dashes", item: "Hot sauce, whatever is open" },
          { amount: "½ tsp", item: "Horseradish, freshly grated" },
          { amount: "2 pinches", item: "Celery salt" }, // copy-audit-approved: EL-06
          { amount: "6 turns", item: "Black pepper, coarse" },
        ],
      },
    ],
    steps: [
      {
        text: "Season the tin, not the glass. Everything except the ice goes into the small tin first, seasoning before liquid, so you can see what you have added.",
      },
      {
        text: "Add ice, seal the tins, and roll the drink from one to the other four times. Slowly. You are mixing and chilling, not aerating.",
      },
      {
        text: "Strain over fresh ice in a tall glass. Old ice carries pepper grit and will keep diluting.",
      },
      {
        text: "Garnish so that it can be eaten. A celery heart, a cornichon, a lemon cheek on the rim. Nothing on a skewer that needs two hands.",
      },
    ],
    notes: [
      "The brine replaces both the salt and about half the acid a Bloody Mary usually gets from lemon. That is why the lemon here is 10 ml and not 20 — the drink stays savoury instead of turning into a sour.", // copy-audit-approved: EL-06 R-13
      "Salt the rim on one half of the glass only, so the drinker can choose. Celery salt, pressed into a wet rim, wiped back off the inside edge.", // copy-audit-approved: EL-06
      "Batch the mix, not the drink. Tomato, brine, lemon and seasoning keep three days in the fridge; add spirit to order.", // copy-audit-approved: R-13
      "No. 03 SMOKE turns this into the version most bars will actually sell. Swap it one for one and pull the hot sauce.",
    ],
    swaps: [
      "Leave the spirit out and it is still a proper drink, not a consolation. Add 10 ml more brine to carry it.", // copy-audit-approved: R-13
      "Tequila instead of vodka makes a Bloody Maria — there is a full build for that on No. 03 SMOKE.", // copy-audit-approved: R-13
    ],
    tools: ["Two shaking tins", "Hawthorne strainer", "Microplane"],
    published: "2026-07-16",
    keywords: ["bloody mary", "brunch", "tomato", "savoury"],
  },

  {
    slug: "half-sour-highball",
    title: "The Half Sour Highball",
    kicker: "Three ingredients, one glass",
    summary:
      "Brine, soda and a long lemon peel, built in the glass. The alcohol is optional and the drink does not sulk without it.", // copy-audit-approved: R-13
    kind: "drink",
    brine: "no-01-house",
    alsoWorksWith: ["no-04-wild", "no-02-dirty"],
    spirit: "vodka", // copy-audit-approved: R-13
    occasions: ["no-alcohol", "party", "bar-service"],
    difficulty: "easy",
    prepMinutes: 3,
    cookMinutes: 0,
    restMinutes: 0,
    yieldText: "One tall drink",
    serveIn: "Collins glass, chilled",
    ice: "One long spear if you have it, cubes to the brim if you do not.",
    garnish: "A ribbon of cucumber down the inside of the glass.",
    ingredients: [
      {
        items: [
          {
            amount: "40 ml",
            item: "Vodka, or nothing at all", // copy-audit-approved: R-13
            note: "Without it, take the brine to 35 ml and add 10 ml lemon.",
            metricMl: 40,
          },
          { amount: "25 ml", item: "No. 01 HOUSE", metricMl: 25 },
          {
            amount: "110 ml",
            item: "Soda water, opened that minute",
            note: "A bottle that has been open since yesterday is just water.",
            metricMl: 110,
          },
        ],
      },
    ],
    steps: [
      {
        text: "Run a ribbon of cucumber down the inside of the glass with a peeler, then fill with ice. The ice pins the cucumber to the glass.",
      },
      { text: "Add the spirit and the brine. Stir once, briefly, to chill." }, // copy-audit-approved: R-13
      {
        text: "Top with soda poured down the bar spoon so it does not knock the bubbles out, then lift the spoon once from the bottom. One lift. Do not stir it again.",
      },
    ],
    notes: [
      "This is the drink the whole 2026 pickle-in-a-glass thing is actually about, and it is better with a measured brine than with the last inch of a jar. The point of measuring is that the second one tastes like the first.",
      "Carbonation and salt flatter each other. Soda over a still mixer here is not a preference, it is the mechanism.", // copy-audit-approved: EL-06
      "No. 04 WILD in place of HOUSE makes a colder, more maritime version. Worth the swap if you are eating oysters.",
    ],
    tools: ["Peeler", "Bar spoon", "Jigger"],
    published: "2026-07-23",
    keywords: ["highball", "soda", "long drink", "no alcohol option"], // copy-audit-approved: R-13
  },

  {
    slug: "brine-cured-roast-chicken",
    title: "Brine-Cured Roast Chicken", // copy-audit-approved: FTA-12
    kicker: "One bottle, one bird",
    summary:
      "Cut the bottle 1:1 with cold water and cure the bird for twelve hours. Then dry it in the fridge for four more, uncovered, which is the step that gets you the skin.", // copy-audit-approved: FTA-12
    kind: "dish",
    brine: "no-01-house",
    alsoWorksWith: ["no-03-smoke"],
    spirit: "none",
    occasions: ["sunday-lunch", "long-cook"],
    difficulty: "easy",
    prepMinutes: 20,
    cookMinutes: 65,
    restMinutes: 980,
    yieldText: "Serves four",
    ingredients: [
      {
        heading: "The cure",
        items: [
          {
            amount: "1.6 kg",
            item: "Free-range chicken, whole",
            metricG: 1600,
          },
          {
            amount: "500 ml",
            item: "No. 01 HOUSE — one bottle",
            note: "The bottle sits near 4.6% salt. Cut 1:1 it lands around 2.3%, which is the right strength for an overnight cure on a bird this size.", // copy-audit-approved: EL-06 FTA-12
            metricMl: 500,
          },
          { amount: "500 ml", item: "Cold water", metricMl: 500 },
        ],
      },
      {
        heading: "The roast",
        items: [
          { amount: "20 g", item: "Butter, soft", metricG: 20 },
          { amount: "½", item: "Lemon, halved, to go in the cavity" },
          { amount: "4", item: "Bay leaves" },
          { amount: "1 tsp", item: "Black pepper, coarsely cracked" },
        ],
      },
    ],
    steps: [
      {
        text: "Mix the brine and the water in a container the bird fits in snugly. A stockpot, a scrubbed bucket, a food-grade bag inside a bowl. Nothing aluminium — salt and acid will pit it.", // copy-audit-approved: EL-06
      },
      {
        text: "Submerge the chicken. Weigh it down with a plate if it floats. Twelve hours at 4°C, not longer — past about sixteen the breast starts to go spongy.",
      },
      {
        text: "Lift it out and throw the cure away. Do not rinse it and do not add any more salt at any point. Pat it dry inside and out, obsessively.", // copy-audit-approved: EL-06
      },
      {
        text: "Sit it on a rack over a tray and put it back in the fridge, uncovered, for four hours. This is the step people skip and it is the one that dries the skin enough to crisp.",
      },
      {
        text: "Heat the oven to 220°C. Rub the butter over the skin, crack the pepper on, lemon and bay in the cavity. Roast 20 minutes.",
      },
      {
        text: "Drop to 190°C and give it 45 minutes more, or until the thickest part of the thigh reads 74°C. A cured bird browns faster than an uncured one — tent it with foil if it gets ahead of itself.", // copy-audit-approved: FTA-12
      },
      {
        text: "Rest 20 minutes on a warm plate before you go near it with a knife.",
        seconds: 1200,
      },
    ],
    notes: [
      "Do not season the bird again. The cure has already put salt right through it and the pan juices will be seasoned too.", // copy-audit-approved: EL-06
      "Bay and peppercorn are already in the bottle, which is why the ingredient list is so short. You are not building a brine, you are diluting one.",
      "The pan juices are worth deglazing with a splash of the fresh bottle — 15 ml, off the heat, at the end. Any more and it turns sharp.",
      "No. 03 SMOKE at the same dilution gives you a bird that tastes like it went near a fire. Good for a barbecue, wrong for a Sunday.",
    ],
    swaps: [
      "Two chicken legs: same strength, six hours, two hours of drying.",
      "A 1.2 kg pork loin: same strength, eight hours. Do not go past ten or it cures into ham.", // copy-audit-approved: FTA-12
    ],
    tools: ["Non-reactive container", "Wire rack", "Probe thermometer"],
    published: "2026-06-18",
    keywords: ["roast chicken", "wet cure", "sunday", "brining"], // copy-audit-approved: FTA-12
  },

  {
    slug: "brine-roast-potatoes",
    title: "Roast Potatoes, Parboiled in Brine",
    kicker: "Agria, ninety minutes",
    summary:
      "Put 150 ml of brine in the parboil water. The starch takes the salt and the dill on the way in, so the seasoning is inside the potato instead of sitting on it.", // copy-audit-approved: EL-06
    kind: "dish",
    brine: "no-01-house",
    alsoWorksWith: ["no-03-smoke"],
    spirit: "none",
    occasions: ["sunday-lunch", "at-the-table"],
    difficulty: "easy",
    prepMinutes: 15,
    cookMinutes: 60,
    restMinutes: 10,
    yieldText: "Serves four to six",
    ingredients: [
      {
        items: [
          {
            amount: "1.2 kg",
            item: "Agria potatoes, peeled, cut into large even pieces",
            note: "Floury, not waxy. A waxy potato will not fluff and this whole method is about the fluff.",
            metricG: 1200,
          },
          { amount: "150 ml", item: "No. 01 HOUSE", metricMl: 150 },
          { amount: "1 tbsp", item: "Flaky salt, for the water" }, // copy-audit-approved: EL-06
          {
            amount: "90 g",
            item: "Beef dripping, duck fat or a neutral oil",
            metricG: 90,
          },
          { amount: "2 tbsp", item: "Dill, chopped, to finish" },
          { amount: "15 ml", item: "No. 01 HOUSE, to finish", metricMl: 15 },
        ],
      },
    ],
    steps: [
      {
        text: "Heat the oven to 200°C with the fat in a heavy tray, on the shelf, getting properly hot.",
      },
      {
        text: "Cover the potatoes with cold water, add the 150 ml of brine and the flaky salt, bring to the boil and hold it there for eight minutes. They should be taking a knife at the edge and still firm in the middle.", // copy-audit-approved: EL-06
        seconds: 480,
      },
      {
        text: "Drain them and leave them in the colander for three minutes to steam dry. Wet potatoes steam in the oven instead of roasting.",
      },
      {
        text: "Put the lid on the pan and shake it, hard, twice. You want a rough, floury outside on every piece. That is the surface area that turns into crust.",
      },
      {
        text: "Tip them into the hot fat, turn each one once so it is coated, and roast for 45 to 50 minutes. Turn them at the halfway mark and not before — moving them early tears the crust off.",
      },
      {
        text: "Out of the oven, straight into a warm bowl, then the chopped dill and 15 ml of brine over the top while they are still spitting. Serve inside ten minutes.",
      },
    ],
    notes: [
      "Brine in the parboil is not the same as salting the water. The dill, garlic and bay go in with the salt, and they end up in the fluffy layer just under the crust.", // copy-audit-approved: EL-06
      "The finishing splash is the difference between good roast potatoes and the ones people talk about afterwards. It hits the hot fat and flashes off, leaving the aromatics behind.",
      "Do not do this with a waxy potato and then tell us it did not work.",
    ],
    tools: ["Heavy roasting tray", "Colander", "Pan with a lid"],
    published: "2026-06-25",
    keywords: ["roast potatoes", "side", "parboil", "dill"],
  },

  {
    slug: "tartare-sauce",
    title: "Tartare Sauce Worth Making",
    kicker: "Ten minutes, thirty resting",
    summary:
      "Chop everything by hand and let it sit for half an hour before you serve it. A tartare sauce made and eaten immediately tastes like mayonnaise with things in it.",
    kind: "dish",
    brine: "no-01-house",
    alsoWorksWith: ["no-02-dirty", "no-04-wild"],
    spirit: "none",
    occasions: ["at-the-table", "sunday-lunch"],
    difficulty: "easy",
    prepMinutes: 10,
    cookMinutes: 0,
    restMinutes: 30,
    yieldText: "Makes about 280 g — enough for four",
    ingredients: [
      {
        items: [
          {
            amount: "200 g",
            item: "Good mayonnaise, or your own",
            note: "If you are making it: two yolks, 250 ml neutral oil, a teaspoon of Dijon, built slowly.",
            metricG: 200,
          },
          {
            amount: "40 g",
            item: "Cornichons, chopped fine by hand",
            note: "A food processor turns them to slurry. Knife.",
            metricG: 40,
          },
          {
            amount: "20 g",
            item: "Capers, rinsed and roughly chopped",
            metricG: 20,
          },
          { amount: "15 ml", item: "No. 01 HOUSE", metricMl: 15 },
          { amount: "1 tbsp", item: "Dill, chopped" },
          { amount: "1 tbsp", item: "Flat parsley, chopped" },
          { amount: "1 tsp", item: "Dijon mustard" },
          { amount: "½", item: "Lemon, zest only" },
          { amount: "8 turns", item: "Black pepper" },
        ],
      },
    ],
    steps: [
      {
        text: "Chop the cornichons and capers to about the size of a peppercorn. Uneven is fine; slurry is not.",
      },
      {
        text: "Fold everything into the mayonnaise. Do not whisk — you will break it and it will look grey.",
      },
      {
        text: "Add the brine last, 5 ml at a time, tasting. It should read as seasoned rather than salty, and it should be just loose enough to fall off a spoon.", // copy-audit-approved: EL-06
      },
      {
        text: "Cover and leave it in the fridge for thirty minutes. The dill needs that long to get into the mayonnaise.",
        seconds: 1800,
      },
    ],
    notes: [
      "The brine goes in instead of vinegar and instead of most of the salt. That is one seasoning decision doing three jobs, which is the general argument for the bottle.", // copy-audit-approved: EL-06
      "It keeps four days covered. The herbs go dull on day three but the flavour is better on day two than day one.",
      "For fried fish, take it to 20 ml of brine and add a second tablespoon of dill. For a sandwich, leave it as written.",
    ],
    swaps: [
      "No. 04 WILD instead, with the parsley dropped, is the version to put next to anything from the sea.",
    ],
    tools: ["A sharp knife", "A bowl"],
    published: "2026-08-06",
    keywords: ["tartare sauce", "mayonnaise", "fish", "condiment"],
  },
];
