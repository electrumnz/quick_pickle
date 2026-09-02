/**
 * Every word the four new storefront routes say.
 *
 * Same rule as `components/product/copy.ts` and `components/home/data.ts`: a
 * page renders a record, it never carries a sentence of its own. So the trade
 * sheet, the recipe library, the delivery page and the terms page all read from
 * here, and `legal/scripts/audit-copy.mjs` scans one file rather than chasing a
 * stray clause through JSX.
 *
 * ALCOHOL, CHECKED ONCE FOR THIS FILE (2026-08-30)
 * Several lines name a drink, because the drink is the positioning: this is a
 * bar ingredient and a cooking acid. Checked against the ASA Code for the
 * Advertising and Promotion of Alcohol — nothing here encourages excessive or
 * rapid consumption, nothing is pitched at or primarily appealing to under-18s,
 * and nothing suggests the product offsets the effects of alcohol. The per-line
 * `copy-audit-approved: R-13` markers record that check where the auditor can
 * see it.
 *
 * NO PROVENANCE CLAIMS. Nothing in this file says where anything is grown,
 * harvested or made. There is no confirmed supplier relationship behind the
 * native botanicals in No. 04, and under Fair Trading Act 1986 ss 12A and 13(j)
 * a sourcing line published before it is true is an offence — so there is no
 * sourcing line, rather than a sourcing line with a note beside it.
 */

/* --------------------------------------------------------------- routes */

export const WHOLESALE_PATH = "/wholesale";
export const RECIPES_HREF = "/recipes";
export const DELIVERY_PATH = "/delivery";
export const TERMS_PATH = "/terms";
export const SAMPLES_ANCHOR = "samples";

/* ------------------------------------------------------------- delivery */

/**
 * What delivery costs, said in the two places a buyer meets the question: once
 * in full on its own page, and once in a line short enough to sit beside a buy
 * button.
 *
 * The charge and the threshold are interpolated from `delivery.ts` at render
 * time and never written out here, so a rate change is one edit and the pages
 * cannot disagree with each other or with the checkout.
 */
export const DELIVERY = {
  /** Sits under the price on a product page and on the shop masthead. */
  shortLead: "Delivery",
  // copy-audit-approved: FTA-06 (the offer states its threshold and its region in the same sentence: NZ addresses, orders of the stated value or more — legal/COPY-RULES.md §4 FTA-06)
  shortLine:
    "{charge} a parcel to a New Zealand address, and free on orders of {threshold} or more to a New Zealand address.",
  dispatchLine:
    "We pick and pack on Tuesdays and Thursdays, so a Friday order moves on Tuesday.",
  linkLabel: "Delivery and returns",

  eyebrow: "Getting it to you",
  heading: "Delivery.",
  lede: "One charge, stated before you start rather than at the last step of a checkout you have already committed to.",

  chargeLabel: "One parcel, anywhere in New Zealand",
  freeLabel: "Orders of {threshold} or more",
  freeValue: "No charge",
  dispatchLabel: "Days we pack",
  dispatchValue: "Tuesday and Thursday",

  sections: [
    {
      heading: "What it costs",
      // copy-audit-approved: FTA-06 (threshold and region stated in the same sentence)
      body: "Delivery is {charge} a parcel to any New Zealand address, whatever is in the parcel. Orders of {threshold} or more go free to a New Zealand address. One parcel of three bottles costs the same to send as one bottle, which is the whole reason the box of Nos 01 to 03 exists.",
    },
    {
      heading: "When it leaves",
      body: "We pack on Tuesdays and Thursdays. An order placed on a Friday is packed on the Tuesday. Nothing is dispatched on a public holiday, and we will tell you if a run slips rather than letting you work it out from a tracking page.",
    },
    {
      heading: "Where we send it",
      body: "New Zealand addresses. We do not send outside New Zealand yet, and we will say so on this page on the day that changes rather than taking an order we cannot fill.",
    },
    {
      heading: "If it arrives broken",
      // copy-audit-approved: R-19 (a remedy, worded to match legal/terms-of-sale.md and legal/shipping-returns.md, and stating that nothing here narrows the statutory position)
      body: "Glass in a courier network sometimes loses. Tell us as soon as you open the parcel, send the batch code from the label and a photograph, and we will replace it or refund it, your choice, at our cost. Nothing on this page limits what the law already gives you.",
    },
  ],
} as const;

/* ------------------------------------------------------------ the trade */

/**
 * The trade page.
 *
 * The one thing it exists to do is remove an email from the middle of a
 * purchase: the price, the case, the minimum and the pour cost are all on the
 * page, so a bar manager costing a serve on a Monday morning finishes the sum
 * without waiting two working days for a reply.
 */
export const WHOLESALE = {
  title: "Wholesale",
  metaDescription:
    "The published trade price, the case size, the minimum order and the cost per pour for every bottle in the range. Prices before GST.",

  eyebrow: "For a bar or a kitchen",
  heading: "The trade price, published.",
  // copy-audit-approved: R-13 (names the serve a venue already pours; a purchasing frame, no consumption encouragement)
  lede: "One number for every venue of the same size, on the page rather than in a reply. Work out your cost per pour now, at the desk you are sitting at.",

  listEyebrow: "The list",
  listHeading: "Per bottle, per case, per pour.",
  listNote:
    "Trade prices are before GST. Shelf prices include it, which is why the two columns do not divide into each other cleanly.",

  columnBottle: "Bottle",
  columnShelf: "Shelf",
  columnTrade: "Trade, each",
  columnCase: "A case of six",
  columnPour: "A pour",
  pourNote: "{count} pours a bottle at {ml} ml",
  noPour: "Measured by the spoon, not the pour",
  supplyNote:
    "Supply-limited. It is filled when there is leaf to fill it with, so it comes and goes. Do not build a printed list around it without talking to us first.",

  workingEyebrow: "The working",
  workingHeading: "Where the number comes from.",
  workingSteps: [
    "Take the shelf price and lift the {gst} GST out of it.",
    "Take {discount} off what is left. That is the trade price, and it is the same one every venue of your size pays.",
    "Multiply by six for a case. Divide by the pours in the bottle for the cost of a serve.",
  ],
  workingNote:
    "Nothing on this page is a negotiated rate, and there is no volume tier underneath it. If you find out later that another venue paid less, we got something wrong and we will fix it.",

  termsEyebrow: "The terms",
  termsHeading: "Six to a case.",
  terms: [
    {
      label: "Case size",
      body: "Six bottles, one label per case. We do not split cases. That is the term that makes the price work for both of us.",
    },
    {
      label: "Minimum order",
      body: "One case. There is no minimum spend on top of it and no annual commitment.",
    },
    {
      label: "How it is invoiced",
      body: "As a draft order, so the lines, the terms and the price are on the record before you approve it. Nothing is charged until you do.",
    },
    {
      label: "Batches",
      body: "Every bottle carries a batch number on the label. If a bottle is off, tell us the number and you get an answer rather than an apology.",
    },
    {
      label: "Reordering",
      body: "We work out how long a case lasts your room and check in a week before it runs out, not a week after.",
    },
    {
      label: "When supply is short",
      body: "You hear it from us before you hear it from an empty shelf. No. 04 is limited by leaf supply and always will be.",
    },
  ],

  samplesEyebrow: "Before you order",
  samplesHeading: "Two bottles and a spec card.",
  // copy-audit-approved: FTA-06 R-13 (the offer states what it is, who it is for and what it costs the venue, in the same sentence; the serve is named as a purchasing comparison)
  samplesLine:
    "Two sample bottles and a spec card, delivered free to a licensed New Zealand venue that is considering the list, with no order and no obligation. Pour them against the jar you use now at a pre-service line-up. Ten minutes is enough.",
  samplesFormHeading: "Ask for the samples.",
  samplesFormLine:
    "Your address and the name of the room. Nothing else, and no call unless you ask for one.",
  samplesVenueLabel: "Venue",
  samplesVenuePlaceholder: "The name of the room",
  samplesEmailLabel: "Email",
  samplesEmailPlaceholder: "you@venue.co.nz",
  samplesSubmit: "Ask for two samples",
  samplesDone:
    "Noted. We will be in touch about a time to drop them in, at your pre-service hour rather than mid-service.",

  pourEyebrow: "Costing a serve",
  pourHeading: "Two numbers and a division.",
  pourLine:
    "Cost per pour is the trade price divided by the pours in the bottle. Both numbers are in the table above, so the sum is yours to check rather than ours to assert.",
} as const;

/* ---------------------------------------------------------- the library */

export const RECIPES = {
  title: "Recipes",
  metaDescription:
    "Every drink and dish the brine was built for, with the measures, the timings and what to do when it goes wrong. Nothing asked in return.",

  eyebrow: "The library",
  heading: "What to do with it.",
  lede: "Every one of these has been made, measured and written down, including the part about what to do when it does not work. Take them; nothing is asked in return.",
  countLine: "{count} recipes",

  drinksLabel: "Behind the bar",
  dishesLabel: "In the kitchen",
  builtOn: "Built on",
  alsoWorks: "Also works with",
  allLabel: "The whole library",

  backToLibrary: "All recipes",
  ingredientsHeading: "What you need",
  stepsHeading: "How it goes",
  notesHeading: "Why it works, and what to do when it does not",
  swapsHeading: "If you have not got one",
  batchHeading: "Batching it",
  toolsHeading: "Kit worth having",
  creditHeading: "Credit",
  serveInLabel: "Glass",
  iceLabel: "Ice",
  garnishLabel: "Garnish",
  yieldLabel: "Makes",
  prepLabel: "Hands on",
  cookLabel: "On the heat",
  restLabel: "Waiting",
  totalLabel: "Start to finish",
  difficultyLabel: "Technique",
  buyLine: "Get the bottle",
} as const;

export const DIFFICULTY_WORD: Readonly<Record<string, string>> = {
  easy: "Nothing to it",
  "some-practice": "Takes a couple of goes",
  practised: "Worth practising",
};

/* -------------------------------------------------------------- rights */

/**
 * The terms page.
 *
 * Short on purpose. `legal/terms-of-sale.md` is the full document and it still
 * carries unresolved placeholders — the legal entity, the NZBN, the address —
 * which must not reach a published page. What IS settled is the part a buyer
 * sending $54 to a stranger actually wants: what she is owed, who owes it, and
 * that nothing we write can take it away. That is published here in full and
 * word for word against the policy, because Fair Trading Act 1986 s 13(i)
 * makes misstating a remedy an offence in its own right.
 */
export const TERMS = {
  title: "Terms of sale",
  metaDescription:
    "Where you stand when you order: prices, what happens if something arrives broken, and the rights the law gives you that nothing here can take away.",

  eyebrow: "Where you stand",
  heading: "Your rights, first.",
  // copy-audit-approved: FTA-05 (names the Consumer Guarantees Act 1993; the statement matches legal/terms-of-sale.md §2 and neither narrows nor enlarges a remedy)
  lede: "Nothing on this site limits, excludes or modifies your rights under the Consumer Guarantees Act 1993 or the Fair Trading Act 1986. If anything we write ever reads as taking one of those away, the law wins and our sentence is worthless.",

  sections: [
    {
      heading: "Prices",
      body: "Every price shown is in New Zealand dollars and includes GST. Delivery is charged separately and is shown before you pay. The price that binds is the one displayed when you place the order.",
    },
    {
      heading: "If a price is obviously wrong",
      // copy-audit-approved: R-19 (states a remedy that matches legal/terms-of-sale.md §3 exactly)
      body: "A decimal point in the wrong place is a mistake, not an offer. We may cancel and refund in full rather than supply at that price. We will tell you promptly, and we will not do it to escape a price we simply regret.",
    },
    {
      heading: "If something is wrong with the order",
      // copy-audit-approved: R-19 (a remedy stated to match legal/shipping-returns.md; the statutory position is stated as unlimited by it)
      body: "Tell us. Send the batch code from the label, your order number and a photograph if there is something to photograph. Broken, leaking, wrong bottle or past its date mark: we replace it or refund it at our cost, your choice. This is what we do on top of the law, not instead of it.",
    },
    {
      heading: "Changing your mind",
      // copy-audit-approved: R-19 (accurately states what is and is not offered; makes no representation about a statutory right)
      body: "Food that has left our hands and sat on a doorstep cannot go back on a shelf, so a change of mind on an opened bottle is not something we can take back. An unopened order that has not been dispatched can be cancelled. Tell us before the Tuesday or the Thursday.",
    },
    {
      heading: "What we say about the product",
      body: "We describe what is in the bottle, what it tastes of and what to do with it. We make no claim at all about what it does to a body, and we will not agree with one if you make it to us. It is a food, and New Zealand's food standards are strict about that.",
    },
    {
      heading: "Your details",
      body: "We keep an address to send a parcel to and an address to email you at, and we use them for that. The list is one email a month and every one of them carries a way off it.",
    },
  ],

  contactHeading: "Reaching a person",
  contactLine:
    "The company is one person. She answers the email and she made the bottle.",
} as const;

/* ---------------------------------------------------------------- list */

/**
 * The list sign-up.
 *
 * It was a `mailto:` until this unit, and the honesty note that used to sit
 * beside it — "there's no form here yet, so the address goes on the list by
 * hand" — was true and is now obsolete. There is a form, it writes to a table,
 * and the copy says what happens next in the same number of words.
 */
export const LIST = {
  heading: "Get told when a batch lands.",
  line: "Roughly one email a month: what's brining, what's back, and one drink worth making. One field, and a way off it in every email.",
  emailLabel: "Email",
  emailPlaceholder: "you@somewhere.co.nz",
  submit: "Join the list",
  done: "You're on the list. The next one goes out when the next batch does.",
  privacyLine:
    "Your address is used for that email and nothing else. Ask and it is gone.",
} as const;

/** What went wrong, said in words the person reading it can act on. */
export const SIGNUP_PROBLEM: Readonly<Record<string, string>> = {
  "bad-email":
    "That does not look like an email address. Check it and send it again.",
  "too-long": "That is longer than an address can be.",
  store:
    "The list could not be reached just now, so nothing was recorded. Try again in a minute, or write to us and it goes on by hand.",
};

/* ---------------------------------------------------------------- hero */

/**
 * The line under the positioning statement on the homepage.
 *
 * The audit's `b2c-serve-named-early` check exists because a stranger who reads
 * three lines of this site without meeting a drink files it beside the imported
 * bottle in the running shop, in the supplement aisle — and the whole culinary
 * position is lost before she scrolls. So a serve is named in the first screen,
 * in the first two hundred characters, and it names three of them.
 */
export const HERO_SERVE_LINE =
  // copy-audit-approved: R-13 (three named serves as uses; no quantity, no effect claim, no under-18 framing — ASA alcohol code checked for this line)
  "Stirred into a martini, poured after a whiskey, splashed over a roast.";

/* ------------------------------------------------------------ templating */

/**
 * Fill `{name}` slots in a copy string.
 *
 * The figures — the delivery charge, the GST rate, the pour count — are
 * computed, so they cannot be written into the sentence. They are marked in the
 * sentence instead and substituted at render time, which keeps the whole
 * sentence in this file where the copy auditor reads it, and keeps the number
 * in the module that derives it.
 */
export function fill(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}
