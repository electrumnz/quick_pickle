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
- [ ] **Finish Stripe's own sign-up.** The account exists and the live site runs on its
      test keys, so nothing can be charged yet. Stripe still wants the business's details
      and a bank account before it will take real payments. After that: live keys.
- [ ] **One test purchase by a person.** On the live site, with Stripe's test card
      (4242 4242 4242 4242, any future date, any three digits). Stripe's payment page will
      not let a robot press Pay, so this is the one step of the paid path nobody has seen
      work end to end.
- [ ] **Make the owner login.** Quick Pickle has its own Supabase organisation and Vercel
      account, apart from Keece, and production is connected. What is left is to open
      `/backstage/set-up` once, with the set-up code from Vercel's settings
      (`BACKSTAGE_SETUP_CODE`), and choose a password.
- [ ] **Disconnect the old Vercel project** (`half-sour`, in the Keece account). It still
      builds every push to this repository. Nothing here can touch it, on purpose.
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
- [x] **Payments.** Stripe behind the seam: the order is saved first, a hosted payment
      page is made for exactly that amount in New Zealand dollars, a signed webhook marks it
      paid, refunds go back to the card, and a clock closes orders nobody paid for.
      Production is on Stripe's test mode. Still to do by a person: one purchase on the live
      site with Stripe's test card (4242 4242 4242 4242), because Stripe's page will not let
      a robot press Pay. Then real keys, once Stripe's own sign-up is finished.
- [ ] **Order emails.** Receipt, on the courier, cancelled. Plain, and free of anything
      promotional so they stay outside the marketing-email rules.
- [x] **Stock and batches.** Shots on hand, counted by batch from movements that are never
      edited. A batch is planned, made, released and closed, with a best-before date and a
      production record. Packing an order is where its shots leave stock and its batch goes
      on record, so the recall list for a batch is one press: who has it, how to reach them,
      and where every other shot went. Materials, suppliers and purchase orders, with what
      to reorder and what is late. What needs a person shows on Today. Still to do by a
      person: record the first real batch, with the best-before date printed on its bottles,
      before the first real order is packed. An order packed while no batch is on sale goes
      on no recall list. Not built: a purchase order is printed or sent by hand (nothing is
      emailed), an order is received all at once, and the shop does not yet stop selling
      when the shelf is empty.
- [ ] **The inbox.** Mail for the business's domain lands in the back end, threaded by
      our own rules (reply headers, order numbers, the same person and subject), linked to
      customers and orders, answered from there.
- [x] **Marketing.** Campaigns to the crew with approval before sending (they go out once
      email is connected), a social planner, reviews read by a person before anyone sees
      them, and partners with a written yes on file before they are named.
- [x] **Codes, links and collabs.** Promo codes at the checkout (percent, dollars or free
      delivery, with dates, a limit, and once for each customer). A code or a short link
      can belong to a club, a creator or an event: their orders are counted as theirs, a
      link can carry their code into the checkout so nobody types it, and every link has a
      QR code to print. A partner's page says what they brought in, what they cost (a cut of
      each sale, a flat fee, product given away) and the sales back for each dollar spent.
- [ ] **Specials and a welcome code.** An offer that applies itself for a set time with no
      code to type, shown on the page; and a code for someone the moment they join the
      Pickle Crew.
- [x] **Landing pages.** The one page with other words at the top, for one advert or
      audience, each at its own address with its own numbers. Written as a draft, checked
      against the copy rules, looked at in a preview that is the real page, then published.
      With none made, everyone sees the standard page.
- [x] **Who sees which page, and A/B tests.** Rules that put a landing page at the front
      of the shop for visitors who arrived a particular way (a link, an advert, a website,
      a promo code, having bought before), a test that splits everybody else between two
      pages and says which sells more, and "see it as": describe a visitor and see the page
      they would get. All of it switched off until somebody starts something, and no cookie
      is set for anybody until then.
- [ ] **Automations and routines.** Rules that react to events, schedules that run, a
      daily digest, and an approval queue for anything outward.
- [x] **Plans.** The plan, the budget and what a pack costs to make and send, how-to
      sheets, a to-do list, the open questions for Ashleigh, and a light checklist of what a
      food business has to have in place.
- [ ] **Run the shop from the back end.** Prices, ship date, launch mode, delivery rates
      and the announcement, without a deploy.
- [x] **Numbers.** Sales, visits and how far they get (our own count, no cookies, nobody
      identified), where visits came from with the sales from each, phones against
      desktops, and how the crew list is moving.
- [ ] **Xero and couriers.**
- [ ] **Claude tooling (MCP).** Last, over the same operations: a small tool set, per-user
      sign-in, every call in the activity log.

## Before it takes real money

- [ ] **Order emails.** The "order's in" page says a receipt is on its way. Until email is
      connected, it is not.
- [ ] **A limit on how often one address can ask the checkout things.** The order form and
      the promo code check answer anybody, as often as they ask. That is enough to guess at
      codes, or to ask, one email at a time, whether somebody has already used a once-only
      code.
- [ ] **Refunds made from Stripe's own dashboard**, and card disputes, written back onto
      the order. Today a refund has to be started from the back end to be recorded.

## Would make it sell harder

- [ ] Real product photography or approved illustration of the bottle and the packs.
- [ ] A hero loop and reels. The slots are in `content/media.ts`; the encoder is
      `scripts/build-media.mjs`.
- [ ] Reviews, once there are real ones. None are invented.
- [ ] Subscribe and save, once there is a second batch to subscribe to.

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
