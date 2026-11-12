/**
 * The starter plans: the business plan, the marketing plan and the launch
 * checklist.
 *
 * Drafts for the owner to argue with. They state only what was known on
 * 12 November 2026 and mark the rest as an assumption, a blank or a question.
 * One paragraph per line: in these documents a line break is a line break.
 */

import {
  HEALTH_CLAIMS,
  HEALTH_QUESTION,
  HEALTH_QUESTION_SLUG,
  LINK,
} from "./terms";
import type { StarterDocument } from "./types";

const businessPlan: StarterDocument = {
  slug: "business-plan",
  title: "Business plan",
  kind: "plan",
  summary:
    "What we sell and to whom, what has to be true for it to work, the first 90 days and the risks.",
  sort: 10,
  body: `**What this is:** the working plan for Quick Pickle on a few pages. It is a draft to argue with, not a finished document. Anything marked *Assumption* has not been checked yet.

*Starter draft, written from what was known on 12 November 2026. Rewrite it as you learn. Every save is kept in the history, so nothing is lost by changing it.*

## What we sell

Quick Pickle is pickle juice in a shot. The juice is clear and there are no pickles in the bottle. It comes in a 100 ml clear plastic bottle with a white screw cap.

We sell it direct, online, to addresses in New Zealand. Every price and cost in this plan is in New Zealand dollars.

Packs of 6, 12 and 24 are planned. Their names and prices on the site are stand-ins until you confirm them.

What we are really selling is four things, and only these four:

- **The taste.** Sour, salty, properly pickly. Everyone pulls the face.
- **The tiny bottle.** One twist, down in one. It lives in the kit bag.
- **The ritual.** Before the whistle, at the half, on the sideline with the oranges.
- **Lucky.** The superhero cat who comes with every shot.

## Who it is for

*Assumption.* People with a game-day ritual: club players, weekend runners, social-grade netballers, the parent running the sideline. They buy it because it tastes like something and is fun to hand round the team.

*Assumption.* The person who buys is often buying for more than themselves: a captain, a coach, a manager or a parent. That is who the 24 pack is for.

Nobody has tested either of these with real people yet. The [marketing plan](${LINK.doc("marketing-plan")}) says how to test them cheaply.

## How we sell it

- From our own site and our own checkout. No marketplace and no retailer to start with.
- Payments will go through Stripe, once there is an account in the business's name.
- A courier takes it to the door. The delivery prices on the site are stand-ins until a courier quotes.
- The site is built but not launched. Today the checkout is in test mode: it records an order and charges nobody.
- *Not decided:* whether the first sale is a pre-order for a first batch, or stock on the shelf. The site is set up as a pre-order for now.

## What has to be true for this to work

A plan is a list of bets. These are ours. Each one stays an assumption until there is a number or an answer beside it.

1. **People like it enough to buy it twice.** A first order can be curiosity. A second order is the business. *How we will know:* the [Customers](${LINK.customers}) screen shows how many orders each customer has placed.
2. **A pack leaves money after everything.** After the juice, bottle, cap, label, carton, courier and card fee, there is enough left on each pack to pay the monthly costs and to find the next customer. *How we will know:* the [Budget](${LINK.budget}), once real costs are in it. Today every cost there is a blank.
3. **We can make it safely, and the same every time.** A registered food plan, a label that has been checked, and a batch record for every production day. *How we will know:* nothing under Making food or The label on the [compliance checklist](${LINK.compliance}) is still waiting.
4. **We can sell it without saying what it does to a body.** *How we will know:* people buy from a page that only talks about the taste, the bottle, the ritual and Lucky.
5. **We can reach buyers cheaply.** Clubs, teams, events, the Pickle Crew list and word of mouth, without paying for every sale with advertising. *How we will know:* where each order came from, and what it cost to get.
6. **It arrives in one piece.** A plastic bottle of liquid has to survive a courier. *How we will know:* send test parcels to yourself and to a rural address before the first real order, then count how many real orders arrive damaged.

## The first 90 days

*Assumption: the clock starts on the day the questions that hold up launch are answered. Nothing below has a date on purpose.*

The step-by-step version is the [launch checklist](${LINK.doc("launch-checklist")}).

**Days 1 to 30: real answers and real numbers.**

- Answer the [questions that hold up launch](${LINK.questions}).
- Find out which food plan applies, and register.
- Settle the recipe, the label wording and the date mark with whoever makes it.
- Get real quotes for juice, bottles, caps, labels, cartons and the courier. Put each one in the Budget.
- Set up the legal entity, the bank account, Stripe and the customer email address.
- Set prices once the Budget shows what a pack costs.

**Days 31 to 60: a small first batch and a quiet launch.**

- Make the first batch, with a complete batch record.
- Send test parcels. Fix the packaging if anything leaks.
- Open to the Pickle Crew list and to people you know first. Small enough that a mistake is cheap.
- Pack and send every order yourself from the packing sheet, and fix the sheet where it is wrong.
- Ask every early customer one thing: would you order again?

**Days 61 to 90: learn, then decide.**

- Look at the numbers below.
- Try one or two channels from the marketing plan properly, one at a time.
- Decide: make a second batch the same, change something first, or stop. Stopping after one small batch is a fine result if the numbers say so.

## The numbers that matter

Keep it to a handful.

| Number | Where it lives |
| --- | --- |
| What is left on each pack after costs | Budget |
| Packs a month needed to cover the monthly costs | Budget, under Break-even |
| Orders, and money in | Orders |
| Customers who have ordered more than once | Customers |
| People on the Pickle Crew list | Today |
| Orders that went wrong: damaged, missing, complaints | Notes on the order, and Tasks |

Accounting is not done here. Sales, costs and tax are for Xero and your accountant. The Budget is for setting prices and seeing whether a pack pays for itself. It is not the books.

## Risks

**The big one: in New Zealand a food cannot be sold on what it does to a body.** That covers the label, the site, emails, captions, replies to customers and anything a stockist says for us. *Assumption, from a desk look at other brands' websites and not checked by us:* other pickle juice brands lean on exactly those claims. We do not, and cannot. So the brand sells the taste, the tiny bottle, the ritual and Lucky. Every word that goes out is checked against the copy rules, and there is a sheet for the day a customer asks: [How to answer a ${HEALTH_QUESTION}](${LINK.doc(HEALTH_QUESTION_SLUG)}). The short name for this rule is "no ${HEALTH_CLAIMS}".

The others, in the order they are likely to bite:

- **Food safety.** One bad batch can end a small food business. The answer is boring: a registered plan, a batch record every time, and a recall sheet you have read before you need it.
- **The label.** A label that misses something means a reprint, or worse. Have it checked before printing a large run.
- **The sums.** Small bottles of liquid are heavy for their price, and couriers usually charge by size and weight. Delivery may eat what is left on the small packs. The Budget will show it once the courier's quote is in.
- **Leaks and breakages in the post.** Test parcels first.
- **One person.** If you are away, nothing ships. The how-to sheets exist so someone else can pack an order or run a production day from the page.
- **Supply.** One supplier for bottles or juice means one thing going wrong stops everything. Know the lead time and the second choice.
- **Shelf life.** *Not known yet.* Until it is, do not make more than you can sell well inside it.
- **The name and the cat.** Check that the name is free to use, and decide whether to register it and Lucky as trade marks.

## What is not decided yet

The open questions are on the [Questions](${LINK.questions}) screen. The ones marked as holding up launch have to be answered before the site can take money. The big groups are the product facts (recipe, label, shelf life, where it is made), the offer (packs, prices, delivery), the business itself (legal entity, GST, bank, Stripe) and the claim lines from the concept deck.`,
};

const marketingPlan: StarterDocument = {
  slug: "marketing-plan",
  title: "Marketing plan",
  kind: "plan",
  summary:
    "Who it is for (to test), what we are allowed to say, the first channels, a 12-week calendar and the rules.",
  sort: 20,
  body: `**What this is:** how we plan to find the first customers, what we are allowed to say, and a 12-week launch calendar. Every "who" in it is a guess until it has been tested.

*Starter draft, written from what was known on 12 November 2026.*

## Who it is for

All three are assumptions to test, not findings. Nobody has been asked yet.

1. **The player with a ritual.** *Assumption:* club and weekend players who do the same things before every game and are a bit proud of it. They would add a sour shot to that routine for the fun of it, and hand them round.
2. **The person who buys for the team.** *Assumption:* captains, coaches, managers and sideline parents buy the big pack and bring it to the game.
3. **The gift buyer.** *Assumption:* someone after a small, funny present for the sporty person in their life. Lucky and the stickers do the work here.

**How to test them cheaply, before spending on anything:**

- Talk to eight to twelve people who play club sport. Ask what they do before a game, what is in their kit bag, and what they would say to a teammate about a pickle shot. Ask about the routine and the taste. Do not ask about their body, and do not write down anything they say about it as a selling point.
- Take a tray to one club night. Watch who picks one up, who pulls the face, and who asks where to buy.
- Ask every early customer how they heard about us and who it was for.

Free samples are food too. Look at Samples and events on the [compliance checklist](${LINK.compliance}) before handing any out.

## The message we are allowed to use, and why

Quick Pickle is a food. In New Zealand a food cannot be advertised on what it does to a body, so we never say what it does. We say:

| We talk about | For example |
| --- | --- |
| The taste | Sour, salty, properly pickly. Everyone pulls the face. |
| The tiny bottle | One twist, down in one. It lives in the kit bag. |
| The ritual | Before the whistle. At the half. On the sideline with the oranges. |
| Lucky | Part cat, all cape. Turns up to every game. |

Say **when** people have one. Never say **why**, or what happens next.

The full voice, the lines that are yours and the lines that are never used are in the [brand guide](${LINK.brand}).

## Channels worth trying first

One at a time, smallest first. A tiny brand cannot do five things well.

1. **The Pickle Crew email list.** People who asked to hear from us. It is the only audience we own. Sign-ups come from the site and the checkout. Use it for the launch and for each new batch, and for nothing in between that is not worth opening. *Costs:* the email service.
2. **Instagram and TikTok.** Short videos of the face people pull, Lucky, the ritual, the bottle. Posted by hand. *Costs:* time. No paying to push a post until the unpaid ones show what people like.
3. **Clubs and teams.** One club at a time, starting with one you know. A box for the team in exchange for honest opinions, then an easy way to reorder.
4. **Events and sampling.** A table at a club day, a tournament or a market, with shots to try, stickers and a card with a code that opens the site. *Costs:* stock, a banner, a day.
5. **Word of mouth.** Make it easy: a sticker in every order, a pack that is made to hand round, and a reason to tell a teammate. It is the cheapest channel and the only one that grows by itself.

Not yet: paid advertising, retailers and wholesale, and paying anyone to post. Each can wait until the numbers under What to measure look worth multiplying.

## A 12-week launch calendar

*Assumption: week 1 is the week the questions holding up launch are answered and the first batch has a date. Move the whole calendar if that week moves.*

| Week | What happens |
| --- | --- |
| 1 | Pick the launch date. Write the three emails: it is coming, it is here, last call for this batch. Photograph the real bottle. |
| 2 | Tell the Pickle Crew list a date is coming. Start posting: one post about Lucky, one about the face. |
| 3 | Talk to people who play (the eight to twelve chats). Line up the first club. |
| 4 | Send test parcels to yourself and two friends, one of them rural. Film one being opened. |
| 5 | Quiet launch: open to the Pickle Crew list and people you know. |
| 6 | Pack and send. Ask each customer how they heard and who it was for. |
| 7 | First club night with samples. Take photos, with permission. |
| 8 | Public launch post. Second email to the list. |
| 9 | Second club, or the first event table. |
| 10 | Look at the numbers. Which channel brought orders? Drop the weakest. |
| 11 | Ask the first customers for a review. Read every one before it goes anywhere. |
| 12 | Decide on the next batch: the same, changed, or bigger. Write what you learned into this document. |

## What to measure

Only what you will act on.

- **Orders, and where they came from.** Ask in the follow-up email until there is tracking you trust.
- **Second orders.** The share of customers who come back. This is the number that says whether there is a business.
- **Pickle Crew sign-ups,** and how many of them buy.
- **What it costs to get a customer.** What you spent on a channel, divided by the new customers it brought. Compare it with what a pack leaves on the [Budget](${LINK.budget}).
- **What people say about the taste,** in their own words. Keep a list.

## The rules

1. **Nothing about what it does to a body.** Not on the label, the site, an ad, a caption, a hashtag, a reply or a sticker. Not as a joke, and not by hinting. This is the "no ${HEALTH_CLAIMS}" rule, and there is [a sheet](${LINK.doc(HEALTH_QUESTION_SLUG)}) for when a customer asks.
2. **Email needs consent.** Only email people who signed up. Say who it is from. Every marketing email carries an unsubscribe that works, and people who leave stay off. Order emails (a receipt, a delivery update) carry no promotion.
3. **Nobody is named without written permission.** No club, team, event, stockist, player or customer is named, quoted, tagged or pictured until they have said yes in writing and it is on file. See [Naming people](${LINK.doc("policy-naming-people")}).
4. **Reviews that describe a body effect are not published.** A customer may say what they like on their own account. The moment we repost, quote or pin it, it is ours. See [Reviews](${LINK.doc("policy-reviews")}).
5. **Nothing made up.** No invented reviews, numbers or countdowns. Facts about the product (what is in it, where it is made, how long it keeps) are stated only once you have confirmed them.
6. **Paid or gifted posts say so.** If anyone is paid, or given product, to post about us, the post makes that clear.`,
};

const launchChecklist: StarterDocument = {
  slug: "launch-checklist",
  title: "Launch checklist",
  kind: "plan",
  summary:
    "Every step from here to the first real order at a customer's door, in order.",
  sort: 30,
  body: `**What this is:** every step between today and the first real order arriving at a customer's door, in an order that makes sense. Print it and tick it, or work down it on your phone. The [go-live list](${LINK.goLive}) is the live version of the facts the site itself is waiting on.

*Starter draft. The order is a suggestion. Delete the steps you have already done.*

## 1. Decide

1. [ ] Answer the [questions holding up launch](${LINK.questions}). Start with who makes it and where: most of the other answers hang off that.
2. [ ] Decide whether the first sale is a pre-order or stock on the shelf.
3. [ ] Decide who does what: who makes, who packs, who answers customers, who does the books.

## 2. Check the rules

*A short list to work through with the bodies named on the [compliance checklist](${LINK.compliance}). None of it is legal advice.*

4. [ ] Find out which food plan applies in New Zealand and register. Ask MPI or your council.
5. [ ] Settle the legal entity and get its New Zealand Business Number.
6. [ ] Decide about GST with an accountant. Do not assume either way.
7. [ ] Check the name is free to use.
8. [ ] Read the site's delivery, returns, terms and privacy pages. Agree to what they promise, or have them changed.

## 3. Get the real numbers

9. [ ] Get quotes for juice, bottles, caps, labels and cartons.
10. [ ] Get a courier quote for each pack size, to a town address and a rural one.
11. [ ] Put every quote into the [Budget](${LINK.budget}) and mark it confirmed.
12. [ ] Set the pack prices and the delivery charges from what the Budget shows. Prices on the site are changed in the site's own files for now, so tell Sam.
13. [ ] Look at the break-even. Is it a number of packs you believe you can sell?

## 4. Get the product ready

14. [ ] The final recipe, ingredients list and nutrition panel, from whoever makes it.
15. [ ] The shelf life, the date mark and the storage line.
16. [ ] Label artwork checked against The label on the compliance checklist, then printed.
17. [ ] One straight-on photo of the finished bottle on plain card, for the site.
18. [ ] Packaging chosen and tested: post parcels to yourself and to a rural address.
19. [ ] Fill in the blanks on the [production day](${LINK.doc("how-to-production-day")}) and [packing](${LINK.doc("how-to-pack-an-order")}) sheets.
20. [ ] Read the [recall sheet](${LINK.doc("how-to-recall")}) once, start to finish, and fill in its blanks.

## 5. Get the business ready

21. [ ] A bank account in the business's name.
22. [ ] A Stripe account in the business's name. Test keys first, live keys at launch. Sam connects them.
23. [ ] The domain name and the customer email address.
24. [ ] Xero set up, and an accountant who knows it is coming.
25. [ ] Insurance: ask a broker. It is not required by law, but some events and stockists ask for it.
26. [ ] The site moved to its own hosting and database accounts, on a plan that allows a business to take money. This one is Sam's.

## 6. Make the first batch

27. [ ] Production day, with a complete batch record.
28. [ ] Release the batch for sale only when every check in your food plan is done and written down.

## 7. Open quietly

29. [ ] Every line on the [go-live list](${LINK.goLive}) is settled. The site then opens itself to search.
30. [ ] Place one real order yourself, with a real card, to a real address. Refund it afterwards.
31. [ ] Tell the Pickle Crew list first. Then people you know.
32. [ ] Pack and send every order from the packing sheet.
33. [ ] After a week, ask what went wrong and fix the sheets. Then go wider, following the [marketing plan](${LINK.doc("marketing-plan")}).`,
};

export const STARTER_PLANS: readonly StarterDocument[] = [
  businessPlan,
  marketingPlan,
  launchChecklist,
];
