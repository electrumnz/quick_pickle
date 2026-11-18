# Quick Pickle: the handover

For Ash. Written on 16 November 2026 (New Zealand time), the day Sam handed this over.

Start here. Everything else is linked from this page.

## What you are being handed

Two things, kept in one place: a repository on GitHub, which is the folder that holds all
the code and these pages.

1. **The shop.** A one-page site that sells Quick Pickle in packs, with its own jar and
   checkout. It is live at [quickpickle.vercel.app](https://quickpickle.vercel.app).
2. **The back end.** Everything for running the business, behind a sign-in: orders,
   customers, stock and batches, the inbox, marketing, plans and budget, numbers, and
   the settings that change the shop. It does not do the accounts. That is Xero's job.

Both were built between 12 and 16 November 2026 by Claude, Anthropic's AI, working for
Sam. No person wrote the code. Your brand is the brand: the logo, Lucky, the three
colours and the four fonts are yours, used as you drew them.

## Where it stands today

**It is not launched, and it cannot take money yet.** That is on purpose.

- The checkout sends a buyer to Stripe's real payment page in **test mode**. A test card
  goes through. A real one is turned away. Nobody can be charged.
- The site tells search engines to stay out until the facts on it are confirmed.
- Several things a customer reads are still **stand-ins**, or left blank: the pack
  prices, the delivery rates, the ship date, the contact address. Nothing says what is in
  the bottle, because nobody has confirmed it.
- No email is sent. Receipts are written down in the back end and go nowhere until email
  is connected.
- The only orders in the database are a handful of cancelled tests.

The back end has a page that keeps this list for you and cannot go out of date:
**Settings, Go-live list**. It is the one to trust. [TODO.md](TODO.md) is the same list
with the reasons written out.

## Getting in

Go to the shop, scroll to the very bottom and press **Staff**.

**There is one login today.** It was made on 16 November 2026 with a PIN, while the shop
was being set up, and it carries the name typed that day. The activity log puts that name
beside everything done under it, and no screen changes it. If that name is not yours, do
not take the login over. Get one of your own:

1. Whoever has the PIN signs in and opens **Settings, Staff**, then **Invite someone**.
   They type your name and an email address, and pick **Owner**. The email is only a
   login name: nothing is sent to it.
2. The page shows a link that works once and lasts three days. They pass it to you.
3. You open it and choose a password. You are in.
4. From then on, **Staff** shows the sign-in page, and **Sign in with an email and
   password** is the line under the PIN box.

That login is yours, and the activity log says your name.

**Then retire the PIN.** A short number is fine while a shop is being set up. It is not
what should stand in front of real customers' details, and the go-live list says so until
it is gone. It cannot simply be switched off. Whoever comes in with the PIN swaps it for
an email and a password first (Settings, Staff, the panel at the top), which asks for the
set-up code. After that it is an ordinary login, and you can switch it off from yours.

**The set-up code** is a long phrase kept where the site is hosted (Vercel, the project's
Settings, Environment Variables, `BACKSTAGE_SETUP_CODE`). It is the key behind the PIN: it
made the first login, and it sets a new PIN if the PIN is forgotten or the door is locked
(**Forgot the PIN, or locked out?** on the sign-in page). Once the PIN has been swapped,
the code opens nothing.

## What is yours to decide

These are not technical. Nobody else can answer them, and the site is built to wait for
you rather than guess.

- **The claim.** "A pickle punch to cramps in 60 seconds flat" cannot go on the site, the
  pack or an ad in New Zealand. A food may not be advertised as easing a condition. The
  site is built without it, and a scanner stops that line and the softer ones like it
  from being published by anybody, including an AI. If you want any of them back, that is
  a conversation with a food lawyer or MPI first. [legal/COPY-RULES.md](legal/COPY-RULES.md)
  has the detail.
- **The packs and prices.** 6, 12 and 24 at $27, $48 and $84, called The Trial, The
  Starter and The Squad, are all stand-ins.
- **What the label says.** The ingredients list, the allergen line if there is one, and
  the storage line, word for word from the printed label. And whether you want the
  nutrition panel on the site as well as on the bottle: it is not there today.
- **The ship date**, if this opens as a pre-order.
- **Delivery.** Where you send to and what it costs.
- **The fine print.** The delivery, returns, terms and privacy pages make promises in the
  business's name. Read them and agree to them, or change them.
- **Who the business is.** The legal name, the NZBN, the address, and whether it is
  registered for GST.
- **A customer email address.**
- **Two Lucky poses.** Celebrating (on the "order's in" page) and sleeping (the empty jar
  and the page-not-found page) were generated from your art and are marked as proposed.
  They need your nod, or replacing.
- **The other name.** "Pickled Jews" is the umbrella this project sits under. Everything
  a customer sees says Quick Pickle. Whether the other name ever shows, and in what
  words, has been left for you.

Most of these are set in the back end with no code changed: **Settings, The shop** and
**Settings, The label and the company**. Then you say each one is right on the go-live
list, with your name beside it.

The full list is [docs/starter/QUESTIONS.md](docs/starter/QUESTIONS.md): 47 questions by
topic, each with why it matters and who to ask. The same list is in the back end under
Plans, Questions, where you can answer them.

## Before it takes real money

In rough order. Each is spelt out in [TODO.md](TODO.md).

1. Answer what is yours to decide, above, and confirm each on the go-live list.
2. Finish Stripe's sign-up with the business's details and bank account.
3. Point your domain at the shop. `quickpickle.co.nz` is yours, at 1st Domains. Add the
   two records Claude hands you: [docs/ACCOUNTS.md](docs/ACCOUNTS.md) has it, screen by
   screen, under "The shop's own domain". The shop needs nothing else from the registrar.
4. Make a Resend account for the domain and connect email, so receipts are really sent.
5. Move the hosting off Vercel's free plan. It is not for a business that takes money.
6. Retire the PIN, as under Getting in above.
7. Make one test purchase yourself, start to finish. Stripe's payment page will not let
   a robot press Pay, so it is the one step nobody has watched work end to end.
8. Switch Stripe from test keys to live ones.

## Running it day to day

There is a sheet for each job, written as a checklist to follow. They are in the back
end under Plans, and here as files:

- [How to pack an order](docs/starter/how-to/how-to-pack-an-order.md)
- [How to change a price, a date or delivery, and how to stop taking orders](docs/starter/how-to/how-to-change-the-shop.md)
- [How to run a production day](docs/starter/how-to/how-to-production-day.md)
- [What to do when an order arrives damaged or goes missing](docs/starter/how-to/how-to-damaged-or-missing-order.md)
- [How to handle a complaint](docs/starter/how-to/how-to-complaint.md)
- [What to do when a card payment is disputed](docs/starter/how-to/how-to-card-dispute.md)
- [How to recall a batch](docs/starter/how-to/how-to-recall.md)
- [How to answer a health question](docs/starter/how-to/how-to-answer-a-health-question.md)
- [What to hand to Xero and the accountant at month end](docs/starter/how-to/how-to-month-end.md)
- [The weekly check](docs/starter/how-to/how-to-weekly-check.md)
- [How to email the Pickle Crew](docs/starter/how-to/how-to-email-the-pickle-crew.md)
- [How to connect Claude, and what it can do for you](docs/starter/how-to/how-to-work-with-claude.md)

There are also draft plans (business, marketing, a launch checklist), a compliance
checklist and the lines of a budget: [docs/starter](docs/starter/README.md). The budget
has a line for each thing that will bill you once the shop is live (hosting, the domain,
email, card fees). Every one is blank until you have the real figure.

The back end was made for one person. Anything you do not need every day is switched
off until you start it: the morning email, landing pages for one advert, tests between
two pages, specials, connecting Claude.

## The rules that are built in

You do not have to remember these. The site enforces them.

- **No claims about what it does to a body.** Anywhere, by anybody. Every word that is
  published or sent is read against the rules first: a page, a campaign, a reply typed in
  the inbox, something an AI drafted.
- **Nothing about the product is guessed.** No ingredient, volume, origin or process word
  appears until you have confirmed it.
- **A price never comes from the buyer's browser.** Every total is worked out on the
  server, and again as the order is placed.
- **Real records are only ever behind the sign-in.**
- **An AI never acts on a customer by itself.** A Claude connected to the back end can
  draft, look things up and do the day-to-day. Anything that sends, refunds, deletes or
  otherwise reaches a customer waits for you to press yes in the back end. Publishing
  words is always done by a person, on the screen that shows them.
- **Every change is written down.** Settings, Activity log says who did what and when.

## Handing it over

The accounts behind the site are in Sam's name today. Moving them is about a morning's
work, and the shop stays up throughout. [docs/ACCOUNTS.md](docs/ACCOUNTS.md) has every step,
in order, with links to each provider's own instructions.

In short:

| What                | What happens                                              |
| :------------------ | :-------------------------------------------------------- |
| The database        | Sam makes you an owner, then leaves                       |
| The code, on GitHub | Sam transfers the repository to you                       |
| The hosting, Vercel | Sam transfers the project to you                          |
| Payments, Stripe    | Sam transfers ownership, then you finish Stripe's sign-up |
| The domain          | Yours already, at 1st Domains                             |
| Email               | Not made yet. You make it, in the business's name         |
| Xero and a courier  | Yours to set up. The back end makes files for both        |

Then a few things change so that only you know them: who can sign in to the back end,
the set-up code, and the keys the repository uses. That page says which and how.

## Keeping it going

You do not need a developer. You need a Claude account that includes Claude Code.

1. Sign in at [claude.ai/code](https://claude.ai/code) and connect your GitHub account
   ([claude.ai/connect-github](https://claude.ai/connect-github)). If it asks, let the
   Claude GitHub App see this repository.
2. Start a session on this repository and say what you want, in plain words. "Add a pack
   of 48." "The returns page should say 14 days." "Why did this order's email not send?"

Claude reads [CLAUDE.md](CLAUDE.md) at the start of every session. That file is the
rulebook: how the site is built, every rule above, and every decision made so far with
the reason. You never need to read it. It is why a new session knows what the last one
knew.

**Say how much rope it has.** Sam let Claude merge its own changes once the checks
passed, and change the live site's settings by itself. That was Sam's call for Sam's
time. It does not pass to you unless you say so. In your first session, tell it: "ask me
before anything goes live", or "carry on as you did for Sam". Either is fine. It is
yours to choose.

What Claude cannot do for you: open accounts, see a password or a key, pay for anything,
or press Pay on Stripe's page. It needs no keys of its own, and
[docs/ACCOUNTS.md](docs/ACCOUNTS.md) says the little its environment does need.

Nothing works on the code unless you ask. While the site was being built, a Claude
session looked at the brand pack's folder every hour and went over the site in a loop.
Both have stopped. What still runs by itself is the site's own housekeeping: the checks
on every change to the code, and the database ringing the site every five minutes.

That is Claude working on the code. Separately, you can connect a Claude to the back end
itself, to help run the shop by chat: look up an order, draft a reply, say what needs
doing today. It ships switched off. The how-to sheet above says how to switch it on and
what it may do.

## What is not built, and what is not certain

- **No lawyer has read any of this.** The fine print, the compliance checklist and the
  copy rules were written by an AI from public sources. They are careful, and they are
  not legal advice.
- **No real email has ever been sent.** Sending, receiving and bounces are built and
  tested, but only against stand-ins. The first real one is yours.
- **No real payment has gone through.** Everything up to Stripe's page and back from it
  is tested. Paying on it has to be done by a person.
- **Nobody has connected a real Claude to the back end.** It is tested with the same
  parts a real one uses. [TODO.md](TODO.md) says what to look at if the first try fails.
- **There is no direct line to Xero or to a courier.** The back end makes a file for
  each. A direct line waits on having an account to try it with.
- **The nutrition panel** is not on the site.
- **The video slots** on the page are empty. The brand pack's own notes mark its motion
  files as superseded, waiting on a rebuild, so nothing from there is used yet.
- **A box's weight** is not in the courier's file, because nobody has weighed one.
- **The front page is close to its speed limit on a slow machine.** It passes. The next
  improvement is written up in [TODO.md](TODO.md).

## Where everything is

| File                                       | What it is                                               |
| :----------------------------------------- | :------------------------------------------------------- |
| [HANDOVER.md](HANDOVER.md)                 | This page                                                |
| [TODO.md](TODO.md)                         | What is done and what is not, with the reasons           |
| [docs/ACCOUNTS.md](docs/ACCOUNTS.md)       | Every account, setting and key by name, and the handover |
| [docs/starter](docs/starter/README.md)     | The how-to sheets, plans, questions and checklists       |
| [legal/COPY-RULES.md](legal/COPY-RULES.md) | What may and may not be said, and why                    |
| [README.md](README.md)                     | For a developer: how to run it                           |
| [CLAUDE.md](CLAUDE.md)                     | The rulebook Claude works from                           |
