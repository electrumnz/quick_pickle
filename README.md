# HALF SOUR

Next.js 16 (App Router) + React 19 + Tailwind CSS v4 storefront.

## Getting started

Node 22 is required — it is pinned in `.nvmrc`, declared in `package.json`
`engines`, used by every CI job and set as the Vercel project's Node version, so
what is verified is what ships.

```bash
nvm use                      # reads .nvmrc
npm install
cp .env.example .env.local   # fill in values; never commit real ones
npm run dev
```

## Scripts

| Script              | What it does                           |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Dev server on http://localhost:3000    |
| `npm run build`     | Production build                       |
| `npm start`         | Serve the production build             |
| `npm run typecheck` | `next typegen` + `tsc --noEmit`        |
| `npm run lint`      | ESLint + Prettier check                |
| `npm run test`      | Vitest unit tests                      |
| `npm run test:e2e`  | Playwright end-to-end tests            |
| `npm run lhci`      | Lighthouse CI: collect + assert budget |

## Layout

```
app/(site)/     public storefront routes
app/(admin)/    password-gated admin routes
lib/commerce/   Shopify clients, cart + checkout
lib/agents/     Claude-powered agents and tools
lib/brand/      brand tokens, voice, asset manifests
components/3d/  React Three Fiber scenes
inngest/        background + scheduled functions
supabase/       database migrations
e2e/            Playwright specs
tests/          Vitest specs
```

## CI

`.github/workflows/ci.yml` runs three independent jobs on every push and pull
request:

| Job                               | What it gates                                                       |
| --------------------------------- | ------------------------------------------------------------------- |
| `typecheck / lint / test / build` | `next typegen` + `tsc`, ESLint + Prettier, Vitest, production build |
| `e2e (Playwright)`                | the Playwright suite, run against `next start`, not `next dev`      |
| `Lighthouse budget`               | `lighthouserc.json` assertions — a violation fails the build        |

### Lighthouse budget

`lighthouserc.json` is the performance contract, asserted against the
production build (`npm run build && npm start`) on a mobile emulation profile.
Breaching any of these fails CI:

- Performance, Accessibility, Best Practices and SEO all >= 95
- Cumulative Layout Shift <= 0.02
- Resource budgets: script <= 400 kB, stylesheet <= 100 kB, image <= 600 kB,
  total <= 1.6 MB (transfer size)

Reports are uploaded as the `lighthouse-reports` build artefact. Add new routes
to `ci.collect.url` as they land so the budget covers them too.

## Deployments

The Vercel project `half-sour` tracks this repository. Its production branch is
the working branch, so every push deploys to production and updates
<https://half-sour.vercel.app>. Preview deployments stay enabled: any other
branch or pull request gets its own URL.
