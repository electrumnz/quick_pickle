# Quick Pickle: what's done, what isn't

Updated 12 November 2026. Honest status, not a summary.

`npm run prelaunch` checks the first two sections for you and fails until they are done.

## Needs a person. Nobody else can do these.

- [ ] **Decide what happens to the claim.** Ashleigh's line "a pickle punch to cramps in
      60 seconds flat" cannot go on the site, on pack or in an ad in New Zealand: a food may
      not be advertised as easing a condition (Food Standards Code, Standard 1.2.7-8). The
      site is built without it. "Performance with pickles" and "for the quads" are softer
      but lean the same way and are held back too. If anyone wants them back, that is a
      conversation with a food lawyer or MPI first. `legal/COPY-RULES.md` has the detail.
- [ ] **Pack sizes, names and prices.** 6 / 12 / 24 at $27 / $48 / $84 are stand-ins, and
      so are the names (The Trial, The Starter, The Squad). `content/offer.ts`.
- [ ] **Clean shots of the real bottle.** It is confirmed as a 100 ml food-grade plastic
      bottle with a white cap, and the page shows a drawing of it. One straight-on photo on
      plain card, once the real labels are printed, replaces the drawing.
- [ ] **Ingredients and the nutrition panel**, exactly as printed on the label. Until then
      the page says nothing about what is in it. Also: where it is made, and how it should
      be stored. None of that is guessed.
- [ ] **The ship date for Batch 001**, if this launches as a pre-order. A pre-order with no
      date is not something to take money for.
- [ ] **Delivery rates from a courier.** $7 flat, $4.50 rural, free over $60 are stand-ins,
      and so is "anywhere in New Zealand".
- [ ] **Read the fine print and agree to it.** The delivery, returns, terms and privacy pages
      make promises on the business's behalf: a replacement or refund if an order arrives
      damaged, and a full refund on a pre-order cancelled before it ships. They are sensible
      and in line with the Consumer Guarantees Act, but they are yours to make.
- [ ] **A customer email address.** The policies and FAQ leave a gap where it goes.
- [ ] **The legal entity, NZBN and GST status.** The terms of sale name no company yet, and
      receipts cannot show GST until the registration is confirmed.
- [ ] **Pick a payment processor.** The checkout is ours end to end and runs in test mode.
      Stripe is the obvious choice for New Zealand (cards, Apple Pay and Google Pay inside
      our own checkout, which is the single biggest lift on a phone). It plugs in at
      `lib/shop/payments`.
- [ ] **Somewhere to keep orders.** A database (Supabase or Neon) and an email sender for
      receipts. Until then a deployed test order is written to the server log and nowhere
      else. It plugs in at `lib/shop/store`.
- [ ] **A domain.**
- [ ] **Open the site to search at launch.** It happens on its own when `UNCONFIRMED` in
      `content/offer.ts` is empty. At the same time, set `categories:seo` in
      `lighthouserc.json` back from `warn` to `error`: it is a warning today only because a
      site that says noindex on purpose cannot pass it.
- [ ] **Ashleigh's nod on the two proposed Lucky poses in use**: celebrating (order placed)
      and asleep (empty jar, 404). Both were generated from her art, not drawn by her.

## Would make it sell harder

- [ ] Real product photography or approved illustration of the bottle and the packs.
- [ ] A hero loop and reels. The slots are in `content/media.ts`; the encoder is
      `scripts/build-media.mjs`.
- [ ] Reviews, once there are real ones. None are invented.
- [ ] Subscribe and save, once there is a second batch to subscribe to.
- [ ] Analytics, so the page can be tuned on evidence.

## Built and verified

- [x] The one page, mobile first: hero, pack picker, product truths, the ritual, Meet Lucky,
      Pickle Crew sign-up, questions, final call to action, sticky buy bar on phones
- [x] The jar: stored in the browser, free-delivery bar, size-up swap, cross-tab sync
- [x] Native checkout, priced on the server, with field-level errors and autofill
- [x] Order confirmation, delivery / returns / terms / privacy pages, a proper 404
- [x] Brand layer from Ashleigh's files: four fonts (37 kB), tokens, Lucky and the lockup
      as true vector, stickers and poses as WebP
- [x] The living brand guide and go-live list in the back end (`/backstage`)
- [x] Copy rules and a scanner that fails the build on a health claim, with a self-test
      that proves it catches the concept deck's own lines
- [x] Unit tests for money, the jar, pricing and order placement (price tampering included)
- [x] Browser tests for the purchase journey, no-JavaScript reading, and axe on every page
      at phone and desktop size
