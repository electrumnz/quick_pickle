# Storefront copy — marketing audit

**Read on:** 30 August 2026, from a production build (`NEXT_DIST_DIR=.scratch/next-copyaudit`,
`HALF_SOUR_DEMO=1`, port 4310), rendered HTML, not source.
**Pages read in full:** `/`, `/shop`, `/products/no-01-house`, `/products/no-02-dirty`,
`/products/no-03-smoke`, `/products/no-04-wild`, `/products/the-full-set`, `/recipes`,
`/recipes/dirty-martini`, `/recipes/brine-cured-roast-chicken`, `/wholesale`, `/delivery`,
`/terms`, plus the 404 states.
**Judged against:** `content/strategy/brandscript.ts`, `content/strategy/avatars.ts`,
`brand/brand-guide.md`.
**This is an audit.** No production copy was changed. Every proposed line below is a proposal.

**Not re-audited:** compliance. `legal/scripts/audit-copy.mjs` owns that question and it is
answered — across the whole storefront tree there is **not one banned term**. The scanner does
exit non-zero on the storefront paths, but on seven RESTRICTED flags, which the scanner itself
defines as "allowed, flagged so a human checks context" — and five of the seven are a TypeScript
union of spirit names in `content/types.ts:62`, which is a type declaration and not copy anybody
reads. Nothing in this document is a legal finding.

---

## Verdict

**The words are the best thing this company owns, and they are not converting, because the
storefront is written as a catalogue instead of as an argument.** Page for page this is better
writing than the reference brands publish — `/wholesale`, `/terms`, `/delivery` and all
twenty-five recipe pages are genuinely excellent and several are better than anything the
category has. But the site never picks a fight. The BrandScript names a villain — "the half-empty
olive jar in the fridge door" — and that villain is named for the bar manager, on `/wholesale`,
and never once for the Friday host on `/`, `/shop`, or any product page. The one sentence that
demolishes the jar is written, and it is buried at the bottom of a recipe page four clicks deep
(`content/recipes/dirty.ts:80`). So the site opens with a claim about itself, spends five screens
being calmly excellent, and never tells the person reading it what is wrong with the free thing
already in her fridge door. **The single biggest lever is to promote the jar from the deepest page
on the site to the first sentence of it** — the BrandScript one-liner already exists, is already
audited, and its own dated next action (`one-liner-everywhere`, due 2026-09-15) says to put it in
the header unchanged. It is currently on zero surfaces.

## The reference-brand question, answered directly

The owner's read is that the storefront does not feel better than Good Girl Snacks or Liquid
Death, and wants to know whether the words are part of that. **Mostly they are not, and it would
be dishonest to let this document imply otherwise.**

Neither reference brand is a copy brand. Liquid Death is roughly twelve words of tone per
surface carried by a can that reads as a beer and a film budget; Good Girl Snacks is art
direction, a doodled label and a feed. Their advantage over this site is almost entirely
**pictures** — and `TODO.md` already knows it: real product photography is an open item, every
image service was unreachable during the build, and the storefront is currently selling a
$26 bottle with authored vector art. That is the gap, and no sentence fixes it.

But one part of the gap is the words, and it is a specific part: **both reference brands pick a
fight in their first three words.** Liquid Death's enemy is bland bottled water; Good Girl Snacks'
is the boring pickle. HALF SOUR's enemy is written down in `brandscript.ts` and never reaches a
customer. Confidence without an antagonist reads as a catalogue, and a catalogue is what the
homepage currently is: positioning → serves → range → process → buy, with no problem beat
anywhere in it. That is the copy half of the gap. It is worth fixing on its own, and it is
cheaper than a photoshoot.

Two things that are not copy problems and should not be mistaken for them, because they will eat
whatever the copy earns: **the header cart chip is a `<span>`, not a link**
(`components/product/StoreChrome.tsx:143-148`) and there is no `/cart` route in the build, so a
shopper who adds three bottles has no way to review them; and checkout terminates at "Checkout is
not connected", which is an honest string about the open Shopify-token item in `TODO.md`.

---

## Findings

Severity: **blocking** — costs orders today. **serious** — costs orders at a rate worth
measuring. **friction** — a leak, cheap to plug. **polish** — a craft slip a careful reader sees.

| #   | Sev      | Page                                       | The line, verbatim                                                                                                                                                                                                                                                                                                                    | Costs               | Why it underperforms                                                                                                                                                                                                                                                                                                                                                                                             | Proposed replacement                                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | blocking | `/` hero                                   | "Pickle brine built as an ingredient in its own right — measured, consistent, and good enough to put on a menu." — `components/home/Hero.tsx:174-175`                                                                                                                                                                                 | **The Friday host** | Every clause is about us. "in its own right" is a status claim, "good enough to put on a menu" is a claim about our quality. SB7 says the brand is the guide; this is the brand as hero. She never appears, and neither does her problem.                                                                                                                                                                        | The BrandScript one-liner, unchanged: "Most home martinis are let down by whatever is left in the olive jar. HALF SOUR makes brine built for the glass — so the drink you pour on a Tuesday is the drink you poured on Saturday." (`content/strategy/brandscript.ts` `derived.oneLiner`)                                                                                                  |
| 2   | blocking | `/`, `/shop`, all product pages            | _No line exists._ The jar is named once on the whole storefront, to the trade: "Pour them against the jar you use now at a pre-service line-up." — `components/site/copy.ts:164-166`                                                                                                                                                  | **The Friday host** | Her alternative today is free and already in the fridge door. The site never says what is wrong with it, so it is competing on adjectives against zero dollars. The demolition sentence is already written and sits four clicks deep: "The reason a house dirty martini usually goes cloudy is that bars use olive jar water, which carries suspended solids and a lactic haze." — `content/recipes/dirty.ts:80` | Promote that sentence. On `/products/no-02-dirty`, under the descriptor: "A house dirty martini goes cloudy because the jar water carries suspended solids and a lactic haze. No. 02 is filtered for exactly this drink."                                                                                                                                                                 |
| 3   | blocking | `/recipes/*` (25 pages)                    | Last words on the page: "Freeze it in the bottle you will pour from. It will not freeze solid at this strength. Label it with the date — the vermouth is the clock and it gives you four days." — then the site footer. The last content section closes at `components/site/RecipeView.tsx:288`                                       | **The Friday host** | Zero `<button>` elements on the entire page. These are the longest-dwell pages on the site and the BrandScript's transitional call — the low-risk yes that is meant to hand over to the direct one. `RECIPES.buyLine` ("Get the bottle", `components/site/copy.ts:218`) exists and is used only by the index (`RecipeLibraryView.tsx:170`). The handoff is built and not wired.                                  | A buy block at the foot of every recipe, reusing the numbers the product page already computes: "You need No. 02 DIRTY. $20 for 500 ml — about 25 of these." + the add-to-cart control.                                                                                                                                                                                                   |
| 4   | serious  | all four product pages                     | "About 25 × The Dirty Martini, at 20 ml a drink." — `components/product/copy.ts:190-191`                                                                                                                                                                                                                                              | **The Friday host** | The count is right, sits correctly above the button, and then stops one operation short. Twenty-five is a number; eighty cents is an argument. `avatars.ts` says it in as many words: "A $20 bottle that makes 25 of them is the whole argument, and the arithmetic is not on the page." It is still not on the page.                                                                                            | "About 25 × The Dirty Martini, at 20 ml a drink. Eighty cents of brine a glass." (Computed from live price ÷ yield, never written in — same rule as `setSaving`. Do **not** put the avatar's "$24 at a bar" on the page: that is a representation about someone else's pricing and s 12A puts the burden of grounds on us.)                                                               |
| 5   | serious  | `/products/the-full-set`                   | "$54" / "500 ml × 3 · $3.60 / 100 ml" — and nothing else. `components/product/ProductView.tsx:309-310` renders the saving only in the bundle cross-sell block, so the set never renders it about itself                                                                                                                               | **The Friday host** | Every page that does _not_ sell the box argues for it — `/shop` says "Separately $60 — $6 less than buying the three one at a time", so does every single-bottle page. The one page where the box decision is actually made drops the argument. It is also the gift page ("A present" points here) and the order shape the margin model wants, since one parcel of three ships for the price of one.             | Under the price on the set's own page: "$54 for three. Separately they are $60, and three bottles travel in one parcel for the price of one."                                                                                                                                                                                                                                             |
| 6   | serious  | `/wholesale`                               | "Cost per pour is the trade price divided by the pours in the bottle. Both numbers are in the table above, so the sum is yours to check rather than ours to assert." — `components/site/copy.ts:179-180`                                                                                                                              | **The bar manager** | The page stops at cost per pour. His stated anchor is "cost per pour **against the drink's menu price, and the GP percentage that comes out of it**", and his Sunday-night conversation is about GP, not about cents. The page hands him the numerator and leaves the division that actually wins the argument to him.                                                                                           | Add one line under the table: "Set it against your own menu price. At $0.42 a pour, No. 02 is under 2% of a $22 martini and under 3% of a $15 one."                                                                                                                                                                                                                                       |
| 7   | serious  | `/shop`, all product pages                 | "We pick and pack on Tuesdays and Thursdays, so a Friday order moves on Tuesday." — `components/site/copy.ts:52`                                                                                                                                                                                                                      | **The Friday host** | The brand may not manufacture urgency, and should not. But it has a real deadline and spends it on a disclaimer — the sentence tells you the bad case and never the good one. Her buying window is Thursday night, phone in hand, for a Friday: this sentence tells her she has already missed it.                                                                                                               | On the buying path: "We pack Tuesdays and Thursdays. An order in by Wednesday night leaves on Thursday." Keep the Friday sentence on `/delivery`, where a disclaimer belongs.                                                                                                                                                                                                             |
| 8   | serious  | `/` `<title>` and meta                     | title "Half Sour"; description "Half Sour — pickle brine, bottled with a straight face." — `app/layout.tsx:26-30`                                                                                                                                                                                                                     | **Both**            | The description is a good sentence doing no work. It names no serve, no price, no country, and duplicates the brand name already in the title. `avatars.ts` says her highest-intent search is "the drink, the ingredient, and the country" — this string matches one of the three, and the title matches none.                                                                                                   | Title: "Half Sour — pickle brine for the glass". Description: "Brine built for the martini and the pan, not what is left in the olive jar. Four bottles, $18 to $26, delivered anywhere in New Zealand." (Country as a **delivery** fact only. "New Zealand pickle brine" is a place-of-origin representation and is blocked until the Food Control Plan address is on file — `TODO.md`.) |
| 9   | friction | all product pages                          | "Dill and Peppercorn Brine The everyday one. Reach for it without thinking." — built by `[entry.descriptor, entry.line].join(" ")` at `app/(site)/products/[handle]/page.tsx:47`                                                                                                                                                      | **Both**            | Two sentences welded without a full stop, in the one string a search result shows. It also spends its whole length on adjectives and never states the price, which is the field that decides the click on an unknown brand.                                                                                                                                                                                      | Join with ". " and append the figures: "Dill and Peppercorn Brine. The everyday one. Reach for it without thinking. $18 for 500 ml."                                                                                                                                                                                                                                                      |
| 10  | friction | any URL outside `/products` and `/recipes` | "404 / This page could not be found." — stock Next.js, no header, no footer, **no links at all**                                                                                                                                                                                                                                      | **Both**            | `brand/brand-guide.md` §5 principle 5 makes error pages the place the voice is loudest, and §5 example 16 already contains a written 404: "There's nothing here. There is something in the fridge, though." The guide wrote the line and the site does not use it. `/products/*` and `/recipes/*` both have proper branded 404s, so this is a gap, not a policy.                                                 | Add `app/not-found.tsx` with the chrome the product 404 already has, and the guide's line: "There's nothing here. There is something in the fridge, though." plus a route to `/shop`.                                                                                                                                                                                                     |
| 11  | friction | every page, header                         | "Cart empty" — `components/product/StoreChrome.tsx:147`                                                                                                                                                                                                                                                                               | **The Friday host** | The one persistent state message on the site, and the only place the voice goes flat. §5 example 8 is already written for this exact moment: "Nothing in here yet. No. 01 is the one to start with." (The larger problem is that the chip is a `<span>` — see the note above the table. Copy alone will not fix that.)                                                                                           | Chip: "Cart · empty". The guide's sentence belongs on the cart surface when there is one.                                                                                                                                                                                                                                                                                                 |
| 12  | friction | all product pages                          | _No line exists._ The spec block is "SKU / Size / Price shown" — `components/product/copy.ts:175-177`                                                                                                                                                                                                                                 | **The Friday host** | Nothing anywhere says how long a bottle keeps once it is open. She uses 20 ml a fortnight; at $26 a bottle the unspoken question is whether the other 480 ml survives to be used. Her recorded objection is "Will it just sit in the fridge?" — the kitchen use answers half of it and the keeping question is unanswered on every page.                                                                         | A fourth spec row: "Once open — keeps refrigerated for _[the real figure off the batch spec]_." Do not ship a guess; the first personality trait in the guide is that if we print it, it is true.                                                                                                                                                                                         |
| 13  | polish   | `/`                                        | Nav and footer say "What it's for" and "How it's made" (`components/home/data.ts:248-249, 304, 312`); the section eyebrows twelve lines below say "What it&rsquo;s for" and "How it&rsquo;s made" (`app/(site)/page.tsx:248, 354`)                                                                                                    | **Both**            | The same four words set with two different apostrophes, visible on one screen, on the site of a brand whose first stated trait is _Exact_.                                                                                                                                                                                                                                                                       | Curly everywhere. Move the strings out of `page.tsx` so `data.ts` is the only place they exist.                                                                                                                                                                                                                                                                                           |
| 14  | polish   | `/shop`, all product pages                 | "$8.50 a parcel to a New Zealand address, and free on orders of $90.00 or more to a New Zealand address." — `components/site/copy.ts:50`                                                                                                                                                                                              | **The Friday host** | Two faults in one sentence. "$90.00" renders beside "$18" and "$54" because the delivery lines use `formatMoney` while products use `formatPrice`, which strips `.00` (`components/product/catalogue.ts:405-408`) — inconsistent money on one screen. And "to a New Zealand address" is stated twice in thirty-three words, at the buy moment.                                                                   | "$8.50 a parcel anywhere in New Zealand, free over $90."                                                                                                                                                                                                                                                                                                                                  |
| 15  | polish   | `/` and all product pages                  | "500 ml of flint glass, a cap you can open one-handed, and the batch number printed on the bottle rather than kept in a database." (`components/home/data.ts:190`) and "Flint glass, a cap you can open one-handed, and the batch number printed on the label rather than kept in a database." (`components/product/copy.ts:192-194`) | **Both**            | The same sentence twice, near-identical but not identical — bottle/label, with and without the measure. It reads as a refrain the second time and as a copy-paste the third. **This is the sentence to cut first.**                                                                                                                                                                                              | Keep it on `/` as process step 04, where it earns its place among numbers. Cut it from the product spec block, where the SKU and size rows already say what the bottle is.                                                                                                                                                                                                                |

---

## Page by page

### `/` — the one page that is written as a catalogue

The first screenful is strong and it is not doing the right job. It carries the wordmark
(the `<h1>` is the wordmark image, `aria-label="HALF SOUR"` — the page has no textual H1), the
four-bottle line-up, the positioning sentence, "Stirred into a martini, poured after a whiskey,
splashed over a roast." (`components/site/copy.ts:328`), and two controls. So a stranger who
never scrolls learns what it is and three things to do with it. That is more than most food sites
manage, and the serve line is the reason — it is doing real work and should not be touched.

What she does not learn is why she should stop using what she has. The page structure is
positioning → serves → range → process → buy, which is the order a **product** goes in, not the
order a **decision** goes in. There is no problem beat anywhere on the homepage. Findings 1, 2,
7 and 8 all live here.

Two smaller things. The header's one call to action is "Buy" pointing at `#buy`, a scroll to the
bottom of the same page rather than to `/shop` — the site's only persistent CTA does not leave the
page. And the strongest empathy marker the brand has, "The company is one person. She answers the
email and she made the bottle." (`components/site/copy.ts:281-282`), is published once, on
`/terms`. It is listed in the BrandScript as a B2C authority marker and it is on the page a
customer reaches last, if ever.

### `/shop` — the best-merchandised page on the site

Nearly nothing wrong with it. "Half a litre of the brine, not the pickle. Start from what you are
making and the bottle picks itself." (`components/product/copy.ts:117`) is the clearest sentence
on the storefront: it answers the category question and the choosing question in nineteen words.
The `CHOOSER` block ("Start with the drink." → "A dirty martini → No. 02 DIRTY") is the single
best piece of conversion copy in the tree, because it is the only place the site organises itself
around what the customer is doing rather than around what we made. The `JOB` labels set above the
names — "The everyday one", "The martini", "Mezcal, michelada, pork", "Seafood" — are exactly
right and are load-bearing.

The card images carry `alt=""`. That is defensible as decorative markup since the name sits
beside them, but it means the shop page contributes nothing to image search for a brand whose
whole problem is that nobody knows it exists.

### The four product pages — one operation short

Structurally correct and better than the category. The yield block sits above the buy control, the
delivery charge is stated before the ask, the stock count is real ("17 in stock" on WILD, off a
real 40-bottle run), and the WILD supply note is the right way to do scarcity: "Limited by leaf
supply. WILD is only filled when there is kawakawa to fill it with, so it comes and goes rather
than sitting on the shelf." (`components/product/copy.ts:234-236`) — a fact about a season, not a
timer. Findings 4, 9, 12 and 15 are the gaps.

WILD deserves a specific note. Its page is the only one where the descriptor is doing less work
than it could — "Kawakawa, kelp and lemon. For anything that came out of the sea." is good, but at
$26 it is the most expensive bottle in the range with the least argument on its page, and its
yield line reads "About 41 × The Rock Pool, at 12 ml a drink", which is the strongest
cost-per-serve number in the whole range (63 cents) and is left as a raw count. Finding 4 pays
off hardest here.

### `/products/the-full-set` — the weakest page on the site

The only page that is worse than the pages linking to it. Finding 5. It has no yield block, no
recipe block, no saving and no argument — just a price, a quantity selector and a list of what is
inside. The `boxNote` explaining WILD's absence is good and honest. Everything else on the page is
inventory.

### `/recipes` and the recipe pages — the best writing, doing the least selling

`/recipes/dirty-martini` is better than anything the competitive set publishes. "Stir twenty-two
seconds. Slightly longer than a plain martini: the salt sharpens the perception of alcohol, so the
drink wants a touch more water in it." — that is a sentence written by someone who has made the
drink, and it buys more credibility than any adjective could. The "Why it works, and what to do
when it does not" and "If you have not got one" sections are the brand's authority claim made good
rather than asserted. "Take them; nothing is asked in return." (`components/site/copy.ts:192`) is a
lovely line and the page then honours it too literally: nothing is asked. Finding 3.

The index is a single ungrouped wall of twenty-five entries under four headings, with no filter for
drinks versus kitchen. Not a copy finding, but at twenty-five it is at the point where the page
starts costing the visitor something.

### `/wholesale` — the strongest commercial page in the tree

Publish this page and change nothing except finding 6. It does what the B2B avatar says a venue
needs, in the order he needs it: the price, the case, the minimum, the pour cost, then the working,
then the terms, then a form that asks for two fields. "One number for every venue of the same size,
on the page rather than in a reply." (`components/site/copy.ts:105`) removes the email from the
middle of a purchase, which is the entire trade thesis. And "If you find out later that another
venue paid less, we got something wrong and we will fix it."
(`components/site/copy.ts:129-130`) is the most persuasive sentence anywhere on this site — it
converts a policy into a checkable promise, which is precisely what a bar manager needs from a
one-person supplier he has never met. Leave it alone.

It also resolves the `menu-claim-with-no-door` contradiction in `avatars.ts`: the homepage's
"good enough to put on a menu" now has a door, and the door is good.

### `/delivery` — does its job

"One charge, stated before you start rather than at the last step of a checkout you have already
committed to." (`components/site/copy.ts:57`) answers the avatar's single largest unanswered
objection, and "One parcel of three bottles costs the same to send as one bottle, which is the
whole reason the box of Nos 01 to 03 exists" is quietly the best merchandising sentence on the
site — it makes the upsell an act of consideration rather than a push. Findings 7 and 14 are the
only marks against it. The page ends on "If it arrives broken" and then the footer, with no route
back to buying; a shopper who came here to check the charge has to navigate out.

### `/terms` — a competitive advantage in the wrong clothes

"Your rights, first." with the Consumer Guarantees Act paragraph under it is a differentiator,
not boilerplate. Nobody in this category leads a terms page with the customer's rights, and doing
so answers the avatar's "sending $54 to a stranger" objection better than any trust badge. It is
buried in the footer. Worth a sentence and a link on the product page, near the buy control, where
the doubt actually occurs.

---

## The five changes that would move conversion most

1. **Put the BrandScript one-liner in the hero and name the olive jar.**
   Replaces `components/home/Hero.tsx:174-175`. It is the top of the funnel, so it multiplies
   everything downstream; it is the only change that turns the site from a catalogue into an
   argument; the string already exists and is already written and audited; and its own dated next
   action (`one-liner-everywhere`, 2026-09-15) is overdue on all four surfaces. Note it names the
   martini, so it needs a `copy-audit-approved: R-13` marker when it lands on a consumer surface —
   the same marker it already carries in `brandscript.ts`.

2. **Give every recipe page a buy control at the foot.**
   Twenty-five of the longest-dwell pages on the site currently ask for nothing. This is the
   transitional-to-direct handoff SB7 requires, the mechanism is already built
   (`RECIPES.buyLine`), and it is the cheapest change on this list. Second only because it needs
   traffic to pay off, and traffic needs change 1.

3. **Turn the pour count into money on every product page.**
   One computed clause. It is the sentence that beats free, it lands at the exact moment of the
   decision, and it converts the range's price ladder from a cost into a per-glass figure that
   flatters the most expensive bottle most.

4. **Turn the dispatch rhythm into a deadline on the buying path.**
   "Order in by Wednesday night and it leaves Thursday" is a real deadline the brand is allowed to
   use — it is a fact about a packing day, not a countdown — and it lands precisely in the Thursday
   evening window the avatar research identifies as when things actually get bought. Currently the
   same fact is written as the reason it will be late.

5. **Add the GP line to `/wholesale`.**
   One sentence away from a complete trade page. Cost per pour is the number he asked for; GP
   against menu price is the number he has to defend on a Sunday night. Fifth only because the
   trade funnel is smaller and slower than the direct one, not because the page is weaker — it is
   the strongest page here.

---

## What is genuinely good, and should not be touched

Not a courtesy list. These are things that are better than the category and would be worse if
edited.

- **`/wholesale`, as a whole page.** It removes an email from the middle of a purchase, which is
  a structural advantage over every distributor a venue already deals with. "If you find out later
  that another venue paid less, we got something wrong and we will fix it." is the best sentence on
  the site.
- **The `CHOOSER` block on `/shop`.** "Start with the drink." with eleven occasions mapped to five
  products is the only place the site is organised around the customer's job. It should be
  imitated on the homepage, not changed here.
- **The `JOB` labels.** Four words or fewer, set above the name, above the price. "The martini"
  does more selling than any paragraph on the site.
- **The recipe notes and swaps.** "Taste the vermouth before you build. If it smells of sherry, it
  is oxidised and it will make the drink taste of old apples." This is the brand's authority claim
  evidenced instead of asserted, and it is the reason a bartender would trust the bottle.
- **The WILD supply note.** Real scarcity, wired to a grower's season, stated flatly. It is the
  correct answer to the brand's own ban on manufactured urgency, and it is more persuasive than a
  countdown would have been.
- **`/terms` and `/delivery`.** Both take the unglamorous moment seriously, which is exactly what
  §5 principle 5 asks for. "One charge, stated before you start rather than at the last step of a
  checkout you have already committed to." is a promise with a competitor implied in it, which is
  the register the whole site should be in.
- **The serve line in the hero.** "Stirred into a martini, poured after a whiskey, splashed over a
  roast." Three occasions in twelve words, culinary from the first syllable. It is the single
  sentence keeping this brand out of the supplement aisle, and it should survive any hero rewrite.
- **The register itself.** Dry, unbothered, numbers-led, no puns, no exclamation marks, no
  superlatives, nothing about a body. Across thirteen pages and roughly eight thousand words the
  voice does not slip once except at "Cart empty" and the stock 404 — both of which are the
  absence of copy rather than bad copy. That consistency is rare and it is worth defending.
