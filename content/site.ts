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

import { STORE } from "./offer";

const preorder = STORE.launchMode === "preorder";

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
  cta: preorder ? "Pre-order a pack" : "Grab a pack",
  points: ["No pickles, no bits", "Kit-bag sized", "Delivered NZ-wide"],
  packsFrom: "Packs from",
  luckyAlt:
    "Lucky, a cream tabby cat in a cape, running flat out with a pickle held up in one paw.",
} as const;

export const BUY = {
  eyebrow: preorder ? `Pre-order ${STORE.batchName}` : "The line-up",
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
  add: preorder ? "Pre-order" : "Add to jar",
  added: "In the jar!",
  reassure: {
    delivery: "Delivered anywhere in New Zealand",
    // copy-audit-approved: FTA-06 (the spend threshold is stated with it, from content/offer.ts)
    freeOver: "Free delivery over",
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
  stickersAlt: "Quick Pickle stickers",
} as const;

export const FAQ = {
  title: "Fair questions.",
} as const;

export const FINAL = {
  /** OFFICIAL. */
  title: ["Lucky you've", "got us."],
  lockupAlt:
    "Quick Pickle. Lucky, the superhero cat, runs through the logo with his pickle raised.",
  body: preorder
    ? `Pickle juice shots. ${STORE.batchName} is open for pre-order.`
    : "Pickle juice shots. Ready when your ritual is.",
  cta: preorder ? "Pre-order a pack" : "Grab a pack",
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
} as const;

export const BUYBAR = {
  label: "Quick add",
  add: preorder ? "Pre-order" : "Add",
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
  preorderNote: preorder
    ? `${STORE.batchName} pre-order. You pay now and it ships when the batch is ready.`
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
    "Placing the order takes you to Stripe's payment page in its test mode. Use one of Stripe's test cards there. No real money is taken and nothing will be sent.",
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
    emailHint: "For your receipt and delivery updates.",
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
    ruralHint: "Rural delivery costs the courier more, so it adds",
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
  edit: "Edit jar",
  showSummary: "Show order",
  hideSummary: "Hide order",
} as const;

export const THANKS = {
  metaTitle: "Order placed",
  title: ["Order's", "in!"],
  lead: "Lucky's on it.",
  cheers: "Cheers",
  numberLabel: "Order number",
  emailNote: "A receipt is on its way to",
  preorderNote: `This is a ${STORE.batchName} pre-order. We'll email you the ship date, and again when it's on the courier.`,
  liveNote: "We'll email you again when it's on the courier.",
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
  closedTitle: ["Not", "paid."],
  closedBody:
    "That order wasn't paid, so it has been closed. Nothing was charged, and your jar is just as you left it.",
  closedCta: "Back to checkout",
  reviewNote:
    "Your payment came through, but there's something on this order we need to check by hand. We'll email you about it shortly.",
  noneTitle: "No order to show.",
  noneBody:
    "There's no recent order on this device. If you just placed one, check your email for the receipt.",
} as const;

export const NOT_FOUND = {
  title: ["Nothing here", "but a napping cat."],
  body: "That page has wandered off. The pickle juice is this way.",
  cta: "Back to the start",
  alt: "Lucky asleep on top of a jar, wrapped in his cape.",
} as const;
