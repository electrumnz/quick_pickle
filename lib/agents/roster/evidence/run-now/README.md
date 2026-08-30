# "Run now" — the control, photographed

Six screenshots of `/admin/team/brine-ops`, taken against a real server with the
production build, signing in through the real login form. What each one is, and
what was true when it was taken.

| Shot                    | What it shows                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `01-needs-sign-in.png`  | The open demonstration admin, nobody signed in. The button is disabled and says why. |
| `02-ready.png`          | Signed in, a model configured. The button is live and the cost is quoted.            |
| `03-during.png`         | Mid-run. Disabled, saying "Marlow is working…", with the live region beneath.        |
| `04-after.png`          | Where it landed: the finished transcript, `started by you`, priced.                  |
| `05-no-model.png`       | No `AI_GATEWAY_API_KEY`. "The team cannot think", and the variable to set.           |
| `06-window-expired.png` | Past 6 September 2026. Which model lapsed, and what to set instead.                  |

## What was real, and what was not

**Real in every shot.** The production build (`next build`), served by
`next start`. The compiled-in demonstration Postgres — the same image the
deployment uses, with `supabase/seed.sql` behind it. The real login form, real
argon2id verification, a real session cookie: there is no test bypass here, so
shots 1 and 2 sitting next to each other are proof that the only difference
between them is a password. The real roster, loaded from `strategy_documents`.
The real runtime, the real approval gate, the real cost meter, the real
`SqlAgentStore` writing `agent_runs`, `agent_messages`, `agent_tool_calls` and
`agent_costs`, and `RecordingOutbox`, which delivers nothing.

**Not real: the model's answer.** No gateway credential was available in the
container this was captured from. Rather than photograph a scripted planner and
call it a run, `stand-in-gateway.mjs` speaks the gateway's own wire protocol on
`127.0.0.1:4311` and the app is pointed at it with `AI_GATEWAY_BASE_URL`. So the
real `@ai-sdk/gateway` client built the request, the runtime built the prompt,
the seeded Postgres answered `read_stock_cover`, the meter priced the tokens and
the transcript was written — but the two sentences Marlow "says" in shot 4 were
written by hand in that file, not by a model.

`tests/roster/manual-run.test.ts` proves the same stack with `fetch` substituted
in process, and asserts what actually goes on the wire: the gateway URL, the
`ai-language-model-id` header, the credential, and the role's twenty-three tool
definitions and nobody else's.

**Not real: the clock, in shot 6 only.** The free window on
`minimax/minimax-m2.7-free` closes at the end of Sunday 6 September 2026 and
these were taken on 30 August. `shift-clock.mjs` is a `--import` preload that
moves the server's clock to 8 September. Nothing in `lib/agents` is patched, no
constant is edited and no test hook exists in the product: the server simply
believes it is a date it will really be in nine days.

## Reproducing it

```bash
NEXT_DIST_DIR=.scratch/next-runnow HALF_SOUR_DEMO=1 npx next build

node lib/agents/roster/evidence/run-now/stand-in-gateway.mjs 4311 &

HALF_SOUR_DEMO=1 SUPABASE_DB_URL= NEXT_DIST_DIR=.scratch/next-runnow \
  ADMIN_PASSWORD_HASH='<argon2id hash, $ escaped if a dotenv file declares the key>' \
  ADMIN_SESSION_SECRET='<32+ random bytes, base64>' \
  AI_GATEWAY_API_KEY=stand-in AI_GATEWAY_BASE_URL=http://127.0.0.1:4311 \
  npx next start -p 3315 &

BASE=http://localhost:3315 ADMIN_PASSWORD='…' STATE=ready \
  node lib/agents/roster/evidence/run-now/capture.mjs
```

`STATE` is one of `needs-sign-in`, `ready`, `no-model`, `window-expired`. The
last two want a server started without `AI_GATEWAY_API_KEY`, and with
`HALF_SOUR_EVIDENCE_CLOCK=2026-09-08T09:00:00.000Z` plus the `--import` preload,
respectively.

Use `localhost`, not `127.0.0.1`. The admin refuses a cross-origin state change,
and `NEXT_PUBLIC_SITE_URL` is compiled into the build — a sign-in from
`127.0.0.1` is correctly recorded in `audit_log` as `cross_site` and refused.
