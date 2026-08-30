# `lib/agents/roster` — the staff

The founder is the only human in HALF SOUR. These eight are the rest of the
company. `lib/agents` is the machinery they run on; this is who they are.

| Slug        | Name   | Job                     | Audience | Autonomy          | Runs               |
| ----------- | ------ | ----------------------- | -------- | ----------------- | ------------------ |
| `brine-ops` | Marlow | Head of Brine Ops       | internal | `act_with_limits` | 7pm daily          |
| `concierge` | Dot    | Customer Concierge      | B2C      | `propose`         | every four hours   |
| `ledger`    | Teller | Finance and Pricing     | internal | `propose`         | Monday 8am         |
| `social`    | Vinnie | Social and Content Lead | B2C      | `propose`         | Mon + Thu evenings |
| `marketing` | Ari    | Marketing               | B2C      | `propose`         | on demand          |
| `trade`     | Vic    | Trade                   | B2B      | `propose`         | on demand          |
| `product`   | Pip    | Product Development     | internal | `propose`         | first of the month |
| `analyst`   | Cass   | Analyst                 | internal | `act_with_limits` | Monday 6am         |

A role is an `AgentDefinition` plus the plain-English metadata a person needs —
what it does in one sentence, what it remembers, how you would know it was doing
its job, and what it actually does when it runs. Adding a ninth role is another
entry in `definitions.ts`. It is never a new code path, and it can never be a
new authorisation rule: those live in `lib/agents` and only there.

## Where things are

| File              | What it is                                                                          |
| ----------------- | ----------------------------------------------------------------------------------- |
| `definitions.ts`  | The eight roles: prompts, grants, autonomy, budgets, and the routine each runs      |
| `roster.ts`       | `loadRoster(strategyStore)` and `registerRoster(runtime, roster)`                   |
| `reads.ts`        | The read port: thirteen ways to look at the business, as typed structures           |
| `sql-reads.ts`    | Those reads in SQL, over any `$1`-style client (`pg` in the admin, PGlite in tests) |
| `tools.ts`        | Every tool the roster can be granted, declared with `defineTool`                    |
| `outbox.ts`       | The write side. Records; never delivers                                             |
| `presentation.ts` | The machine words in the founder's words, for the admin                             |
| `types.ts`        | `RosterRole` and the routine model                                                  |
| `evidence/`       | Generated proof; see `evidence/README.md`                                           |

## Two rules this unit adds

**A role cannot invent a fact.** Every number an agent states came out of a
query in `sql-reads.ts`. The analysis lives there too — days of cover, margin
against the floor, reorder cadence, week-on-week change — so the model is handed
a finished figure and told not to produce another one. Where the data is missing,
the field is `null` and the role is instructed to say so.

**Nothing is delivered.** This build is not authorised for live outbound. No
role has a tool that posts to a real account, sends a real email, or places a
real order. The five `external` tools and the one `storefront_write` tool all end
in `outbox.ts`, which writes the action down and returns a receipt saying it was
not sent. That is the second line, not the first: the first is the runtime, where
those two effect classes cannot execute at all without an `approvals` row in an
approved state covering the exact arguments.

## M38 — the consumer and trade sides are separate agents

Not one agent with a tone switch. Ari and Vic differ in every dimension that
matters, and `tests/roster/separation.test.ts` asserts each one:

|             | Ari (B2C)                                         | Vic (B2B)                                                               |
| ----------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| Prompt      | Leads with the DIRECT CUSTOMER script             | Leads with the TRADE BUYER script; carries the market model             |
| Tools       | aggregate sales, catalogue, draft, campaign email | trade list, one account's whole file, catalogue, account note, outreach |
| Memory      | none, deliberately — a consumer is a number here  | everything, per account: orders, every message sent, whether it opened  |
| Measured on | repeat purchase rate and revenue per campaign     | accounts reordering inside their own cadence                            |

They share exactly one tool: `read_catalogue`, the price list. Each is refused
the other's channel by the runtime, not by a policy anyone has to remember.

## Registration

`supabase/migrations/20260103000000_agent_roster.sql` writes the eight into
`public.agents`, which is the table the admin's Team page reads and the table
`AgentRuntime.register()` reconciles into. `tests/roster/registration.test.ts`
applies that migration to a real Postgres and fails if it has drifted from the
definitions, field for field.

`supabase/seed.sql` truncates `public.agents`. **After re-running the seed,
re-apply the roster migration**, or the admin will show the six seeded rows and
not the roster.

## Running one

```ts
const roster = await loadRoster(new SqlStrategyStore(sql));
const tools = createRosterTools({
  reads: new SqlBusinessReads(sql),
  outbox: new RecordingOutbox(),
});
const platform = createAgentRuntime({
  store,
  registry: tools.registry,
  models,
});
await registerRoster(platform.runtime, roster);

const role = roleFor(roster, "brine-ops");
const run = await platform.runtime.startRun({
  agentSlug: role.definition.slug,
  goal: role.goal,
  trigger: "schedule",
});
await platform.runtime.runToCompletion(run.runId, { onApproval });
```

## Wiring it into the app

`app/api/inngest/route.ts` currently serves the durable functions with an empty
registry, and its own comment says the unit that defines the agents replaces it.
`createRosterPlatform()` is that replacement, in one call:

```ts
const { platform } = await createRosterPlatform({
  sql: createPgExecutor(process.env.SUPABASE_DB_URL),
  outbox: new RecordingOutbox(),
});
```

**It is not called anywhere yet.** It needs `ANTHROPIC_API_KEY` and the Supabase
service credentials, neither of which is configured in this environment, and
`createProductionRuntime` refuses to build a platform with no model behind it —
which is the correct behaviour and the reason the wiring is left as one
deliberate line for whoever configures those.

## Testing without a key

`ANTHROPIC_API_KEY` is not required and was not present when this was built.
`tests/roster/support/planner-model.ts` is a deterministic model that follows the
role's own routine and writes only from what the tools returned — so the tests
exercise the real runtime, the real tools and the real seeded business, and the
only thing standing in for the real world is the sentence generator.

```bash
npx vitest run tests/roster/                      # the whole unit
npx vitest run tests/roster/evidence.test.ts      # regenerate lib/agents/roster/evidence/
npx vitest run tests/roster/approval-gate.test.ts # the bypass attempts
```
