/**
 * The starter questions: one list of everything only a person can decide or
 * supply.
 *
 * Merged from three places and de-duplicated: the stand-in facts on the site
 * (`UNCONFIRMED` in content/offer.ts, shown on the go-live list), the "needs
 * a person" list in TODO.md, and the brand pack's thirty questions for
 * Ashleigh. `source` says which. A few more came out of writing the how-to
 * sheets.
 *
 * `blocksLaunch` is set only where the site cannot take money until the
 * question is answered. The order here is the order on the screen: topics in
 * the order they matter, and within a topic the most pressing first.
 *
 * Nothing here is an answer. Where something is already known (the bottle is
 * 100 ml, the market is New Zealand, payments will be Stripe) it is not asked.
 */

import type { StarterQuestion } from "./types";

const ASHLEIGH = "Ashleigh";
const BUSINESS = "Whoever runs the business side";
const SAM = "Sam";

type Topic = {
  readonly topic: string;
  readonly questions: readonly Omit<StarterQuestion, "topic">[];
};

const TOPICS: readonly Topic[] = [
  {
    topic: "Product facts",
    questions: [
      {
        key: "where-made",
        question:
          "Where is it made, and by whom: you, or someone making it for you?",
        why: "It decides which food plan applies and who registers, whose name and address go on the label, and whether anything can be said about where it is from.",
        askOf: ASHLEIGH,
        source: "To-do list; questions for Ashleigh 12",
        blocksLaunch: true,
      },
      {
        key: "ingredients",
        question:
          "What is in it? The ingredients list and the nutrition panel, exactly as they will be printed on the label, and anything that has to be declared as an allergen.",
        why: "The site says nothing about what is in the bottle until this is confirmed, and the label cannot be printed without it.",
        askOf: "Ashleigh, with whoever makes it",
        source:
          "Go-live list (ingredients); to-do list; questions for Ashleigh 12",
        blocksLaunch: true,
      },
      {
        key: "shelf-life",
        question:
          "How long does it keep, how was that worked out, and how must it be stored before and after opening?",
        why: "The label needs a date mark and a storage line, and neither can be guessed. It also sets how big a batch can be and how long stock can sit.",
        askOf: "Ashleigh, with whoever makes it",
        source: "To-do list; questions for Ashleigh 12",
        blocksLaunch: true,
      },
      {
        key: "food-registration",
        question:
          "Is the business registered to sell food in New Zealand, and under which kind of food plan?",
        why: "Food cannot be sold without the right registration. MPI's online tool says which plan applies, and the answer depends on where and how it is made.",
        askOf: "Ashleigh, with MPI or the council",
        source: "Compliance checklist",
        blocksLaunch: true,
      },
      {
        key: "label-check",
        question:
          'Who checks the label before it is printed, and is "pickle juice shot" the right name for it on the pack?',
        why: "A reprint costs money, and a wrong label can mean bringing a batch back. The compliance checklist lists what to check.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 9",
        blocksLaunch: false,
      },
      {
        key: "flavours",
        question: "Is there one juice, or is more than one flavour planned?",
        why: "The site sells one juice in three pack sizes. A second flavour changes the label, the stock and the page.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 10",
        blocksLaunch: false,
      },
      {
        key: "bottle-photo",
        question:
          "When will there be a finished bottle, with its real label, to photograph?",
        why: "The site shows a drawing of the bottle. One straight-on photo on plain card replaces it.",
        askOf: ASHLEIGH,
        source: "To-do list",
        blocksLaunch: false,
      },
    ],
  },
  {
    topic: "The offer",
    questions: [
      {
        key: "packs-prices",
        question: "What are the pack sizes, their names and their prices?",
        why: "Packs of 6, 12 and 24 are planned, but the names and prices on the site are stand-ins. Set them once the Budget shows what a pack costs.",
        askOf: ASHLEIGH,
        source: "Go-live list (packs); to-do list; questions for Ashleigh 11",
        blocksLaunch: true,
      },
      {
        key: "launch-mode",
        question:
          "Does it launch as a pre-order for a first batch, or with stock on the shelf? If it is a pre-order, what date does the first batch ship from?",
        why: "The site is set up as a pre-order. A pre-order with no ship date is not something to take money for.",
        askOf: ASHLEIGH,
        source:
          "Go-live list (ship-date); to-do list; questions for Ashleigh 15",
        blocksLaunch: true,
      },
      {
        key: "delivery",
        question:
          "Which courier, where do we deliver, and what does it cost us and the customer?",
        why: "The delivery prices on the site are stand-ins, and so is delivering anywhere in New Zealand. It needs a courier's quote for a small box of liquid, rural included.",
        askOf: "A courier, for a quote",
        source: "Go-live list (shipping-rates); to-do list",
        blocksLaunch: true,
      },
      {
        key: "fine-print",
        question:
          "Have you read the delivery, returns, terms and privacy pages on the site, and do you agree to what they promise?",
        why: "They promise a replacement or the money back if an order arrives damaged, and the money back on a pre-order cancelled before it ships. They are your promises to make.",
        askOf: BUSINESS,
        source: "Go-live list (returns-promises); to-do list",
        blocksLaunch: true,
      },
      {
        key: "stickers",
        question: "Are the stickers and any merchandise given away, or sold?",
        why: "If they are sold they are products, with prices and stock. If they are given away they are a cost on every order in the Budget.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 17",
        blocksLaunch: false,
      },
    ],
  },
  {
    topic: "The business",
    questions: [
      {
        key: "legal-entity",
        question:
          "What is the legal entity behind the store: its name, its New Zealand Business Number and its address?",
        why: "The terms of sale name no seller yet, the label needs a name and address, and the bank and Stripe will both ask.",
        askOf: BUSINESS,
        source:
          "Go-live list (legal-entity); to-do list; questions for Ashleigh 12",
        blocksLaunch: true,
      },
      {
        key: "gst",
        question: "Is the business registered for GST in New Zealand?",
        why: "Receipts cannot show GST until this is known, and the Budget works its sums both ways until it is. Nothing assumes either answer.",
        askOf: BUSINESS,
        source: "Go-live list (legal-entity); to-do list",
        blocksLaunch: true,
      },
      {
        key: "stripe",
        question:
          "Is there a Stripe account in the business's name, with a bank account for it to pay into?",
        why: "Stripe is the chosen way to take payment. Until its keys are connected the checkout charges nobody.",
        askOf: BUSINESS,
        source: "To-do list",
        blocksLaunch: true,
      },
      {
        key: "contact-email",
        question: "What is the customer email address?",
        why: "The policies and the questions on the site leave a gap where it goes, and customers need somewhere to write.",
        askOf: BUSINESS,
        source: "Go-live list (contact-email); to-do list",
        blocksLaunch: true,
      },
      {
        key: "domain",
        question: "What is the domain name?",
        why: "The customer email address and email in the back end both hang off it.",
        askOf: BUSINESS,
        source: "To-do list",
        blocksLaunch: false,
      },
      {
        key: "xero",
        question: "Is Xero set up, and who is the accountant?",
        why: "Accounting is not done in the back end. The month-end sheet assumes Xero and an accountant.",
        askOf: BUSINESS,
        source: "How-to sheets",
        blocksLaunch: false,
      },
    ],
  },
  {
    topic: "Making and sending",
    questions: [
      {
        key: "first-batch",
        question:
          "How many shots are in the first batch, and when is production day?",
        why: "It sets the ship date, how much packaging to order and how much money is tied up before the first sale.",
        askOf: ASHLEIGH,
        source: "Business plan",
        blocksLaunch: false,
      },
      {
        key: "suppliers-costs",
        question:
          "Who supplies the juice or its ingredients, the bottles, caps, labels and cartons, and what does each cost?",
        why: "Every line on the Budget is a blank until there are real quotes. Lead times decide how early to order.",
        askOf: ASHLEIGH,
        source: "Budget",
        blocksLaunch: false,
      },
      {
        key: "packing-setup",
        question:
          "Who packs and sends orders, where is stock kept, and what box does each pack go in?",
        why: "The packing sheet has blanks for the box, the padding and where slips are filed.",
        askOf: ASHLEIGH,
        source: "How-to sheets",
        blocksLaunch: false,
      },
      {
        key: "box-weight",
        question:
          "What does a packed box weigh, for each pack size, and how big is it?",
        why: "A courier charges by weight and size. The file the Courier screen makes for the courier's website leaves both out until they are known, so they are typed in on the courier's site each time.",
        askOf: ASHLEIGH,
        source: "Courier screen",
        blocksLaunch: false,
      },
    ],
  },
  {
    topic: "The claim lines",
    questions: [
      {
        key: "claim-line",
        question:
          "What happens to the lead line from the concept deck, the one that says what the product does and how fast?",
        why: "It cannot go on the site, the pack or an ad in New Zealand, because a food may not be sold on what it does to a body. The site is built without it. If anyone wants it back, that is a conversation with a food lawyer or MPI first. Until you say otherwise, it stays out.",
        askOf: ASHLEIGH,
        source: "To-do list; questions for Ashleigh 21",
        blocksLaunch: false,
      },
      {
        key: "claim-owner",
        question:
          "Who signs off anything that could be read as a claim about the product?",
        why: "No ad, pack or product page should go out without one named person having checked it. Today that is nobody.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 20",
        blocksLaunch: false,
      },
      {
        key: "claim-other-lines",
        question:
          'Two softer lines from the deck are also held back: the title with the word "performance" in it, and the one that ends "for the quads". Keep them out, or get advice on them? And what does "the quads" mean to you: a part of the leg, a name for your people, or both?',
        why: "Next to a food, both lean towards saying what it does. If the quads is a name for your people it could be used that way. If it is a part of the body it stays out.",
        askOf: ASHLEIGH,
        source: "To-do list; questions for Ashleigh 7 and 24",
        blocksLaunch: false,
      },
      {
        key: "story-sentences",
        question:
          "Are you happy for your Meet Lucky story to run without the two sentences about the body holding a player back?",
        why: "On a page that sells the product they set up a claim, so the site leaves them out. They are your words, so it is your call to confirm.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 22",
        blocksLaunch: false,
      },
      {
        key: "lucky-title",
        question:
          'Lucky\'s full title in your file ends in "with Pickle Power". Are you happy with "Lucky, the superhero cat" until there is advice on it?',
        why: "Next to a food, the word power can read as a claim about what it gives you.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 23",
        blocksLaunch: false,
      },
    ],
  },
  {
    topic: "Who it is for",
    questions: [
      {
        key: "audience",
        question:
          'Who is it really for? Is "people with a game-day ritual" right, and which sports come first?',
        why: "Every word on the site assumes club and weekend players. If the real buyers are someone else, the words and the channels change.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 6 and 8",
        blocksLaunch: false,
      },
      {
        key: "channels",
        question:
          "Beyond the website, what comes next: clubs and teams, events, shops? In what order?",
        why: "The marketing plan guesses clubs first, then events. Shops would need wholesale prices and another look at the label.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 14",
        blocksLaunch: false,
      },
      {
        key: "named-partners",
        question:
          "Which clubs, events or stockists may we name in public, and is their permission in writing?",
        why: "Nobody is named without written permission on file. Today the answer is nobody.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 16",
        blocksLaunch: false,
      },
      {
        key: "research",
        question:
          "Do you want the small round of research run: eight to twelve chats with people who play, and a table at one event?",
        why: "Who it is for is a guess until someone is asked. This is the cheap way to check before money goes into packaging and ads.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 18",
        blocksLaunch: false,
      },
      {
        key: "local-competitors",
        question:
          "Which other pickle juice products, or anything like them, do you know of on sale in New Zealand?",
        why: "The brand pack's desk look found none made here, which may only mean they are not easy to find online.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 19",
        blocksLaunch: false,
      },
    ],
  },
  {
    topic: "Brand and voice",
    questions: [
      {
        key: "brand-idea",
        question:
          "Do you approve the brand idea (a ritual and a lucky charm) and the six checks in the brand guide?",
        why: "Everything on the site is built on them. They are in the brand guide in the back end, ready for you to change.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 1 to 3",
        blocksLaunch: false,
      },
      {
        key: "lead-line",
        question:
          'Are you happy with "A little shot of good luck." leading the site, and "Never fear, Lucky is here." signing off Meet Lucky?',
        why: "The first is cut from your own sentence. The brand pack's proposal led with Never fear instead. It is your line either way.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 4",
        blocksLaunch: false,
      },
      {
        key: "umbrella-name",
        question:
          "Should Pickled Jews appear on the pack or the site, and in what words?",
        why: "Until you decide, it appears nowhere a customer can see.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 5",
        blocksLaunch: false,
      },
      {
        key: "te-reo",
        question: "May we use te reo Māori greetings in replies and posts?",
        why: "It is a choice about how the brand speaks to New Zealanders, and it needs care in use.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 27",
        blocksLaunch: false,
      },
      {
        key: "emoji",
        question: "One emoji at most in a caption, with the pickle allowed?",
        why: "A small rule that makes the feed recognisable.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 28",
        blocksLaunch: false,
      },
    ],
  },
  {
    topic: "Lucky",
    questions: [
      {
        key: "lucky-poses",
        question:
          "Do you approve the two extra Lucky poses in use: celebrating (order placed) and asleep (empty jar, page not found)?",
        why: "Both were generated from your art, not drawn by you. If you say no, they come out in one line each.",
        askOf: ASHLEIGH,
        source: "To-do list; questions for Ashleigh 30",
        blocksLaunch: false,
      },
      {
        key: "lucky-credit",
        question:
          "Would you like a credit for Lucky and the logo anywhere on the site or the pack?",
        why: "They are yours. Whether and how that is said is up to you.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 13",
        blocksLaunch: false,
      },
    ],
  },
  {
    topic: "Trade marks",
    questions: [
      {
        key: "trade-marks",
        question:
          "Are Quick Pickle, the logo, Lucky and Pickle Crew registered or applied for as trade marks in New Zealand, and in whose name?",
        why: "No trade mark symbol goes anywhere until this is known. It is also the check that nobody else already has the name.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 25",
        blocksLaunch: false,
      },
    ],
  },
  {
    topic: "Customers",
    questions: [
      {
        key: "care-replies",
        question: "Who answers customers, and how are replies signed?",
        why: "The replies on the how-to sheets end with a name. Decide whose.",
        askOf: ASHLEIGH,
        source: "Questions for Ashleigh 26",
        blocksLaunch: false,
      },
      {
        key: "comment-moderation",
        question:
          "Who watches the comments on our social pages, and do we hide ones that say what it did to someone's body?",
        why: "A claim sitting on our own page may count as ours. The sheet says hide until you have decided.",
        askOf: ASHLEIGH,
        source: "How-to sheets",
        blocksLaunch: false,
      },
    ],
  },
  {
    topic: "Site and hosting",
    questions: [
      {
        key: "own-accounts",
        question:
          "Has Quick Pickle finished moving to its own hosting and database accounts, and has the first owner sign-in been made?",
        why: "Real orders need a real database. Until one is connected the back end runs on made-up records and the shop cannot keep an order.",
        askOf: SAM,
        source: "To-do list; go-live list",
        blocksLaunch: true,
      },
      {
        key: "hosting-plan",
        question: "Vercel Pro, or move the hosting to Cloudflare?",
        why: "The free hosting plan is for personal projects, not a business's shop. One or the other has to be in place before the shop opens to the public. In November 2026 Vercel Pro was US$20 a month with nothing to move, and Cloudflare US$5 a month with the site moved and tested again.",
        askOf: SAM,
        source: "To-do list",
        blocksLaunch: true,
      },
      {
        key: "email-service",
        question: "Is email set up for the business's own domain?",
        why: "Order emails, the inbox and the Pickle Crew emails all need it. The plan is Resend to start with, and it needs the domain first.",
        askOf: SAM,
        source: "To-do list",
        blocksLaunch: false,
      },
      {
        key: "automation-tokens",
        question:
          "Are the two access tokens in place, so the repository's own automation can run the database and the hosting?",
        why: "Without them those jobs are done by hand.",
        askOf: SAM,
        source: "To-do list",
        blocksLaunch: false,
      },
      {
        key: "open-to-search",
        question: "Is anything left to do before the site opens to search?",
        why: "It opens by itself once every stand-in fact on the go-live list is settled. One build check is switched back on at the same time.",
        askOf: SAM,
        source: "To-do list",
        blocksLaunch: false,
      },
    ],
  },
];

export const STARTER_QUESTIONS: readonly StarterQuestion[] = TOPICS.flatMap(
  ({ topic, questions }) =>
    questions.map((question) => ({ ...question, topic })),
);
