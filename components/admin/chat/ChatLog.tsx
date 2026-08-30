import type { ApprovalItem } from "@/components/admin/data/queries";
import { ago } from "@/components/admin/data/format";
import { ApprovalCard } from "@/components/admin/approvals/ApprovalCard";
import { Badge, EmptyState } from "@/components/admin/ui/primitives";
import {
  CAPABILITY_WORDS,
  WAITING_HEADLINE,
  costWords,
  type ChatTurnRow,
} from "@/lib/agents/chat";

/**
 * The conversation, read from the top.
 *
 * ## It is a log, and it is a list
 *
 * `role="log"` on the wrapper tells a screen reader that things get added to
 * the bottom of this and that they should be announced politely when they do —
 * which is exactly what happens when she asks something. Inside it is an
 * ordinary ordered list of ordinary list items in the order they happened, so
 * the reading order and the visual order are the same one. A chat that is a
 * pile of divs is a chat that reads as one long paragraph with no turns in it.
 *
 * Each turn is one list item holding two things: what she said, and what came
 * back. They are one item rather than two because they are one exchange, and
 * splitting them makes "which answer belongs to which question" a thing she has
 * to work out from the layout.
 *
 * ## What it says about who answered, and why
 *
 * The point of the routing is that she never has to know the team's names — so
 * the surface tells her afterwards, every time: who picked it up, what their job
 * is, and the words in her own message that decided it. That is what stops the
 * roster being a mystery, and it is also what lets her correct a wrong guess
 * ("you said 'post'…") instead of wondering why the wrong agent answered.
 *
 * No slug, no capability name, no run id, no halt code. `lib/agents/chat/presentation.ts`
 * turns every one of those into a sentence before it reaches this file.
 */

export function ChatLog({
  turns,
  approvals,
  csrfToken,
  back,
}: {
  turns: readonly ChatTurnRow[];
  /** The decision behind a waiting turn, by turn id. */
  approvals: ReadonlyMap<string, ApprovalItem>;
  /** Empty when nobody is signed in, which is when no card is drawn. */
  csrfToken: string;
  back: string;
}) {
  if (turns.length === 0) {
    return (
      <EmptyState
        headline="Nothing asked yet"
        fills="Say what you need in the box below and it will go to whoever does that job."
      >
        You do not need to know who does what. Ask for the thing — &ldquo;how
        much No 02 have we got&rdquo;, &ldquo;what did last week take&rdquo;,
        &ldquo;anyone waiting on a reply&rdquo; — and the team works out who
        picks it up.
      </EmptyState>
    );
  }

  return (
    <div role="log" aria-label="Conversation with the team" className="min-w-0">
      <ol className="divide-y divide-hairline">
        {turns.map((turn) => (
          <li key={turn.id} className="px-4 py-4">
            <article className="min-w-0">
              {/*
                h2, not h3: the page's only h1 is its title, and a heading that
                skips a level is a heading a screen-reader user cannot use to
                navigate the conversation. axe's `heading-order` catches it.
              */}
              <h2 className="text-body-sm font-medium text-primary">
                <span className="text-muted">You asked: </span>
                {turn.asked}
              </h2>
              <p className="mt-0.5 text-caption text-muted">
                {ago(turn.askedAt)}
              </p>
              <div className="mt-3 min-w-0">
                <Answer turn={turn} />
              </div>
              {turn.outcome === "waiting_on_you" && (
                <WaitingOnYou
                  turn={turn}
                  approval={approvals.get(turn.id) ?? null}
                  csrfToken={csrfToken}
                  back={back}
                />
              )}
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Who answered, what they said, and why it went to them.
 *
 * The agent's own words are shown only when it actually answered. A halted run
 * still carries an `agent_runs.outcome`, but that field then reads
 * "Halted: model_call_failed …" — the runtime writing for the record, not for
 * her. In that case `note` is the sentence, and showing both would tell her the
 * same thing twice, once in machine words.
 */
function Answer({ turn }: { turn: ChatTurnRow }) {
  const said = turn.outcome === "answered" ? (turn.said?.trim() ?? "") : "";
  return (
    <div className="rounded-md border border-hairline bg-surface-sunken px-3.5 py-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-body-sm font-medium text-primary">
          {turn.agentName ?? "The team"}
        </span>
        {turn.agentJobTitle !== null && (
          <span className="text-caption text-muted">{turn.agentJobTitle}</span>
        )}
        <OutcomeBadge turn={turn} />
      </p>

      {said !== "" && (
        <p className="mt-2 whitespace-pre-line text-body-sm text-primary">
          {said}
        </p>
      )}
      {turn.note !== null && (
        <p className="mt-2 text-body-sm text-primary">{turn.note}</p>
      )}
      {said === "" && turn.note === null && (
        <p className="mt-2 text-body-sm text-primary">
          {turn.outcome === "waiting_on_you"
            ? `${turn.agentName ?? "It"} got as far as it can on its own. The next step is one it is not allowed to take without you, so it stopped and asked.`
            : "Still working on this one."}
        </p>
      )}

      <p className="mt-2.5 text-caption text-muted">
        <WhyThem turn={turn} />
        {turn.runCostMicros > 0 && ` ${costWords(turn.runCostMicros)}`}
      </p>
    </div>
  );
}

function OutcomeBadge({ turn }: { turn: ChatTurnRow }) {
  if (turn.outcome === "waiting_on_you") {
    return <Badge tone="accent">Needs your yes</Badge>;
  }
  if (turn.outcome === "nobody_does_that") {
    return <Badge tone="quiet">Nobody does that</Badge>;
  }
  if (turn.outcome === "stopped") {
    return <Badge tone="quiet">Stopped</Badge>;
  }
  if (turn.outcome === "working") {
    return <Badge tone="quiet">Still going</Badge>;
  }
  return null;
}

/**
 * Why this one and not another.
 *
 * Her own words, quoted back, and the job they name. The agent is named above;
 * this says what made it that agent. Together they are the sentence that makes
 * the roster legible: "Marlow, Head of Brine Ops — you said 'how much', so this
 * is about how much is left."
 */
function WhyThem({ turn }: { turn: ChatTurnRow }) {
  if (turn.capability === null) {
    return <>Nothing in what you asked named a job the team does.</>;
  }
  const words = turn.matched.slice(0, 2);
  const quoted = words.map((word) => `“${word}”`).join(" and ");
  return (
    <>
      {words.length === 0
        ? "This is about "
        : `You said ${quoted}, so this is about `}
      {CAPABILITY_WORDS[turn.capability]}.
    </>
  );
}

/**
 * The decision, on the same card as everywhere else.
 *
 * Nothing she typed can make a write happen. When what she asked for needs an
 * action that leaves the company or changes the shop, the run stops and raises
 * an `approvals` row through the ordinary gate — and this is the ordinary card,
 * imported rather than redrawn, so approving from a chat window is the same
 * interaction as approving from Today. She learns it once.
 */
function WaitingOnYou({
  turn,
  approval,
  csrfToken,
  back,
}: {
  turn: ChatTurnRow;
  approval: ApprovalItem | null;
  csrfToken: string;
  back: string;
}) {
  return (
    <div className="mt-3 rounded-md border border-hairline">
      <p className="border-b border-hairline px-4 py-2 text-caption font-semibold text-primary">
        {WAITING_HEADLINE}
      </p>
      {approval === null ? (
        <p className="px-4 py-3 text-caption text-muted">
          {turn.agentName ?? "The agent"} stopped and asked for a decision, and
          that decision has since been made or taken away. Nothing is waiting on
          you here.
        </p>
      ) : csrfToken === "" ? (
        <p className="px-4 py-3 text-caption text-muted">
          {approval.title} — {approval.summary} Sign in to decide it.
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          <ApprovalCard approval={approval} csrfToken={csrfToken} back={back} />
        </ul>
      )}
    </div>
  );
}
