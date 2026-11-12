# QUICK PICKLE

Two things in one repository, for Quick Pickle: pickle juice shots, sold direct, in New
Zealand. The juice is clear. There are no pickles in the bottle.

1. **The shop.** A one-page site with its own jar and checkout.
2. **The back end** (`/backstage`). Everything Ashleigh needs to run the business: orders,
   customers, stock, the inbox, marketing, plans and budget, automations. Accounting is the
   one thing it will never do; that is Xero's job.

There is no human writing code here. The owner (Sam) has handed the repository, the
database and the hosting to Claude: build it, verify it, merge it.

The brand is Ashleigh Lennard's: the logo, Lucky the superhero cat, the three colours and
the four fonts. "Brand Guide v2" (Grok's write-up of her files) is a starting point, not a
rulebook. The version this build actually follows is the living guide at `/backstage/brand`,
rendered from the same tokens and components as the site.

Everything a customer sees says Quick Pickle. "Pickled Jews" (what the repository was called
until Sam renamed it `quick_pickle` on 12 November 2026) is the umbrella the project sits
under. Whether it ever shows on the pack or the site, and in what
words, is Ashleigh's call and is not made yet, so until then it appears nowhere a customer
can see.

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

Not every word a customer reads is in the repository: a reply typed in the inbox, a
campaign, a template kept in the database, anything a bot drafts. So the rules themselves
live in `legal/scripts/rules.mjs`, and **every operation that sends or publishes words runs
the finished text through `refuseUnsendable` (`lib/backstage/core/copy.ts`) first**, whoever
wrote it. A banned term never goes out. A restricted one goes out only when a person has
recorded that they checked it; a bot cannot. Em dashes are refused there too.

**Facts must be literally true.** Fair Trading Act s 9, 12A, 13. Nothing about the product
is guessed: no ingredient, volume, origin, storage line or process word ("strained",
"brewed") appears until Ashleigh confirms it. Unknown commercial facts carry a stand-in in
`content/offer.ts` and are listed in `UNCONFIRMED` there. While that list is not empty the
site tells crawlers to stay out and `npm run prelaunch` fails.

**No demo or preview banner on public pages.** Test mode is explained once, on the
checkout, where a visitor would otherwise expect a card field. (A staff preview of a
landing page does carry a strip saying what it is. It is behind the sign-in, and a
customer can never reach it.)

**No em dashes in customer-facing copy.** Use a full stop, a comma or a colon. The founder
reads them as machine-written. Code comments are not copy.

**Never trust a price from the browser.** The jar holds SKUs and quantities. Every total
is computed from `content/offer.ts` by `lib/shop/pricing.ts`, and computed again on the
server when an order is placed. There is no price field on any form.

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
app/backstage/(door)/  sign-in, first-time set-up, choose a password
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
lib/brand/             tokens.css (the only file with a hex), base.css, fonts, art data
lib/time.ts            New Zealand time. Every conversion goes through it.
legal/                 COPY-RULES.md and the scanner
tests/  e2e/           vitest and Playwright
```

`lib/backstage/README.md` is the guide to adding an area to the back end.

`.wip/` holds areas that were stopped part-built (see its README). Nothing in it is built,
linted, tested or scanned. An area is finished and wired in by moving it out.

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
- `requireStaff()` is the lock, called by every page and (through `staffCaller()`) every
  action. `proxy.ts` is not the lock.
- **Outward and irreversible operations** (`effect: "outward" | "destructive"`) need a yes.
  A form's button is the yes. A bot has to ask first.
- **Demo mode** (no database): open, seeded through the real operations, labelled on every
  screen. The label lives only in the back end. Nothing on a public page says "demo".
- The old build's "one shared password, no email" rule was dropped on purpose: with several
  people and bots at work the activity log has to say who did what. Its "no MCP" decision is
  also reversed: an MCP connection is planned, built last, over the same operations.

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
- **Visits and sales are two different things, and Numbers says which is which.** Visits are
  our own count and run a little low. Sales are the orders: paid, less refunds. Every
  figure on `/backstage/numbers` comes from one read (`numbers.summary`) for one stretch of
  New Zealand days, so they agree with each other.
- `lib/shop/store` is where the shop hands an order over. The default is `db`: the back
  end's own `orders.record` operation, so an order is on the Orders screen as it is placed.
- The "order's in" page reads a short-lived httpOnly receipt cookie. It is display only.

### Design rules that came from measuring

- **Mobile first.** The phone layout is the design; wider screens only add room. The button
  is on the first screen at 390 wide, and a sticky buy bar follows the thumb after that.
- **On the pink ground, sentences live on a cream card.** Cream on pink is 3.8:1 and navy
  on pink is 3.4:1: large type only. `tests/brand/tokens.test.ts` computes every pair.
- **Never a raw hex outside `lib/brand/`.** A test enforces it.
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
- With several agents in the tree: each owns its folders, nobody runs `git stash`, `git
checkout -- <path>`, `git add -A` or `db:generate` but the one integrating, and every
  build takes a private `NEXT_DIST_DIR`.
- ESLint 9 not 10, TypeScript 6 not 7: both held back on purpose by the Next toolchain.
- Customer-facing writing is plain everyday New Zealand English with British spelling.

## Deploying

Production follows `main`; every other branch gets a preview. Never push a red build to
`main`: Vercel keeps the last good deployment, so a failed build silently freezes
production rather than breaking it. Claude merges its own pull requests once CI is green
(Sam, 12 November 2026: "you own all three").

Quick Pickle is moving to its own free Vercel account and its own Supabase organisation,
both apart from Keece. Production needs `DATABASE_URL` or `POSTGRES_URL` (Production
environment only) and `BACKSTAGE_SETUP_CODE`. Vercel's free plan does not allow a business
that takes money, so launch means either Vercel Pro or moving hosting to Cloudflare: keep
the app free of Vercel-only services in its core paths so that move stays cheap.

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

The site is not launched. See `TODO.md` for what stands between this and taking money.

## History

Until 12 November 2026 this repository held a different, placeholder brand ("HALF SOUR")
with a large AI-operated admin behind it. That code was removed for the Quick Pickle
rebuild and is intact in git history at commit `9f2531f`.
