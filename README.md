# Quick Pickle

The one-page shop for Quick Pickle: pickle juice shots, sold direct in New Zealand.

Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · TypeScript. No CMS and no
third-party storefront: the catalogue, the jar and the checkout are all in this repository.

## Getting started

Node 22 (pinned in `.nvmrc`).

```bash
nvm use
npm install
npm run dev
```

Nothing needs configuring to run it. With no environment variables set, the site builds,
serves, takes test orders and charges nobody. See `.env.example` for the three that exist.

## Scripts

| Script                        | What it does                                             |
| ----------------------------- | -------------------------------------------------------- |
| `npm run dev`                 | Dev server on http://localhost:3000                      |
| `npm run build`               | Production build. The real check that a change is sound. |
| `npm start`                   | Serve the production build                               |
| `npm run typecheck`           | `next typegen` + `tsc --noEmit`                          |
| `npm run lint`                | ESLint + Prettier check                                  |
| `npm run test`                | Vitest: money, jar, pricing, orders, brand tokens        |
| `npm run test:e2e`            | Playwright: the purchase journey, no-JS, axe             |
| `npm run audit:copy`          | Fails on a banned claim in anything a customer can read  |
| `npm run audit:copy:selftest` | Proves the scanner still catches what it exists to catch |
| `npm run prelaunch`           | Lists what still stands between this and taking money    |
| `npm run lhci`                | Lighthouse budget                                        |

## Where things are

```
content/     every word and every price. Start here.
app/         the page, /checkout, /order/thanks, the fine print, /backstage
components/  brand art, page sections, the jar, the checkout form
lib/brand/   design tokens, fonts, generated art data
lib/shop/    money, jar, pricing, orders, payment and storage seams
legal/       the copy rules and the scanner that enforces them
scripts/     art, vector, video and go-live tooling
```

To change a price, a pack or a delivery rate: `content/offer.ts`.
To change a line of copy: `content/site.ts`.

`CLAUDE.md` has the rules of the road. `TODO.md` has the honest status.
