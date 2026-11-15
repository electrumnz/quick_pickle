# Quick Pickle

Pickle juice shots, sold direct, in New Zealand. This repository is the whole business
online: the shop, and the back end that runs it.

- **The shop** is one page with its own jar and checkout:
  [quickpickle.vercel.app](https://quickpickle.vercel.app).
- **The back end** is at `/backstage`, behind a sign-in: orders, customers, stock and
  batches, the inbox, marketing, plans and budget, numbers, and the settings that change
  the shop. Accounting is the one thing it leaves to Xero.

It is **not launched**. The checkout runs in Stripe's test mode and nobody can be
charged. [TODO.md](TODO.md) says what stands between this and taking money.

## Which page to read

| If you are                          | Read                                                                            |
| :---------------------------------- | :------------------------------------------------------------------------------ |
| Taking the business on              | [HANDOVER.md](HANDOVER.md). Start there                                         |
| Moving the accounts to a new owner  | [docs/ACCOUNTS.md](docs/ACCOUNTS.md)                                            |
| Running the shop day to day         | The how-to sheets: [docs/starter](docs/starter/README.md)                       |
| Deciding what the site may say      | [legal/COPY-RULES.md](legal/COPY-RULES.md)                                      |
| Wondering what is done and what not | [TODO.md](TODO.md)                                                              |
| Changing the code, person or AI     | [CLAUDE.md](CLAUDE.md), then [lib/backstage/README.md](lib/backstage/README.md) |

## Running it on your own machine

Node 22 (pinned in `.nvmrc`).

```bash
nvm use
npm install
npm run dev
```

Nothing needs setting up. With no settings at all the site builds, serves, takes test
orders, charges nobody, and runs its back end on invented records in memory, open with
no sign-in. `.env.example` explains every setting there is.

To try the sign-in screens locally, set `BACKSTAGE_AUTH=required` and a
`BACKSTAGE_SETUP_CODE` of 16 characters or more.

## Scripts

| Script                        | What it does                                                         |
| :---------------------------- | :------------------------------------------------------------------- |
| `npm run dev`                 | Development server on http://localhost:3000                          |
| `npm run build`               | Production build. The real check that a change is sound              |
| `npm start`                   | Serves the production build                                          |
| `npm run typecheck`           | `next typegen` and `tsc --noEmit`                                    |
| `npm run lint`                | ESLint and a Prettier check                                          |
| `npm run test`                | Vitest: about 1,500 unit tests                                       |
| `npm run test:e2e`            | Playwright: the purchase, the back end, sign-in, and axe             |
| `npm run audit:copy`          | Fails on a banned claim in anything a customer can read              |
| `npm run audit:copy:selftest` | Proves the scanner still catches what it exists to catch             |
| `npm run prelaunch`           | Lists what still stands between this and taking money                |
| `npm run lhci`                | The Lighthouse budget for the front page                             |
| `npm run db:generate`         | Turns a change to `db/schema` into a migration                       |
| `npm run docs:export`         | Writes `docs/starter` again from the drafts the back end starts with |

## Where things are

```
app/(site)/     the shop: the page, the checkout, the fine print, landing pages
app/backstage/  the back end: the door, and one folder for each area
components/     brand art, the shop's sections, the jar, the checkout, the back end's parts
content/        every word a customer reads, and every price. Start here
db/             the tables and their migrations
lib/shop/       money, the jar, pricing, orders, payments
lib/backstage/  the operations every change in the back end goes through
lib/mail/       sending email, and checking what arrives
lib/brand/      colours, fonts and art data
legal/          the copy rules and the scanner that enforces them
scripts/        art, video, go-live and hosting tooling
tests/  e2e/    unit tests and browser tests
docs/           the handover documents
```

To change a line of copy: `content/site.ts`.

To change a price, a delivery rate or the ship date: the back end, **Settings, The
shop**. No code changes and nothing is deployed. `content/offer.ts` is only where those
figures start.

## How it gets to the live site

The live site follows the `main` branch. Every other branch gets a preview that runs on
invented records. A change is a pull request, and three checks run on it: the build and
unit tests, the browser tests, and the Lighthouse budget.

The repository can look after its own hosting, database and payments settings through
`.github/workflows/infra.yml`, so a change to a live setting is a commit that is
reviewed like any other. [docs/ACCOUNTS.md](docs/ACCOUNTS.md) lists what it can do.

## Who made it

The brand is Ashleigh Lennard's. The site and the back end were built by Claude,
Anthropic's AI, working for Sam, in November 2026. No person wrote the code, and
[CLAUDE.md](CLAUDE.md) is how the next session knows what the last one decided.
