/**
 * The starter how-to sheets: numbered checklists to follow on the day.
 *
 * Each is a frame, not a finished procedure. Where the real answer depends on
 * something not yet known (the packaging, the courier, the registered food
 * plan), the sheet leaves a blank to fill in. No food-safety figure is given
 * anywhere: no temperature, no time, no acidity. Those come from the
 * registered food plan, word for word, and from nowhere else.
 *
 * One paragraph per line: in these documents a line break is a line break.
 */

import {
  HEALTH_CLAIMS,
  HEALTH_QUESTION,
  HEALTH_QUESTION_SLUG,
  LINK,
} from "./terms";
import type { StarterDocument } from "./types";

const packAnOrder: StarterDocument = {
  slug: "how-to-pack-an-order",
  title: "How to pack an order",
  kind: "how-to",
  summary: "From the packing queue to the courier, one order at a time.",
  sort: 10,
  body: `**What this is:** the steps for packing one order, from the queue to the courier. Follow it top to bottom. Where a step is wrong for how you really work, change the sheet.

*Starter draft. The blanks (____) are for you to fill in once the packaging and the courier are chosen.*

Before you start: clean, dry hands and a clear bench.

## Before you pack

1. [ ] Open [Orders](${LINK.orders}) and look at **To pack**. Start with the oldest.
2. [ ] Open the order. Check it says **To pack**. If it says **Awaiting payment** or **Test**, do not pack it.
3. [ ] Open its **Packing slip**. Print it, or keep it open on your phone.
4. [ ] Read the address once. If it looks wrong or half finished, stop and ask the customer before packing.

## Pack it

5. [ ] Count out the shots the slip says. Count again as they go into the box.
6. [ ] Look at every bottle: cap tight, nothing leaking, label straight and readable, date mark and batch code there.
7. [ ] Check the date. Do not send a bottle that is past its date, or closer to it than your own rule allows: ____.
8. [ ] Note the batch code on the bottles, so the order can be traced to its batch. Until batches are tracked in the back end, add a note on the order: "Batch ____".
9. [ ] Pack so that nothing rattles. Box size and padding: ____.
10. [ ] Add the sticker or card, if there is one: ____.
11. [ ] Seal the box. Stick the courier label on flat, with its barcode clear of any edge.
12. [ ] Check the name on the courier label against the slip.

## Send it

13. [ ] On the order, press **Mark as packed**.
14. [ ] When the courier has it, pick the courier from the list, type the tracking number off the label and press **Mark as shipped**. The link the customer follows is worked out for you. This cannot be undone, so check you are on the right order. With more than a couple of orders, use the [Courier](${LINK.courier}) screen: it gives the courier's website every packed order as one file, and takes the tracking numbers back in one go.
15. [ ] Put the slip in the box, or file it: ____.

## If something is not right

- **A bottle is damaged or leaking.** Put it aside and do not send it. Record it as waste against its batch.
- **Not enough stock.** Do not send part of an order without telling the customer first.
- **A rural address.** The order shows a **Rural** tag. Use the rural service.
- **Anything else.** Add a note on the order, so the next person knows.`,
};

const runTheShop: StarterDocument = {
  slug: "how-to-change-the-shop",
  title:
    "How to change a price, a date or delivery, and how to stop taking orders",
  kind: "how-to",
  summary:
    "What a pack costs, what delivery costs, when a pre-order ships, and the switch that stops orders. All changed in one place, with nobody else needed.",
  sort: 15,
  body: `**What this is:** how to change what the shop sells for, without waiting on anybody. It all lives on one screen: [The shop](${LINK.shop}), under Settings.

*Starter draft. The steps are how the screen works today. The blanks (____) are yours to fill in.*

## Before you change anything

1. [ ] Know the new figure. A price is what a customer pays for the whole pack. Delivery is for one order.
2. [ ] If it is a price, look at the [budget](${LINK.budget}) first. It shows what is left of each pack at the price you have in mind.

## Change it

3. [ ] Open [The shop](${LINK.shop}) and type the new figure in its box. Leave everything else alone.
4. [ ] Press **See what changes**. Nothing is saved yet. The screen reads the change back in plain words, like "The Trial from $27 to $30".
5. [ ] Read it. If a digit slipped, this is where you catch it. Fix the box and press **Check again**.
6. [ ] Press **Change the shop**. It is live for every customer from that moment, and the site shows it within a minute.
7. [ ] Open the shop and look. The link is at the bottom of the screen.

## What each thing does

- **Prices.** The savings and the price for each shot on the page are worked out from them, so there is nothing else to update. A bigger pack has to cost more than a smaller one.
- **Standard delivery.** One rate for an order, anywhere in New Zealand. Set it to 0 and delivery is free for everybody.
- **Extra for a rural address.** Added on top. Set it to 0 and the checkout stops asking whether an address is rural.
- **Free delivery on orders of.** The order value that earns free delivery. Leave it empty and no order gets it.
- **Pre-orders ship from.** Leave it empty until the date is certain. The site says the date is to be confirmed and never guesses one.
- **Pre-order or live.** Pre-order means people pay now and it ships when the batch is ready. Switch to live when it is on the shelf and going out as it is ordered.
- **What this batch is called.** Shown on the page and on receipts while it is a pre-order.
- **The address customers write to.** Shown in the questions, the fine print and on order emails.

## If somebody is paying while you change a price

Nobody is charged a price they were not shown. If a customer is part-way through the checkout when a price or a delivery rate changes, their order is handed back to them with the new total, and they press the button again if they still want it.

## Stop taking orders

8. [ ] On [The shop](${LINK.shop}), choose **No, stop for now**, then check and change as above. Use it when a batch has sold out, or you are away and cannot send anything.
9. [ ] The page says the shop is not taking orders and points people to the Pickle Crew. The checkout takes nothing.
10. [ ] [Today](${LINK.today}) carries a line for as long as it is off, so it is not forgotten.
11. [ ] To start again, choose **Yes, taking orders**. Then tell the Pickle Crew: they were promised first dibs.

## When a pre-order's ship date changes

12. [ ] Set the new date on [The shop](${LINK.shop}).
13. [ ] Tell everybody with a pre-order that has not shipped. The site promises they will hear from you. Under the form on [The shop](${LINK.shop}) a panel says how many have not been told the new date. Press **Email them** and each gets one email with it. [Today](${LINK.today}) shows it until it is done.
14. [ ] If order emails are not connected yet, the panel lists whose orders they are. Write to each yourself. Who does it: ____.

## Saying a figure is right

Changing a figure does not confirm it. While any fact about the shop is still a stand-in, the site stays out of search engines. When the prices, the delivery rates, the ship date and the contact address are the real ones, an owner says so on the [go-live list](${LINK.goLive}), one at a time. Their name goes beside each.

## What is on the label, and who the company is

These are on their own screen: [The label and the company](${LINK.label}), under Settings. It works the same way, with the same two presses.

15. [ ] Have the printed label in your hand. Nothing about what is in the bottle is typed from memory.
16. [ ] Type the ingredients list word for word, then the allergen line and the storage line if the label has them. Leave a box empty and the site says nothing for it. With no allergen line the site says nothing about allergens either way.
17. [ ] Press **See what changes** and read it back against the label, letter by letter.
18. [ ] If the screen asks you to check a word against the printed label, it is one the food rules put on labels themselves (the name for a kind of additive, say) and that would read as a claim anywhere else. Look at the label. If it says exactly that, tick the box and check again. Only a person can tick it, and your name goes beside it.
19. [ ] Press **Change the site**. The list shows on the shop under "What's in it?" within a minute.
20. [ ] For the company: the legal name (the company's registered name, or your own if you trade as yourself), the NZBN if there is one, the address, and whether it is registered for GST. With a GST number in, a receipt says how much of the total is GST. The two numbers are checked as you save them, so a slipped digit is caught.
21. [ ] When both are right, an owner says so on the [go-live list](${LINK.goLive}).

If the label changes (a new recipe, a new supplier), change it here the same day. Who checks the site against each new label: ____.

## The line of words across the top

The line that runs across the very top of the shop has its own screen: [The line across the top](${LINK.topLine}), under Marketing, Landing pages. You do not have to change it. The shop comes with one.

22. [ ] Type the lines, one to a row. Up to 8, each up to 60 letters. Keep them to things that stay true: a date or a price belongs on [The shop](${LINK.shop}), and a special says itself in the line by itself while it is switched on.
23. [ ] Press **Save the draft**. Nothing a customer sees has changed. The preview beside it shows the shop with your words across the top.
24. [ ] Read what the copy check says. Wording about what the drink does to a body cannot be published, here or anywhere.
25. [ ] Press **Publish this line**. The shop shows it within a minute.
26. [ ] To go back, press **Put the standard line back**. Your words are kept as the draft, so they can go up again.`,
};

const productionDay: StarterDocument = {
  slug: "how-to-production-day",
  title: "How to run a production day",
  kind: "how-to",
  summary:
    "What to prepare and what to write in the batch record. The food-safety steps are blanks to fill from your food plan.",
  sort: 20,
  body: `**What this is:** the order of a production day and what to write down. It is a frame. The food-safety steps are blanks on purpose: they come from your registered food plan, word for word, and not from this sheet.

> This sheet does not replace your food plan. Where the two disagree, the plan wins. Fill in every blank (____) from the plan before the first batch, then delete this note.

## The day before

1. [ ] Decide the flavour, the size of the batch and its batch code. One batch is one flavour. The next code is: ____.
2. [ ] Count what is going into it: juice or ingredients, bottles, caps, labels, cartons. Count, do not guess.
3. [ ] Check the labels are the current version, with room for the date mark and the batch code.
4. [ ] Check the supplier's details are on file for everything going into this batch: who it came from, their lot numbers, their dates.
5. [ ] Work out the date mark: made on ____, plus the shelf life in your plan (____), gives ____.
6. [ ] Check the equipment your plan lists is there and working: ____.

## Before you start

7. [ ] Anyone who is unwell stays away from the food today. Your plan says exactly who, and for how long: ____.
8. [ ] Hands, clothing and hair, as your plan says: ____.
9. [ ] Clean the area and the equipment as your plan says: ____. Write down that it was done.
10. [ ] Start the batch record: the date, the batch code, who is working.

## Make it

11. [ ] Write down everything that goes in: what, how much, which supplier, the supplier's lot number.
12. [ ] Follow the recipe and the steps in your plan, in order. Do not change the recipe on the day.
13. [ ] Do the checks your plan requires. Copy them here from the plan, and leave nothing to memory:
    - Check: ____ Limit: ____ Result: ____ Time: ____
    - Check: ____ Limit: ____ Result: ____ Time: ____
    - Check: ____ Limit: ____ Result: ____ Time: ____
14. [ ] If a check is outside its limit, stop. Do what the plan says for that check: ____. Write down what happened and what you did.

## Fill, cap, label

15. [ ] Fill and cap as your plan says: ____.
16. [ ] Label every bottle. Check the first one against the approved label for this flavour: the name, the ingredients, the date mark, the batch code, the storage line.
17. [ ] Check bottles through the run: cap tight, nothing leaking, label straight, code readable. How many and how often: ____.
18. [ ] Count the finished shots. Count what was wasted, and say why.

## Finish

19. [ ] Store the batch as the label says: ____.
20. [ ] Keep samples of the batch if your plan asks for them. How many: ____. Where: ____. How long: ____.
21. [ ] Clean down as your plan says. Write down that it was done.
22. [ ] Finish the batch record: shots made, shots wasted, anything unusual, who signed it off.
23. [ ] Enter the batch in the back end: the flavour, the code, the date made, the date mark, the shots counted. Do not release it for sale until every check in the plan is done and written down.
24. [ ] File the paper record: ____. Your plan says how long records are kept: ____.

## What the batch record holds

Enough to answer two questions about any bottle: what went into it, and where did it go.

- The batch code and the date it was made
- The date mark given to the batch
- Each ingredient, with its supplier and the supplier's lot number
- The bottles, caps and labels used, if your plan asks for them
- Every check the plan requires, with its result, the time and who did it
- Anything that went wrong, and what was done about it
- Shots made and shots wasted
- Who made it and who signed it off

Check this list against your plan. The plan decides what has to be recorded. This is the least that makes a recall possible.`,
};

const damagedOrMissing: StarterDocument = {
  slug: "how-to-damaged-or-missing-order",
  title: "What to do when an order arrives damaged or goes missing",
  kind: "how-to",
  summary:
    "A customer says their order arrived damaged, leaking, wrong, or not at all.",
  sort: 30,
  body: `**What this is:** the steps when a customer says their order arrived damaged, leaking, wrong, or not at all. Problems with the juice itself have their own sheet: [How to handle a complaint](${LINK.doc("how-to-complaint")}).

*Assumption: the promise on the site's Returns page stands as drafted. It says that if an order arrives damaged, faulty or is not what was ordered, we replace it or refund it, the customer chooses, and we cover any cost of getting it back. That promise is still on the list of things for you to agree to. If it changes, change this sheet.*

## Straight away

1. [ ] Reply the same day, even if only to say you are on to it. Say sorry once, plainly.
2. [ ] Find the order. Search [Orders](${LINK.orders}) by name, email or order number.
3. [ ] Ask only for what you need:
   - Damaged or leaking: a photo of the parcel and the bottles, and the batch code on a bottle if they can read it.
   - Wrong items: what arrived.
   - Missing: nothing. You check the tracking.
4. [ ] Do not make the customer wait on the courier. Sort it for them first and claim from the courier afterwards.

## Work out what happened

5. [ ] **Missing.** Open the tracking. If it says delivered, ask the customer to check with the household, the neighbours and around the property. If it has not moved for ____ working days, call it lost.
6. [ ] **Damaged in the post.** It is the courier's doing, but ours to fix for the customer. How to claim from the courier: ____.
7. [ ] **Leaking, or a cap not sealed, with no damage to the box.** That may be a fault from production day, not from the courier. Note the batch code. If a second report comes in for the same batch, stop sending that batch and open the [recall sheet](${LINK.doc("how-to-recall")}) to decide what to do.
8. [ ] **Anything about the juice itself:** its smell, colour or taste, or something in the bottle. Stop. That is a complaint, not a delivery problem. Go to the [complaint sheet](${LINK.doc("how-to-complaint")}).

## Put it right

9. [ ] Offer what the Returns page promises: a replacement or the money back. The customer chooses.
10. [ ] **A replacement.** There is no button for this yet. Pack the replacement by hand, and add a note on the original order saying what was sent and when.
11. [ ] **Money back.** On the order, open **Record a refund** and enter the amount and the reason. For an order paid by card through Stripe the money goes back to the card by itself, and the screen says so before you press. For any other order it is only written down, so send the money back by hand as well.
12. [ ] Tell the customer what you have done and when to expect it.
13. [ ] Do not ask for damaged bottles to be sent back. Ask the customer to throw them away. If you do need one back to look at a fault, you pay the postage.

## Write it down

14. [ ] Add a note on the order: what was wrong, the batch code, what you did.
15. [ ] If stock went out as a replacement, record it against its batch.
16. [ ] Keep a count. Several damaged parcels close together means the packaging needs changing. Several leaks from one batch means that batch needs a hard look.

## The reply

Plain and short. No jokes and no Lucky in this one. Change the details and keep the shape:

> Hi [name], thanks for telling us, and sorry about that. [We are sending a replacement today. / We have sent your money back the way you paid, and it usually shows within five working days.] You do not need to send anything back. [Your name], Quick Pickle

## If a refund comes back

Now and then a refund leaves and the customer's bank cannot put it on the card, because the card has been closed. It can take a couple of weeks to find out. [Today](${LINK.today}) says "A refund came back", and the order shows it as left and come back.

- The customer was told it was on its way, so write to them first.
- Send the money another way. Ask them for a bank account. Sending it to the same card again would only come back again.
- On the order, open **Write down money sent back another way** and enter the amount and how it went. That only writes it down: it sends nothing.`,
};

const complaint: StarterDocument = {
  slug: "how-to-complaint",
  title: "How to handle a complaint",
  kind: "how-to",
  summary:
    "A customer is unhappy with the product itself: how it tasted, looked or smelled, or they felt unwell.",
  sort: 40,
  body: `**What this is:** what to do when a customer is unhappy with the product itself: how it tasted, smelled or looked, something in the bottle, or feeling unwell afterwards. Delivery problems have their own sheet: [damaged or missing orders](${LINK.doc("how-to-damaged-or-missing-order")}).

*Starter draft. Your registered food plan has its own section on what to do when something goes wrong. Where it says more than this sheet, the plan wins.*

## Every complaint

1. [ ] Reply the same day. Thank them for telling you. Do not argue, explain or guess at a cause.
2. [ ] Get the facts and write them on the order as a note:
   - which order, and the batch code and date mark on the bottle
   - what was wrong, in their words
   - when it arrived, when they opened it and how it was kept
   - a photo, if there is something to see
   - whether they still have the bottle. Ask them to keep it, capped, until you say.
3. [ ] Decide which kind it is:
   - **Not to their taste.** It is a sour, salty shot and not everyone likes it. Be kind about it. The Returns page says we do not take food back for a change of mind. A small goodwill gesture is your call: ____.
   - **Something wrong with the product:** an off smell or taste, cloudy when it should be clear, something in the bottle, a broken seal, a wrong or missing label or date. Go to step 4.
   - **They say they were unwell afterwards.** Go to step 4 and then step 7.
   - **They ask what it does for their body, or tell you what it did.** Use [How to answer a ${HEALTH_QUESTION}](${LINK.doc(HEALTH_QUESTION_SLUG)}). Do not agree or disagree.

## If something may be wrong with the product

4. [ ] Find the batch. Look for other complaints or notes about the same batch.
5. [ ] Look at your own stock from that batch, and at the batch record for anything unusual on the day.
6. [ ] Decide today:
   - A one-off, with nothing else wrong: replace or refund as the Returns page promises, and keep watching that batch.
   - Any sign the batch is unsafe or wrongly labelled, or a second complaint like it: stop selling and sending that batch now, and open the [recall sheet](${LINK.doc("how-to-recall")}).
   - Not sure: stop sending that batch while you find out. Ask your verifier or MPI.

## If someone says they were unwell

7. [ ] Take it seriously and do not diagnose. Say you are sorry they are unwell, and that if they are worried they should see their doctor. Do not suggest a cause, and do not say it could not have been the product.
8. [ ] Write down only what they tell you: what they had and when, when they became unwell and how they describe it, whether anyone else who had it was unwell, whether they have seen a doctor. This is personal information. Keep it to the people who need it.
9. [ ] Stop sending that batch until you know more.
10. [ ] Follow the part of your registered food plan about what to do when something goes wrong. It says who you must tell and how soon: ____. If in doubt, ring your verifier or MPI the same day.
11. [ ] If the batch may be unsafe, open the [recall sheet](${LINK.doc("how-to-recall")}).

## Close it

12. [ ] Put it right for the customer: a replacement or the money back, as the Returns page promises.
13. [ ] Write the outcome on the order and, if the product was at fault, against the batch.
14. [ ] If it showed a weakness in how you make, pack or label, change the sheet or the plan so it cannot happen the same way twice.

## Words to keep out of any reply

- Anything about what the product does or does not do to a body.
- "It is perfectly safe" or "that cannot have been us", before you know.
- Blame: the courier, the customer, the supplier.
- Promises you have not checked against the Returns page.`,
};

const cardDispute: StarterDocument = {
  slug: "how-to-card-dispute",
  title: "What to do when a card payment is disputed",
  kind: "how-to",
  summary:
    "A customer's bank has taken a payment back and given the shop a date to answer by.",
  sort: 45,
  body: `**What this is:** the steps when a customer's bank disputes a card payment, sometimes called a chargeback. It is rare. It has a date on it, and missing the date loses the money, so it comes first on the day it arrives.

*Starter draft. A dispute is answered in Stripe's own dashboard, not here. The back end tells you there is one, which order it is about and how it ended. The blanks (____) are for you to fill in.*

## What has happened

A cardholder has told their bank they should not have been charged: they do not recognise the payment, the order never came, or it was not what they expected. The bank takes the money back from the shop straight away, and Stripe charges a fee for the dispute (its price list says how much). You then have until a set date to show the bank the sale was fair. If the bank agrees, the money comes back. If it does not, or nobody answers by the date, the money stays with the cardholder.

## The day it arrives

1. [ ] [Today](${LINK.today}) shows it at the top: which order, how much, the bank's reason and the date to answer by. Open the order. The same is across the top of the order's own page, and under **Money** there.
2. [ ] Read the order's history. Was it packed and sent? Is there a tracking number? Has the customer been in touch?
3. [ ] Do not refund the order while it is disputed. The bank has already taken the money back, and a refund on top could pay it twice.
4. [ ] If it looks like a mix-up and you can reach the customer, write to them. A customer can tell their bank to drop a dispute. Still answer in Stripe by the date: do not wait on them.

## Answer it, in Stripe

5. [ ] Open the dispute in Stripe's dashboard. Under **Money** on the order, **Open the disputes list in Stripe** goes to the list, and the line above it says what Stripe calls this one (it starts with dp_). Who has the login: ____.
6. [ ] Give the bank what shows the sale was fair. What helps depends on the reason:
   - **They say it never arrived:** the tracking number, the courier's page showing it delivered, and the address it went to.
   - **They do not recognise it, or say it was not them:** the order's details as the customer typed them (name, email, delivery address), and any emails with them.
   - **They say it was not as described:** what the page said they were buying, and the returns promise shown on the site.
   - **They say they were charged twice:** show there is one payment for one order. If there really are two, say so.
7. [ ] If the customer is right, say so and accept the dispute in Stripe. It is quicker than losing it slowly.
8. [ ] Send it before the date. An answer can only be sent once, so read it through first.

## Afterwards

9. [ ] Once it is answered, Today stops calling it urgent and says it is with the bank. How long the bank usually takes: ____.
10. [ ] When the bank decides, the order's history says how it ended. Won: the money stays and nothing else changes. Lost: the amount is written on the order as given back, so the order and [For the books](${LINK.books}) are right. There is nothing more to do on the order.
11. [ ] Add a note on the order: what you sent and what you learned.
12. [ ] Two disputes close together for the same reason are worth a hard look. "Never arrived" twice points at the courier or the address form. "Do not recognise it" twice may mean the name on card statements is not one customers know: ask Stripe what it shows.`,
};

const recall: StarterDocument = {
  slug: "how-to-recall",
  title: "How to recall a batch",
  kind: "how-to",
  summary:
    "Who to tell, in what order, and what to keep, when a batch has to come back.",
  sort: 50,
  body: `**What this is:** the order of work when a batch has to come back: who to tell, in what order, and what to keep. Read it now, while nothing is wrong.

> In New Zealand the regulator for food recalls is the Ministry for Primary Industries (MPI). MPI's own recall guidance and your registered food plan govern. This sheet is a checklist to work through beside them, not a substitute. MPI sets how quickly it must be told about a recall. Look that up now and write it here, before you ever need it: ____.

## When to open this sheet

- A batch may be unsafe: something in it that should not be, a check on production day that was missed or failed, a sealing fault.
- A batch is wrongly labelled in a way that matters: an allergen not declared, the wrong date mark, the wrong ingredients list.
- A supplier tells you something they supplied is being recalled.
- MPI or your verifier tells you to.

Not sure whether it is a recall? Stop selling the batch first, then ask MPI or your verifier. Stopping costs a few days. Not stopping can cost far more.

## First: stop it moving

1. [ ] Write down the time. From here on keep a log: what you learned, what you decided, who you told, and when.
2. [ ] Stop selling and sending the batch. Open the batch in the back end and use what its page offers to stop it being packed. Marking a batch as recalled cannot be undone, so do that once you are sure.
3. [ ] Put your own stock from that batch aside, clearly marked "do not send".
4. [ ] If the shop is selling only that batch, stop taking orders. How to pause the shop: ____.
5. [ ] Work out how big it is: how many shots were made, how many are still with you, how many have gone out. The batch record and the batch's page have the numbers.

## Then: tell the people who must know

6. [ ] **MPI.** Tell them in the way, and within the time, their recall guidance sets (see the note at the top). Have ready: what the product is, the batch code and date mark, what is wrong, how many were made and sent, and where they went.
7. [ ] **Your verifier,** if your plan says so.
8. [ ] **Anyone who helped make it:** a contract maker, or the supplier of whatever is at fault, so they can check their side.
9. [ ] **Anyone holding stock:** a stockist or a club. Ask them to stop selling or handing it out, and to tell you how many they hold.
10. [ ] If a public notice is needed, agree its wording with MPI. Do not write your own first.

## Then: tell customers

11. [ ] Open the batch's page and print its **recall list**: every order that had shots from that batch, with the customer's name, email and address.
12. [ ] Contact every customer on the list. Email first, then phone anyone who has not answered after: ____.
13. [ ] The message says, plainly: which product and batch, and where to find the code on the bottle; what is wrong; what to do with it (as agreed with MPI); how they get their money back or a replacement; and how to reach you. No marketing, no jokes, no Lucky.
14. [ ] Tick each customer off the list when they have been told, and again when they have been sorted.

## Afterwards

15. [ ] Account for the whole batch: made, still held, returned, thrown away by customers, not accounted for.
16. [ ] Get rid of returned and held stock as agreed with MPI. Write down how and when.
17. [ ] Refund or replace for every customer affected.
18. [ ] Report back to MPI as their guidance asks.
19. [ ] Find the cause and fix it before making another batch. Update your food plan and these sheets.
20. [ ] Tell your insurer, if you have cover for this.
21. [ ] File the log with the batch record.

## Practise

Your plan may ask for a practice run, and say how often: ____. Even if it does not, try it once before the first big batch. Pick a batch and see how long it takes to produce the list of everyone who received it. That is the number that matters on the day.`,
};

const healthQuestion: StarterDocument = {
  slug: HEALTH_QUESTION_SLUG,
  title: `How to answer a ${HEALTH_QUESTION}`,
  kind: "how-to",
  summary:
    "The one safe reply when someone asks what it does for their body, or tells us what it did.",
  sort: 60,
  body: `**What this is:** the reply to give when someone asks what Quick Pickle does for their body, or tells us what it did. It is the same reply every time, wherever they ask: an email, a comment, a message, or face to face at a table.

## Why there is a sheet for this

Quick Pickle is a food. In New Zealand a food cannot be sold on what it does to a body, and that covers answers as well as adverts: a reply to a customer is us speaking. So we do not answer the question. Not to say yes to something that sounds harmless, and not even if we think we know.

Saying "we are not allowed to tell you" is not safe either. It hints that there is something to tell, and a hint counts.

## What to do

1. [ ] Do not answer the question that was asked. Not yes, not no, not "some people say".
2. [ ] Give the safe reply below. Keep it short and kind.
3. [ ] Stop there. If they ask again, say the same thing again, in the same words.
4. [ ] If they tell you what it did for them, good or bad, do not agree, disagree, thank them for the result or repeat it.
5. [ ] If what they describe sounds like they were unwell after having it, that is a complaint. Open [How to handle a complaint](${LINK.doc("how-to-complaint")}).
6. [ ] Never like, share, pin, quote or screenshot a comment that says what it did for someone. Left on their own account it is theirs. Repeated by us it is ours.
7. [ ] A comment like that on one of our own pages: hide it if the platform lets you, and do not reply with a correction that repeats it. Whether to hide or leave these is still an open question for you: ____.
8. [ ] If the question comes from a journalist, a stockist or anyone who will pass the answer on, give the same reply and nothing more.

## The safe reply

In an email or a message:

> Thanks for asking. Quick Pickle is a food, and we sell it for the taste. We don't make ${HEALTH_CLAIMS} about it, so that one is a question for your doctor or physio.

Shorter, for a comment:

> It's pickle juice, and we sell it for the taste. For anything about your body, your doctor or physio is the one to ask.

Face to face:

> "It's a food. We sell it because it tastes like pickles. Your doctor's the one to ask about that."

## What not to say

| Do not say | Why |
| --- | --- |
| "Yes, lots of people have it for that." | It is a claim. |
| "We can't legally say." | It hints there is something to tell. |
| "Try it and see." | It leaves them to fill in an effect. |
| "Have a look online." | It points them at claims we could not make ourselves. |
| "It's only pickle juice, it can't hurt." | That is a claim too. |

## Questions about what is in it

These are different, and they do get an answer: the exact wording on the label, and nothing added. That covers ingredients and allergens. Until the label is final, say the ingredients list will be published before the first bottle ships. For anything beyond the label, their doctor is the one to ask.

## If you get it wrong

Say so the same day. A reply can usually be edited or taken down. Add a task so the wording gets fixed everywhere it was used.`,
};

const monthEnd: StarterDocument = {
  slug: "how-to-month-end",
  title: "What to hand to Xero and the accountant at month end",
  kind: "how-to",
  summary:
    "The month-end routine: what to pull out of the back end and what goes to Xero and your accountant.",
  sort: 70,
  body: `**What this is:** the month-end routine: what to pull out of the back end, and what to hand to Xero and your accountant. The back end does not do accounting, and is not meant to.

*Assumptions: the business uses Xero and has an accountant or bookkeeper, and payments come through Stripe. Neither is connected to the back end yet, so this is done by hand. All amounts are New Zealand dollars. Go through this routine with your accountant once, and change the sheet to match what they want.*

## In the first week of each month

1. [ ] **Sales.** Open [For the books](${LINK.books}) and press **Last month**. It shows what customers were charged and what was given back, day by day, with test orders and unpaid ones left out. Download both files: by day, and by order. How your accountant wants sales entered in Xero: ____.
2. [ ] **Money received.** From Stripe, download last month's payouts and fees. A payout is usually several sales in one lump, less Stripe's fees. How your accountant wants it entered: ____.
3. [ ] **Match them.** Paid orders, less refunds, less Stripe's fees, should come to what Stripe paid out, allowing for payouts that straddle the end of the month. If it does not, find out why before going on.
4. [ ] **Refunds.** The same screen shows what was given back on each day, and the by-order file shows it against each order. A refund made in Stripe's own dashboard is in there too. Check each one against Stripe's list.
5. [ ] **Bills.** Every supplier invoice and receipt for the month goes into Xero with the paperwork attached: juice or ingredients, bottles, caps, labels, cartons, courier, hosting, email, insurance, fees.
6. [ ] **Courier.** Check the courier's invoice against the orders you sent. Query anything you did not send.
7. [ ] **Bank.** Reconcile the bank account in Xero: every line matched to a sale, a bill or a transfer.
8. [ ] **Stock count.** Count the shots on hand by batch, and the bottles, caps, labels and cartons. Write down the count and the date. Whether your accountant wants this monthly or only at year end: ____.
9. [ ] **Stock written off.** List what was given away as samples and what was thrown away, with the reason.
10. [ ] **GST.** If the business is registered for GST in New Zealand, the return is filed when Inland Revenue says it is due. If it is not registered, look at the last 12 months of sales with your accountant, who will say when registering becomes compulsory. Not sure which applies: ask them.
11. [ ] **Update the [Budget](${LINK.budget})** with any cost that changed: a new courier rate, a new price for bottles. Mark it confirmed if it came from an invoice.
12. [ ] **Look at the month.** Orders, second orders, what a pack really left after costs. Write three lines in the business plan about what you learned.

## At year end

Ask your accountant now what they will want, so it is kept as you go. Usually that is the bank and Stripe records, every invoice, the stock count on the last day of the year, and anything the owner paid for personally or took for themselves.

## How long to keep it all

Ask your accountant how long business records have to be kept in New Zealand, and in what form: ____.`,
};

const weeklyCheck: StarterDocument = {
  slug: "how-to-weekly-check",
  title: "The weekly check",
  kind: "how-to",
  summary:
    "A once-a-week run through orders, stock, customers, money and the plan, from your phone.",
  sort: 80,
  body: `**What this is:** a once-a-week run through the whole business, from your phone. Pick a day and keep to it. When nothing is wrong it is short, which is the point.

*Starter draft. Cross out what does not apply yet and add what you find yourself checking anyway.*

## Orders

1. [ ] Open [Orders](${LINK.orders}). Is anything waiting to be packed that is more than a day old?
2. [ ] Anything packed but not yet with the courier?
3. [ ] Anything shipped more than a week ago and not marked as delivered? Check its tracking.
4. [ ] Any damaged, missing or complaint notes from the week still open? Finish them.

## Stock

5. [ ] How many shots are on hand, and which batch goes out next? The one with the earliest date goes first.
6. [ ] Is any batch getting close to its date? Decide now what happens to it.
7. [ ] Enough bottles, caps, labels and cartons for the next batch? Order now if the lead time says so. Lead times: ____.

## Customers

8. [ ] Any email, message or comment not answered? Answer it today.
9. [ ] Any comment on our pages that says what it did to someone's body? Follow [the sheet](${LINK.doc(HEALTH_QUESTION_SLUG)}).
10. [ ] How many people joined the Pickle Crew list this week?

## Money

11. [ ] Did any cost change this week: a new quote, a courier price rise? Update the [Budget](${LINK.budget}).
12. [ ] Any refund recorded but not yet sent back by hand? Send it.

## The plan

13. [ ] Open [Tasks](${LINK.tasks}). Do what is overdue, or move its date honestly.
14. [ ] Open [Questions](${LINK.questions}). Can you answer one today?
15. [ ] Write one line in the [business plan](${LINK.doc("business-plan")}) about what you learned this week.`,
};

const emailTheCrew: StarterDocument = {
  slug: "how-to-email-the-pickle-crew",
  title: "How to email the Pickle Crew",
  kind: "how-to",
  summary:
    "Writing a campaign, reading it, sending it, and what to do when somebody wants off the list or an email comes back.",
  sort: 82,
  body: `**What this is:** how to send an email to everyone who asked to hear from us. It all lives under Marketing, in [Campaigns](${LINK.campaigns}).

*Starter draft. The steps are how the screens work today. The blanks (____) are yours to fill in.*

## Who gets it

Only people who put their own address into the Pickle Crew form and are still on the list. Buying something puts nobody on it. That is the law here as well as good manners: marketing email goes to people who asked for it, says who it is from, and has a way out that works.

## Write it

1. [ ] Open [Campaigns](${LINK.campaigns}) and press **New campaign**.
2. [ ] Give it a working title (only you see it), choose who it goes to, and write the subject, the preview line and what it says.
3. [ ] Press **Save the draft**. The copy check reads it as you save. Wording that is not allowed has to change before it can go. This is where ${HEALTH_CLAIMS} are caught. Write about the taste, the bottle and Lucky, and nothing about a body.
4. [ ] Read **How it will read**. That is the email as it arrives, with the line saying who we are and the unsubscribe link under it. You do not write those. They are added to every one.

## Approve it

5. [ ] Read every word once more, out loud if it helps. Is every fact in it true today: the price, the date, what is in stock?
6. [ ] Press **Approve it**. Approving says a person has read it and it can go as it stands. It sends nothing.
7. [ ] To change a word after that, press **Back to draft, to edit it**, and approve it again.

## Send it

8. [ ] Press **Send to ... now**. The button says how many people. Or set a day and a time and it starts within a few minutes of then.
9. [ ] It goes out a few dozen at a time, so a long list takes a while. The campaign's page counts them as they go. You do not need to watch it.
10. [ ] Once an email has gone it cannot be called back. **Stop sending** only stops the ones still waiting.
11. [ ] First time: send one while the list is only yourselves. Open it on a phone, then press the unsubscribe link in it and see that it works.

## If it says it cannot send

The campaign's page and [Today](${LINK.today}) say why in a sentence. Nobody is marked as missed: the emails wait, and go by themselves a few minutes after it is put right. Most often email is not connected, or the mail company wants something from us. The [go-live list](${LINK.goLive}) says what is missing.

If the campaign has **stopped itself**, too many emails bounced or were marked as spam. Do not start it again the same day. Find out why first: an old list, or an email people did not expect. Who to ask: ____.

## When somebody wants off the list

- **They press the link in the email.** One press and they are off. Nothing for you to do.
- **They write in, or tell you.** Open [Campaigns](${LINK.campaigns}), open **Somebody asked to come off the list** at the bottom, type their address and press **Take them off the list**. Do it the same day. Then answer them to say it is done.
- **They never want any email from us at all**, not even about an order: that is the [do-not-email list](${LINK.doNotEmail}). Think twice. They will not get a receipt either.

Emails about an order (the receipt, on the courier) are not marketing. They still go to somebody who has left the list.

## When an email comes back

An address that bounces for good, or somebody who marks an email as spam, is taken off by itself and never emailed again. The campaign's page lists them under **Who it went to**. A mailbox that was only full that day stays on the list.

## How often

Only when there is something worth an email: a new batch, the date it ships, the shop opening again. Our rule: no more than ____ a month.`,
};

const workWithClaude: StarterDocument = {
  slug: "how-to-work-with-claude",
  title: "How to connect Claude, and what it can do for you",
  kind: "how-to",
  summary:
    "Connecting your own Claude to the back end, what it may do by itself, and how you say yes to the rest.",
  sort: 85,
  body: `**What this is:** how to let Claude help run the shop. Connected, it can look things up and do the day-to-day when you ask it in plain words. It is switched off until an owner switches it on.

*Starter draft. The steps are how the screens work today. The blanks (____) are yours to fill in.*

## Switch it on and connect yours

1. [ ] An owner opens [Claude](${LINK.claude}), under Settings, and presses **Let Claude be connected**.
2. [ ] In Claude, add a custom connector and give it the address that screen shows.
3. [ ] Claude sends you to a page here to say yes. You have to be signed in. Choose what it may do: **Look**, or **Look and make changes**.
4. [ ] Start with **Look** if you are not sure. You can connect again later and let it do more.

## What it can do by itself

- Read what you can read: orders, customers, stock, the inbox, the numbers, the plans.
- If you let it make changes: add a note to an order, add or finish a task, write a draft, record a count of stock.
- Everything it does is in the activity log under its own name, "Claude, for" and your name.

## What it has to ask you for

Anything that reaches a customer or cannot be undone: sending an email, a refund, a price, a promo code, where an order is sent, the words under your replies, putting a batch on sale, sending a campaign you have approved, deleting something. Claude cannot do these. It can only ask.

5. [ ] When it asks, it gives you a link. [Today](${LINK.today}) shows it too, and so does [Waiting for a yes](${LINK.approvals}).
6. [ ] Open it and read it. It says what would happen in plain words, and shows exactly what Claude handed over, word for word. That is all that will be done.
7. [ ] Press **Yes, do it** or **No**. Yes does it there and then. Nothing you type to Claude in the chat counts as a yes.
8. [ ] If you leave it for a week it lapses, and nothing is done.

## What it can never do

- Publish. Putting a landing page up, approving a campaign or a caption, publishing a review, switching a special on: Claude can write the draft, and you publish it yourself, on its own screen, with the words in front of you.
- Anything only an owner may do: staff accounts, the go-live list, cutting off somebody else's Claude.
- Say an order was paid for, or a refund went through. Those come from the payment processor.
- Confirm what the printed label says. Only a person with the label in hand does that.
- Correct the dates on a batch once it has been made, or say that a second email address belongs to a customer. Those are yours.
- Write a claim about what the product does to a body. The copy rules stop it, the same as they stop anybody.

## Cut it off

9. [ ] On [Claude](${LINK.claude}), press **Cut off** beside the connection. It stops working at once.
10. [ ] An owner can cut off anybody's, or press **Stop Claude connecting** to stop them all.
11. [ ] When somebody leaves, switch off their staff account. Their Claude goes with it.
12. [ ] A new password link for somebody cuts their Claude off as well, and so does a new PIN. Whoever had the old password or PIN may have connected a Claude of their own. They connect theirs again once they are back in.

## Things to know

- Connected, Claude reads customers' names, addresses, emails and orders. What it reads goes to the company that makes Claude, under your own agreement with them. The privacy page says the shop may be run with an AI assistant.
- Who is allowed to connect one: ____.
- What we never ask it to do, even though it could: ____.`,
};

export const STARTER_HOW_TOS: readonly StarterDocument[] = [
  packAnOrder,
  runTheShop,
  productionDay,
  damagedOrMissing,
  complaint,
  cardDispute,
  recall,
  healthQuestion,
  monthEnd,
  weeklyCheck,
  emailTheCrew,
  workWithClaude,
];
