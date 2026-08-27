# Evidence

Generated, not written. Regenerate all of it with:

```bash
npx vitest run tests/agents/evidence.test.ts
```

Every number, status and log line in these files is read back out of the store,
the logger or the durable-step trace _after_ the scenario has run. Nothing is
narrated by hand.

| File                          | Shows                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-approval-gate-bypass.txt` | Seven deliberate attempts to make an external-effect tool fire without an approved `approvals` row. All refused.                                                        |
| `02-replay.txt`               | `replay(runId)` for a real three-step run, reconstructed from stored rows only, including the prompt rebuilt from storage.                                              |
| `03-cost-cap-halt.txt`        | All four cost ceilings tripped on purpose — per run, per agent per day, per agent per month, company-wide — with the halt recorded each time.                           |
| `04-approval-park-resume.txt` | A run parking on `waitForEvent`, the founder deciding, and the workflow resuming — with the step trace showing completed steps replayed from memory rather than re-run. |
| `05-kill-switch.txt`          | The kill switch thrown while a model call is open, aborting it mid-flight, and the halt recorded.                                                                       |
| `06-npm-test.txt`             | `npm run test` output.                                                                                                                                                  |
| `07-typecheck-lint-build.txt` | `npm run typecheck`, `npm run lint` and `npm run build` output.                                                                                                         |
| `08-no-secrets-grep.txt`      | Grep showing no key, secret or password value in the unit's committed files.                                                                                            |

## Mocked versus live

**Mocked: the model, and only the model.** `lib/agents/model/mock.ts` implements
the AI SDK's `LanguageModelV4` interface and replays a fixed script. It is used
because `ANTHROPIC_API_KEY` is not set in this environment, and because the
properties being proved — the approval gate, cost caps, the kill switch, replay,
durability — are properties of the runtime, not of the model. A live model cannot
make any of them true or false.

**Real in every artefact above:** the tool registry and its authorisation, the
effect-grant capability, the approval service, the cost meter and the price book,
the control plane, transcript persistence and its constraint checks, `replay`,
the run history, and the durable workflow body — the same one
`inngest/functions/agent-run.ts` registers.

**Real but not exercised here:** `SupabaseAgentStore` (needs a live database) and
the Inngest server itself (needs a running dev server or cloud account). The
in-memory store enforces the same invariants the SQL check constraints do —
terminal runs carry a finish time, failed runs carry an error, rejected approvals
carry a note, message `seq` is unique per run, a rejected tool call carries an
approval id — so a test that passes against it would pass against Postgres.

**Nothing here made a network call.** No live model call was made in producing
any artefact in this directory.
