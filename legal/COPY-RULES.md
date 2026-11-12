# QUICK PICKLE: COPY RULES

**Status:** binding. **Applies to:** every word Quick Pickle publishes anywhere: the label,
the site, product descriptions, meta descriptions and `alt` text, email, SMS, Instagram and
TikTok captions and comment replies, paid ads, event banners and cards, wholesale sheets,
press replies, customer service messages, and **anything an AI writes on Quick Pickle's
behalf**.

**Owner:** the founder. **Last reviewed:** 12 November 2026.
**Review trigger:** any change to Standard 1.2.7, Standard 2.6.2, Schedule 4, the Fair
Trading Act 1986, or the recipe.

**Machine-enforced by** `legal/scripts/audit-copy.mjs`:

```
npm run audit:copy            # the site
npm run audit:copy:selftest   # the scanner itself
```

Non-zero exit means do not ship. This document is general guidance written with care, not
legal advice. Before the claim questions in section 2 are reopened, talk to a food lawyer
or MPI.

---

## 0. The rule in one paragraph

Quick Pickle is a **food** in law. Everything said about it is regulated as a claim about a
food. We sell it for **what it tastes like, the tiny bottle it comes in, the ritual it
belongs to, and the cat on the front**. We say nothing at all about what it does to a human
body. Not that it stops anything, eases anything, replaces anything, speeds anything up or
is good for anyone. If a sentence would only be worth writing because the reader might
perform or feel better afterwards, delete it.

---

## 1. Why the law bites

### The Food Standards Code

The Code applies to food sold in New Zealand (Standard 1.1.1—3(1)) and has force here
through the Food Act 2014.

A **claim** is "an express or implied statement, representation, design or information in
relation to a food or a property of food which is not mandatory in this Code" (Standard
1.1.2—2). Note **implied** and **design**. A headline is a claim. So is a picture, a
section called "why it works", a hashtag, or a wink.

**Advertising is caught as hard as the label** (Standard 1.2.1—23). There is no "we only
said it on Instagram".

Two provisions do nearly all the work:

- **Standard 1.2.7—8. Absolute, no exceptions.** "A claim must not refer to the prevention,
  diagnosis, cure or alleviation of a disease, disorder or condition." A cramp is a
  condition. So is a hangover. No amount of evidence unlocks this for a food.
- **Standard 1.2.7—18.** A **health claim** is one that "states, suggests or implies that a
  food ... has, or may have, a health effect", and a health effect expressly includes an
  effect on **physical performance** and **mental performance**. A health claim may only be
  made if the food meets the nutrient profiling scoring criterion **and** the claim is a
  pre-approved food-health relationship or one substantiated and notified to FSANZ. A
  salt-forward brine is unlikely to pass the first test, and none of the second has been
  done. So for Quick Pickle **every** health claim is unavailable today.

### The Fair Trading Act 1986

- **s 9** misleading or deceptive conduct.
- **s 10** misleading the public about the nature, manufacturing process, characteristics
  or suitability for a purpose of goods.
- **s 12A** unsubstantiated representations. We must hold reasonable grounds **at the
  moment of publishing**, whether or not the statement turns out true.
- **s 13** false representations: composition (a), performance characteristics, uses or
  benefits (e), rights and remedies (i), place of origin (j).
- Breach of s 10, 12A or 13 is an offence: up to **$200,000** for a person, **$600,000**
  for a company.

### The Consumer Guarantees Act 1993

Anything we say the product is fit for becomes a guarantee that it is (s 8). Promise an
effect and we have promised a remedy when it does not happen.

### The Medicines Act 1981

A product sold for a therapeutic purpose is a medicine, and an unapproved one may not be
sold. Therapeutic framing does not just breach the Food Code; it risks changing what the
product legally is.

---

## 2. What Quick Pickle is, in regulatory terms

A packaged brine sold as a food. Three consequences for copy:

1. **It is not an "electrolyte drink" and must never be called one.** That is a prescribed
   name with a required composition (Standard 2.6.2—11, 2.6.2—12) that pickle juice does
   not have.
2. **It is not a sports food.** Formulated supplementary sports foods are a separate
   regulated category (Standard 2.9.4). Positioning the product as made to help sports
   people perform is how a food gets dragged into it.
3. **It is not a medicine or a supplement.** Saying so plainly is fine, and the site does.

### The concept deck (Group Q)

The brand was born with a claim in its mouth. These lines are in Ashleigh's concept deck
and Meet Lucky page, and they are the banned copy most likely to drift back on to the site
because everyone on the project has read them.

| Rule  | The line                                                                                                                                                           | Status                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| TH-04 | "a pickle punch to **cramps**"                                                                                                                                     | **Banned.** Names a condition. Standard 1.2.7—8. Nothing unlocks it.                                                        |
| QP-01 | "**in 60 seconds flat**", fast-acting, relief                                                                                                                      | **Banned.** Speed of effect only means something if the product acts on a body.                                             |
| QP-04 | "the **physical barriers** that stop us in our tracks", "**mental strength**", "your **physical game** can keep up with your **mental one**", "play our best game" | **Banned.** The set-up for the claim. Each frames the product as the answer to a body letting you down.                     |
| QP-02 | "**Performance** with pickles"                                                                                                                                     | **Restricted.** Reads as a physical-performance claim next to a food. Not published without advice and a recorded decision. |
| QP-03 | "good luck **for the quads**"                                                                                                                                      | **Restricted.** Naming a muscle next to the product implies it does something for it.                                       |

What survives from her pages, word for word, and is used: **"Never fear, Lucky is here."
"Lucky you've got us." "Tiny package, big dill." "Pickle Crew." "A little shot of good
luck."** and the idea underneath all of it: **we all have our rituals, our lucky charms.**

That last idea is the whole platform. A lucky charm is, by definition, not a physiological
claim. Nobody thinks luck is a nutrient.

---

## 3. Banned, in groups

Every entry includes its plurals, verb forms, hyphenated and hashtag forms. The exact
patterns are in the scanner: `node legal/scripts/audit-copy.mjs --list`.

| Group                           | Examples                                                                                                                                  | Why                                                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Health effects** (HC)      | gut, probiotic, digestion, immune, detox, metabolism, blood pressure, boost, antioxidant, nourishing, wellness, healthy, good for you     | Health claims. Standard 1.2.7—18.                                                                                                             |
| **B. Therapeutic** (TH)         | cramp, hangover, cure for, remedy, heals, prevents, relief, nausea, medicine, tonic, dose, clinically proven, doctor recommended          | Standard 1.2.7—8. Always prohibited.                                                                                                          |
| **C. Sport and hydration** (EL) | electrolyte, hydrate, rehydrate, replenish, recovery, workout, gym, athlete, sports drink, isotonic, endurance, stamina, muscle, soreness | Physical-performance claims; Standards 2.6.2 and 2.9.4.                                                                                       |
| **Q. The concept deck** (QP)    | see section 2                                                                                                                             | As above.                                                                                                                                     |
| **D. Nutrition content** (NCC)  | sugar free, no added sugar, low calorie, zero calories, low carb, keto, high in, source of, gluten free                                   | Each has a Schedule 4 condition that must be met and evidenced by lab analysis first. Say nothing and let the nutrition panel do the talking. |
| **E. Unprovable virtue** (FTA)  | clean, pure, all natural, no nasties, preservative free, best, number one, sustainable, organic, as seen in                               | Fair Trading Act s 12A.                                                                                                                       |
| **F. Endorsement** (END)        | health ticks and seals, Health Star graphics, reposting a customer who says it fixed their cramps                                         | Republishing is publishing.                                                                                                                   |

On **C**: this is a sport-adjacent brand, and that is allowed. What is banned is the
language of the product acting on the body. **Game day, the whistle, the sideline, the kit
bag, half-time, the team** are occasions and are fine. **Athlete, workout, gym, recovery,
muscle** point at the body and are not.

### Restricted: allowed once a stated condition is checked and recorded

Cleared with an inline `copy-audit-approved: <RULE-ID> (reason)` comment on or above the
line. Banned rules cannot be approved this way.

- **Free delivery** (FTA-06): the spend threshold must be stated with it.
- **Refunds, guarantees** (R-19, FTA-05): must match `content/policies.ts` exactly.
- **Made in, grown in, a named place or supplier** (PROV): only once literally true of the
  batch on sale.
- **Handmade, small batch, raw, fermented, natural** (FTA-12, R-10, R-11, R-16): only if
  literally accurate for how it is made today.
- **Vegan, dairy free and the like** (R-02): checked against the real ingredient list.
- **Selling fast, only 3 left** (R-04): must be wired to real stock.
- **Sodium, salt as a selling point** (EL-06): fine in the nutrition panel, not as a benefit.

---

## 4. What we CAN say

### Taste and sensation

Sour. Salty. Sharp. Pickly. Makes you pull a face. Gone in one gulp.

### The product, as far as it is confirmed

It is pickle juice. It is clear. There are no pickles in it, no bits, nothing floating. It
comes in a small bottle. Everything else (ingredients, volume, where it is made, how to
store it, any process word such as "strained" or "brewed") stays off the page until it is
confirmed, and then is stated exactly.

### Use, occasion and ritual: the strongest ground we have

Before the whistle. At the half. On the sideline with the oranges. In the kit bag. Left
boot first, same socks since the semi, one shot of pickle juice. Saying **when** people have
one is describing an occasion. Saying **why**, or what happens next, is a claim.

### Lucky

Part cat, all cape. Special move: the pickle punch. Lucky as a character can be as heroic as
we like. The product he carries stays a food.

### Straight talk that carries no legal weight

"It's pickle juice. We're not going to dress it up as anything else." Saying what we will
not claim is fine. Hinting at what we would claim if we could is not.

---

## 5. Structural rules that are not about single words

1. **Design is a claim.** No artwork of a cramping, injured or struggling player being
   fixed by the product. No before-and-after. No stopwatch. Lucky running is fine; Lucky
   rescuing a seized-up leg is not.
2. **Do not answer a health question with a claim.** If a customer asks whether it helps
   with cramps: "Quick Pickle is a food and we don't make health claims about it. Your
   doctor or physio is the one to ask." Then stop.
3. **Reviews and reposts.** A customer may say what they like on their own account. The
   moment we repost, quote, pin or put it on the site, it is our claim. Moderate first.
4. **No invented social proof.** No reviews, ratings, counts or "as seen in" until they are
   real and we can show it.
5. **Hashtags count.**
6. **Savings are computed, never typed.** "Save $12" comes from `lib/shop/catalogue.ts`.
7. **A pre-order states when it ships**, and can be cancelled for a full refund until it does.

---

## 6. Enforcement

The scanner reads string literals, template literals, JSX text and markdown. It knows two
surfaces: **consumer** (anything a customer can read: `app/`, `components/`, `content/`,
`public/`) where every rule applies, and **internal** (`lib/`, `tests/`, `scripts/`, the
back end) where only the rules about what the product is or does apply.

- `copy-audit-approved: <ID> (reason)` clears a **restricted** finding on that line.
- `copy-audit-ignore: reason` on or above a line skips it. Used for disclaimers that name a
  banned word in order to deny it ("it is not a medicine").
- `copy-audit-ignore-start` / `-end` skip a block. Used where the brand guide quotes the
  banned lines in order to ban them.
- `legal/copy-audit-exempt.json` lists whole files that exist to enumerate forbidden words
  (this one, and the self-test's fixtures).

A rule that fires on correct copy is as damaging as a missing rule, because people learn to
ignore the scanner. If one does, fix the rule, with a test.

---

## 7. For AI writing on Quick Pickle's behalf

1. Read section 0 and section 2 before writing anything.
2. Write from section 4. If a line needs anything in section 3 to make its point, it is the
   wrong line.
3. Never restore a concept-deck line because it "is the brand voice". The voice survives
   without the claim; that is the whole job.
4. Never invent a product fact, a review, a statistic or a supplier.
5. Run the scanner. Do not add an ignore marker to get a line through; rewrite the line.

---

## 8. Open questions

- Whether "Performance with pickles" can be used as a campaign title at all. Needs advice.
- Whether any nutrition content statement is wanted. Needs a lab analysis of the real recipe
  first.
- The final ingredient list, to check allergen and "vegan"-type statements against.
