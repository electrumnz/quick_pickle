# `inngest` — durable execution for the agent runtime

Inngest runs each agent turn as a separate durable step, so a flaky tool retries
on its own without re-spending a model call, a redeploy resumes from the last
completed step, and a run waiting on the founder holds no process open.

## The functions

| Function                  | Trigger                     | What it does                           |
| ------------------------- | --------------------------- | -------------------------------------- |
| `agent-run`               | `agent/run.requested`       | Drives one agent run to completion     |
| `agent-kill-switch-sweep` | `agent/kill-switch.engaged` | Writes down why every live run stopped |
| `agent-paused-sweep`      | `agent/agent.paused`        | The same, for one role                 |

`agent-run` declares `cancelOn` for both control events, so the kill switch and
the per-agent pause stop runs that are already moving. Inngest cancels the
function wherever it is; the sweep function then records the reason on the row,
because a cancelled function does not get to write its own epitaph.

## The shape of a run

```
start-run
  control-0        kill switch / agent pause
  model-0          one model call; messages and cost persisted inside the step
  gate-0-0         authorisation + approval policy for one proposed tool call
    tool-0-0       ... if it may run unattended
    approval-0-0   ... or waitForEvent("agent/approval.decided", timeout "3d")
    resume-0-0     apply the decision — execute, or feed the refusal back
  control-1
  model-1
  ...
summarise-N
```

## Why the body is written against `DurableStep`

`workflow.ts` takes a `DurableStep` rather than Inngest's `step` directly. Two
reasons, both practical:

- `MemoryDurableStep` reproduces Inngest's execution model — completed steps
  memoised by id, the whole function re-invoked after a park — so park/resume is
  provable in a unit test, without a running Inngest server and without an
  `ANTHROPIC_API_KEY`. See `lib/agents/evidence/04-approval-park-resume.txt`.
- It makes the re-invocation model explicit to anyone reading the workflow.
  Nothing in the body may rely on a live object surviving a step boundary, and
  the memory driver enforces that by round-tripping every step result through
  JSON.

## Wiring

`app/api/inngest/route.ts` serves the functions. The runtime the functions use is
installed with `configureAgentPlatform`, which takes a factory so the tool
registry and the agent definitions can belong to the unit that owns the roles
rather than to the runtime.

```ts
configureAgentPlatform(() => {
  const platform = createProductionRuntime({ registry: myToolRegistry });
  // register each role once, at startup
  return platform;
});
```

## Environment

```
INNGEST_EVENT_KEY     server only; absent in local dev
INNGEST_SIGNING_KEY   server only; verifies inbound requests from Inngest
```

Locally: `npx inngest-cli dev` and point it at `http://localhost:3000/api/inngest`.
