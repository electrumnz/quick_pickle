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
- [ ] **Pack sizes, names and prices.** 6 / 12 / 24 at $27 / $48 / $84 started as
      stand-ins, and so did the names (The Trial, The Starter, The Squad). Prices are set in
      the back end (Settings, The shop) with no deploy; an owner then says they are right on
      the go-live list. A pack's name and how many shots are in it are in `content/offer.ts`.
- [ ] **Clean shots of the real bottle.** It is confirmed as a 100 ml food-grade plastic
      bottle with a white cap, and the page shows a drawing of it. One straight-on photo on
      plain card, once the real labels are printed, replaces the drawing.
- [ ] **Ingredients and the nutrition panel**, exactly as printed on the label. Until then
      the page says nothing about what is in it. Also: where it is made, and how it should
      be stored. None of that is guessed.
- [ ] **The ship date for Batch 001**, if this launches as a pre-order. A pre-order with no
      date is not something to take money for. Set it in Settings, The shop, then confirm
      it on the go-live list.
- [ ] **Delivery rates from a courier.** $7 flat, $4.50 rural, free over $60 started as
      stand-ins, and so is "anywhere in New Zealand". The three rates are set in Settings,
      The shop (free delivery can be switched off altogether, or made free for everybody),
      then confirmed on the go-live list.
- [ ] **Read the fine print and agree to it.** The delivery, returns, terms and privacy pages
      make promises on the business's behalf: a replacement or refund if an order arrives
      damaged, and a full refund on a pre-order cancelled before it ships. They are sensible
      and in line with the Consumer Guarantees Act, but they are yours to make. An owner
      says so on the go-live list.
- [ ] **A customer email address.** The policies and FAQ leave a gap where it goes. Set it
      in Settings, The shop.
- [ ] **The legal entity, NZBN and GST status.** The terms of sale name no company yet, and
      receipts cannot show GST until the registration is confirmed.
- [ ] **Finish Stripe's own sign-up.** The account exists and the live site runs on its
      test keys, so nothing can be charged yet. Stripe still wants the business's details
      and a bank account before it will take real payments. After that: live keys.
- [ ] **One test purchase by a person.** On the live site, with Stripe's test card
      (4242 4242 4242 4242, any future date, any three digits). Stripe's payment page will
      not let a robot press Pay, so this is the one step of the paid path nobody has seen
      work end to end. Then refund part of it from Stripe's own dashboard: within a minute
      the order in the back end should say part refunded, with a line in its history.
- [ ] **Make the owner login.** Quick Pickle has its own Supabase organisation and Vercel
      account, apart from Keece, and production is connected. What is left is to open
      `/backstage/set-up` once, with the set-up code from Vercel's settings
      (`BACKSTAGE_SETUP_CODE`), and choose a password.
- [ ] **Disconnect the old Vercel project** (`half-sour`, in the Keece account). It still
      builds every push to this repository. Nothing here can touch it, on purpose.
- [ ] **Connect email, so an order's emails are sent.** The receipt, on the courier,
      cancelled and payment-on-its-way-back emails are built, and each one is being written
      down on its order. Nothing is sent until these four things exist. It needs the domain
      first.
  1. **A Resend account for Quick Pickle** (resend.com; its free tier to start with),
     apart from Keece's.
  2. **The domain added to that account and verified.** Resend's Domains page shows the
     DNS records to add wherever the domain's DNS is kept: DKIM and SPF as TXT records,
     and an MX or CNAME for the return path (it defaults to the `send` subdomain). Add
     them exactly as shown. If the DNS is at Cloudflare, leave the proxy (the orange
     cloud) off for them. A DMARC record is separate and worth adding once those verify.
  3. **An API key** from Resend, with sending access only.
  4. **Three settings on production** (Vercel, the Production environment only):
     `MAIL_PROVIDER=resend`, `RESEND_API_KEY` (the key) and `MAIL_FROM` (the address the
     emails come from, on the verified domain, such as `orders@` it). Replies to an
     order's email go back to that address, so it has to be one somebody reads.
  5. **Check it.** The go-live list (`/backstage/settings/go-live`) says "Order emails:
     Connected", `npm run prelaunch` stops listing it, and the infra run's `status` prints
     "order emails in production: the settings are there". After that, the test purchase
     above sends a receipt that says it was a Stripe test payment.
- [ ] **Connect the inbox, so mail arrives and a bounce is heard.** The inbox is built and
      nothing reaches it yet. It needs sending connected first (above), and the same Resend
      account. Until step 2 is done, an address that bounces or marks us as spam is not
      known about, and would be written to again.
  1. **Decide where the domain's mail goes.** For mail to land in the inbox, Resend has to
     receive it: on Resend's Domains page, turn on receiving for the domain and add the
     MX record it shows, exactly as shown. If the domain already has a mailbox somewhere
     else (Google Workspace, say) do not add it beside that one: mail only goes to
     whichever MX record comes first. Either receive on a subdomain (`mail.` the domain)
     and set `MAIL_FROM` to an address on it, or have the other mailbox forward to an
     address on that subdomain, or skip this step and read replies in that mailbox. Step
     2 is worth doing by itself whichever it is.
  2. **A webhook in Resend** (Webhooks, Add endpoint) that calls
     `https://<the site>/api/mail/resend`, for these events: `email.received`,
     `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.failed`
     and `email.suppressed`. Copy its signing secret (`whsec_...`) into
     `RESEND_WEBHOOK_SECRET` on production. A sending-only API key cannot read a received
     email, so if receiving is on, `RESEND_API_KEY` has to be a full-access key.
  3. **Only once mail arrives here: `MAIL_TOKEN_SECRET`** on production, any long random
     string (`openssl rand -hex 32`). Each email then asks for its replies at an address
     of its own (`reply+...@` the domain), so a reply finds its conversation wherever
     that has been moved. Never set it while replies are read in a mailbox elsewhere:
     that mailbox would not get them.
  4. **A signature**, in Inbox settings (`/backstage/inbox/settings`), and the starter
     replies if they are wanted. Read the "damaged in the post" one against the returns
     policy first: it says what the policy says, and has to keep saying it.
  5. **Check it.** Inbox settings says "Hearing from Resend: On". Send an email to the
     address from a phone: it shows in the inbox within a minute. Reply from the inbox,
     and answer that reply from the phone: it joins the same conversation.
     `MAIL_INBOUND_SECRET` is not needed for any of this. It is for a mail forwarder of
     our own, if Resend's receiving is ever not used.
- [ ] **Tell pre-order customers the ship date, by hand.** The delivery page and the
      "order's in" page promise the ship date by email before anything is sent. Nothing sends
      that by itself. When the date is set, somebody has to email the people with pre-orders.
- [ ] **Vercel's free plan is not for a business taking money.** At launch: Vercel Pro
      (US$20 a month), or move hosting to Cloudflare. Decide then.
- [ ] **A domain.**
- [ ] **Open the site to search at launch.** It happens on its own when the last open fact
      is confirmed: an owner does that on the go-live list for prices, delivery, the ship
      date, the contact address and the fine print, and the two that need words written
      into the site first (the ingredients, the legal entity) come off `UNCONFIRMED` in
      `content/offer.ts`. At the same time, set `categories:seo` in
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
- [x] **Order emails.** The receipt when an order is paid, on the courier when it is marked
      shipped (with the courier, the tracking number and the tracking link if they were
      given), cancelled, and a payment on its way back once Stripe has taken the refund.
      Plain text and simple HTML, and free of anything promotional so they stay outside the
      marketing-email rules. Each is written once, read against the copy rules before it is
      queued, and listed on its order with what became of it. A provider that is busy is
      tried again; one that refuses shows on the order with the reason and a button to try
      again. A test order's customer is not emailed, except that a payment made in Stripe's
      test mode gets a receipt that says so. Still to do by a person: connect email (above);
      until then every one of them is written down and none is sent. Not built: the
      pre-order ship-date email, and GST on the receipt, which waits for the registration.
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
- [x] **The inbox.** Mail for the business's address lands in the back end and is kept in
      conversations by our own rules: a reply address of its own, the message it answers,
      an order number from the customer who placed that order, or the same person under
      the same subject. Each message says why it is where it is, and a person can move
      one, merge two conversations or split one, with later replies following. An order
      number links the conversation to the order whoever quotes it, and a second address
      can be tied to its customer by hand. It is answered from there, with saved replies
      and a signature, and a reply is read against the copy rules as it is sent: a banned
      phrase never goes, and a restricted one goes only on a person's tick, which is kept.
      An email's own HTML is never drawn. A bounce or a spam complaint puts the address on
      a do-not-email list that nothing is sent past. What is waiting shows on Today.
      Still to do by a person: connect it (above). Not built: attaching a file to a reply,
      writing to somebody who has not written first, and more than one member of staff
      sharing the queue (a conversation can be given to somebody through an operation, and
      there is no screen for it, because one person runs this).
- [x] **Marketing.** Campaigns to the crew with approval before sending, a social planner,
      reviews read by a person before anyone sees them, and partners with a written yes on
      file before they are named. Not built: a campaign that is sent is queued, one row for
      each person, and nothing drains that queue yet. Sending those through the mail seam
      (`lib/mail`), with the unsubscribe link each one has to carry, is still to do.
- [x] **Codes, links and collabs.** Promo codes at the checkout (percent, dollars or free
      delivery, with dates, a limit, and once for each customer). A code or a short link
      can belong to a club, a creator or an event: their orders are counted as theirs, a
      link can carry their code into the checkout so nobody types it, and every link has a
      QR code to print. A partner's page says what they brought in, what they cost (a cut of
      each sale, a flat fee, product given away) and the sales back for each dollar spent.
- [x] **Specials and a welcome code.** A special comes off by itself with no code to type,
      and the shop says so across the top of the page, where the packs are picked, in the
      jar and at the checkout. It is set up switched off, its name is read by the copy rules
      before it goes on, and what it gives is written from its own terms. One special at a
      time, and one saving an order. A code can be chosen as the Pickle Crew's welcome code:
      people are shown it as they join and it comes off at their checkout.
      Later, if wanted: the special's saving in the jar's own total (it is said there, and
      taken off at the checkout), and a code only people on the Crew list can use.
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
- [x] **Run the shop from the back end.** Settings, The shop: what each pack costs, the
      three delivery rates, the ship date, pre-order or live, the batch's name, the address
      customers write to, and a switch to stop taking orders, all with no deploy. A change
      is read back in plain sentences before it is made, shows on the site within a minute,
      and anybody part-way through the checkout is shown the new total before they can pay.
      An owner confirms each open fact on the go-live list. A shut shop and a ship date
      that has gone by are on Today.
- [ ] **The rest of the shop from the back end.** The line across the top, the video
      slots (`content/media.ts`), the ingredients, the storage line and the legal entity
      are still in the files. Words a customer reads need the copy rules and a draft
      before they are published, the way a landing page has them, and a video needs
      somewhere to be kept.
- [x] **Numbers.** Sales, visits and how far they get (our own count, no cookies, nobody
      identified), where visits came from with the sales from each, phones against
      desktops, and how the crew list is moving.
      Today carries the pulse in two lines: today so far and yesterday, by the same rules.
- [x] **The courier, by file.** Packed orders go out as one file for the courier's
      website, and the tracking numbers it gives back are pasted in (or read from the
      courier's own file) to mark those orders shipped in one go, after a look at which
      orders they are. NZ Post, Aramex, Post Haste and NZ Couriers are known by name, with
      a tracking link the customer can follow; any other courier gets the number alone.
- [x] **For the books.** What was charged and what was given back, by day, for any
      stretch of days, with a file by day and a file by order for whoever keeps the
      accounts.
- [ ] **A direct line to Xero and to a courier.** Both wait on an account to try them
      against. Xero's own file import could not be checked from here (its help pages
      would not load), so nothing claims to be in its layout yet. For a courier: which
      one, then labels and tracking without the file in between.
- [ ] **What a packed box weighs.** The courier's file has no weight in it, because nobody
      has weighed one. Once the box is real: a weight for each pack size, and the file
      carries it.
- [ ] **The same courier list on an order's own page.** Shipping one order by hand still
      means typing the courier's name and pasting its tracking link. The list the courier
      screen uses could fill the link in there too.
- [ ] **Claude tooling (MCP).** Last, over the same operations: a small tool set, per-user
      sign-in, every call in the activity log.

## Before it takes real money

- [x] **The "order's in" page tells the truth about a receipt.** It says one is on its way
      only for a real, paid order placed while order emails were really being sent, and the
      checkout only says the email address is for a receipt then too. Otherwise neither says
      anything about one. Connecting email is in the first list; `npm run prelaunch` fails
      until it is done.
- [x] **A limit on how often one address can ask the checkout things.** From one internet
      address, in ten minutes: 20 wrong promo codes or questions that name a person, 30
      orders, 20 Pickle Crew sign-ups. After that it is asked to wait ten minutes. A real
      code, and a form handed back to fix a field, count for nothing, so a crowd on one
      wifi never meets it. No address is kept. The go-live list says whether it is on, and
      the infra workflow's `limits-off` stops it without a change to the code.
- [ ] **The visit counter and the short links' counts can still be flooded.** `/api/seen`
      writes a row, and `/go/<slug>` adds one to a link's count, for whoever asks, as often
      as they ask. No money and nothing about a person rides on either (a partner is
      credited by orders, never by clicks), but it could pad out the numbers and a test's
      verdict. The checkout's counter would fit both.
- [x] **Refunds made from Stripe's own dashboard**, written back onto the order. When
      Stripe says a payment was refunded, the refunds it holds are read and any the order
      does not have are recorded: the order, the customer's records and the books all
      follow. One the back end started is known by its own id and never counted twice.
- [x] **Card disputes**, written onto the order with the date an answer is due, and on
      Today until they are decided. A lost one is written as given back, so the order and
      the books stay true. The answering itself is done in Stripe's dashboard.
- [ ] **A dispute on the order's own page.** Today and the order's history say there is
      one. The page itself has no line for it yet, and no link straight to it in Stripe.
- [ ] **A refund Stripe later says failed** (a closed card, say) is not taken back off the
      order. Rare, and Stripe emails about it, but the order would go on saying refunded.

## Would make it sell harder

- [ ] Real product photography or approved illustration of the bottle and the packs.
- [ ] A hero loop and reels. The slots are in `content/media.ts`; the encoder is
      `scripts/build-media.mjs`. Nothing on the Drive is to be used yet: on 13 November
      (New Zealand time) the brand pack marked every motion file it holds (the hero loop,
      the films, the stingers) as superseded, pending a rebuild. Never the films that carry
      "for the quads" or "performance with pickles", whatever state they are in.
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
