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
- [ ] **What the label says**: the ingredients list, the allergen line if it has one, and
      the storage line, word for word. Until then the page says the list is on its way and
      nothing about what is in it. Type them in Settings, The label and the company, with
      the printed label in your hand, then confirm them on the go-live list. Where it is
      made is not asked for and not stated anywhere. None of this is guessed.
- [ ] **The nutrition panel is not on the site.** The label has to carry one; the site
      shows the ingredients list only. Showing the panel too means building a small table
      and a form for its figures. Say if you want it.
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
- [ ] **The legal entity, NZBN and GST status.** The terms of sale name no company yet.
      Put the legal name, the NZBN, the address and whether it is registered for GST in
      Settings, The label and the company, then confirm them on the go-live list. With a
      GST number in, a receipt says how much of the total is GST.
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
- [ ] **Before the first campaign to the Pickle Crew.** Three things, in this order.
  1. Connect email and the webhook (both above). The webhook is how a bounce or a spam
     complaint about a campaign takes somebody off the list. Without it they would be
     written to again.
  2. Enter who the company is (Settings, The label and the company) and the address
     customers write to (Settings, The shop). They are printed under every campaign
     email: marketing email has to say who sent it and how to reach them. A campaign's
     page shows the line as it will print.
  3. Send the first one while the list is still only yourselves. Open it on a phone,
     then press the unsubscribe link in it and see that you come off the list. The
     how-to "How to email the Pickle Crew" (Plans) has the steps.
- [ ] **Tell pre-order customers the ship date.** The delivery page and the "order's in"
      page promise the ship date by email before anything is sent. Once email is connected
      it is one press: set the date in Settings, The shop, and the panel under it says who
      has not been told and writes to them. Today shows it until it is done. Move the date
      and they are owed the new one. Until email is connected, it is still by hand: the
      panel lists whose orders they are.
- [ ] **Vercel's free plan is not for a business taking money.** At launch: Vercel Pro
      (US$20 a month), or move hosting to Cloudflare. Decide then.
- [ ] **A domain.**
- [ ] **Open the site to search at launch.** It happens on its own when the last open fact
      is confirmed. An owner does that on the go-live list, for all seven: prices, delivery,
      the ship date, the contact address, the fine print, what the label says and who the
      company is. None of them needs a code change. At the same time, set `categories:seo` in
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
      file before they are named.
- [x] **Campaigns really go.** A campaign that is sent goes out a few dozen emails at a
      time, the first few as send is pressed and the rest every five minutes, and one
      given a time is queued when the time comes. Each email says who it is from and
      carries an unsubscribe link that works with one press and no sign-in, as well as the
      header a mail program's own unsubscribe button uses. If the mail provider is busy or
      refuses us nobody is marked as failed: the campaign waits, says why on its own page
      and on Today, and carries on by itself. Nobody is sent a second copy on a guess. An
      address that bounces for good, or marks an email as spam, is never emailed again.
      With email not connected a campaign cannot be queued at all, and the screen says so.
      Still to do by a person: connect email (above), then send the first campaign while
      the list is still only yourselves, and press the unsubscribe link in it. Not built:
      counting opens and clicks. Nothing in an email is tracked, on purpose.
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
- [x] **The things that should happen by themselves, for one person.** A morning email
      (Settings, Morning email; off until it is switched on): one a day, saying how many
      things need you, how many orders are waiting and what yesterday came to, with a link
      and nobody's details. And the email the site promises a pre-order's customer with
      the ship date: Today says who has not had it, and one press sends it.
- [x] **Waiting for a yes.** A bot that wants to send, publish or delete something has to
      ask a person first. What it asked for waits at `/backstage/approvals` and on Today,
      says exactly what it would do, and is done only when somebody signed in presses yes.
- [ ] **Rules of your own.** Rules somebody writes themselves ("when this happens, do
      that") are not built: Today already gathers what needs a person, and nobody has asked
      for one yet.
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
- [x] **The label and the company from the back end.** Settings, The label and the
      company: the ingredients list, the allergen line, the storage line, the legal name,
      the NZBN, the address and the GST number, read back before they are saved. The
      label's words meet the copy rules; a word the food rules put on labels themselves
      waits for a person's tick. The two numbers are checked for a slipped digit. They
      show under "What's in it?", in the terms of sale, on a receipt and on a purchase
      order.
- [ ] **Still in the files:** the line across the top of the shop and the video slots
      (`content/media.ts`). The line needs a draft and the copy rules before it is
      published, the way a landing page has them, and a video needs somewhere to be kept.
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
- [x] **Claude, connected (MCP).** Settings, Claude: an owner switches it on, and a member
      of staff connects their own Claude with one address. Three tools (find, look,
      change) reach the whole back end. It can read and make ordinary changes; anything
      that reaches a customer or cannot be undone waits for a yes in the back end. Every
      call is in the activity log under the bot's own name.
- [x] **The connection, hardened after an independent review (12 November 2026).** The
      review read the whole connection cold and found two serious gaps, both closed
      before anybody could switch it on. A bot could hand over a key the operation does
      not read, dressed up to look like the one that matters, and the yes/no page showed
      it: every key a bot hands over now has to be one the operation reads, a reply has
      to carry its own words, and publishing saved words (a page, a campaign, a caption,
      a review, a special) is a person's, on the screen that has the words on it. And a
      dozen operations that reach a customer without sending anything ran with no yes at
      all: a promo code, where an order is sent, the signature, the do-not-email list,
      blocking a sender, the morning email's address, a partner's permission to be named,
      releasing a batch, taking a review down, unsubscribing somebody. Each now waits
      for a person. Smaller ones closed with them: a bot's tick no longer counts as a
      person's read of a restricted phrase, the yes/no page says only its own sentences,
      a replaced renewal key gets one more go and not many, a flood of registrations
      cannot shut the door, a list of calls in one request is refused, every verb
      answers 404 while it is off, and an unexpected failure tells a bot nothing of the
      database.
- [ ] **Connect Claude for real, once.** Nothing here could be tried against Claude
      itself, only against the protocol's own client library. After the owner login is
      made: Settings, Claude, switch it on, then in Claude add a custom connector with the
      address shown. If Claude says it cannot register or cannot sign in, look at
      `/.well-known/oauth-authorization-server` on the site first. If the consent screen
      says the app "asked to be sent back somewhere it did not register", Claude's callback
      address has moved: the two it may use are in `lib/backstage/connect/tokens.ts`.
      **One thing to look at while doing it,** which could not be checked from here:
      every Claude on the web is sent back to the same address at claude.ai, so our
      consent screen cannot tell your Claude from somebody else's. What keeps a stranger
      from getting you to press Connect for THEIR Claude is that Claude ties the answer
      to the browser that started it, and the screen's own line: only say yes if you
      started this yourself, just now. To check the first, start connecting in one
      browser, copy the address of our consent screen into a different browser where you
      are also signed in to the back end, and press Connect there. Claude should refuse
      to finish. If it finishes, switch connecting off and tell whoever looks after this
      code: the fix is a short code the person types across.
- [ ] **A notice in the address is the back end's own voice on every screen but one.**
      After a form is saved, the sentence that says how it went travels in the address
      (`?notice=`), so a link somebody made by hand can put any sentence in a notice box
      on a back-end page. It is text only and it is behind the sign-in, and the one page
      where it mattered (the yes/no page a bot hands out the link to) now takes a word
      from a fixed list instead. Doing the same everywhere means signing the notice, or
      carrying it in a short-lived cookie: about fifty pages read it today
      (`lib/backstage/ui/submit.ts` writes it).
- [ ] **Say in the privacy page which tools read customers' details.** It now says the
      shop may be run with an AI assistant. If Claude is never switched on, that line can
      come out; if another tool is added, it goes in.

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
- [x] **The visit counter and the short links' counts cannot be flooded.** One internet
      address gets 600 steps of the visit counter and 300 follows of a short link every
      ten minutes. Past that they stop being counted, and nothing else changes: the page
      still loads and the link still leads on. The privacy page says so.
- [x] **Refunds made from Stripe's own dashboard**, written back onto the order. When
      Stripe says a payment was refunded, the refunds it holds are read and any the order
      does not have are recorded: the order, the customer's records and the books all
      follow. One the back end started is known by its own id and never counted twice.
- [x] **Card disputes**, written onto the order with the date an answer is due, and on
      Today until they are decided. A lost one is written as given back, so the order and
      the books stay true. The answering itself is done in Stripe's dashboard.
- [x] **A dispute on the order's own page.** Across the top while it is open, and under
      Money always: how much, the bank's reason, whether it is ours to answer and by when,
      and how it ended. It links to Stripe's list of disputes and shows what Stripe calls
      this one. Stripe's documentation gives no address for a single dispute, so the link
      goes to the list.
- [x] **A refund that comes back.** When a refund leaves and the customer's bank cannot
      put it on the card (a closed card, say), Stripe says so days or weeks later. It is
      written on the order as left and come back, comes off what the order has given
      back, and goes on Today until the money is sent another way. The books show it out
      on the day it left and back on the day it came back. A refund that was sent some
      other way can be written down on a card order, which sends nothing. Still to do by
      a person: nothing, until one happens. Then write to the customer first.

## Would make it sell harder

- [ ] Real product photography or approved illustration of the bottle and the packs.
- [ ] A hero loop and reels. The slots are in `content/media.ts`; the encoder is
      `scripts/build-media.mjs`. Nothing on the Drive is to be used yet: on 13 November
      (New Zealand time) the brand pack marked every motion file it holds (the hero loop,
      the films, the stingers) as superseded, pending a rebuild. Never the films that carry
      "for the quads" or "performance with pickles", whatever state they are in. That was
      still so at the last look at the Drive (11:00am on 13 November, New Zealand time),
      after which the hourly watch was switched off.
- [ ] **Vector copies of the three official marks are on the Drive** (`02 Logos/vector/`,
      13 November): the stacked lockup, Lucky flying and the round lockup, drawn in-house
      from the official pictures. The pack's own notes say they are not Ashleigh's original
      vectors and list where they differ. The site keeps what it has: her own paths where
      she drew them as vectors, and the official pictures elsewhere. Worth a look only if a
      sharper full-colour Lucky is wanted at a large size.
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
