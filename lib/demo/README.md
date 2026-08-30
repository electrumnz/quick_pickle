# `lib/demo` — the demonstration deployment

One environment variable, `HALF_SOUR_DEMO=1`, gives the deployment a Postgres
that is compiled into it. Nothing else turns it on, and with it unset nothing in
this directory runs.

## Why it exists

The storefront reads from `content/`, so it renders with no database at all.
Everything else does not. Without `SUPABASE_DB_URL`, `/shop` shows four bottles
that all say "Unavailable — ordering is switched off", and the admin cannot
open. Demo mode fills that hole without anyone having to stand up Supabase
first.

## The pieces

| File                      | What it is                                                          |
| ------------------------- | ------------------------------------------------------------------- |
| `mode.ts`                 | The one predicate, `isDemoMode`, and the database-URL resolver.     |
| `build.ts`                | Applies the migrations and `supabase/seed.sql`, dumps the data dir. |
| `database.ts`             | Opens the image, once per server process, as a `SqlExecutor`.       |
| `scripts/build-image.mts` | The `prebuild` step. Skips silently unless demo mode is on.         |
| `generated/`              | The image. Gitignored — it is a cache of files already in the tree. |

The image is built by `prebuild`, so `HALF_SOUR_DEMO` is necessarily set at
build time for a demo deployment to exist. That is why the `noindex` layers can
be decided at build time.

## What demo mode does and does not do

It substitutes a **database**, at one seam: `resolveDatabaseUrl` answers with
`pglite://half-sour-demo`, and `createPgExecutor` turns that into the image.
Commerce, the admin's own queries, the storefront's list sign-ups, the asset
library and the auth store all go through that one door.

It does **not** touch authentication. `ADMIN_PASSWORD_HASH` and
`ADMIN_SESSION_SECRET` are still required, a wrong password is still refused by
the same argon2id verification with the same escalating delay and the same
lockout, and there is no code path anywhere that signs anyone in without
verifying a password. `describeAuthConfigGaps` behaves exactly as it did, minus
the `SUPABASE_DB_URL` line. `tests/demo/switch.test.ts` asserts both halves.

## The limitation, stated plainly

**Reads are consistent. Writes are not durable.**

Every server instance opens the same image, so the catalogue, the 95 orders and
the agent history are identical wherever a request lands. A write — packing an
order, adjusting stock, adding to a cart — goes into the memory of the one
instance that served it. That instance keeps it: pack an order and reload, and
the order is packed. But serverless instances share no memory, so the next
request may reach one that never saw it, and a redeploy or a recycle discards
everything.

That is why the banner is on every page and says the data resets, and why
`/admin/settings` says it again in more words. A demo that quietly loses a write
teaches the founder to distrust the admin.

## Commands

```bash
npm run demo:build-image                     # build the image now
HALF_SOUR_DEMO=1 npm run build               # build it as part of the build
HALF_SOUR_DEMO=1 COMMERCE_PROVIDER=demo \
  npx vitest run tests/commerce/conformance.test.ts   # the suite, against the image
npx vitest run tests/demo/switch.test.ts     # the switch, both ways
```
