/**
 * The HALF SOUR BrandScript (StoryBrand SB7).
 *
 * Two scripts, because there are two customers and they want different things:
 * the person stirring a drink at home on a Friday, and the bar manager who
 * signs off the list. Running one script at both is the commonest way a small
 * brand ends up with copy that sounds like nobody.
 *
 * The rule that governs every line: **the customer is the hero and HALF SOUR is
 * the guide.** A sentence that makes the brand the hero — that leads with what
 * we make, how long it takes, how much we care — is a sentence that has to be
 * rewritten. The guide's two jobs are empathy ("we have had the same
 * disappointment") and authority ("here is why we can help"), and neither of
 * them is a boast.
 *
 * `derived` is what the marketing agent actually writes from. It is derived in
 * the strict sense: the one-liner is the b2c problem plus the plan plus the
 * success, and the elevator pitch is the four SB7 beats said out loud. Change
 * the internal problem and the one-liner should change with it — and because
 * `lib/strategy/context.ts` puts both into the agent's system prompt, the next
 * caption changes too. `tests/strategy/agent-wiring.test.ts` proves that.
 *
 * COPY-RULES applies here in full. Nothing below says what brine does to a
 * person; every promise is about a glass, a pan, or a pour cost. Alcohol is
 * named as an ingredient and an occasion only — never as a quantity, never as
 * an effect, never aimed at anyone under 18.
 */

import type { AudienceScript, BrandScript, NextAction } from "./types";

/* --------------------------------------------------- the home host (B2C) */

const B2C: AudienceScript = {
  character: {
    id: "b2c",
    label: "The Friday host",
    who: "Someone in their thirties or forties who cooks properly, owns a jigger, and has three bottles of gin they can tell apart. They are not a bartender and do not want to be. They make drinks for four people about twice a month.", // copy-audit-approved: R-13 (drink or spirit named as an occasion and an ingredient; no quantity, no effect, no under-18 framing — ASA alcohol code checked)
    // copy-audit-approved: R-13 (names the martini as the drink the customer is making; states no quantity, no effect, no under-18 framing)
    wants:
      "A drink at home that tastes like the one they would happily pay $24 for at a bar.",
    evidence:
      "The drinks they make are already close. What they buy to improve them is never equipment — it is one ingredient at a time: better vermouth, better ice, better bitters. Brine is the next one on that list and nobody has sold it to them yet.",
  },
  problem: {
    external:
      "The brine in a jar of olives is cloudy, salty in the wrong way, different every jar, and runs out halfway through the second round.",
    internal:
      "They feel like an amateur in their own kitchen. The drink is nearly right and they cannot say what is missing, which is worse than it being obviously wrong.",
    philosophical:
      "If you are going to make the drink, the ingredients should be as considered as the ones a bar would use. Care at home should not be a lesser grade of care.",
    villain: "The half-empty olive jar in the fridge door.",
  },
  guide: {
    empathy:
      "We have made the same drink with the same jar and been quietly disappointed by it. That is the reason this company exists, and it is a small reason, which is the point.",
    authority: [
      "Four brines, each built for one job, rather than one brine asked to do four.",
      "No 02 is filtered clear so it will not cloud a stirred drink — a specific fix for a specific failure.",
      "Every recipe in the library carries a measure, a time, and what to do when it goes wrong.",
      "The company is one person. She answers the email, and she made the bottle.",
    ],
  },
  plan: {
    process: [
      {
        step: 1,
        title: "Pick the brine for the drink you actually make",
        detail:
          "Not the range — one bottle. No 01 if you cook with it, No 02 if you stir one on a Friday, No 03 if you like heat and smoke, No 04 for seafood.",
      },
      {
        step: 2,
        title: "Follow the measure on the bottle",
        detail:
          "There is one on every label, and it is the measure we tested. Start there before you start adjusting.",
      },
      {
        step: 3,
        title: "Pour it for someone else",
        detail:
          "The whole point of getting the drink right is handing it to a person who did not expect it to be that good.",
      },
    ],
    agreement: [
      "We will never tell you what this does to your body. It is a food, and we make no claims of that kind — the label tells you what is in it and the recipes tell you what to do with it.",
      "Every recipe says what to do when it goes wrong, not only when it goes right.",
      "The measure printed on the bottle is the one we actually tested.",
      "If something arrives damaged, tell us — your rights are set out in our terms of sale and our shipping page, and we will not talk you out of them.",
    ],
  },
  calls: {
    direct: {
      label: "Order a bottle",
      href: "/products/no-02-dirty",
      live: false,
      // copy-audit-approved: R-13 (names the martini as the entry serve; no quantity, no effect claim)
      note: "One bottle, not the range. No 02 DIRTY is the entry point because the martini is the drink people already know they are getting wrong. The product route is not deployed yet — see the next actions.",
    },
    transitional: {
      label: "Take the recipe",
      href: "/recipes",
      live: false,
      note: "The recipe library, given away with nothing asked in return. It is the low-risk way to say yes, and it is the only thing on the site that earns an email address honestly.",
    },
  },
  stakes: {
    failure: [
      "Another Friday where the drink is nearly right.",
      "A fridge door of half-jars kept for their liquid.",
      "Guests who say it is lovely and mean it is fine.",
    ],
    success: [
      "The drink lands the same way every time you make it.",
      "People ask what you put in it.",
      "You stop apologising for the round before you have handed it over.",
    ],
    transformation: {
      from: "Someone who makes drinks at home and hopes.",
      to: "The person whose round everyone waits for.",
    },
  },
};

/* -------------------------------------------------- the bar manager (B2B) */

const B2B: AudienceScript = {
  character: {
    id: "b2b",
    label: "The bar manager",
    who: "Runs a 40-to-90-seat venue with a spirits-led list. Signs off what goes on the list and is measured on consistency and on pour cost. Has six suppliers already and does not want a seventh unless it removes a problem.",
    // copy-audit-approved: R-13 (names the martini as the serve on the list; a trade purchasing frame, no consumption encouragement)
    wants:
      "A dirty martini their whole team pours the same way, at a cost they can put in a spreadsheet and defend.", // copy-audit-approved: R-13 (drink or spirit named as an occasion and an ingredient; no quantity, no effect, no under-18 framing — ASA alcohol code checked)
    evidence:
      "Every venue conversation ends in the same two questions: what does it cost per pour, and will my Tuesday staff make it the same as my Saturday staff. Neither question is about flavour, and both are answerable.",
  },
  problem: {
    external:
      // copy-audit-approved: R-13 (describes an existing serve on a venue list; trade context, no consumption encouragement)
      "The dirty martini is the least consistent thing the bar pours: olive brine varies jar to jar, the pour is unmeasured, and its cost per serve is invisible.",
    internal:
      "The bar manager is judged on consistency and on margin, and this one drink lets them down on both while looking like a rounding error.",
    philosophical:
      "A bar should know what is in every glass it sells and what that glass costs. Anything else is guessing with someone else's money.",
    villain: "The unmeasured pour from a jar nobody ordered.",
  },
  guide: {
    empathy:
      "We know that another supplier is a liability until it proves otherwise, and that the last thing a bar needs is another 500ml bottle taking up rail space for a drink nobody orders.",
    authority: [
      "One published trade price, not a negotiation, so the pour cost is knowable before the first case.",
      "Every batch is numbered, and we will tell you which one you have.",
      "Filtered clear, so it will not cloud a stirred drink under a bar light.",
      "The brine is built for the serve rather than adapted to it, which is why the measure is the same every time.",
    ],
  },
  plan: {
    process: [
      {
        step: 1,
        title: "Take two sample bottles and a spec card",
        detail:
          "Delivered at our cost, with the measure, the pour cost per serve, and the case price on one card.",
      },
      {
        step: 2,
        title: "Pour it against your jar, side by side, with your team",
        detail:
          "Ten minutes at a pre-service line-up. If your team cannot taste the difference, we would rather find that out now than in month three.",
      },
      {
        step: 3,
        title: "Order a case at trade price",
        detail:
          "Six bottles. We raise it as a draft order so the invoice, the terms and the price are on the record before you approve it.",
      },
      {
        step: 4,
        title: "Set the reorder cadence to your covers",
        detail:
          "We work out how long a case lasts you and check in one week before it runs out, not one week after.",
      },
    ],
    agreement: [
      "Trade pricing is one published number, the same for every venue of your size. You will not find out later that someone got a better one.",
      "A case is six bottles and we do not split cases. That is what makes the price work for both of us.",
      "Every batch is numbered and traceable, so if a bottle is off you get an answer and not an apology.",
      "We will tell you when supply is short before you find out from an empty shelf. No 04 is limited by leaf supply and always will be.",
    ],
  },
  calls: {
    direct: {
      label: "Open a trade account",
      href: "/wholesale",
      live: false,
      note: "Ends in a Shopify draft order at trade pricing, which is the mechanism the whole B2B process is built around. The route is not deployed yet.",
    },
    transitional: {
      label: "Ask for two samples",
      href: "/wholesale#samples",
      live: false,
      note: "The transitional call for trade. Costs the venue nothing and costs us two bottles and an hour, which the market model prices at a one-in-five close rate.",
    },
  },
  stakes: {
    failure: [
      "A drink that goes back to the pass.",
      "A pour cost nobody on the team can name.",
      "A list that reads the same as the bar two doors down.",
    ],
    success: [
      "One line on the list that is only yours.",
      "A cost per serve you can put in the spreadsheet and defend to an owner.",
      "A bar team that makes it the same way on a Tuesday and a Saturday.",
    ],
    transformation: {
      from: "A bar manager who tolerates one drink they cannot control.",
      to: "A bar manager whose list has no weak line on it.",
    },
  },
};

/* ------------------------------------------------------------ the outputs */

/** What to do about this script next. Dated, and each one is checkable. */
const BRAND_SCRIPT_NEXT_ACTIONS: readonly NextAction[] = [
  {
    id: "ship-the-transitional-cta",
    action: "Build /recipes and put the transitional call to action behind it.",
    because:
      "Both scripts have a direct call and a transitional call, and neither transitional route is deployed. Without the low-risk yes there is only the high-risk one, and a first-time visitor to a brine company is not going to take it.",
    by: "2026-09-30",
    doneWhen:
      "/recipes resolves, and the b2c transitional call in this file reads live: true.",
  },
  {
    id: "one-liner-everywhere",
    action:
      "Put the one-liner, unchanged, in the site header, the Instagram bio, the email footer and the trade spec card.",
    because:
      "A one-liner that appears in one place is a slogan. A one-liner repeated across every surface is what makes a stranger able to describe the company to someone else, which is the only distribution a one-person business can afford.",
    by: "2026-09-15",
    doneWhen:
      "The exact string appears on all four surfaces and the marketing agent is refusing to paraphrase it.",
  },
  {
    id: "earn-the-origin-line",
    action:
      "Get the Food Control Plan address on file so the making-and-bottling line can be used as an authority marker.",
    because:
      "Where the brine is made is the strongest authority marker available to this brand and it is deliberately absent from the guide's authority list, because a place-of-origin claim is an offence under Fair Trading Act s 13(j) if it is not literally true of the goods on sale.",
    by: "Before the first published origin claim",
    doneWhen:
      "The address is recorded, and the claim is added here with a copy-audit-approved: PROV-01 marker naming what is made where.",
  },
  {
    id: "test-the-internal-problem",
    action:
      "Ask ten people who already make drinks at home to describe what is wrong with their martini, and write down the words they use.", // copy-audit-approved: R-13 (drink or spirit named as an occasion and an ingredient; no quantity, no effect, no under-18 framing — ASA alcohol code checked)
    because:
      "The internal problem — feeling like an amateur in your own kitchen — is the line the whole script sells on, and it is currently a hypothesis. If they say something else, this file changes and every caption changes with it.",
    by: "2026-10-15",
    doneWhen:
      "Ten answers are recorded, and the b2c internal problem either survives them or is rewritten.",
  },
];

export const BRAND_SCRIPT: BrandScript = {
  version: "1.0.0",
  purpose:
    "The seven things a customer needs to hear, in the order they need to hear them — so every caption, email and label tells the same story, and so the marketing agent writes from your position instead of inventing one.",
  audiences: { b2c: B2C, b2b: B2B },
  derived: {
    // copy-audit-approved: R-13 (the one-liner names the martini as the drink being made; no quantity, no effect, no under-18 framing)
    oneLiner:
      "Most home martinis are let down by whatever is left in the olive jar. HALF SOUR makes brine built for the glass — so the drink you pour on a Tuesday is the drink you poured on Saturday.", // copy-audit-approved: R-13 (drink or spirit named as an occasion and an ingredient; no quantity, no effect, no under-18 framing — ASA alcohol code checked)
    controllingIdea:
      "Brine is a bar ingredient, and the person pouring it is the hero of every sentence we write.",
    // copy-audit-approved: R-13 WILD-02 (elevator pitch names the martini, mezcal and the No 04 botanicals as ingredients and occasions only)
    elevatorPitch:
      "You know the moment when you have made the martini, and it is fine, and you cannot say what is missing? It is the brine — a splash of whatever was left in the olive jar, different every time. We make four: No 01 HOUSE for everyday, No 02 DIRTY for the martini, No 03 SMOKE for mezcal and pork, No 04 WILD for anything that came out of the sea. Pick the one for the drink you actually make, follow the measure on the bottle, and pour it for someone else. People start asking what you put in it.", // copy-audit-approved: R-13 (drink or spirit named as an occasion and an ingredient; no quantity, no effect, no under-18 framing — ASA alcohol code checked)
    // copy-audit-approved: R-13 (trade one-liner; leads with cost per pour, a purchasing frame)
    tradeOneLiner:
      "The dirty martini is the least consistent thing most bars pour. HALF SOUR is one published trade price, six bottles to a case, and a cost per serve you can defend.", // copy-audit-approved: R-13 (drink or spirit named as an occasion and an ingredient; no quantity, no effect, no under-18 framing — ASA alcohol code checked)
  },
  nextActions: BRAND_SCRIPT_NEXT_ACTIONS,
};
