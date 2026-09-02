# HALF SOUR

Brand, storefront and admin for a New Zealand pickle-brine company.
One founder is the only human; Grok Bot operates the admin as a person at the
keyboard (see `docs/grok-bot-adoption.md`). There is no in-site agent runtime.

## Non-negotiables

**No health claims. Anywhere. Ever.** Positioning is culinary — brine as a cocktail
mixer and cooking acid. Not sports recovery, not gut health, not wellness. Health and
nutrition claims on food are governed by the FSANZ Code and MPI, and a single stray word
turns marketing copy into a regulated therapeutic claim.

`legal/COPY-RULES.md` is binding on every word this company publishes, including anything
an AI agent drafts. It is machine-enforced:

```bash
node legal/scripts/audit-copy.mjs <paths>   # exits non-zero on a banned term
```

Note "cure" and "cured" are CORRECT food vocabulary here — a half-sour is a cucumber
_cured_ in brine rather than vinegar. That is the brand's own name rationale. Do not
avoid the word; the scanner rule for it is scoped to the therapeutic sense.

**Provenance must be literally true.** Fair Trading Act s 13(j) makes false place-of-origin
claims an offence. Supplier stories are a deliberate content pillar, so any sourcing fact
not yet verified is marked `TODO: verify with supplier` rather than written as fact.

## The products

| SKU       | Name            | Brine                              | Price | Job                             |
| --------- | --------------- | ---------------------------------- | ----- | ------------------------------- |
| HS-01-500 | No 01 HOUSE     | Dill, peppercorn, garlic, bay      | $18   | The everyday one                |
| HS-02-500 | No 02 DIRTY     | Cornichon, green olive, lemon peel | $20   | The martini                     |
| HS-03-500 | No 03 SMOKE     | Chipotle, manzano, manuka-smoked   | $22   | Mezcal, michelada, pork         |
| HS-04-500 | No 04 WILD      | Kawakawa, kelp, lemon              | $26   | Seafood. Limited by leaf supply |
| HS-SET-3  | The First Three | All three of 01–03                 | $54   |                                 |

All 500ml, NZD, live in Shopify. WILD carries the highest claim risk in the range because
kawakawa has strong rongoā associations — keep its copy strictly culinary.

## Stack

Next.js App Router · TypeScript · Tailwind v4 · Vercel
React Three Fiber + GSAP/ScrollTrigger + Lenis for the storefront
Shopify (Storefront + Admin API) behind a provider adapter
Supabase for everything Shopify cannot do — recipes, batches, approvals, brand rules
Admin operations via Grok Bot (see `docs/grok-bot-adoption.md`); no in-site agent runtime

**Pinned versions, deliberately.** ESLint 9 not 10 (eslint-config-next bundles an
eslint-plugin-react that calls the removed `context.getFilename()`). TypeScript 6 not 7
(typescript-eslint hard-throws on TS 7). Playwright 1.56 to match the preinstalled
Chromium build. Do not "upgrade" these without checking why they are held back.

## Conventions

- **Never a raw hex colour outside `lib/brand/`.** Components consume the semantic token
  layer (`--text-primary`, `--surface-raised`), never a pigment name. A test enforces it.
- **Money is integer minor units.** Never a float in a price path. Shopify returns decimal
  strings; conversion belongs in the adapter.
- **`npm run typecheck` is not sufficient.** It has passed on trees where `npm run build`
  failed on a real error. Verify with `npm run build`.
- No `any`, no `@ts-ignore`, no unjustified `eslint-disable`.
- Commerce is behind `lib/commerce/provider.ts`. A conformance suite written once runs
  against both the mock and Shopify providers; `COMMERCE_PROVIDER` switches them.
- **Take a private build directory.** Two `next build`s sharing `.next` do not fail
  loudly — they interleave, and a running `next start` then serves HTML pointing at CSS
  the other build deleted, which looks like a styling bug and is not one. Use
  `NEXT_DIST_DIR=.scratch/next-<something>`. It also gets its own gitignored
  `tsconfig.scratch.json`, so private builds cannot dirty the repo's.
- **Next 16 allows one `next dev` per directory.** A crashed run leaves the server
  holding the lock and every later run in that directory fails with "Another next dev
  server is already running" — kill it by the PID the message gives you. A stale server
  on port 3000 caused three wrong diagnoses in one session, because Playwright's
  `reuseExistingServer` picks it up silently.
- **Never `pkill -f` on a broad pattern.** It has killed servers belonging to other work,
  and once killed the shell that ran it, because the pattern matched its own command
  line. Kill by PID.

## How it runs today

`HALF_SOUR_DEMO=1` is set in production. The whole deployment is served from a PGlite
image compiled into the build — **no Supabase, no database credential**. `SUPABASE_DB_URL`
is answered by `pglite://half-sour-demo`, which nothing dials.

Demo mode is opt-in and one variable. Unset it and everything reverts exactly: the proxy
fails closed, `/admin` redirects to `/login`, and argon2id, the throttle, the lockout and
the sealed cookie all behave as they always did. Tests assert both directions.

Two things it changes, deliberately, because every row in that database is invented:

- **The admin is open** — no password to look. Gated on
  `demoOpensAdmin()`, not bare `isDemoMode()`: the latter is also true when
  `HALF_SOUR_DEMO=1` sits beside a real `SUPABASE_DB_URL`, and Server Actions are
  reachable by POST without rendering a page. Writes with nobody signed in are stamped
  `actor_type = 'system'` against a row that says what it is, never against the founder.
- **The approval gate still holds.** Deciding needs the password.

## Deploying

Production is `half-sour.vercel.app`, and it tracks `main`. A push to `main` builds and
publishes; nothing else does. `vercel.json` turns deployments off for the working branch,
so pushing there is free — use it to park work that is not ready to be seen.

Never push a red build to main: Vercel keeps the last good deployment, so a failed build
silently freezes production rather than breaking it, which is harder to notice.

## Not done yet

See `TODO.md`.
