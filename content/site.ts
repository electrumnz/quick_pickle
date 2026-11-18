/**
 * Every word on the Quick Pickle site.
 *
 * The page components render this file and say nothing of their own, so the
 * copy scanner (legal/scripts/audit-copy.mjs) reads the whole site by reading
 * `content/`, and anyone changing a line changes it in one place.
 *
 * ## The voice
 *
 * Ashleigh's: warm, encouraging, a little cheeky, always on the player's side.
 * Short sentences. Second person. One pun at a time. Lucky is a helper, not a
 * mascot bolted on. Lines marked OFFICIAL are hers, word for word.
 *
 * ## The one thing this copy never does
 *
 * It never says what the product does to a body. Quick Pickle is a food, and
 * under the Food Standards Code a food may not be advertised as preventing or
 * easing a condition (Standard 1.2.7-8), which is exactly what the best-known
 * line in the concept deck does. So the site sells the three things it CAN
 * stand behind: the taste, the tiny bottle, and the ritual. legal/COPY-RULES.md
 * has the detail and the scanner enforces it.
 */

import type { Offer } from "@/lib/shop/offer";

/**
 * What a few of these lines depend on: whether the shop is on pre-order or
 * live, and what the batch on sale is called. Both can be changed from the
 * back end with no deploy (lib/shop/offer.ts), so a line that depends on
 * them is a function of them and not a string. Everything else is a string.
 */
export type OnSale = Pick<Offer, "launchMode" | "batchName">;

const isPreorder = (sale: OnSale) => sale.launchMode === "preorder";

/**
 * When the shop itself changes: it has stopped taking orders for now (the
 * back end's own switch, for a batch that has sold out or a week away), or
 * something about an order changed while its buyer was at the checkout.
 */
export const SHOP = {
  /** On the buy button, which cannot be pressed. Short: it has to fit. */
  closedButton: "Not taking orders",
  /** Under it, and in the jar. The Pickle Crew's own promise, said again. */
  closedNote:
    "We've stopped taking orders for the moment. Join the Pickle Crew for first dibs when we're back.",
  /** The hero's and the last section's button while it is shut. */
  closedCta: "Join the Pickle Crew",
  /** With an order that arrived while the shop was shut. */
  closed: "We're not taking orders right now, so nothing was charged.",
  /**
   * With an order whose page was drawn before a price, a delivery rate or
   * the ship date's terms changed. The page redraws from the new ones.
   */
  moved:
    "Something about your order changed while you were checking out: a price, the delivery, or when it ships. Have a look at it as it stands now, then place it again.",
} as const;

/** Lines from Ashleigh's own pages, word for word. Do not reword. */
export const OFFICIAL = {
  neverFear: "Never fear, Lucky is here.",
  luckyYouveGotUs: "Lucky you've got us.",
  tinyPackage: "Tiny package, big dill.",
  pickleCrew: "Pickle Crew",
} as const;

/**
 * Ours, cut from hers. Her Meet Lucky page says "Our little shot of good luck
 * for the quads," and runs straight on into the sentence the law will not let
 * a food say. This keeps her best six words and stops there. It is not a
 * word-for-word quote, so it does not sit in OFFICIAL.
 */
export const ADAPTED = {
  goodLuck: "A little shot of good luck.",
} as const;

export const META = {
  title: "Quick Pickle | Pickle juice shots",
  description:
    "Pickle juice shots for people with a game-day ritual. Sour, salty, clear, and down in one. Tiny package, big dill.",
} as const;

export const TICKER = [
  "Tiny package, big dill",
  "Never fear, Lucky is here",
  "Pickle Crew",
  "Lucky you've got us",
  "A little shot of good luck",
  "No pickles. No bits. Just the juice",
] as const;

export const HEADER = {
  home: "Quick Pickle home",
  shop: "Shop",
  jar: "Your jar",
  nav: [
    { href: "#shop", label: "Shop" },
    { href: "#ritual", label: "The ritual" },
    { href: "#lucky", label: "Meet Lucky" },
    { href: "#faq", label: "FAQ" },
  ],
} as const;

export const HERO = {
  eyebrow: "Pickle juice shots",
  /**
   * ADAPTED.goodLuck, split into words. `breakOn` says where the line turns:
   * two lines on a phone, three on a wide screen.
   */
  title: [
    { text: "A little", breakOn: "wide" },
    { text: "shot", breakOn: "phone" },
    { text: "of", breakOn: "wide" },
    { text: "good luck.", breakOn: null },
  ],
  body: "Everyone's got a game-day ritual. Ours comes in a tiny bottle. Sour, salty, clear as a whistle, and down in one.",
  cta: (sale: OnSale) =>
    isPreorder(sale) ? "Pre-order a pack" : "Grab a pack",
  points: ["No pickles, no bits", "Kit-bag sized", "Delivered NZ-wide"],
  packsFrom: "Packs from",
  luckyAlt:
    "Lucky, a cream tabby cat in a cape, running flat out with a pickle held up in one paw.",
} as const;

export const BUY = {
  /** `open` false: the shop is shut for now, so nothing says pre-order. */
  eyebrow: (sale: OnSale & { readonly open?: boolean }) =>
    isPreorder(sale) && sale.open !== false
      ? `Pre-order ${sale.batchName}`
      : "The line-up",
  title: "Pick your pack.",
  body: "One juice, three sizes. Sour, salty, and not a pickle in sight.",
  packLegend: "Pack size",
  perShot: "a shot",
  shots: "shots",
  bestValue: "Cheapest per shot",
  luckysPick: "Lucky's pick",
  save: "Save",
  quantity: "How many packs",
  fewer: "One fewer pack",
  more: "One more pack",
  add: (sale: OnSale) => (isPreorder(sale) ? "Pre-order" : "Add to jar"),
  added: "In the jar!",
  /** What delivery costs is said by content/delivery.ts: deliveryPromise. */
  reassure: {
    preorder: "Pre-order now, pay now, ships",
    shipDateTbc: "date to be confirmed",
    sorted: "Something not right? Email us and we'll sort it",
  },
  bottleAlt:
    "Three illustrated Quick Pickle shot bottles: clear juice, a wide white cap, and a pink wrap label with the name and Lucky running across it.",
  artNote: "Illustration. Real bottle shots to come.",
} as const;

export const TRUTHS = {
  title: ["Clear as", "a whistle."],
  body: "No pickles in the bottle. Just the juice.",
  cards: [
    {
      icon: "drop",
      title: "Just the juice",
      body: "No pickles. No bits. Nothing floating about. Clear to the bottom of the bottle.",
    },
    {
      icon: "bottle",
      title: "Tiny package",
      body: "One twist, down in one, done. It lives in the kit-bag pocket you forgot you had.",
    },
    {
      icon: "face",
      title: "Big dill",
      body: "Sour up front, salty at the back, and a face you can't help pulling. Everyone pulls the face.",
    },
    {
      icon: "heart",
      title: "Made to hand round",
      body: "A pack's for sharing. One for you, one for the mate who forgot their boots, the rest for the sheds.",
    },
  ],
} as const;

export const RITUAL = {
  eyebrow: "The ritual",
  title: "Move over, oranges.",
  body: "Left boot first. Same socks since the semi. Three bounces before every serve. Everyone's got a thing. This is ours.",
  steps: [
    {
      title: "Pack it",
      body: "Chuck a shot in the kit bag. It takes up less room than your strapping tape.",
    },
    {
      title: "Crack it",
      body: "Before the whistle. At the half. On the sideline, next to the oranges. Your ritual, your call.",
    },
    {
      title: "Knock it back",
      body: "Down in one. Pull the face. Go play.",
    },
  ],
  rituals: [
    "Left boot first",
    "Same socks since the semi",
    "Three bounces",
    "The lucky undies",
    "Last one out of the sheds",
    "One shot of pickle juice",
  ],
} as const;

export const REELS = {
  eyebrow: "On the sideline",
  title: "See it in action.",
  /** Under the strip while a film made with AI is in it. */
  madeWithAi: "Made with AI.",
  /** The same, while one of them shows people. */
  notRealPeople: "Made with AI. The people in them are not real.",
} as const;

export const LUCKY = {
  title: "Meet Lucky.",
  /** Her Meet Lucky page, minus the lines the law will not let a food say. */
  body: [
    "We all have our rituals. Our lucky charms. That little sequence before we get out there and play.",
    "Lucky is ours. Part cat, all cape, and never seen without a pickle.",
  ],
  signoff: OFFICIAL.neverFear,
  cardTitle: "Player card",
  stats: [
    { label: "Name", value: "Lucky" },
    { label: "Position", value: "Superhero cat" },
    { label: "Special move", value: "Turning up. Every game." },
    { label: "Cape", value: "Always" },
    { label: "Weakness", value: "A sunny windowsill" },
    { label: "Ritual", value: "One shot, down in one, one very sour face" },
  ],
  alt: "Lucky, a cream tabby cat in a cape, leaping with a pickle held high.",
} as const;

export const CREW = {
  title: "Join the Pickle Crew.",
  body: "First dibs on new batches and whatever Lucky gets up to next. No spam. Just pickles.",
  label: "Email address",
  placeholder: "you@example.co.nz",
  cta: "I'm in",
  pending: "Signing you up",
  success: "You're in. Welcome to the crew.",
  invalid: "That email doesn't look right. Have another go.",
  failed: "That didn't go through. Give it another go in a minute.",
  /** Too many sign-ups from one internet address (lib/shop/limit.ts). */
  slowDown:
    "That's a lot of sign-ups from one place in a short time. Give it ten minutes and try again.",
  stickersAlt: "Quick Pickle stickers",
} as const;

export const FAQ = {
  title: "Fair questions.",
} as const;

export const FINAL = {
  /** OFFICIAL. */
  title: ["Lucky you've", "got us."],
  lockupAlt:
    "Quick Pickle. Lucky, a superhero cat with a pickle in his fist, runs through the logo.",
  body: (sale: OnSale) =>
    isPreorder(sale)
      ? `Pickle juice shots. ${sale.batchName} is open for pre-order.`
      : "Pickle juice shots. Ready when your ritual is.",
  cta: (sale: OnSale) =>
    isPreorder(sale) ? "Pre-order a pack" : "Grab a pack",
} as const;

export const FOOTER = {
  tagline: OFFICIAL.tinyPackage,
  logoAlt: "Quick Pickle",
  columns: [
    {
      title: "Shop",
      links: [
        { href: "/#shop", label: "Pick your pack" },
        { href: "/#ritual", label: "The ritual" },
        { href: "/#lucky", label: "Meet Lucky" },
        { href: "/#faq", label: "Questions" },
      ],
    },
    {
      title: "The fine print",
      links: [
        { href: "/delivery", label: "Delivery" },
        // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
        { href: "/returns", label: "Returns and refunds" },
        { href: "/terms", label: "Terms of sale" },
        { href: "/privacy", label: "Privacy" },
      ],
    },
  ],
  legal: "Quick Pickle. All rights reserved.",
  // copy-audit-ignore: a disclaimer. It says what the product is NOT.
  foodNote: "Quick Pickle is a food. It is not a medicine.",
  // The way in for whoever runs the shop. It leads to a sign-in, and to
  // nothing a customer needs.
  staff: { href: "/backstage", label: "Staff" },
} as const;

export const BUYBAR = {
  label: "Quick add",
  add: (sale: OnSale) => (isPreorder(sale) ? "Pre-order" : "Add"),
  added: "In the jar!",
} as const;

export const JAR = {
  title: "Your jar",
  close: "Close your jar",
  open: "Open your jar",
  emptyTitle: "Your jar's empty.",
  emptyBody: "Lucky's having a nap until you put something in it.",
  emptyCta: "Pick a pack",
  emptyAlt: "Lucky asleep on top of a jar, wrapped in his cape.",
  shots: "shots",
  each: "each",
  remove: "Remove",
  less: "One fewer",
  more: "One more",
  // copy-audit-approved: FTA-06 (the spend threshold is stated with it, from content/offer.ts)
  gap: "away from free delivery",
  // copy-audit-approved: FTA-06 (the spend threshold is stated with it, from content/offer.ts)
  unlocked: "Free delivery unlocked",
  upgradeLead: "Make it",
  upgradeTail: "more",
  upgradeCta: "Swap",
  subtotal: "Subtotal",
  deliveryNote: "Delivery worked out at checkout",
  checkout: "Checkout",
  keepShopping: "Keep looking",
  preorderNote: (sale: OnSale) =>
    isPreorder(sale)
      ? `${sale.batchName} pre-order. You pay now and it ships when the batch is ready.`
      : null,
} as const;

export const CHECKOUT = {
  metaTitle: "Checkout",
  title: "Checkout",
  back: "Back to the shop",
  testTitle: "Test mode",
  testBody:
    "Payments aren't switched on yet. No money is taken and nothing will be sent. Use it to try the checkout out.",
  sandboxTitle: "Stripe test mode",
  sandboxBody:
    "Placing the order takes you to Stripe's payment page in its test mode. Pay there with the test card 4242 4242 4242 4242, any date in the future and any three digits. No real money is taken and nothing will be sent.",
  cancelledTitle: "Payment wasn't finished.",
  cancelledBody: "Nothing was charged. Your jar is just as you left it.",
  sections: {
    contact: "Who's it for",
    delivery: "Where's it going",
    payment: "Payment",
    summary: "Your order",
  },
  fields: {
    email: "Email",
    /** Shown when order emails are really being sent. */
    emailHint: "For your receipt and delivery updates.",
    /** And when they are not: nothing is promised that will not arrive. */
    emailHintNoMail: "So we can reach you about your order.",
    phone: "Mobile (optional)",
    phoneHint: "Only used if the courier can't find you.",
    firstName: "First name",
    lastName: "Last name",
    line1: "Street address",
    line2: "Flat, unit or business (optional)",
    suburb: "Suburb (optional)",
    city: "Town or city",
    region: "Region",
    regionPlaceholder: "Choose a region",
    postcode: "Postcode",
    rural: "This is a rural delivery address",
    notes: "Delivery notes (optional)",
    notesPlaceholder: "Gate code, where to leave it, that sort of thing",
    joinCrew: "Add me to the Pickle Crew for news on new batches",
  },
  country: "New Zealand only for now.",
  paymentTest:
    "Card and wallet payments go here once a payment processor is connected. For now, placing the order just records it as a test.",
  paymentSandbox:
    "You'll pay on Stripe's payment page, which is in test mode. Nothing real is charged.",
  paymentLive:
    "You'll pay on Stripe's secure payment page. Your card details never touch our site.",
  subtotal: "Subtotal",
  delivery: "Delivery",
  rural: "Rural delivery",
  free: "Free",
  total: "Total",
  totalNote: "NZD",
  place: "Continue to payment",
  placeTest: "Place test order",
  placing: "Placing your order",
  agree: "By placing this order you agree to our",
  terms: "terms of sale",
  and: "and",
  privacy: "privacy policy",
  emptyTitle: "Nothing to check out yet.",
  emptyBody: "Your jar is empty. Pick a pack and come back.",
  emptyCta: "Pick a pack",
  problem: "A few things need another look before we can place this.",
  failed:
    "Something went wrong placing your order. Nothing was charged. Please try again.",
  /** Too many orders from one internet address (lib/shop/limit.ts). */
  slowDown:
    "That's a lot of orders from one place in a short time, so this one was not placed and nothing was charged. Give it ten minutes and try again.",
  edit: "Edit jar",
  showSummary: "Show order",
  hideSummary: "Hide order",
} as const;

/**
 * Promo codes: everything a customer is told about one, at the checkout and
 * on the order. The sums are in lib/backstage/marketing/promo.ts; the words
 * are here so the copy scanner reads them with the rest of the site.
 */
export const CODES = {
  label: "Got a code?",
  placeholder: "Type it here",
  apply: "Apply",
  checking: "Checking",
  remove: "Take it off",
  applied: "Code applied",
  youSave: "You save",
  discountLine: "Discount",
  codeLine: "Code",
  /** What a code gives, in a few words. The figure is put in front. */
  off: "off",
  // copy-audit-approved: FTA-06 (only shown for a code that waives standard delivery, and says "standard": the rural extra is still charged and shown)
  freeDelivery: "Free standard delivery",
  unknown: "We don't know that code.",
  notInUse: "That code is not in use.",
  finished: "That code has finished.",
  usedUp: "That code has been used up.",
  notStarted: "That code has not started yet.",
  emptyJar: "Put something in your jar first.",
  /** Followed by the amount, then `minimumTail`. */
  minimumLead: "That code is for orders of",
  minimumTail: "or more, before delivery.",
  broken: "That code is not set up properly. Tell us and we will fix it.",
  // copy-audit-approved: FTA-06 (states that delivery on this order is already free under the stated spend threshold)
  deliveryAlreadyFree:
    "Standard delivery is already free on this order, so that code has nothing to take off.",
  wouldBeFree:
    "That code would take this order down to nothing, which the checkout can't do. Get in touch and we'll sort it.",
  changed:
    "That code changed while you were checking out. Have another look at the total and try again.",
  unavailable: "We couldn't check that code just now. Try again in a moment.",
  /** Too many wrong codes from one internet address (lib/shop/limit.ts). */
  slowDown:
    "That's a lot of codes from one place in a short time. Give it ten minutes and try again.",
  alreadyUsed:
    "You've already used that code. It works once for each customer.",
  /**
   * For a visitor who followed a link that carries a code. Read as:
   * "Code CREW10 is in: 10% off. You'll see it come off at the checkout."
   */
  carriedLead: "Code",
  carriedIn: "is in:",
  carriedTail: "You'll see it come off at the checkout.",
  /** Read as: "Code CREW10 came with your link, but ..." then the reason. */
  carriedNo: "came with your link, but it can't be used on this order.",
} as const;

/**
 * A special: a saving that comes off by itself, with no code to type.
 *
 * What a special gives and when it ends are never typed by anybody. They are
 * put together from these words and the special's own terms
 * (lib/backstage/marketing/specials.ts), so the sentence a customer reads is
 * what the checkout does: "10% off every pack, until Sunday 15 November."
 */
export const SPECIAL = {
  /** The small word in front of it, wherever it is said. */
  tag: "Special",
  /** "10% off every pack". The figure is put in front. */
  percentTail: "off every pack",
  /** "$5 off your order". */
  amountTail: "off your order",
  /** With a smallest order: "10% off when you spend $40 or more on packs". */
  off: "off",
  minimumLead: "when you spend",
  minimumTail: "or more on packs",
  /** "for the first 50 orders" */
  limitLead: "for the first",
  limitTail: "orders",
  /** "until Sunday 15 November": the last day it works. */
  until: "until",
  /** Under the sentence, wherever it is said. */
  noCode: "No code needed.",
  /** After `noCode`, on the page and in the jar. */
  comesOff: "It comes off at the checkout.",
  /** Under the code box, when a code is worth less than the special. */
  beatsCode:
    "The special takes more off than that code, so the special is what's on this order. It's one saving an order.",
  /** With the order, when the special that was showing has ended or changed. */
  gone: "The special changed while you were checking out, so your total is different now. Have a look at it, then try again.",
} as const;

/**
 * The code somebody is given when they join the Pickle Crew, if one is set
 * up. Read as: "Your code is CREW10: 10% off. It's saved for you, and comes
 * off at the checkout."
 */
export const WELCOME = {
  lead: "Your code is",
  saved: "It's saved for you, and comes off at the checkout.",
  /** When they already arrived with another code in hand. */
  typeIt: "Type it in at the checkout.",
} as const;

/**
 * The page an email's unsubscribe link leads to. It asks for one press of
 * a button, so that a mail program following links to check them cannot
 * take anybody off the list by accident. Everything said here has to stay
 * true: leaving works at once, and emails about an order are not marketing
 * and are not stopped by it.
 */
export const UNSUBSCRIBE = {
  metaTitle: "Leave the Pickle Crew",
  title: "Had enough?",
  body: (email: string) =>
    `Press the button and we'll stop emailing ${email} about new batches. It takes effect straight away.`,
  cta: "Take me off the list",
  doneTitle: "You're off the list.",
  doneBody: (email: string) =>
    `We won't email ${email} about new batches again. If you order from us, the emails about that order still come.`,
  again: "Changed your mind? You can join again any time, from the shop.",
  shop: "Back to the shop",
  unknownTitle: "That link didn't work.",
  unknownBody:
    "It may have been cut short on its way here. Open the email again and press the unsubscribe link at the bottom.",
  failed: "That didn't go through. Give it another go in a minute.",
} as const;

export const THANKS = {
  metaTitle: "Order placed",
  title: ["Order's", "in!"],
  lead: "Lucky's on it.",
  cheers: "Cheers",
  numberLabel: "Order number",
  /**
   * The three lines about email are only shown when a receipt really is
   * being sent for this order (the receipt cookie's `emails` flag, set by
   * the server from lib/mail). Otherwise the page says `keepNumber`.
   */
  emailNote: "A receipt is on its way to",
  preorderNote: (batchName: string) =>
    `This is a ${batchName} pre-order. We'll email you the ship date, and again when it's on the courier.`,
  liveNote: "We'll email you again when it's on the courier.",
  /** When no receipt is being emailed: what is true instead. */
  keepNumber:
    "Keep a note of your order number. It's how we'll find your order if you get in touch.",
  /** After `keepNumber`, for a pre-order. */
  preorderOnly: (batchName: string) =>
    `This is a ${batchName} pre-order, so it ships when the batch is ready.`,
  testNote:
    "This was a test order. Nothing was charged and nothing will be sent.",
  summary: "What you ordered",
  deliverTo: "Going to",
  home: "Back to the start",
  alt: "Lucky jumping for joy with a pickle.",
  sandboxNote:
    "This was a Stripe test payment. No real money was taken and nothing will be sent.",
  awaitingTitle: ["Nearly", "there."],
  awaitingBody:
    "We're waiting to hear back from the payment page. It usually takes a few seconds.",
  awaitingAgain: "Check again",
  unpaidTitle: ["Not paid", "yet."],
  unpaidBody:
    "Your order is saved but not paid for yet. Finish paying now, or go back and change it.",
  unpaidCta: "Finish paying",
  unpaidChange: "Change my order",
  closedTitle: ["Not", "paid."],
  closedBody:
    "That order wasn't paid, so it has been closed. Nothing was charged, and your jar is just as you left it.",
  closedCta: "Back to checkout",
  reviewNote:
    "Your payment came through, but there's something on this order we need to check by hand. We'll email you about it shortly.",
  noneTitle: "No order to show.",
  noneBody: "There's no recent order on this device.",
  /** After `noneBody`, only while receipts are really being emailed. */
  noneCheckEmail: "If you just placed one, check your email for the receipt.",
} as const;

export const NOT_FOUND = {
  title: ["Nothing here", "but a napping cat."],
  body: "That page has wandered off. The pickle juice is this way.",
  cta: "Back to the start",
  alt: "Lucky asleep on top of a jar, wrapped in his cape.",
} as const;
