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

It **opens the admin to readers**. With `HALF_SOUR_DEMO=1`, `proxy.ts` does not
require a session on `/admin`, and `requireAdminAccess()` lets a page render
without one. Every row on the far side of that door is invented, the deployment
is `noindex` three ways over, and a password in front of a fabricated business
protects nothing while costing the one thing the demo is for.

It does **not** touch authentication. Read the paragraph above as exactly what
it says — the admin does not _require_ a session — and not a word more. Demo
mode mints no session, invents no operator, hard-codes no credential and
answers no password check on anybody's behalf. `/login` still works and still
matters: `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` are still what a
sign-in needs, a wrong password is still refused by the same argon2id
verification with the same escalating delay and the same lockout, and there is
no code path anywhere that signs anyone in without verifying a password.
`describeAuthConfigGaps` behaves exactly as it did, minus the `SUPABASE_DB_URL`
line. `tests/demo/switch.test.ts` asserts those halves and
`tests/auth/proxy-unconfigured.test.ts` asserts the door, both ways.

It **does not open the admin to writers**. A write is stamped into an
append-only `audit_log` row against the operator who made it, and an anonymous
visitor is not an operator. So `requireAdminSession()` — which every write in
`components/admin/write/guard.ts` goes through — is deliberately not
demo-aware: pressing a write control while signed out lands on `/login` with
the page you came from remembered, rather than writing an unattributable row.
Which actions those are is listed at the end of this file.

With `HALF_SOUR_DEMO` unset, none of the above exists. The proxy fails closed,
`/admin` redirects to `/login`, and every line of the gate behaves as it did
before demo mode was written.

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

## What does not work without signing in

The open admin reads. These want an operator to record the change against, so
each one redirects to `/login` and comes back to where it was afterwards:

- Orders — packing, adding a tracking number, cancelling, recording a refund
- Stock — adjusting a count, setting a reorder point
- Batches — opening a batch, releasing one for sale
- Social — approving, declining, editing wording, putting a post in the diary
- The team — pausing an agent, approving or declining what one has asked for,
  changing an agent's autonomy
- Assets — uploading a picture, editing or deleting one, recording consent
- Signing out, which needs a session to sign out of

The forms are still on screen while signed out. That is deliberate: the shape
of the work is most of what the admin is worth showing, and a screen with its
controls removed demonstrates less than one that asks for a password when a
control is pressed.
