<!-- copy-audit-ignore-file — this file quotes generated agent output whose source copy is scanned in content/strategy/ -->

# Brand & Plan — evidence

Generated, not written. Every file here is the output of a command in this
repository, and the command is named next to it.

## The acceptance test: a BrandScript edit changes what an agent says

`npx vitest run tests/strategy/agent-wiring.test.ts`

| File                                  | What it shows                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-brandscript-drives-output.txt`    | The marketing agent run twice through the real `AgentRuntime`. One field differs between the runs — `brandScript.derived.oneLiner` — and the two captions are printed side by side.                           |
| `02-database-edit-changes-output.txt` | The same proof with no TypeScript changed at all: one `update public.strategy_documents` statement, the agent definitions rebuilt from the store, and a different caption. This is the path production takes. |
| `03-agent-briefings.txt`              | The complete system prompt each of the two roles is handed, so the scoping (`applies_to`) can be read rather than taken on trust. Ari gets the story; Vic gets the story and the numbers.                     |

**What is real and what is not.** The strategy tables, `SqlStrategyStore`, the
prompt composition, `defineAgent`, the tool registry, the approval gate, the
cost meter, the control plane, the transcript and `runToCompletion` are all the
production code. The model is not: it is `BriefingModel`, a deterministic
`LanguageModelV4` that composes its answer only out of the named lines it finds
in the system prompt, and refuses to write at all when the strategy block is
absent. A scripted model could not have proved this — its output is fixed in
advance, so it would say the same thing whatever the prompt contained.

## The four screens

`node components/strategy/evidence/capture.mjs`

`identity`, `messaging`, `plan` and `market`, full page, at 1440 and 375. The
script also measures `documentElement.scrollWidth` against the viewport on every
page and exits non-zero on a horizontal overflow — the failure a full-page
screenshot hides, because it widens the capture instead of showing the sideways
scroll a person would get. It found two real ones on the first run (a table
inside a two-column grid whose items lacked `min-w-0`, and a `shrink-0` caption
in a flex row); both are fixed.

The screens are behind the admin gate, so the script needs a live session cookie
at `/tmp/hs-session-cookie.txt`. Its header says how to get one.
