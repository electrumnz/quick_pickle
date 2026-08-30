# Agent boundaries and internal handoff

Research note for the unit that hardens the agent runtime's edges and lets the
roster hand work to itself. Written after reading **Hermes Agent**'s A2A plugin
(Nous Research, Apache 2.0) — `plugins/platforms/a2a/`, A2A Protocol v1.0,
3,257 lines across five files with zero edits to its own core.

Source: <https://github.com/NousResearch/hermes-agent>,
<https://hermes-agent.nousresearch.com/docs/user-guide/messaging/a2a>

## What we already have, and it is most of the hard part

`lib/agents/` is not short of governance. It has a per-agent step ceiling
(`definition.maxSteps`, enforced at `runtime.ts:275` and again as a loop bound
at `730`), four-tier cost caps (per-run, daily, monthly, single-action) that
halt a run and record which cap and what had been spent, a kill switch, fully
replayable transcripts, and an approval gate that will not execute a
`storefront_write` or `external` tool without an `approvals` row covering
those exact arguments. The outbox behind that gate delivers nothing at all
today — every write is recorded with `delivered: false`.

Hermes has no equivalent of the approval gate or the cost meter. On governance
we are ahead. The gaps are at the two edges: what comes in, and what goes out.

## Gap 1 — inbound text from outside is not framed as untrusted

Hermes treats every inbound peer message as hostile by default. Two steps,
both in `security.py`:

1. **Defang, don't reject.** `filter_inbound()` rewrites ChatML markers
   (`<|im_start|>`, `<|system|>`), `[INST]`/`[SYS]` wrappers, line-leading
   `system:` / `assistant:` / `developer:` role prefixes, `</system>`-style
   tags, and the plain-English forms — `ignore all previous instructions`,
   `disregard the above`, `you are now a` — to the literal string
   `[filtered]`. Neutralising rather than rejecting matters: a legitimate
   message that merely _mentions_ one of these still gets through.

2. **Frame it.** `wrap_inbound()` prepends an explicit boundary naming the
   sender and saying the content is untrusted external input, not an operator
   command. Notably it filters and frames _everything_, including text
   starting with `/`, so a remote party can never reach an operator command:
   "a peer that wants an action asks for it in natural language and the agent
   decides."

**Why this is ours.** Half Sour's roster reads attacker-controlled text as a
matter of routine: customer messages reaching the concierge, review bodies,
social comments, B2B enquiries arriving at the trade agent. Today that text
reaches a prompt unframed. `grep -rn "untrusted\|injection" lib/agents` returns
one hit, and it is about narrowing a string to a union.

The consequence is specific rather than theoretical. An agent here can draft a
price change, a supplier order and a campaign email. Those are gated on an
approval, so the failure is not silent execution — it is a founder being asked
to approve something plausible that a stranger's email talked the agent into
drafting. The gate assumes the request came from the business.

## Gap 2 — nothing is redacted on the way out

`redact_outbound()` scrubs credential-shaped strings before any text leaves:
`sk-`/`sk-ant-` keys, `ghp_` tokens, Slack `xox[bap]-`, AWS `AKIA…`, JWTs by
their three-segment shape, `Bearer <20+ chars>`, and bare email addresses.

`grep -rni "redact\|scrub" lib/agents` returns nothing.

This costs nothing today because the outbox delivers nothing. It stops being
free the moment `DraftSink` is implemented against a real channel — which the
outbox's own doc comment describes as a one-interface change. The scrubber
belongs in place _before_ that channel exists, not after. Email is worth
keeping on the list even though ours is a legitimate sender: a campaign draft
that quotes a customer's address back into a public post is the mistake that
actually happens.

## Gap 3 — the step cap is per run, not per conversation

`maxSteps` bounds one run. It does not bound agent A asking agent B, which
asks agent A. Hermes caps this separately: `A2A_MAX_PINGPONG_TURNS`, default
5, hard maximum 20, keyed on the conversation rather than the task, rejecting
with a terminal state rather than looping. The cost meter would eventually
stop a runaway here, but "eventually, by spending the daily cap" is a worse
stop than a turn counter, and it burns the budget of an agent that did nothing
wrong.

This gap is latent — the roster has no handoff yet — and becomes real on the
first day it does.

## The A2A question: build the fabric, defer the protocol

Hermes' outbound tools are worth copying at the level of **shape**:

- `a2a_call(agent, message, context_id?)` — direct, with `context_id`
  threading a multi-turn exchange.
- `a2a_orchestrate(capability, message, mode?)` — fan out to whoever
  _advertises a capability_, with `all` / `first` / `best` modes. Peers declare
  `capabilities: [web_search, research]` in config; the router matches on that,
  not on a name.
- The Agent Card is built **from the live tool registry at serve time**, with
  an allow-list restricting what is advertised.

Capability routing is the idea worth having. "Send this to whoever handles
wholesale" survives a roster change; `callVic()` does not. And deriving an
agent's advertised skills from its actually-registered tools means the Team
page cannot drift from what the agent can really do — that is a property a
test can hold.

**The wire protocol is not worth having, and should be said plainly.** Hermes
serves JSON-RPC 2.0 over stdlib HTTP with SSE streaming, HMAC-signed push
webhooks, SSRF-guarded callback URLs, per-peer bearer tokens, constant-time
comparison, sliding-window rate limits, and a bind-safety rule where a token
alone does not widen the bind. Every line of that exists to cross a process,
machine or framework boundary. Half Sour's agents share one Next.js process,
one Inngest runtime and one Supabase, and the company has one human. Standing
up an authenticated HTTP server so nine agents in one process can talk to each
other adds a network attack surface and buys nothing.

So: build the handoff fabric — capability declaration, a router, a
conversation id, the ping-pong cap — against an interface, exactly as commerce
sits behind `lib/commerce/provider.ts`. If a stockist or supplier ever runs
their own agent, an A2A transport drops in behind that interface without the
roster changing. Until then the transport is a function call.

## What to build

1. `lib/agents/boundary/inbound.ts` — `frameUntrusted(source, text)`: defang,
   then wrap with a named boundary. Applied wherever external text enters a
   prompt. Table-driven tests over the pattern list.
2. `lib/agents/boundary/outbound.ts` — `redact(text)`, applied in the outbox
   before an entry is recorded, so the transcript the founder reads is already
   clean and a future `DraftSink` inherits it.
3. A conversation-scoped turn cap alongside the existing step ceiling,
   recorded with the same shape the cost caps use (which cap, what limit, what
   had happened) so a stop is legible in the transcript.
4. Capability strings on each roster definition, and a router that resolves a
   capability to agents — internal dispatch only, behind an interface.

Order matters: 1 and 2 are small, self-contained and reduce live risk. 3 and 4
are only worth building alongside the handoff they exist to bound.
