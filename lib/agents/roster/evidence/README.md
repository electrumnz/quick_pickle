# Evidence

Generated, not written. Regenerate with:

```bash
npx vitest run tests/roster/evidence.test.ts        # 01–09
npx vitest run tests/roster/approval-gate.test.ts   # 10
npx vitest run tests/roster/separation.test.ts      # 11
BASE=http://localhost:3000 ADMIN_PASSWORD='…' \
  node lib/agents/roster/evidence/capture.mjs       # the screenshots
```

Every number, name and status in these files is read back out of the run
transcript, the approvals table, the cost ledger or the outbox **after** the run
finished. Nothing is narrated by hand. Identifiers are replaced with stable
placeholders (`id#1`) so a regeneration produces the same file unless the
behaviour changed — the business figures do move, because the seed is anchored
to the day it is loaded, and that is the data changing rather than the code.

| File                          | Shows                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `01-roster-registration.txt`  | The eight roles as declared in code, beside the `public.agents` rows the migration wrote. Field-for-field.                     |
| `02-marlow-ops.txt`           | Ops: days of cover per line, ingredients under their reorder point, a priced supplier order put to the founder.                |
| `03-dot-concierge.txt`        | Concierge: everyone waiting, the unhappy one refused an unattended reply, one customer's history read before drafting.         |
| `04-teller-finance.txt`       | Finance: unit cost from the last three released batches, GST separated, margins against the floor, a price change proposed.    |
| `05-vinnie-social.txt`        | Social: a fortnight of post performance, the failed post nobody was told about, a caption drafted from the BrandScript.        |
| `06-ari-marketing.txt`        | Marketing (B2C): the line that fell, a campaign to lapsed customers, stopped at the send.                                      |
| `07-vic-trade.txt`            | Trade (B2B): six accounts ranked by lateness against their own cadence, one account's whole file read, a restock note drafted. |
| `08-pip-product.txt`          | Product: ninety days of sales next to review ratings, one concept written from a recipe that already exists.                   |
| `09-cass-analyst.txt`         | Analyst: the week against the week before, and the sentence the admin opens with.                                              |
| `10-approval-gate-bypass.txt` | Eight deliberate attempts to make a roster agent send something without an approved row. All refused.                          |
| `11-b2c-b2b-separation.txt`   | M38: the two audiences are two agents — prompts, tools, memory, measures, and what each actually wrote.                        |
| `team-*.png`, `agent-*.png`   | The Team and two agent records, at 1440 and 375, light and dark, through a real sign-in.                                       |
| `screenshots.json`            | What was measured on each screenshot: title, headings, console errors, horizontal overflow.                                    |

## Mocked versus live

**Mocked: the model, and only the model.** There is no `ANTHROPIC_API_KEY` in
this environment, and no live model call was made in producing anything here.
`tests/roster/support/planner-model.ts` implements the AI SDK's
`LanguageModelV4` interface directly. It:

- **refuses to work without the strategy** — if the system prompt carries no
  STRATEGY block it throws, so a broken prompt chain fails loudly rather than
  quietly producing something;
- **follows the role's own routine**, which is data on the role in
  `lib/agents/roster/definitions.ts` and is rendered on the admin's agent page —
  not a script hidden in the test;
- **writes only from tool results.** Every figure in an agent's output was
  returned by a tool that ran a query against the seeded business.

One exception, stated plainly: for the two tools whose job is to write a sentence
to a person — `queue_social_post` and `queue_campaign_email` — the copy is
composed out of named BrandScript fields lifted from the system prompt, the same
mechanical way `tests/strategy/support/briefing-model.ts` does it. That is
deliberate. It means a strategy edit visibly changes the copy, which is the
property that matters, and it means the caption cannot contain a claim nobody
wrote down. **Which bottle** the copy is about still comes from the sales data.

**Real in every artefact:** the seeded business database (all migrations and
`supabase/seed.sql` applied to a real Postgres via PGlite), every SQL read the
roster performs, the strategy and brand rules loaded out of their tables, the
role definitions, the tool registry and its authorisation, the effect-grant
capability, the approval service, the cost meter and the price book, the control
plane, transcript persistence, `replay`, and `runToCompletion`.

**Real but not exercised here:** `SupabaseAgentStore` (needs a hosted database)
and the Inngest server. Runs are recorded in `InMemoryAgentStore`, which enforces
the same invariants the SQL check constraints do, so an evidence run leaves the
business database exactly as it found it.

**Nothing left the company.** Every `external` and `storefront_write` tool ends
in `RecordingOutbox`, which writes the approved action down and returns a receipt
saying it was not delivered. The count of things actually delivered anywhere, in
every run in this directory, is zero.

## The seeded runs in the migration

`20260103000000_agent_roster.sql` gives Ari, Vic, Pip and Cass one run each so
the admin can answer "what did this thing do, and why?" for them on day one.
Those runs are **transcribed from the runs recorded here** — the goals, the
reasoning and the figures are the ones in `06`–`09` — and every seeded run's
`context.provenance` names the file it came from. They are a record of a real
run against the seeded business, not an imagined one, and they were produced by
the planner model described above rather than by a live model.
