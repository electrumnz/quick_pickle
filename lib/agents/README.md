# `lib/agents` — the agent runtime

Every AI role in the HALF SOUR admin runs on this. The founder is the only human
in the company; these agents cover every other role. The runtime is what makes
them safe to trust.

A role is a **definition**, not a codepath:

```ts
export const socialAgent = defineAgent({
  slug: "social",
  name: "Ari",
  jobTitle: "Social",
  purpose: "Keeps the feed alive without ever making a health claim.",
  model: "claude-opus-5",
  systemPrompt: "...",
  tools: ["read_catalogue", "save_internal_draft", "send_external_message"],
  autonomy: "act_with_limits",
  requiresApprovalFor: ["social_post"],
  budget: { perRunCents: 40, dailyCents: 300, monthlyCents: 6000 },
  maxSteps: 8,
  brandRuleScopes: ["social"],
});
```

Adding a role is a new definition and, if it needs new capabilities, new
`defineTool` declarations. It is never a new codepath, and it can never be a new
authorisation rule — those live here and only here.

## The safety property

> No agent can write to the storefront or send an external message without a row
> in `approvals` with an explicit approved state.

This is enforced structurally, not by convention.

1. **A tool's code is unreachable.** `defineTool` stores the executor in a
   module-private `WeakMap` keyed by the definition object. The returned
   `ToolDefinition` has no property that exposes it. The only way to run a tool
   is `invokeTool`, which is where the check lives.
2. **Effectful tools need a capability.** For effect classes `storefront_write`
   and `external`, `invokeTool` requires an `EffectGrant`. The type is branded
   with a `unique symbol` that is never exported, so no other module can write a
   value of that type; and every minted grant is recorded in a module-private
   `WeakSet`, so a runtime forgery — including a field-for-field copy of a real
   grant — fails membership.
3. **A grant cannot exist without an approval.** `mintEffectGrant` derives every
   field from an `ApprovalRecord` _read back from the store_. It refuses a row
   that is not `approved`, one raised by a different run, an expired one, and one
   whose payload fingerprint (SHA-256 over canonical JSON) differs from the
   arguments about to run. Grants are single-use and short-lived.
4. **The model cannot execute anything.** Tools are handed to the model with no
   `execute` function, so a model call can only _propose_. The runtime decides
   what happens next.

`lib/agents/evidence/01-approval-gate-bypass.txt` is the output of seven
deliberate bypass attempts, all refused.

## What is where

| Path                         | What it is                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| `definition.ts`              | `defineAgent` — the typed, validated role declaration             |
| `types.ts`                   | The domain model, mirroring the SQL enums one for one             |
| `tools/registry.ts`          | `defineTool`, `ToolRegistry`, `invokeTool`                        |
| `tools/effects.ts`           | `EffectGrant` — the capability the approval gate mints            |
| `tools/authorization.ts`     | Grant list, autonomy dial, approval policy                        |
| `tools/builtin/reference.ts` | One worked tool per effect class                                  |
| `approvals/service.ts`       | Raises, decides and applies `approvals` rows                      |
| `cost/pricing.ts`            | The price book, in NZD micros                                     |
| `cost/meter.ts`              | Per-run, per-day, per-month and company-wide caps                 |
| `control/kill-switch.ts`     | The kill switch, the per-agent pause, the in-flight watcher       |
| `store/`                     | The persistence port, plus in-memory and Supabase implementations |
| `model/`                     | Anthropic via the AI SDK, and the scripted model used for tests   |
| `runtime/runtime.ts`         | The runner: one method per unit of work                           |
| `runtime/replay.ts`          | `replay(runId)` and `renderReplay`                                |
| `runtime/history.ts`         | Typed run history and `explain(runId)` for the admin              |
| `evidence/`                  | Generated proof; see `evidence/README.md`                         |

## The effect classes

| Effect             | Meaning                                             | Needs an approved row?                             |
| ------------------ | --------------------------------------------------- | -------------------------------------------------- |
| `read`             | Observes only                                       | No                                                 |
| `business_write`   | Mutates our own records                             | Only if the autonomy dial or configuration says so |
| `storefront_write` | Changes what customers see                          | **Always**                                         |
| `external`         | Leaves the company — email, social, supplier orders | **Always**                                         |

## The autonomy dial

| Position          | Reads | Internal writes        | Storefront / external |
| ----------------- | ----- | ---------------------- | --------------------- |
| `observe`         | yes   | refused outright       | refused outright      |
| `propose`         | yes   | raises an approval     | raises an approval    |
| `act_with_limits` | yes   | runs inside the caps   | raises an approval    |
| `autonomous`      | yes   | runs and reports after | raises an approval    |

No position removes the approval requirement from the last column. That is the
point of the table.

## Durability and replay

The runtime holds no conversation state in a variable. Before every model call it
rebuilds the prompt from `agent_messages`. That single decision makes three
things the same mechanism:

- a run **survives a redeploy**, because its state is the transcript;
- a **crashed run is inspectable**, because everything was written as it happened;
- `replay(runId)` is **provably faithful**, because it uses the same
  `reconstructPrompt` the runner does.

## Cost

`agent_costs` stores NZD **micros** — millionths of a dollar — because token
pricing is far below one cent per call. A cost row is written immediately after
each model call, before the next step begins. Caps are checked _before_ the call
using a worst-case projection, so a run that would blow its budget stops before
the money is spent, and again after using the real usage.

## Testing without a key

`ANTHROPIC_API_KEY` is not required. `ScriptedModel` implements the AI SDK's
`LanguageModelV4` interface directly and replays a fixed script. Everything below
the model — the registry, the gate, the meter, the control plane, persistence —
is the real code in both cases.

```bash
npm run test                                   # the whole suite
npx vitest run tests/agents/                   # just the runtime
npx vitest run tests/agents/evidence.test.ts   # regenerate lib/agents/evidence/
```
