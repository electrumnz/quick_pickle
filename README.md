# HALF SOUR

Next.js 16 (App Router) + React 19 + Tailwind CSS v4 storefront.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values; never commit real ones
npm run dev
```

## Scripts

| Script              | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Dev server on http://localhost:3000 |
| `npm run build`     | Production build                    |
| `npm start`         | Serve the production build          |
| `npm run typecheck` | `next typegen` + `tsc --noEmit`     |
| `npm run lint`      | ESLint + Prettier check             |
| `npm run test`      | Vitest unit tests                   |
| `npm run test:e2e`  | Playwright end-to-end tests         |

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

CI (`.github/workflows/ci.yml`) runs install → typecheck → lint → test → build
on every push and pull request.
