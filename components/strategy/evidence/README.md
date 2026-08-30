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

## The acceptance test for the avatars: an avatar edit changes what an agent says

`npx vitest run tests/strategy/avatar-wiring.test.ts`

| File                          | What it shows                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `04-avatar-drives-output.txt` | The marketing agent run twice through the real `AgentRuntime`. One field differs between the runs — `avatars.b2c.jobToBeDone` — and the two captions are printed side by side.        |
| `05-avatar-database-edit.txt` | The same proof with no TypeScript changed: one `update public.strategy_avatars` statement, the agent definitions rebuilt from the store, and a caption written to a different person. |

The model here is `AvatarModel` rather than `BriefingModel`, and it is the same
idea one layer along: it composes its answer only out of the `WHO YOU ARE
WRITING TO` block, and refuses to write at all when there is no avatar in the
prompt. The scoping is proved in the same file — Ari gets the Friday host in
full and one line about the bar manager, Vic gets the reverse.

## The audit: the live storefront, scored against both avatars

`npx vitest run tests/strategy/storefront-audit.test.ts`

| File                      | What it shows                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `06-storefront-audit.txt` | Every check, its question, what was found on the page, what failing costs, and the fix — plus the score and the fix that clears the most checks. Written on every run. |

Seventeen binary checks, each fetched over HTTP from a running server. **Eleven
of them fail today and that is the point**: the file is a list of things the
storefront does not yet do for the two people it is for. Turning one green means
changing the store. The same run is shown live in the admin at
`/admin/brand/audience`, which re-runs the audit on every request rather than
reading a stored score.

## The five screens

`node components/strategy/evidence/capture.mjs`

`identity`, `messaging`, `audience`, `plan` and `market`, full page, at 1440 and 375. The
script also measures `documentElement.scrollWidth` against the viewport on every
page and exits non-zero on a horizontal overflow — the failure a full-page
screenshot hides, because it widens the capture instead of showing the sideways
scroll a person would get. It found two real ones on the first run (a table
inside a two-column grid whose items lacked `min-w-0`, and a `shrink-0` caption
in a flex row); both are fixed.

The screens are behind the admin gate, so the script needs a live session cookie
at `/tmp/hs-session-cookie.txt`. Its header says how to get one. A stale cookie
used to pass silently — the gate redirects to `/login`, which answers 200, and
the run captured five pictures of the sign-in form — so the script now compares
the landed path against the requested one and exits non-zero when they differ.
