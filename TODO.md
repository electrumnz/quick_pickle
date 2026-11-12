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
- [ ] **A Stripe account.** The processor is decided: Stripe (cards, Apple Pay and Google
      Pay, no monthly fee). It needs an account in the business's name, then its test keys
      first and its live keys at launch. It plugs in at `lib/shop/payments`.
- [ ] **Finish moving to Quick Pickle's own accounts**, apart from Keece:
      a free Supabase organisation (made 12 November) and a free Vercel account (in
      progress). Connect the two with Vercel's Supabase integration, Production only, and
      add `BACKSTAGE_SETUP_CODE`. Then open `/backstage/set-up` once to make the owner login.
- [ ] **Two tokens, as GitHub repository secrets**, so the repository's own automation can
      run the database and the hosting: `QP_SUPABASE_ACCESS_TOKEN` and `QP_VERCEL_TOKEN`.
- [ ] **Email for the business's own domain.** Resend to start with (free tier, sending and
      receiving); Cloudflare for the domain's DNS, and for receiving if the free tier's daily
      cap ever bites. Both need the domain first.
- [ ] **Vercel's free plan is not for a business taking money.** At launch: Vercel Pro
      (US$20 a month), or move hosting to Cloudflare. Decide then.
- [ ] **A domain.**
- [ ] **Open the site to search at launch.** It happens on its own when `UNCONFIRMED` in
      `content/offer.ts` is empty. At the same time, set `categories:seo` in
      `lighthouserc.json` back from `warn` to `error`: it is a warning today only because a
      site that says noindex on purpose cannot pass it.
- [ ] **Ashleigh's nod on the two proposed Lucky poses in use**: celebrating (order placed)
      and asleep (empty jar, 404). Both were generated from her art, not drawn by her.

## The back end: what is built and what is next

Everything Ashleigh needs to run the business, except accounting (Xero). In build order.

- [x] **Foundations.** Database (Postgres, self-migrating, row level security on every
      table), staff sign-in with roles, the activity log, and one list of operations that
      every screen, automation and bot goes through.
- [x] **Orders and customers.** The queue by stage, search, a page per order with its
      history, packing slips, refunds recorded, customer tags and notes, the Pickle Crew
      list with consent on file.
- [ ] **Payments for real.** Stripe behind the existing seam: a pending order, a hosted
      payment page for exactly that amount, a signed webhook to mark it paid.
- [ ] **Order emails.** Receipt, on the courier, cancelled. Plain, and free of anything
      promotional so they stay outside the marketing-email rules.
- [ ] **Stock and batches.** Shots on hand, batches with best-before dates, which batch
      went to which order (so a recall list is one press), suppliers and purchase orders.
- [ ] **The inbox.** Mail for the business's domain lands in the back end, threaded by
      our own rules (reply headers, order numbers, the same person and subject), linked to
      customers and orders, answered from there.
- [ ] **Marketing.** Campaigns to the crew with approval before sending, promo codes, a
      social planner, tracked links, reviews with moderation.
- [ ] **Automations and routines.** Rules that react to events, schedules that run, a
      daily digest, and an approval queue for anything outward.
- [ ] **Plans.** Business plan, marketing plan, budget and unit economics, how-to sheets,
      the compliance register for a food business, the open questions for Ashleigh.
- [ ] **Run the shop from the back end.** Prices, ship date, launch mode, delivery rates
      and the announcement, without a deploy.
- [ ] **Numbers.** Sales, the funnel (our own, no cookies), crew growth.
- [ ] **Xero and couriers.**
- [ ] **Claude tooling (MCP).** Last, over the same operations: a small tool set, per-user
      sign-in, every call in the activity log.

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
