# QUICK PICKLE

Two things in one repository, for Quick Pickle: pickle juice shots, sold direct, in New
Zealand. The juice is clear. There are no pickles in the bottle.

1. **The shop.** A one-page site with its own jar and checkout.
2. **The back end** (`/backstage`). Everything Ashleigh needs to run the business: orders,
   customers, stock, the inbox, marketing, plans and budget, automations. Accounting is the
   one thing it will never do; that is Xero's job.

There is no human writing code here. Sam, who had it built, handed the repository, the
database and the hosting to Claude: build it, verify it, merge it. It is now being handed
to Ash, and "Whose it is" below says what that changes.

The brand is Ashleigh Lennard's: the logo, Lucky the superhero cat, the three colours and
the four fonts. "Brand Guide v2" (Grok's write-up of her files) is a starting point, not a
rulebook. The version this build actually follows is the living guide at `/backstage/brand`,
rendered from the same tokens and components as the site.

Everything a customer sees says Quick Pickle. "Pickled Jews" (what the repository was called
until Sam renamed it `quick_pickle` on 12 November 2026) is the umbrella the project sits
under. Whether it ever shows on the pack or the site, and in what
words, is Ashleigh's call and is not made yet, so until then it appears nowhere a customer
can see.

## Whose it is

Sam had this built, for Ash. On 16 November 2026 (New Zealand time) he said the build was
done and asked for everything to be written into the repository so it could be handed to
her. `HANDOVER.md` is her way in, `docs/ACCOUNTS.md` is how each account moves, and
`TODO.md` starts with the list for the handover itself.

**What Sam allowed, Sam allowed.** Two things this file says are his own say-so, given
for the build: Claude merges its own pull requests once CI is green, and Claude changes
production's settings through the infra workflow. They stand while the repository is his.
They do not pass to a new owner by being written here. A file is not a person saying yes.

Once the repository is Ash's (on GitHub it has left the `electrumnz` account):

- **Ask her once, at the start, how much she wants done without asking**, and write her
  answer in this section, with the date, in her own words. Until she has said: open the
  pull request, say what it does in a sentence a shop owner can follow, and wait for her
  yes before merging it, and before any infra action other than `status`.
- What goes live is hers to say. Sam may still be about to help, and that does not make
  his go-ahead hers.
- If it is not clear who a session is working for, ask.

None of this touches the rules of the product. No health claims, true facts and the copy
rules do not depend on who is asking: they come from the law, and `legal/COPY-RULES.md`
says where. Changing one is a decision for the owner with a food lawyer, made in that
file, never a favour done in a chat.

## Non-negotiables

**No health claims. Anywhere. Ever.** Quick Pickle is a food. Under the Food Standards
Code a food may not be advertised as preventing or easing a condition (Standard 1.2.7-8),
and any other claim about what it does to a body needs approvals this product does not
have (1.2.7-18). That rules out the line the concept deck is built around: "a pickle punch
to cramps in 60 seconds flat". It also rules out the quieter ones: recovery, hydration,
electrolytes, performance, "for the quads".

So the site sells what it can stand behind: **the taste, the tiny bottle, the ritual, and
Lucky.** `legal/COPY-RULES.md` is binding on every word published, including anything an
AI drafts, and it is machine-enforced:

```bash
npm run audit:copy            # exits non-zero on a banned term
npm run audit:copy:selftest   # proves the scanner still catches the deck's own lines
```

A wink is a claim too. "We can't tell you what it does" implies it does something.

**The rules read text the way a person would** (`lib/backstage/core/reading.ts`), in both
checks: the one a draft is shown with and the last look before anything leaves. A curly
quote is a quote, full-width letters are letters, and a character nobody can see (a
zero-width space, a direction mark, a control character) is taken out, so a word a rule
knows is still that word with one hidden inside it. An email written as pieces marks
where somebody's own words were struck out, and says so when it hands itself over
(`struckOut`), because in typed text that mark is one more thing nobody can see.

Not every word a customer reads is in the repository: a reply typed in the inbox, a
campaign, a template kept in the database, anything a bot drafts. So the rules themselves
live in `legal/scripts/rules.mjs`, and **every operation that sends or publishes words runs
the finished text through `refuseUnsendable` (`lib/backstage/core/copy.ts`) first**, whoever
wrote it. A banned term never goes out. A restricted one goes out only when a person has
recorded that they checked it; a bot cannot. Em dashes are refused there too.

**Facts must be literally true.** Fair Trading Act s 9, 12A, 13. Nothing about the product
is guessed: no ingredient, volume, origin, storage line or process word ("strained",
"brewed") appears until Ashleigh confirms it. Unknown commercial facts carry a stand-in in
`content/offer.ts` and are listed in `UNCONFIRMED` there. Every one of them is set in the
back end, and an owner says each is right on its go-live list once its figure or its words
are in (`shop.confirm`). While any is still open the site tells crawlers to stay out and
`npm run prelaunch` fails.

**No demo or preview banner on public pages.** Test mode is explained once, on the
checkout, where a visitor would otherwise expect a card field. (A staff preview of a
landing page does carry a strip saying what it is. It is behind the sign-in, and a
customer can never reach it.)

**No em dashes in customer-facing copy.** Use a full stop, a comma or a colon. The founder
reads them as machine-written. Code comments are not copy.

**Never trust a price from the browser.** The jar holds SKUs and quantities. Every total
is computed from the offer (`lib/shop/offer.ts`: the catalogue file with the back end's
changes laid over it) by `lib/shop/pricing.ts`, and computed again on the server, from the
server's own copy of the offer, when an order is placed. There is no price field on any
form: what a form sends about prices is a word for "the prices I was shown", never a number.

**Every change in the back end goes through an operation.** `lib/backstage/core/op.ts` is
the one path: it checks the input, checks the role, runs the change in a transaction with
its activity-log line and its events, and refuses anything outward or irreversible until
someone has said yes. A screen, an automation, a schedule and Claude (through MCP) all call
the same operations. Nothing writes to a table any other way, and nothing sends an email,
charges a card or calls another service from inside a transaction.

**Real records only ever sit behind a sign-in.** With a database connected, the back end
always asks for one. With none it runs on invented records and says so on every screen.

**Never touch the Keece database or Vercel projects.** They belong to a different business
that happens to share an account owner. Quick Pickle has its own Supabase organisation and
its own Vercel account.

## How it is built

Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 · Postgres (Supabase) through
Drizzle · Vercel. No CMS and no Shopify. Commerce is native: our catalogue, our jar, our
checkout, our orders.

```
app/(site)/            the shop: the page, /checkout, /order/thanks, the fine print,
                       landing pages (/for/<slug>) and their staff preview (/preview/<id>)
app/backstage/(door)/  sign-in, first-time set-up (and a new PIN), choose a password
app/backstage/(app)/   everything behind the door, one folder per area
app/layout.tsx         the document, the fonts and the shop's stylesheet. No script.
proxy.ts               in front of /backstage (path header, no-store, noindex) and of
                       the front page, where it picks which page a visitor sees
components/brand/      Lucky and the lockup (inline vector), raster art, icons, the bottle
components/site/ cart/ checkout/ ui/   the shop
components/backstage/  the back end's parts: nav, ui kit, forms
content/               EVERY customer-facing word and commercial fact
db/schema/             the tables. `npm run db:generate` turns a change into a migration
db/migrations/         generated SQL, plus the copy embedded in the build
lib/db/                the one connection, the migration runner, ids
lib/backstage/         core (operations, actors, errors), auth, and one folder per area
lib/shop/              money, jar, pricing, orders, the payment seam, the store seam
lib/mail/              the sending seam (off, or Resend), an email written as pieces, and
                       the check on a webhook's signature
lib/brand/             tokens.css (the only file with a hex), base.css, fonts, art data
lib/time.ts            New Zealand time. Every conversion goes through it.
legal/                 COPY-RULES.md and the scanner
docs/                  the handover documents. `docs/starter` is written by a script
tests/  e2e/           vitest and Playwright
```

`lib/backstage/README.md` is the guide to adding an area to the back end.

### The shop and the back end do not share a stylesheet or a script

`app/globals.css` is the shop's. It is imported by the root layout, beside the fonts, so
the two leave as one file: imported a level down it became a second render-blocking request
and failed the Lighthouse budget. `app/backstage/backstage.css` is the back end's, imported
only by `app/backstage/layout.tsx`. Both use the same tokens and brand base
(`lib/brand/base.css`), each has its own copy of Tailwind, and each **only scans the folders
it names** with `@source`. So the shop never downloads a back-end style and its Lighthouse
budget does not move as the back end grows.

The catch: a file that renders on a public page but is not under a scanned folder loses its
utility classes with no error. Add the folder to the list. `e2e/site.spec.ts` has a test for
the way this showed up the first time.

A link from the back end to the shop is `ShopLink` (a plain anchor, full page load), never
`next/link`: a client-side hop between the two would stack one stylesheet on the other.

### Landing pages

A landing page is the one page with other words in the hero, for one audience or one
advert: `/for/<slug>`. `components/site/ShopPage.tsx` is the page; the standard page and
every landing page render it, so there is one shop and the parts under the hero are the
same for everybody.

- **A page keeps two sets of words: the draft and what is published.** Saving changes the
  draft only. `pages.publish` is the one way words get out: it is outward, needs a yes, and
  runs the copy rules over the finished text (`refuseUnsendable` and the marketing gate). A
  banned term refuses it; a restricted one needs a recorded human check. The public address
  only ever reads `published`.
- A page that exists but is not up (a draft, or taken down) shows the **standard page** at
  its address, because an advert or a printed QR code may still point there. An address
  nobody made is a 404.
- The public page is rendered once and kept for a minute. Publishing or taking down raises
  an event whose listener throws the kept copy away, so a change shows at once.
- `<main data-page>` says which page is on screen. The visit counter and an order both read
  it, which is how Numbers tells the pages apart.
- **The preview is the real page, not a likeness.** `/preview/<id>` lives among the shop's
  routes so it is drawn by the shop's stylesheet, but `requireStaff()` is its lock like any
  back-end page. It carries the strip, is never cached or indexed, may be framed only by
  this site (the editor shows it in a phone-sized frame), and its visits are not counted.
- The headline is set as written, a line to a line, at the biggest size its longest line
  fits (`fitFor` in `components/site/Hero.tsx`).

**Who sees which page.** Two things can put a landing page at the front of the shop for
some visitors: a rule ("people who came through Kai's link see Kai's page") and a test
between two pages. Both are optional and both start switched off.

- **With nothing switched on, nothing happens.** `pages.routing` is empty, `proxy.ts` passes
  the front page straight through, and no cookie is read or set for anybody. That is the
  normal state, and a test (`tests/core/proxy.test.ts`) holds it there.
- `lib/shop/routing.ts` is the decision, one function with no imports: a rule that matches
  how the visitor arrived this time, else what they were shown before if that still stands,
  else a running test, else the standard page. The proxy, the back end's "see it as" and the
  tests all call it, so they cannot disagree.
- A landing page is served **at the front page's own address** by a rewrite. The pages are
  already built and kept, so the proxy adds a decision and not a render.
- The one cookie (`qp_page`) names a page and why (which rule, or which side of which
  test). It is only set by a rule or a test, it is believed only while that rule or test
  still exists, and it is cleared when they end. `qp_buyer` is set at the checkout only
  while some rule asks about having bought before.
- **"No answer" is not "nothing set up".** If the proxy cannot find out what is set up it
  serves the standard page and touches nothing, and it goes on using the last good answer.
  Wiping a visitor's cookie because the database blinked would flip them between two
  versions of the shop.
- **The proxy must never be why the front page fails or is slow.** The first visitor after a
  start waits at most 400 ms for the answer and then gets the standard page; everybody after
  is served from the last answer while a new one is fetched behind them. That fetch is handed
  to `event.waitUntil`, because a host that sleeps between requests would otherwise never
  let it land. The answer is believed, so `asRouting` checks it to the letter: one thing out
  of place and it is no answer.
- `home` is the standard page's name everywhere (the numbers, the cookie, a test's first
  side), so a landing page may not take it as its address.
- A machine that says it is one is never put in a test or sent to a landing page: a search
  engine always gets the standard page.
- A test counts only the visits and orders it put on a page itself (`page_events.test`, and
  `test` in an order's `source`). Its verdict is a sentence: too early, too close to call,
  or one page ahead by more than luck. One test at a time, and the database enforces it.
- What the shop is told is asked for at most every ten seconds, so a change takes a few
  seconds to reach every visitor. Nothing may promise it is instant.
- Never start a test on a shared server from a browser test: every other test's front page
  would be split. The split is covered by `tests/core/proxy.test.ts`; the browser test uses
  a rule for a link of its own.

### The line across the top

The line of words that runs across the top of the shop (`TopTicker`) is the site's own
(`TICKER` in `content/site.ts`) unless the back end has published another: Marketing,
Landing pages, The line across the top. `lib/backstage/shop/top-line.ts` is the
operations and `lib/shop/top-line.ts` the part the shop shares with them.

- **It has a draft and what is published, like a landing page.** Saving changes the draft
  only. `shop.publishTopLine` is the one way words get out: outward, needs a yes, and runs
  the copy rules over the finished words (`refuseUnsendable` and the marketing gate). The
  shop only ever draws what is published.
- **A yes is for the words that were on the screen.** Publishing is handed the lines it
  was shown and refuses if the draft is something else by now. A bot may write the draft
  and never publishes it (`PEOPLE_ONLY`).
- **The rules read the lines the way the band runs them:** one after another, and round
  to the first again, never a line at a time. Two lines that are each fine can make a
  sentence that is not, and the band has no end. The same review found "It's good for"
  and "you and your mates" published as two clean lines.
- **What is typed is tidied of what nobody can see** (`tidyTopLines`): a zero-width
  space, a mark that turns the writing round, a control character, half of a pair. A
  row of nothing that shows is not a line. What holds an emoji together stays.
- A write only lands if the row still holds what was read (`writeTopLine`). What is
  compared is the row's own contents, not the moment it was written: two writes can
  share a moment.
- **Nothing typed is thrown away for being a letter over.** A draft may be longer than
  what can be published (8 lines, 60 letters each): the screen says what does not fit, and
  the draft waits.
- Putting the site's own line back is one press, and what was up is kept as the draft.
- It is kept in one `settings` row. With no row, or one that cannot be read, the shop
  shows its own line. A page asks through `topLineForPage()` (`lib/shop/top-line-now.ts`):
  never while the site is being built, and with no answer the last one it had, so a line
  somebody took down does not come back because the database blinked.
- **The band is always full and runs at one pace**, however few or many the words
  (`bandFit`, under "Design rules that came from measuring"). One short line is laid out
  about sixty times to cross the widest screen, a single letter about a hundred and
  fifty, and far fewer of them are drawn on a phone. Only letters a reader can see are
  counted. Only the first copy is read out by a screen reader.
- A special that is switched on still says itself first, in front of whichever line it is.
- The preview is the real page: `/preview/home?line=draft`, behind `requireStaff()`.
- **Never change the line from a browser test on the first server:** every other test
  reads the top of the shop. `e2e/backstage-auth.spec.ts` does it on the sign-in server.

### The films on the shop

The six promo films made on 16 November 2026 can play on the front page, whole, silent
and looping, in the strip of reels ("See it in action.", `ReelsSection`). They are in the
repository (`FILMS` in `content/media.ts`, the files in `public/media/`), and every one
starts switched off. `lib/backstage/shop/films.ts` is the operations, `lib/shop/films-now.ts`
the shop's read: Marketing, Landing pages, Films on the shop.

- **A person chooses, after watching them.** The screen plays each film exactly as the
  shop would, with a box to tick. `shop.showFilms` is outward, needs a yes, and is
  never a bot's (`PEOPLE_ONLY`): a bot cannot watch a film for the person saying yes.
- **A yes is for what was on the screen.** The form sends which films were on when it
  was drawn, and the change is refused if that is not so any more.
- They show in the catalogue's order, whatever order they were ticked in. A key the
  catalogue no longer has is simply not on, and a row that cannot be read is none.
- **The strip says how they were made.** While a film is in it, a line under it says
  made with AI, and that the people are not real when one with people in it is showing
  (`REELS` in `content/site.ts`). The platforms ask for their own label on a post.
- Each film's caption and description are read by the copy rules as it is switched on,
  as well as by the scanner. The words burnt into a film were read when it was made.
- The strip is not drawn at all with nothing in it, and a page asks through
  `filmsForPage()` like the line across the top: never while the site is being built,
  and with no answer the last one it had.
- A film plays only while it is on screen and never under reduced motion or a data
  saver (`LoopVideo`), so its poster is all some visitors see: `--poster-at` in
  `scripts/build-media.mjs` takes it from a moment that shows what the film is.
- **Never switch films on from a browser test on the first server:** every other test
  reads the front page. `e2e/backstage-auth.spec.ts` does it on the sign-in server.

### The database

- `DATABASE_URL` (or `POSTGRES_URL`, which the Vercel and Supabase integration writes) is a
  real Postgres. With neither set the app runs on PGlite, Postgres in the same process: in
  memory for tests and deployments, under `.data/pglite` in development.
- The app migrates itself on first connection, from SQL embedded in the build. Change
  `db/schema`, run `npm run db:generate`, commit the result. A migration that has run
  anywhere real is never edited; add another.
- **A Vercel preview ignores the database** unless `QP_PREVIEW_DATABASE=1`. Previews run
  unmerged code and take test orders. They get the demo data.
- **Every table calls `.enableRLS()`** and a test fails if one does not. Supabase publishes
  the `public` schema through its Data API otherwise. The app connects as the owner, which
  RLS does not apply to.
- Ids are a prefix and 20 readable characters (`ord_…`), random. Sort by `created_at`.
- Money is integer cents. Moments are `timestamptz`, shown in New Zealand time by
  `lib/time.ts`. Never `new Date("2026-11-12T09:00")` on the server: it is UTC there.
- In a sub-query that looks back at the outer row, write the outer column in full
  (`"orders"."id"`). Drizzle drops the table name in a one-table query and the bare column
  then means the inner table's.

### The back end

- **Sign-in:** named accounts with roles (owner, staff, viewer). argon2id passwords,
  sessions stored as hashes, lock-out after five wrong tries, one-time links for invitations.
  The first owner is made once at `/backstage/set-up` with `BACKSTAGE_SETUP_CODE`.
- **For now the first owner comes in with a PIN**, and the shop's footer has a plain
  **Staff** link to the door (Sam, 15 November 2026: "a link in the footer and a pin for
  now. its not a live active website"). `lib/backstage/auth/pin.ts` is the whole idea.
  - The PIN login is an ordinary owner account whose email is a stand-in
    (`pin@backstage.invalid`). That is how there is at most one, and how everything else
    tells (`isPinLogin`). Nobody is invited under a `.invalid` address, and the email
    door never opens it. **A screen that shows a staff member's email asks `isPinLogin`
    first:** the stand-in is never shown as an address, or written to. `staff.list`
    hands back no email for it at all.
  - **A PIN is short, so the door counts wrong tries for everybody together** (`pin:door`
    in `throttle.ts`), not for each address: five in a day locks it, and each lock is
    twice the last, up to a day. A right PIN wipes the count and not the ladder, or a
    guesser would get a fresh run of short locks whenever the owner came in. Locked means
    the right PIN is turned away with the rest.
  - **A try is counted before the PIN is looked at**, and only the first five in a day
    are ever checked against it (the next bullet but one says how, for every door).
  - **The set-up code is what stands behind it.** It makes the PIN, it sets a new one
    (`/backstage/set-up` lives on for that while a PIN login exists), it wipes the lock,
    and it is mixed into the PIN before the PIN is hashed, so a copy of the database
    alone gives nobody the PIN. Change the set-up code and the PIN stops working: set a
    new one.
  - **Nothing a PIN session does can put the set-up code out of reach.** Swapping the
    PIN for a proper login takes the set-up code as well as being signed in, and
    `staff.update` refuses to switch the PIN login off or turn it down. Without those,
    somebody who only knew the PIN could shut the real owner out in one press, and only
    the database would undo it (an independent review, 15 November 2026). They can
    still make themselves an owner: the real one sets a new PIN and reads the staff list.
  - **Whoever has just proved themselves is let in without a counter** (`signInProven`):
    after the set-up code, a one-time link, or a swap made while signed in. A counter is
    anybody's to run up. The same review found the door could be locked before the
    first owner was made, and filled again in the instant after a new PIN wiped it.
  - **Setting a login again cuts off every Claude connected under it** (`cutConnectionsOf`,
    in `lib/backstage/connect/cut.ts`): a new PIN, the swap, and a new password link.
    Signing browsers out is not enough. A connection renews itself and never asks for
    the PIN again, so whoever had the old one could have left a Claude of their own in.
  - **Tries at the set-up code are counted against the caller's own address, never a
    counter everybody shares.** Otherwise whoever locked the PIN door could lock the way
    round it for five more tries. That is safe because the code is long and random (the
    infra script makes it), which a PIN is not.
  - **It is not ready for launch, and says so.** The go-live list counts a PIN door as
    open work. Settings, Staff has one form (`staff.makeProperLogin`) that turns the same
    account into an email and a password, so everything it did keeps its name. After
    that the PIN and the set-up page are gone for good, and the set-up code opens
    nothing.
  - A PIN login is never given a password link: the door could not check a password.
- **Every guess takes its place in the line before it is looked at**
  (`takeTries` in `lib/backstage/auth/throttle.ts`): a password, the PIN, the set-up
  code. The count goes up in one statement the database runs by itself, and a right
  guess gives its place back. Looking first and counting after lets a burst through: a
  hundred guesses sent in the same instant each read "no wrong tries yet". The PIN door
  was built that way first, and a test sent thirty at once with the right one twentieth.
  It walked in (15 November 2026). The email door had done the same since the start.
  - A guess is held against the address it came from, then against what it is guessing
    at. **The address is named first**, so one that is locked out cannot use up an
    email's tries or the PIN door's. A guess that is turned away by one counter was
    never looked at, so it is given back on the others.
  - Coming in right is never charged to the address: a whole office signs in from one.
- `requireStaff()` is the lock, called by every page and (through `staffCaller()`) every
  action. `proxy.ts` is not the lock.
- **Outward and irreversible operations** (`effect: "outward" | "destructive"`) need a yes.
  A form's button is the yes. A bot has to ask first.
- **Demo mode** (no database): open, seeded through the real operations, labelled on every
  screen. The label lives only in the back end. Nothing on a public page says "demo".
- **A notice box only ever says the back end's own words.** The sentence a page shows
  after a form is saved travels in the address, and anybody can type an address. So the
  back end seals each one it writes (`lib/backstage/ui/notice.ts`): the sentence, its
  tone, the page it is for and the moment it was said, signed with a secret the server
  already holds (the clock's, else the set-up code, else the database's own address).
  `proxy.ts` checks the seal before any page is drawn and takes the sentence out of the
  address if it does not hold, by sending the browser to the same address without it.
  - Pages read `notice` and `tone` as they always did and check nothing. **Never build
    `?notice=` by hand:** use `submit`, `sayAndGo` or `withNotice`. One built by hand
    shows on a developer's machine and is taken out in production, so a test reads the
    source and fails on it (`tests/core/notice.test.ts`).
  - A seal is good for its own page and for ten minutes. After that a reload shows the
    page without the sentence.
  - Only a page being asked for is checked (GET and HEAD). A form posts to the address
    it is on, stale sentence and all, and must never be turned away for it: what the
    form gets back is drawn from a new address with a new sentence.
  - **So nothing may put an address in front of a browser, other than by a page being
    asked for, unless every sentence in it was sealed.** A form that hands back what was
    typed and has its page drawn again draws it from the address the browser is on. A
    redirect from a form is the one way an address gets there unasked (with scripting
    on it sets the address without asking for the page), and the only form that
    redirects to an address from outside is signing in. `safeNext`
    (`lib/backstage/auth/next.ts`) is the one function that reads a return address: a
    page of the back end or nothing, and never with a sentence in it. An independent
    review found a sentence riding in that way (15 November 2026). **Add a form that
    redirects to an address it was handed, and send it through `safeNext`.**
  - This is not the lock either. It decides what a notice box may say, never who comes in.
  - Both browser-test servers are given a secret, so every form the tests press goes
    through the seal.
- The old build's "one shared password, no email" rule was dropped on purpose: with several
  people and bots at work the activity log has to say who did what. (The PIN above is
  one named owner's login. Hand it to a second person and the log says one name for
  both, which is one more reason it goes before launch.) Its "no MCP" decision is
  also reversed: a member of staff can connect their own Claude, over the same operations
  (see "Claude, connected" below).

- **One person runs this (Ash).** Anything she does not need every day ships switched off
  and out of the daily screens: nothing to look after unless someone starts it. A screen
  that needs explaining says the answer in one sentence first and shows its working under
  it. (Sam, 12 November 2026, on A/B tests: "it'll be too much for Ash to manage".)

### What happens after a change

An operation writes events in its own transaction and does nothing outward. Once it has
committed, `lib/backstage/core/events.ts` hands each event to its listeners (`after()` in a
request), at least once: a listener that throws is retried with a growing wait and given up
on after eight tries, where a person can send it round again. So **every listener must be
safe to run twice**. `lib/backstage/handlers.ts` is the one list of who hears about what.
Tests leave the dispatcher off and call `processEvents` themselves.

**The clock** (`lib/backstage/clock/tick.ts`, reached at `/api/tick`) is what makes "later"
and "again" happen: it gives failed listeners their next try and settles an order still
unpaid long after its payment page ran out. The database's own scheduler rings it every
five minutes (pg_cron and pg_net, set up by the infra workflow's `connect-clock`), with
`CRON_SECRET`; the host's daily cron in `vercel.json` is a second caller. It lives with the
database so that it survives a change of host. Everything it does is safe to do twice, and
it can be minutes late, so nothing in the product may promise a time to the minute. The
go-live list shows when it last ran and what is stuck.

### Commerce

- `content/offer.ts` is the catalogue. Money is integer cents; never a float in a price path.
- **The offer is a value, not a constant.** `content/offer.ts` is where every commercial
  fact starts, and with no database it is the whole story. The back end lays a short, closed
  list of changes over it with no deploy (Settings, The shop): a pack's price, the delivery
  rates, the ship date, pre-order or live, the batch's name, the contact address, and whether
  orders are being taken; and on a screen of their own (Settings, The label and the
  company) what the label says and who the company is. It can never add a pack, a size or
  a currency.
  `lib/shop/offer.ts` is the type and the browser-safe part; `lib/shop/offer-changes.ts` is
  what may change and how it is laid over the file (zod, server only);
  `lib/backstage/shop/ops.ts` is the operations. Only what differs from the file is stored
  (one `settings` row), so a figure set back to the file's is forgotten.
  - **Everything that reads a price is handed the offer**, first: `quote(offer, cart)`,
    `normaliseCart(offer, input)`, `packBySku(offer, sku)`, `faqs(offer)`, `policies(offer)`.
    Nothing in the shop imports `PACKS`, `SHIPPING` or `STORE` for something a customer
    reads. In the back end an operation asks `readShop(ctx.db)`.
  - **Two ways to ask, for two jobs** (`lib/shop/offer-now.ts`). `offerForPage()` draws a
    page: it never asks the database while the site is being built, and with no answer it
    gives the last one it had, then the file's, so it is never why a page fails.
    `offerNow()` prices an order: read fresh, no fallback.
  - **A page can be a little behind, and that is safe.** The form sends the offer's
    `version`, a word that changes when anything that moves a total does (a price, a
    delivery rate, pre-order or live, open or shut) and not otherwise. If the server's
    offer has another word, the order is handed back with the new total first
    (`SHOP.moved`) and the page redraws from the offer that came back with it. A price
    that went DOWN is handed back too: a word cannot say which way. `orders.record` reads
    the offer once more inside its own transaction, so a change that lands in the instant
    between is caught as well. Nobody is charged a total other than the one on the button.
  - **The browser is handed `forPage(offer)` and nothing more:** prices, delivery, the
    batch's name. The notes on what is still to confirm are for the people running the
    shop and never reach a page's source. The jar (`CartProvider`) holds it; the checkout,
    which is never a kept copy, hands the jar its own fresher one (`FreshOffer`).
  - **Kept pages.** `shop.changed` throws away every page under the shop's layout at once.
    The layout's `revalidate = 60` catches everything else, above all a fresh deployment,
    whose pages were built from the file alone.
  - **Changing the shop is two presses** (`shop.checkChange`, then `shop.change`, which is
    outward and needs a yes). The first saves nothing and reads the change back in
    sentences; the second makes exactly that change to exactly the shop that was shown.
    It refuses a price under a dollar, a bigger pack that costs no more than a smaller
    one, and a batch name that fails the copy rules. **Changing a figure never confirms
    it:** `shop.confirm` is a separate act, for an owner, with their name beside it.
  - **Every sentence that reads a rate is written for every way it can be set**
    (`content/delivery.ts`): standard delivery free for everybody, a flat rate, or a flat
    rate waived from a stated spend; a rural extra, or none. `freeOverCents` null means no
    order earns it. Free for everybody is said one way only, by a flat rate of nothing,
    and where a rural address still pays an extra the sentence says "standard delivery
    is free", so "free" never stands without its one condition. Add a sentence that
    reads the offer and write it for all of these: `tests/shop/offer-words.test.ts`.
  - **What the label says is never ours to write** (`label` on the offer: the ingredients
    list, the allergen line, the storage line). A person types it with the printed label
    in hand, it is read back before it is saved, and the site shows it as typed under
    "What's in it?". It meets the copy rules as it is saved. On the ingredients list
    only, the words the Food Standards Code itself puts there (an additive's class name,
    an added vitamin or mineral) are held for a person's recorded check, where anywhere
    else they are refused (`ON_A_LABEL` in `lib/backstage/core/copy.ts`). A bot's tick is
    not taken, and the screen's tick only counts for the words it was shown beside. With
    no allergen line the site says nothing about allergens, and never that there are
    none. Nothing drafts, tidies or guesses these.
  - **Who the company is** (`company`: legal name, NZBN, address, GST number) is a fact
    about us and not words of ours, so it is not put through the copy rules, the way a
    customer's own address is not: a registered name is whatever it is. The two numbers
    are checked by their own check digits (`lib/shop/company-numbers.ts`). A receipt
    names the legal seller once it is set, and says how much of the total is GST only
    when the business is set as registered and has its number in. A GST number on a
    business set as not registered is refused: one of the two was typed wrong.
  - **Shut** (`open: false`, for a batch that has sold out or a week away): the buy button
    cannot be pressed and says so, the sticky bar goes, the hero's button leads to the
    Pickle Crew, the jar has no way through to the checkout, and the checkout takes
    nothing. Today carries a line for as long as it is off, so nobody forgets.
  - The 404 has no jar. It sits outside the shop's layout and is carried inside every
    other page, the back end's included, so a jar there would mean an offer there.
  - **Never change the shop from a browser test on the first server:** every other test's
    total would move. `e2e/backstage-auth.spec.ts` does it on the sign-in server, whose
    shop nothing else buys from. Both test servers keep the pages they draw again in
    memory (`QP_KEPT_PAGES=memory`), because they share one build folder and a page
    drawn by one would otherwise be served by the other, or by the next run.
- `lib/shop/payments` is where a processor plugs in, named by `PAYMENT_PROVIDER`. An
  unknown name throws rather than falling back to test mode.
  - `test` (the default): the checkout records the order, charges nobody, and says so.
  - `stripe`: Stripe's hosted payment page, with no SDK. The order is **saved first** as
    awaiting payment, a payment page is made for exactly its total (the order number is the
    idempotency key), and the buyer is sent there. Stripe's signed webhook
    (`app/api/stripe/webhook`) marks it paid; the page the buyer returns to asks Stripe as
    well, through the same operation, so whichever arrives first does the work. A test key
    means Stripe's test mode and the checkout says that instead.
  - The page is asked for in New Zealand dollars only (Stripe's own-currency offer is off,
    so the figure on its page is the figure on our button) and in the shop's colours. Both
    are niceties: if Stripe refuses the request with them on, it is asked again without.
  - Money arriving is never taken on trust: `orders.markPaid` checks amount and currency
    against the order, is safe to call twice, and flags a payment for a cancelled order
    for refund instead of reopening it. A payment that does not match is written down once
    (payment status `review`) and waits for a person; no clock closes it.
  - Cancelling an unpaid order closes its payment page at Stripe, through a listener.
  - A refund on a Stripe-paid order is saved as `pending` and sent after the save, by a
    listener, under our own refund id. The refund's row is the record of whether the money
    went: before sending, Stripe's own list is checked for that id, because Stripe forgets a
    request after a day and a retry can come later. Refused, it comes back off the order.
    Any other order's refund is only written down, and the screen says which it will be.
  - A refund made from Stripe's own dashboard is written onto the order when Stripe says
    one was made (`charge.refunded`). `lib/backstage/orders/outside-refunds.ts` reads the
    refunds Stripe holds for that payment and `orders.refundsSeen` records any the order
    does not have. **Stripe's list is the record and its news only the nudge**, so being
    told twice, late or out of order writes nothing twice. A refund the back end started
    carries our own id at Stripe and is never counted again.
  - **A refund can come back.** It leaves, the customer is told, and days or weeks later
    their bank cannot put it on the card (it has been closed, say). Stripe marks the
    refund failed and says so (`refund.failed`, `refund.updated`). That news only says
    "look again": the same read of Stripe's list writes a refund the order holds as given
    down as `returned`. It comes back off what the order has given back and **keeps both
    its dates, because money moved twice**: the books show it out on the day it left and
    back on the day it came back, and never rewrite a day that may already be with the
    accountant. Nobody is emailed. Today carries it until money goes back another way:
    `orders.recordRefund` with `byHand` writes down, on a card order, a refund that was
    sent some other way, and sends nothing.
  - **A card dispute is read from Stripe as it stands, never from the news about it**
    (`lib/backstage/orders/disputes.ts`, table `payment_disputes`). Open, it is on Today
    with the date an answer is due, urgent while the shop is the one being waited on.
    Won, the order is untouched. Lost, the amount is written as given back
    (`refunds`, reason "Card dispute lost"), so the order and the books are true, and it
    raises `order.dispute_closed`, never `order.refunded`: nobody is told a refund is on
    its way for money their bank took back. Once decided, later news changes nothing.
    The order's own page says where it stands, in the same words wherever it is said
    (`disputeInWords`), and links to Stripe's list of disputes. Stripe's documentation
    gives no address for one dispute, so none is made up: the page shows the dispute's
    own id beside the link.
  - The site only hears the kinds of news its endpoint was told to send. Teach it a new
    one and add it to `STRIPE_EVENTS` in the infra script, then run `stripe-events`: that
    changes the list on the endpoint that is there, and keeps its signing secret.
  - **Stripe's payment page cannot be driven by an automated browser.** Its bot check
    swallows the press on Pay. Everything up to it and the way back can be; the paid path
    needs a person with a test card (4242 4242 4242 4242), then `status` in the infra run.
- **Every operation that changes an order loads it with `forChange`** (`orders/load.ts`), a
  row lock held to the end of the transaction, so a person and a webhook changing one order
  take turns. Reading a figure and writing it back without that lock is how two refunds
  pass one cap.
- An operation that finds its work already done says `ctx.nothingChanged()`. Without it the
  activity log gets a line for a repeat that did nothing.
- **A promo code is a word, never a number.** The checkout sends what the buyer typed and
  nothing else. What it is worth comes from the code's own terms
  (`lib/backstage/marketing/promo.ts`), is worked out when the jar is priced, and is worked
  out again inside the transaction that records the order, where its use is counted in one
  guarded statement (two buyers cannot both take a last use). An order that is never paid
  gives its use back. On Stripe's page the saving is a one-off coupon for that order, and
  if the coupon cannot be made no page is made. One code an order; none may take an order
  below a dollar. Everything a customer is told about a code is in `CODES`, in `content/`.
- **A special is a promo code nobody types.** It is the same table, the same sums and the
  same guarded count (`promo_codes.automatic`), so an order on a special is recorded,
  refunded and added up like one with a code. What is its own is in
  `lib/backstage/marketing/specials.ts`:
  - It ships switched off. Switching it on is publishing: outward, needs a yes, and its
    name (the one thing a person typed) goes through the copy rules first. What it gives
    and until when is never typed. `specialSentence` writes it from the terms and from
    words in `content/`, so the sentence a customer reads is what the checkout does.
  - It can only be changed while it is off, and a code's operations refuse to touch it.
  - One special at a time: two switched on over the same days is refused. One saving an
    order: with a code typed as well the buyer gets whichever takes more off, and a tie
    goes to the code. A partner's code that lost to the special is still credited
    (`creditCode` on the order).
  - The form sends the special's word, never a number. If that special is not what comes
    off any more, the order is refused and the buyer is shown the new total, so nobody pays
    more than the button said. Paying less than was shown needs nobody's leave.
  - The shop's pages are built once and kept, so the special is read when a page is built
    (`lib/shop/special-now.ts`), and never while the site itself is being built. Switching
    one on or off throws the kept pages away. While one is switched on the clock does the
    same on every tick, which is what catches a first day, a last day and a new deployment.
    `WhileOn` hides one whose last day has passed, whatever the kept copy says.
  - Never switch a special on from a browser test unless no other test's jar can reach it
    (`e2e/specials.spec.ts` asks for $300 of packs): every other test's total would move.
- **The Pickle Crew's welcome code** is an ordinary code with `crew_welcome` set (at most
  one, held by an index). The crew form shows it as somebody joins, and their browser keeps
  it like a code a link carried. It is only handed out while it could be used.
- **Who brought an order in is decided once, when it is placed, and kept on the order.**
  A promo code or a short link can belong to a partner (a club, a creator, an event). The
  order is credited to whoever owns the code that was used or, failing that, the link the
  buyer came through (`lib/backstage/marketing/credit.ts`), and it keeps its own copy of
  that partner and the cut they were on (`orders.partner_id`, `orders.commission_percent`).
  Results are added up from those copies, so changing a deal or handing a code to somebody
  else never rewrites the past. A partner is paid two ways, often both: a cut of each sale
  (a percentage, set on the partner) and flat costs written down as they happen (a fee,
  product given away). `collab-sums.ts` is the arithmetic and `collabs.ts` the results.
- **Only real sales count, everywhere:** paid orders less refunds. Test orders and cancelled
  ones are never sales. The Customers screen and every collab figure use the same rule.
- **How a visitor arrived lives in their own browser, not in a cookie.** `/go/<slug>` adds
  `via=<slug>` to a page on this site, and `code=<CODE>` if the link carries one. The page
  keeps both in `localStorage` for thirty days (`lib/shop/arrival.ts`) and sends them only
  with an order. The code is tried at the checkout so nobody types it; the link is a label
  on the order. Both are claims from the address bar: the server works the code out from its
  own terms and drops a link it does not know. `lib/shop/code.ts` imports nothing, on
  purpose, so the browser can tell what could be a code without pulling the database in.
  The privacy page says all of this; change one and change the other.
- Every short link has a QR code (`lib/backstage/marketing/qr.ts`), which only ever holds
  the link's own address on this site. Its tests scan the code back with a reader.
- **The shop counts its own visits, with no cookie and nobody identified.** A page tells
  `/api/seen` that it was viewed, that something went in the jar, that the checkout was
  opened (`lib/shop/seen.ts`). Each page load makes a random id that lives only in that
  page's memory. A browser that asks not to be tracked (Global Privacy Control, Do Not
  Track) sends nothing, and the server checks again. Machines that say what they are are
  not counted, nor is anything not sent by one of our own pages, and the address answers
  204 whatever happened. **An order is never counted on a browser's say-so**: `orders.record`
  writes the visit's last step itself, in the order's own transaction. Visits are kept
  thirteen months; the clock throws older ones away. The privacy page says all of this.
  A page whose address is somebody's own (the unsubscribe link from an email) says so
  with `data-uncounted` on its `<main>` and sends nothing; the server refuses that path
  too. A new page with a secret in its address needs both.
- **Visits and sales are two different things, and Numbers says which is which.** Visits are
  our own count and run a little low. Sales are the orders: paid, less refunds. Every
  figure on `/backstage/numbers` comes from one read (`numbers.summary`) for one stretch of
  New Zealand days, so they agree with each other.
- **The checkout counts how often one internet address asks it things, and past a ceiling
  asks it to wait** (`lib/shop/limit.ts` for what counts, `lib/shop/caller.ts` for who is
  asking, `limits.hit` for the count). In ten minutes: 20 promo codes we do not know or
  questions that name a person, 30 presses of the order button, 20 Pickle Crew sign-ups.
  - **One address is often a crowd** (a club's wifi, a stall, a phone company's shared
    addresses), so an ask about a real code, and a form handed back to fix a field, is
    counted and then given back. Only what a guesser does stays on the count. Change what
    counts and keep that true: `tests/shop/limit.test.ts` holds it.
  - The count is taken first, in one guarded statement, and given back after. Checking
    first and counting after lets a burst through.
  - No address is kept. The key holds a keyed hash of the address (an IPv6 one by its /64),
    the question and the window, so it changes every ten minutes, and the clock throws rows
    away after two hours. The privacy page says so; change one and change the other.
  - A fourth count, `knock`, is not the shop's: an app registering with the connection
    for Claude, or handing it a code or a key. A real swap or renewal is given back.
  - **Two more are the shop's own counts, and nobody is ever turned away for them:**
    `seen` (600 steps of the visit counter) and `link` (300 follows of a short link). Past
    the ceiling the page still answers and the link still leads where it leads. It is
    simply not counted, so the numbers and a test's verdict cannot be padded out. The
    ceilings sit well above a crowd on one wifi, because a busy ten minutes is when the
    numbers matter. A link's ask is counted after the visitor has been sent on.
  - It is on whenever a database is connected, so never in the browser tests, which all
    come from one address. It is never why the shop fails: no address, or no count, and
    the answer is yes. `QP_LIMITS=off` stops it (the infra workflow's `limits-off`, then
    `redeploy`; `limits-on` is the way back), and the go-live list says which it is.
  - **The address is read from headers Vercel writes itself.** On another host, or with a
    proxy in front of this one, `callerOf` is the line to change. Believe the wrong header
    and either anybody picks their own address or every buyer shares the proxy's.
- **The courier is a file out and a list back** (`lib/backstage/orders/courier.ts`, the
  screen at `/backstage/orders/courier`). No courier's system is linked to.
  - Out: `orders.courierFile` makes one row an order under the field names Starshipit
    lists for a file of orders. It changes no order, and is written in the activity log
    because customers' addresses leave the back end in it. There is no weight in it:
    nobody has weighed a packed box, and a guess would be charged for.
  - Back: what is pasted is read by `readTrackingBack`, shown, and only then shipped, by
    `orders.markShipped` once for each order. The second press only acts on exactly what
    the first showed. Only a packed order ships this way: packing is where the batch is
    named.
  - **Reading somebody else's file guesses nothing.** A list is an order number and a
    tracking number and nothing else on the line. A courier's file is read by its
    headings: the tracking column by name, the order's column by which one has our order
    numbers in it. A phone number looks just like a tracking number, which is why no
    column is ever picked by what its cells look like.
  - **A courier's tracking address is read off its own page, never remembered**
    (`lib/backstage/orders/couriers.ts` says where each came from and when). A customer
    is sent that link. For a courier not on the list the customer gets the number alone.
  - **One order shipped from its own page uses the same list** (`shipWith`): pick the
    courier, type the number, and the link is worked out. Nobody pastes one. A number
    that does not read as a tracking number is refused before anything is shipped,
    because shipping cannot be undone and emails the customer what was typed. For another
    courier the name and number are taken as typed, with a link only if the person
    shipping pasted one: they are looking at it, and we do not guess.
  - Every cell a customer typed is made safe for a spreadsheet (`csvCell` in
    `lib/backstage/orders/csv.ts`): one that starts a sum gets a leading apostrophe. Any
    new file that leaves the back end is written with `toCsv`.
- **For the books is what moved on each day** (`lib/backstage/numbers/books.ts`): a sale
  on the New Zealand day it was paid for, a refund on the day it was given. Numbers nets
  a refund against the order's own day, because it asks how the shop did; a ledger asks
  what moved when. Over a stretch that holds both, the two agree. Nothing here is in
  Xero's own layout and nothing says it is: that waits on a Xero account to try it with.
- `lib/shop/store` is where the shop hands an order over. The default is `db`: the back
  end's own `orders.record` operation, so an order is on the Orders screen as it is placed.
- The "order's in" page reads a short-lived httpOnly receipt cookie. It is display only.

### Stock

- **Shots are counted by batch, from movements.** Nothing stores how many are left: on hand
  is the sum of a batch's rows in `stock_movements`. A wrong count is put right with another
  movement and a reason, never by writing a number over it. Anything that takes stock locks
  the batch rows first, in id order, and counts after.
- **One pool.** An order is its total shots across every line (`orderShots` in
  `lib/backstage/stock/allocation.ts`). Packs of 6, 12 and 24 draw on the same shots;
  nothing is checked, promised or taken a pack at a time.
- **The batch is confirmed at packing, never guessed.** Placing or paying for an order
  writes no movement: its shots only count as promised. `orders.markPacked` takes them, from
  the batch the person packing names (`batchCode`, or `batches` for a box that mixes them).
  With one batch on sale that one is used; with a choice and no name it refuses. First
  expired, first out is only the suggestion on the screen. Unpacking puts the shots back;
  cancelling a packed order writes them off unless told they went back on the shelf. A test
  order takes no stock. That is what makes a batch's recall list one query, and true.
- **Only a batch that is released and still good is sold from.** Made-on and best-before
  are New Zealand calendar dates (`date` columns, read as "2026-11-12"). A batch is good
  through the end of its best-before day here: ask `isGoodOn` with `todayKey(ctx.now)`
  (`lib/backstage/stock/dates.ts`), and never compare one with an instant.
- **With no batch recorded, nothing happens.** Until a first batch has been recorded as
  made (`tracking`), orders pack exactly as they did, Today lists nothing about shots, and
  an order's page says nothing about batches. Once there is one, an order packed while no
  batch is on sale says so, because it is on no recall list.

### Email

- `lib/mail` is where a mail provider plugs in, named by `MAIL_PROVIDER`. Unset or `off`
  (the default): nothing is sent, and each email is written down with the reason. `resend`:
  Resend's HTTP API, with no SDK (`RESEND_API_KEY`, and `MAIL_FROM` for the address to send
  from). An unknown name throws rather than falling back to off.
- **Email only ever leaves a production deployment with a real database.** Never a Vercel
  preview, a development server, a back end on demo data, or a test. `mailConnection()` is
  the one answer to "is email being sent, and if not, why": the outbox, the go-live list,
  an order's page and the shop all read it. Under a test runner the seam refuses to use the
  network at all, so a test that reaches Resend has to bring its own `fetch`.
- **The outbox is `mail_messages`.** An operation writes the email down as `queued` in its
  own transaction (`writeOutbound`, `lib/backstage/mail/outbound.ts`) and leaves a
  `mail.queued` event. A listener sends it after the commit and records what happened
  through an operation: `sent`; `not_sent` (written down and, on purpose, not sent: `error`
  holds the sentence why, and that is the end of it); or `failed` (tried again by the event
  pipeline when the provider was busy, and by "Try sending it again" when it was not). The
  message's id is the idempotency key Resend is given, so one message is one email however
  often its event is delivered. A try that got no clear answer is only repeated while
  Resend still remembers the key (a day); after that it is parked for a person, because
  nothing may risk a second copy on a guess.
- **A failure the queue is still trying is nobody's problem yet.** Fifty orders shipped at
  once can meet Resend's rate limit. Each email that is told to slow down is marked
  `qp:retrying` and kept off Today and off the inbox's Not delivered pile until the
  pipeline has had its last try, when it becomes an ordinary failure for a person.
- **Every email is read before it is queued.** One of ours is written as pieces
  (`lib/mail/compose.ts`): our words, the recipient's own (their name, their address) and
  data (a number, a date, a link). `refuseUnsendable` reads the finished email with only
  our words in it, so somebody who lives in Nelson can get a receipt and a banned word of
  ours still stops it. A system email cannot carry a recorded human check, so a restricted
  word stops it too: the words in `content/emails.ts` have to be clean, and a courier's
  name or a code's word that would not pass is left out rather than sent.
- **An order's emails** (`lib/backstage/orders/emails.ts`, one operation,
  `orders.emailCustomer`): the receipt on `order.paid`, on the courier on `order.shipped`,
  cancelled on `order.cancelled`, and a payment on its way back on `order.refunded` when
  it went back through Stripe (a refund made from Stripe's own dashboard included: its
  event names the refund like any other). Money a bank took back in a card dispute is
  never written about. Each is written once (its id is worked out from the order and what
  it is about) and only when it is true. They are transactional under the
  Unsolicited Electronic Messages Act 2007: **nothing promotional may ever be added to
  one**, which is also why they carry no unsubscribe link.
- **The ship date is an order's email too, and the one a person sends**
  (`lib/backstage/orders/ship-date.ts`). The site tells a pre-order's customer "we'll
  email you the ship date" in four places, so somebody is owed that email: every paid
  pre-order that is not cancelled, not on the courier and not a test, whose customer has
  not been told the date that is set NOW. A receipt that said the date counts as telling
  them (each email that says a date carries it in a note, `qp:ship-date`). An email that
  was written down and never sent told nobody, and does not count. So a date that moves is
  owed again to everybody, in words that say it moved. It is written once for each date by
  `orders.emailCustomer` (`about: ship_date`), and never by itself: Today says who is
  owed, and one press on Settings, The shop writes to them, for the date that was on the
  screen. With email not connected the press writes nothing at all, because a message
  written down and not sent would use up each customer's one email for that date. A date
  that has gone by is told to nobody.
- **A test order's customer is not emailed**, with one exception: a payment made in
  Stripe's test mode gets a receipt that says first that it was a test. The practice
  checkout gets none, because pressing its button costs nothing and would let anybody make
  the shop email any address they liked.
- **The shop never promises an email that will not be sent.** The checkout's hint and the
  "order's in" page are told whether email is really leaving (the receipt cookie carries
  `emails`), and when it is not they say nothing about a receipt.
- An address on `mail_suppressions` is sent nothing, its own order's emails included.
- **No secret is logged or stored.** What Resend says when it refuses is scrubbed before it
  is kept, and the go-live list names the settings that are missing, never a value.
- **A campaign's emails are sent a few dozen at a time, by the clock**
  (`lib/backstage/marketing/deliver.ts`). `campaigns.send` lines them up, one row a
  person, and sends nothing. A round takes the next few off the queue and hands each to
  the mail seam: the first few as send is pressed (a listener on
  `campaign.send_requested`), the rest on each tick, which is also what queues a campaign
  that was given a time. A long list goes out over several rounds, so nothing may promise
  when the last one lands.
  - **A person is only written down as failed for a reason that is theirs:** they left
    the list, their address is on the do-not-email list, or the provider will not take
    that one address. When the provider is busy, or refuses us (a wrong key, a domain not
    set up), nobody is marked: the round stops, the rest wait, the campaign and Today say
    why (`campaigns.noteTrouble`), and they go by themselves once it is put right. One
    refusal is taken to be about one person only when an email beside it went. Two
    running are about us.
  - **A provider that is only busy is nobody's problem yet**, like a failed email the
    queue is still trying. Being asked to slow down is ordinary and the next round goes.
    It is said on the campaign and on Today only once the campaign has got nowhere for
    twenty minutes (`BUSY_GRACE_MS`). A refusal of us is said at once.
  - **Nothing is sent again on a guess.** Each email's own id is the key the provider is
    given, and the provider remembers a key for a day, so two rounds at once, or a round
    that died before it wrote anything down, send one copy. A try that got no clear
    answer is written on that email (`campaign_sends.doubted_at`), tried again inside
    the day, and after that set aside saying it may have arrived.
  - The finished email is read against the copy rules before the first one of a round
    goes, footer and all. Only the restricted phrases a person read when they approved
    it are let through. Who the company is and where it lives are facts about us, and
    are not read, as on a receipt.
  - **The subject and the preheader are read together as well as apart** (`inboxLine`),
    because a list of emails runs one straight on from the other. Words are read the way
    they are seen: the same rule as the lines of the band across the top.
  - With real records and no way to send, a campaign cannot be queued at all, and a
    screen says which of the three places it is in (`howCampaignsGo`). On invented
    records each email is written down as not sent.
  - **A bounce that will not get better, or a spam complaint, strikes the address off:**
    the do-not-email list, and marked on the Pickle Crew list. The news comes in by
    Resend's webhook, which hands it on when the email is not one of the inbox's
    (`recordCampaignAfterwards`). A mailbox that is only full today strikes nobody off.
  - The round comes last in a tick, after the pulse is written, and is given only the
    time that is left (`campaignBudget`): it must never be why the tick's request runs
    out.
- **Every campaign email carries a way to leave that needs no sign-in**
  (`app/(site)/unsubscribe/[token]`). The page has one button and looking at it changes
  nothing, because a mail program opens every link in an email to check it. A mail
  program's own unsubscribe button posts to `./one-click`, which is the request itself.
  The token in the address stands for one person, so the page is never kept, never
  indexed, tells no other site its address, and **is never counted as a visit**: its
  `<main data-uncounted>` stops the counter sending, and the server refuses the path as
  well. Only the shop itself may ask whose a token is (`crew.standing`); no screen and no
  bot ever shows one.
- **The morning email** (`lib/backstage/digest/ops.ts`, Settings, Morning email) is one
  email a day to whoever runs the shop, saying how many things need them. It ships
  switched off. Switched on, the clock writes it once each New Zealand morning (its id is
  worked out from the day, so two ticks write one), and each joins the last one's
  conversation. **It carries no record:** counts, what yesterday came to and a link, never
  a name, an address or an order number. Real records stay behind the sign-in, and an
  inbox is not behind it. With email not connected nothing is written down at all.
- **Nothing a test does reaches a real provider, whatever the test sets.** The mail seam
  and the event dispatcher both ask `underTestRunner()` (`lib/under-test.ts`), which reads
  the runner's own marks as well as `NODE_ENV`. They used to ask `NODE_ENV` alone, and a
  test that stood in for production by setting it (the morning email's first) was let
  through to the network. A test that needs email "connected" stubs the settings and
  also puts a counting `fetch` in the real one's place, and ends by checking it was never
  asked (`tests/backstage/morning-email.test.ts`).

### The inbox

Mail to the business's address lands in the back end (`/backstage/inbox`), is kept in
conversations, and is answered from there. `lib/backstage/mail/` is the area;
`ingest.ts` is the one way a message gets in and `mail.send` the one way a reply gets out.

- **Two ways in, both shut until their secret is set** (`endpoints.ts`).
  `/api/mail/resend` is Resend's webhook: its Svix signature is checked against the body
  exactly as it arrived, before that body is read (`RESEND_WEBHOOK_SECRET`). It brings mail
  Resend received for us (the original is then fetched from Resend with the API key) and
  what became of mail we sent. `/api/mail/inbound` takes a raw email from a forwarder that
  holds `MAIL_INBOUND_SECRET`. Neither reads a cookie. An email already held is a success
  that changes nothing.
- **An email's HTML is never drawn.** A cleaned copy is stored, and the screen shows plain
  text: the email's own, or the words read out of its HTML when it has no other. There is
  no `dangerouslySetInnerHTML` in the inbox and there must never be. No picture is fetched,
  nothing a stranger wrote is a link, and an attachment or the original is only ever a
  download (`/backstage/files/<id>`, `nosniff`, sandboxed).
- **Conversations are ours, not a mail program's** (`threading.ts`, a pure function). A
  message joins one for a reason that can be said in a sentence, tried in this order: it
  was sent to the reply address of a message of ours (a signed token); it answers a message
  we hold (In-Reply-To, References); it quotes an order of the sender's own and exactly one
  open conversation with them is about it; it is a reply that lost its headers, from the
  same person, under the same subject, within thirty days. Otherwise it starts a new one.
  The reason is kept on the message and shown. Never a provider's thread id, a subject
  alone, or a number alone.
- **An order number always links, and only joins for its own customer.** Anybody quoting
  QP-7K2M9X gets that conversation shown on the order. Only the customer who placed it is
  let into the conversation about it: a wrong join can put one person's details in front
  of another. A second address is "the same customer" once a person says so (`mail.updateContact`
  ties it, and links what it has already said to that customer).
- **A token routes. It never says who is writing.** A message that arrives by a reply
  address is filed in that conversation and still shown as from whoever sent it, and the
  first message from a new address is pointed out before anyone answers it. A reply goes
  to the address the last person wrote FROM: a Reply-To is offered and never used unasked.
- **Rethreading by hand** is `mail.moveMessage`, `mail.mergeConversations` and
  `mail.splitConversation`. A message a person placed is pinned: automatic threading
  leaves it alone, and replies to it follow it wherever it is now.
- **A reply meets the copy rules as it is sent**, signature and all (`mail.send`, outward,
  needs a yes). A banned phrase or an em dash refuses it. A restricted one refuses it
  unless a PERSON sends it with `acknowledgeRestricted`, which is written on the message
  (`qp:checked`) and in the activity log; a bot's say-so is not taken. The screen's tick
  covers the phrases it showed and nothing typed since. Nothing is exempt, the customer's
  own name included. Saved replies and the signature are refused at save if they could
  never be sent.
- **With real records and no way to send, a reply is refused**, not written down as if it
  had gone. (On demo data it is written down and marked as not sent, like every email.)
- **Whose turn it is** is the conversation's status: needs a reply, waiting on them, done,
  spam. Only a person's message puts the ball in our court. An out-of-office, a notice or a
  delivery report never does, and a conversation every message of which came from a
  machine sits in Notices. An email of ours that did not arrive does not change whose turn
  it is: it puts the conversation on the Not delivered pile until a later one goes or a
  person says it is dealt with.
- **Bounces and complaints stop further sending.** A hard bounce (Resend's event, or a
  delivery report that names an email we really sent) and a spam complaint put the address
  on `mail_suppressions`. Only an owner takes one off.
- **Reply addresses of their own** (`reply+<token>@`, `MAIL_TOKEN_SECRET`) are only used
  while a way in is open. A reply address nothing listens at would swallow every answer a
  customer gave, so without one replies are asked for at `MAIL_FROM`.
- Every email is SENT from `MAIL_FROM`. A mailbox row is an address mail arrives at, and
  where the signature under a reply is kept.
- Nothing in the inbox is switched on by itself: with no secret set nothing arrives, and
  the piles a person does not need every day (Not delivered, Put away) only show while
  there is something in them.

### Claude, connected

A member of staff can connect their own Claude to the back end (Settings, Claude), over the
Model Context Protocol. It was built last, and it sits on the same operations as every
screen. `lib/backstage/connect/` is all of it.

- **It ships shut.** Until an owner switches it on, every address it has answers 404: the
  two discovery documents, registration, the token endpoint and `/api/mcp`. On invented
  records it is shut whatever the switch says. A door that is off does not say it is a
  door, **to any verb**: left alone the framework answers 405 to a verb with no handler
  and 204 to OPTIONS, so every verb on those addresses has one (`notThatWay`).
- **Three tools, not two hundred** (`server.ts`): `find` (what there is, and what each
  takes), `look` (run operations that read) and `change` (run operations that change). The
  model finds what it needs, so a couple of hundred operations cost it nothing until it
  asks. `look` and `change` are two tools so the app can let a look run and show a change
  first. Neither tool decides what is safe. The server does, by what the operation is
  (`run.ts`). There is no sandbox running a model's own code: nothing here needed one, and
  it would be a second way in to keep safe.
- **What a bot is offered is one file's decision** (`catalogue.ts`). Never what only an
  owner may do, and never the system's own work, listed by name in `SYSTEM_ONLY`: recording
  an order or a payment, mail arriving, the clock's rounds, who can sign in, the
  connection's own plumbing. Those are true because the shop, a payment processor or a
  mail provider said so, and a bot saying so is not the same thing. A bot naming one is
  told there is no such operation. A test reads the source for every `defineOp`, fails if
  one is missing from the list, and pins how many are held back in each area. **Add an
  operation and decide which it is.**
- **"Outward" is whatever reaches a customer, not only what sends something.** A promo
  code, where an order is sent, the signature under replies, the do-not-email list,
  blocking a sender, releasing a batch for sale, taking a review down: none sends an
  email, each can leave a customer worse off, and each has an `effect` and waits for a
  yes. An independent review found a bot running all of them by itself (12 November
  2026). `tests/backstage/connect-catalogue.test.ts` names them.
- **A person saying yes is shown exactly what the bot handed over, so that has to be the
  whole of it.** Three rules follow, all in `catalogue.ts` and `run.ts`:
  - Every key a bot hands over has to be one the operation reads (`unreadKeys`). Reading
    drops what it does not know, so a request could otherwise carry a `Body` that looks
    like the words and does nothing, beside no `body` at all. It holds for looking and
    changing too, where a filter spelt wrong would be answered as if it were not there.
  - **Publishing saved words is never a bot's, with a yes or without** (`PEOPLE_ONLY`):
    a landing page, a campaign, a caption, a review, a special, starting a test. The
    words are kept somewhere else and a draft can be saved again after the asking. A
    person does it on the screen that has the words on it; the bot is told where.
  - Where one field is like that it is named in `BOT_MUST_SAY`: a reply needs its `body`,
    because without one `mail.send` sends the saved draft.
  - What is put in front of a person is at most 20,000 letters, and it is all checked
    again as it is run, a week later if need be.
- **Some things only a person may say, inside an operation a bot may otherwise run:** that
  a restricted phrase was read (`requireRestrictedRead` takes the actor, and a bot's tick
  or the system's is refused), what a printed label says, whose a second email address
  is (`mail.updateContact`), and the dates of a batch once it has been made
  (`stock.updateBatch`). The operation refuses and says where a person does it.
- **Anything outward waits for a person, in the back end and not in the chat**
  (`approvals.ts`, `approve.ts`). An operation with an effect is never run for a bot. What
  it would do is written down, shown on Today and at `/backstage/approvals`, and done only
  when a signed-in person presses yes: once, however many press, and as the bot that
  asked. A request that could never run is refused on the spot and never put in front of
  anybody. A yes typed into a chat is not a yes. Being approved does not make a bot a
  person: what only a person may record (a restricted phrase, a label's words) is still
  refused. A request lapses after a week. **The yes/no page says only its own
  sentences:** the link to it is handed over by the bot, so how a press went travels in
  the address as a word from a fixed list (`outcomeSaid`), never as a sentence, and it
  is only said where it is true of the request.
- **A connection is one person's, and never more than they are** (`oauth.ts`). It acts
  under a bot account named for them ("Claude, for Ash"), so the activity log says who did
  what. What it may do is the lesser of what was chosen on the consent screen and what the
  person may do, never an owner's reach, and it is read again on every call: switch the
  person off and their Claude is off. Somebody who can only look cannot connect one, and
  turned down to that, theirs stops until they are turned back up. A new password link
  for the person, a new PIN, or a PIN swapped for a proper login cuts their connections
  off as well: whoever had the old way in could have connected a Claude of their own.
- **The way in is OAuth, with nothing taken on trust.** An app registers itself and can
  only ever be sent back to Claude's own callback or to the person's own computer
  (`tokens.ts`), so a code can never go to somebody else's site whatever an app registers.
  The yes is given on a page behind the sign-in, which checks the request to the letter
  before it draws and again before it hands out a code. The code works once, for a minute,
  with the app's own secret (PKCE). A key lasts an hour and renews by rotation; a replaced
  renewal key turning up after two minutes means somebody else has a copy, and the
  connection is cut off. Inside the two minutes it gets one more go, for an app that
  never heard the answer, and the pair that displaces is remembered with no grace at
  all. Only hashes are kept. A key is good for this site's own address and no other, so
  **moving the site to a new address ends every connection**: people connect again.
- **Anybody can register an app, so registering must never be how the door is shut.** It
  lets nothing in. At the limit, room is made by letting go of the oldest app nobody said
  yes to. It takes JSON said to be JSON, and nothing from a page on another site.
- **One call in a request.** The protocol's older form takes a list, which would be
  counted once and run many times: `/api/mcp` reads the body itself, refuses a list and
  anything over a megabyte, and hands the rest on already read.
- **A failure nobody planned for tells a bot nothing.** What a database says when it
  fails holds the query and what was in it. The bot gets one plain sentence, the batch
  stops, and the whole of it goes to the server's log.
- **The protocol is the official SDK's** (`@modelcontextprotocol/server`), and stateless: a
  fresh server for each call, one JSON answer, no sessions, nothing subscribed to. It runs
  the same on any host. It speaks the July 2026 revision and answers 2025-era apps from
  the same handler.
- **Nobody could try this against Claude itself from here.** It is tested with the
  protocol's own client library, which does what a real app does: in vitest against the
  handlers (`tests/backstage/connect-http.test.ts`) and through the real consent screen in
  the browser tests. The first connection from claude.ai is a person's to make, and
  `TODO.md` says what to look at if it does not go through, and the one thing about
  Claude's own side that could not be checked from here.
- Connecting Claude means customers' details are read by Claude. The owner's switch and
  the consent screen both say so, and the privacy page says the shop may be run with one.
  Change one and change the others.

### Design rules that came from measuring

- **Mobile first.** The phone layout is the design; wider screens only add room. The button
  is on the first screen at 390 wide, and a sticky buy bar follows the thumb after that.
- **On the pink ground, sentences live on a cream card.** Cream on pink is 3.8:1 and navy
  on pink is 3.4:1: large type only. `tests/brand/tokens.test.ts` computes every pair.
- **Never a raw hex outside `lib/brand/`.** A test enforces it.
- **One focus ring, on every ground.** Navy, cream, navy, two pixels each, outside the
  control (`--focus-ring`, from the brand pack's UI kit). Whatever it lands on, one band
  stands off it by 3:1. The rule sits outside every CSS layer in `lib/brand/base.css`,
  because a ring made of shadows has to win over the shadow a component already wears. A
  button's ring is worn by its face so it sits above the offset; the pack picker's card
  wears it for its hidden radio. It never animates.
- **Olive is an accent, never small type**, on any ground: the pickle, the badge, a rule, a
  sparkle. On navy, small labels are cream. Olive type starts at 1.2rem bold.
- **The Varsity faces have a smallest size.** Varsity Senior (`.varsity`) is never set under
  1.5rem and Summer Varsity (`.display`) never under 2rem: they are display cuts, and the
  brand pack's fonts note (12 November 2026) gives those floors. A smaller line, a pack's
  name in the jar say, is set in the label face. `tests/brand/type-floors.test.ts` reads
  every class list and fails on one that is under.
- **Nothing is cut off when a reader spaces the text out** (line height 1.5, letters 0.12em,
  words 0.16em, paragraphs 2em). `e2e/site.spec.ts` applies that and looks for clipped
  words, after proving it can see one. A box that is clipped on purpose says so with
  `data-marquee`.
- **Every section's words start and stop at the same two edges**: a page
  (`--container-page`) in the middle, a gutter either side. There are two ways to write
  that and they come to the same thing: `max-w-page mx-auto` for a box inside somebody
  else's gutters, and `max-w-page-gutters px-gutter mx-auto` for a box that carries its
  own. `max-w-page px-gutter` on one box is neither. It is a page less two gutters: it
  looks right on a phone, and from about 1,280 wide it sits 64px in from its neighbours,
  as the header, the hero and the ritual did until 15 November 2026.
  `tests/brand/page-width.test.ts` catches it where it is typed and `e2e/site.spec.ts`
  measures the edges in a browser.
- **A running band is laid out to cross the widest screen.** A band slides its words by
  half their width and starts again, so half the copies have to reach right across. With
  four copies the olive band under the hero fell short on a 27 inch monitor (2,560 wide)
  and showed bare band for a few seconds of every loop; the line across the top fell
  short just past that. `bandFit` (`components/ui/ticker-fit.ts`) works out how many
  copies from the letters, on the narrow side, and how long the loop takes from how far
  it then goes, so the pace does not change.
  - **A phone does not carry what only a big monitor needs.** There are two counts: what
    a screen under 1,536 wide draws (the four copies each band always had) and what a
    wider one draws, out to 3,840. The copies in between are in the page and not drawn
    below `2xl`, and the loop's length is chosen by the same breakpoint.
  - Nothing can measure the words where the page is drawn, so each band has its measures
    beside it in `components/site/Sections.tsx`. `e2e/site.spec.ts` measures every band
    in a browser either side of that line and out to the widest: change a band's face or
    size and measure it again.
- **A band that is turned needs room that grows with the screen.** The olive band under
  the hero is turned 1.6 degrees about its middle, so its ends rise and fall by 1.4% of
  the screen's width: 6px on a phone, 54px at 3,840. The box that stops it scrolling the
  page sideways cuts off whatever leaves it, and with 12px of room at every width the
  band's top right and bottom left corners were cut off from about 830px wide (Sam, 16
  November 2026, on a screen 1,887 wide). The room is now `1.4vw` and 6px to spare, and
  never less than the 12px a phone always had. Change the angle and change the 1.4 with
  it: `e2e/site.spec.ts` measures the corners out to 3,840, after proving it can see a
  cut one.
- **Motion is transform and opacity only**, on the guide's durations, and everything
  collapses under `prefers-reduced-motion`. Content is visible without JavaScript; scroll
  reveal only hides blocks once its observer is actually running.
- **A chart is one colour of mark, with its numbers as a table under it.** The brand pink
  is the mark colour (checked against the paper it sits on); words stay in ink and never
  wear the mark's colour. Pink and olive are never used as two series side by side: to
  someone red-green colour-blind they are too close to tell apart. Two measures of
  different size are two charts, never two scales on one.
- Tap targets are 44px or more. axe runs on every page at both sizes with no rule disabled.
- **Lighthouse runs with the slow connection applied for real**, five runs, median
  (`throttlingMethod: "devtools"` in `lighthouserc.json`). Its default is to load the page
  at full speed and then estimate. Served from the same machine, the scripts land before the
  first paint, the estimate counts them as blocking it, and identical bytes scored 2.4 s or
  2.9 s for the largest paint depending on a 20 ms race. Measured properly it is the first
  paint: about 1.7 s on slow 4G.
- **Lighthouse measures a warm server** (`scripts/lhci-server.mjs`). With no database the
  app boots one in its own process on the first requests it gets, and that froze the
  server for six to nine seconds on a CI runner. So the first of every five samples
  scored about 0.45, on `main` too, which left four real ones and made the median the
  second-worst of four. A runner that happened to be slow then failed the check with the
  shop's code unchanged (15 November 2026). The script asks for the front page until it
  answers quickly three times running, and only then lets Lighthouse start. Production
  has a real database and never does that boot, and the budget itself is untouched.
  - **How fast the runner is moves the score more than most changes do.** Each report
    carries the machine's own benchmark. The same page scored 0.98 and 0.99 on a runner
    near 3,000 and 0.91 to 0.96 on one near 2,400, all of it in blocking time while the
    page's script starts. Read the reports (the `lighthouse-reports` artifact) before
    believing a small move either way.
- **Lucky stays drawn into the page.** The home document is about 280 kB before it is
  squeezed (about 40 kB as Vercel sends it), and Lucky's drawing is 53 kB of that, twice over,
  because React sends its own copy of everything the server drew. It is tempting to move
  her to a separate image. Measured on 12 November 2026 and left alone: a drawing in the
  page paints with the first paint and is not counted as the largest one (the headline
  is), where a separate image arrives after it, becomes the largest paint, and lands
  late on a first visit. Fewer bytes, a worse page.

### Art

Ashleigh's concept pages are true vector, so Lucky (running, and flying up) and the stacked
QUICK / PICKLE lockup are drawn from her own paths: `scripts/build-vectors.py` extracts
them, `components/brand/Vector.tsx` renders them. They are never redrawn or recoloured.
Only the marks she drew as motion (burst lines, speed lines, dust) move.

That vector art is her pink-ground "knockout" palette. On cream or navy use the full-colour
raster art (`components/brand/Art.tsx`, built by `scripts/build-art.mjs`).

The bottle is real: 100 ml, clear food-grade plastic, straight sides, a wide white ribbed
screw cap, juice as clear as water, and a wrap label covering most of the body (the name in
Summer Varsity, Lucky running under it). `components/brand/Bottle.tsx` is a drawing of that,
standing in until the proper labels are printed and photographed. The samples seen so far
wore temporary stickers.

Poses marked "proposed" in the pack were generated from her art and are pending her nod:
celebrate (order placed) and sleeping (empty jar, 404) are in use and flagged in the guide.

The asset pack itself (200 MB of print masters) is not in the repository. Both build
scripts take its path as an argument.

Video and reels go in the slots in `content/media.ts`, encoded by `scripts/build-media.mjs`.
The promo films are there too, switched off until the owner puts them on (under "The films
on the shop" above).

### The documents

- `HANDOVER.md` is for the owner, in plain words: what there is, where it stands, what is
  hers to decide. `docs/ACCOUNTS.md` is every account, setting and key by name, never a
  value, and how each is handed on. `TODO.md` is the full list with the reasons.
  **Keep the three true** when something they describe changes: a new setting on the
  host, a new infra action, a job crossed off. `tests/core/handover-docs.test.ts` fails
  on a link in them that leads nowhere, and on anything in them shaped like a key.
- **`docs/starter` is written by a script.** The drafts the back end starts with (the
  how-to sheets, the plans, the policies, the questions, the compliance list, the lines
  of the budget) are data in `lib/backstage/plans/starter`. `npm run docs:export` writes
  them out as Markdown, and `tests/backstage/starter-docs.test.ts` fails when the folder
  is not exactly what the data makes. Never edit those files by hand. They are the
  starting drafts and not the working copy: once somebody has changed a sheet in the
  back end, the back end is where it lives, and every file says so at the top.
- A link in those files to a screen of the back end carries the shop's whole address
  (`LIVE_SITE` in `lib/backstage/plans/starter/export.ts`). Change it when the shop has
  its own domain, and run the export again.
- The copy scanner reads what a customer can read. It does not read `docs/` or the
  Markdown at the top of the repository, which quote the very lines the site may not
  say in order to explain why.

## Conventions

- **`npm run typecheck` is not sufficient.** Verify with `npm run build`.
- No `any`, no `@ts-ignore`, no unjustified `eslint-disable`.
- Copy lives in `content/`. A component that needs a new word gets it from there, so the
  scanner reads the whole site by reading one folder.
- **Take a private build directory** when more than one thing builds this tree:
  `NEXT_DIST_DIR=.scratch/next-<something>`. Two builds sharing `.next` interleave silently.
- **Next 16 allows one `next dev` per directory.** A crashed run leaves the lock held; kill
  it by the PID the error message gives you.
- **Never `pkill -f` on a broad pattern.** Kill by PID.
- Playwright is pinned to the version whose Chromium is preinstalled in the cloud sandbox
  (1.63). Do not run `playwright install` there.
- A headless browser says it is one, so the visit counter ignores it. A browser test that
  needs a visit counted sets an ordinary user agent (`e2e/numbers.spec.ts`) and arrives
  under a label of its own, so it can find its visit whatever else is running.
- The browser tests start **two** servers from one build: the site (no database, so its
  back end is open and on demo data) and a second copy with `BACKSTAGE_AUTH=required` for
  the sign-in tests. React clears a form's fields when its action returns; a test that types
  straight after pressing a button must wait for the reply first (see `press` in
  `e2e/backstage-auth.spec.ts`).
- `getByRole("alert")` also matches Next's route announcer after a client-side navigation.
  Scope it: `page.locator("main [role=alert]")`.
- A form that is handed back keeps what was typed through `defaultValue`. A `<select>` only
  reads its starting value once, so it also needs a `key` made from that value, or it comes
  back empty (the checkout's region did, until a browser test picked a region first).
- A local run of the browser tests that starts its own servers has to give them what the
  Playwright config gives the ones it starts: no mail settings, and `QP_KEPT_PAGES=memory`.
  A machine's own environment can hold mail keys, and a server left over from an earlier
  run answers in place of a fresh one, with the last run's records in it.
- With several agents in the tree: each owns its folders, nobody runs `git stash`, `git
checkout -- <path>`, `git add -A` or `db:generate` but the one integrating, and every
  build takes a private `NEXT_DIST_DIR`.
- **A test that reads the real clock is run at every hour of the day.** The demo's month
  of visits was laid out in blocks of 24 hours counted back from now, while Numbers
  counts New Zealand calendar days. So one test failed for the first half hour after
  midnight here and passed for the other twenty-three and a half, until somebody pushed
  at five past twelve (15 November 2026). Anything laid out by day goes through
  `lib/time.ts`, and its test makes it at fixed moments as well: just after midnight
  here, just before, and on the days the clocks change.
- **After a link inside the back end is followed, the new page's heading is drawn a few
  milliseconds before its title is in the document** (up to 20 ms on a slowed machine).
  A check that reads the whole document waits for the title first, or it can catch the
  page without one: axe did, in one CI run of some dozens (16 November 2026).
  `expectNoAxeViolations` in `e2e/backstage-auth.spec.ts` shows how. No rule is switched
  off for it.
- **The sign-in tests are one story on a server that keeps its accounts, so they cannot
  be retried.** When one fails, the retry starts the story again and its first test
  fails too, because the first owner is already made. Read the first error in the log,
  not the retry's.
- ESLint 9 not 10, TypeScript 6 not 7: both held back on purpose by the Next toolchain.
- Customer-facing writing is plain everyday New Zealand English with British spelling.

## Deploying

Production follows `main`; every other branch gets a preview. Never push a red build to
`main`: Vercel keeps the last good deployment, so a failed build silently freezes
production rather than breaking it. Claude merges its own pull requests once CI is green
(Sam, 12 November 2026: "you own all three"). That is Sam's say-so and holds while the
repository is his: "Whose it is", near the top, says what holds after.

Quick Pickle has its own free Vercel account and its own Supabase organisation, both
apart from Keece. Production needs `DATABASE_URL` or `POSTGRES_URL` (Production
environment only) and `BACKSTAGE_SETUP_CODE`. Vercel's terms keep its free plan to
"personal or non-commercial use" and let it switch a free project off without notice (read
18 November 2026). The line is a shop open to the public, not the first sale. So before
launch it is either Vercel Pro or moving hosting to Cloudflare, and `TODO.md` sets the two
side by side: keep the app free of Vercel-only services in its core paths so that move
stays as small as it can be.

### The repository's own hands

Nobody holds dashboard access for the code's sake. `.github/workflows/infra.yml` runs
`scripts/infra/run.mjs` with four repository secrets and can read and set up Vercel,
Supabase and Stripe. It runs on every push to `main` (it reads the state and changes
nothing) and does more only when that push changed `.github/infra-request.json`:

```json
{
  "actions": ["status", "stripe-check", "connect-stripe", "redeploy"],
  "confirm": "yes"
}
```

So a change to production's settings is a commit, checked and merged like any other. Read
the result in the run's log. `status` is also how production's data is looked at: orders by
state, the event queue, and whether Stripe's news is being delivered (counts only, never a
name or an order number). It can be run by hand on `main` at any time. Change what is sent
to Stripe and `stripe-check` belongs in the same merge: it runs the app's own functions
against Stripe's test mode. It prints names and states, never a value; it is pinned to
Quick Pickle's own Vercel project (by id) and Supabase project, and refuses to run against
Keece's. GitHub does not tell a workflow which files a push changed, so the workflow works
that out with git.

Production today: the app has its own database login (`qp_app`, made by `connect-database`,
through the pooler in transaction mode) as `DATABASE_URL`, so it owns its tables;
`BACKSTAGE_SETUP_CODE` was made by `ensure-setup-code` and can be read in Vercel's settings.

### The shop's own domain

The site answers at two kinds of address, and `scripts/infra/domain.mjs` says which is
for whom.

- **The host's own address** (`quickpickle.vercel.app`) is for machines. Stripe's news of
  a payment and the database's clock both call it, and go on calling it whatever domain
  the shop is given, so no DNS of ours can stop a payment being recorded or the clock
  being rung. **Never set it to send people on to the domain:** a machine that is
  redirected gives up. `status` says so if it ever is.
- **The domain is for people**, and it is connected in two commits to
  `.github/infra-request.json`, each naming it (`"domain": "example.co.nz"`).
  `add-domain` puts the name on the project, with `www.` beside it sending people on to
  it, and prints the DNS records a person adds at the registrar. Once `status` says the
  name is answering, `use-domain` makes it the address the shop calls itself by.
  `leave-domain` is the way back. Each of those two is followed by `redeploy`, because
  the address is built into the site.
- **The address the shop calls itself by is held, never left to the host.** `add-domain`
  sets `NEXT_PUBLIC_SITE_URL` to the host's own address before the name goes on the
  project. Left alone, the host names a new domain as the project's address at the next
  deployment, before one record points at it, and every link in an email and every
  return from Stripe would lead to a registrar's parking page.
- **`use-domain` moves nothing until the shop answers at the name:** the host has to say
  its DNS is right, and the front page has to come back from it when asked as a visitor
  would ask.
- A new address ends every Claude connection, because a key is good for one address:
  people connect again. `LIVE_SITE` in `lib/backstage/plans/starter/export.ts` follows
  it, with `npm run docs:export`. QR codes printed before it still lead to the host's
  own address, which goes on working.
- **A domain's name is only ever taken from a commit.** The form that starts the
  workflow by hand has no box for one, and `tests/infra/domain.test.ts` holds it there,
  with the order above.
- The domain is `quickpickle.co.nz`, Ash's, at 1st Domains. Only the name is needed
  from a registrar. Its web hosting (PHP, WordPress) cannot run this site, its database
  is not the kind the site is written for, and the site keeps its files in its own
  database. A mailbox there is the owner's choice: the shop sends and reads its own mail
  through Resend, and `TODO.md` says how the inbox sits beside a mailbox elsewhere.
- **Registrars do not agree on how the bare name is written.** The script prints `@`.
  1st Domains wants that box left blank. Say which when handing records to a person.
- None of this could be tried against the host from a session: only the workflow on
  `main` holds the token. The first real `add-domain` is the test of what the host
  answers, so read its log before believing it.

The site is not launched. See `TODO.md` for what stands between this and taking money.

## History

Until 12 November 2026 this repository held a different, placeholder brand ("HALF SOUR")
with a large AI-operated admin behind it. That code was removed for the Quick Pickle
rebuild and is intact in git history at commit `9f2531f`.
