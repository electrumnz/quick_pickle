import Link from "next/link";

import { ago } from "@/components/admin/data/format";
import { Callout } from "@/components/admin/ui/primitives";
import {
  Field,
  FormFields,
  SubmitButton,
  Textarea,
} from "@/components/admin/ui/controls";
import { AdminSignInLink } from "@/components/auth/admin-sign-in-link";
import { WHY_SIGN_IN } from "@/lib/agents/chat";

import { askAction, newConversationAction } from "./actions";
import { ChatLog } from "./ChatLog";
import { CurrentPathField } from "./CurrentPathField";
import type { ChatView } from "./data";

/**
 * The conversation, and the box under it.
 *
 * Rendered on the server and used twice: once as the page at `/admin/chat`, and
 * once as the contents of the floating panel that opens over any other screen.
 * Both show the same conversation because both are drawn from the same read —
 * opening the panel from Stock and opening it from Money lands her in the same
 * place, which is the whole point of it floating.
 *
 * Everything here works with the scripting turned off. The composer is a plain
 * form posting to a Server Action, and so is "start a new one": no fetch, no
 * optimistic message, no spinner that lies. She presses the button, the page
 * comes back with the answer on it.
 *
 * The two forms are siblings rather than nested, and the second button reaches
 * its form by `form=` — a form inside a form is not valid HTML, and this is the
 * same join `ApprovalQueue` uses for its bulk bar.
 *
 * ## Who gets the box
 *
 * Two states, and `canAsk` below is the whole of the difference. A signed-in
 * founder always gets it. On an open demonstration so does a visitor who has
 * not signed in — the founder reported the refusal as a defect, and
 * `components/admin/write/open-demo.ts` carries the whole account of what
 * stands in for her name in the record. With `HALF_SOUR_DEMO` unset,
 * `demoOpensAdmin()` is false and this is exactly the sign-in prompt it always
 * was.
 *
 * The approval cards inside the log are a separate question and the answer has
 * not moved: they are drawn from `csrfToken`, which is empty without a session,
 * so a run that parks on a decision still needs the password to decide. Asking
 * is open; changing what the answer proposes is not.
 */
export function ChatPanel({
  view,
  csrfToken,
  canAsk,
  back,
  /** Compact enough for the floating panel; roomier on the page. */
  variant = "page",
}: {
  view: ChatView;
  /** Empty string when nobody is signed in. */
  csrfToken: string;
  /**
   * Whether this request may use the composer at all.
   *
   * Handed in rather than derived from `csrfToken`, because the two stopped
   * meaning the same thing: an open demonstration has no token and may still
   * ask. `canAsk` in `./data.ts` is the one place that decides, and it is a
   * pure function of `AdminAccess` so both directions of the switch are pinned
   * by a unit test rather than by reading this file.
   */
  canAsk: boolean;
  back: string;
  variant?: "page" | "dock";
}) {
  const composerId = `ask-${variant}`;
  const newFormId = `new-conversation-${variant}`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {canAsk && (
        <div className="shrink-0 border-b border-hairline px-4 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
            <p className="text-eyebrow uppercase text-muted">
              {view.sessions.length === 0
                ? "Ask the team"
                : "Your conversations"}
            </p>
            <form action={newConversationAction} id={newFormId}>
              <FormFields
                csrfToken={csrfToken}
                {...(variant === "dock" ? {} : { back })}
              />
              {variant === "dock" && <CurrentPathField />}
            </form>
            <SubmitButton tone="quiet" form={newFormId}>
              Start a new one
            </SubmitButton>
          </div>
          {view.sessions.length > 0 && (
            <SessionList view={view} variant={variant} />
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ChatLog
          turns={view.turns}
          approvals={view.approvals}
          csrfToken={csrfToken}
          back={back}
        />
      </div>

      <div className="shrink-0 border-t border-hairline px-4 py-3">
        {canAsk ? (
          <form action={askAction} className="space-y-2.5">
            {/*
              Asking from the floating panel must not move her off the page she
              is standing on, so the panel fills the return path in from the
              browser rather than from this prop — the layout that renders it
              has no pathname to give. Everything else here, including a
              decision made on an approval card above, uses `back` as given:
              approving is a decision she should see land, and the chat page is
              where its consequences are shown.
            */}
            <FormFields
              csrfToken={csrfToken}
              {...(variant === "dock" ? {} : { back })}
              values={{ sessionId: view.current?.id ?? "" }}
            />
            {variant === "dock" && <CurrentPathField />}
            <Field
              label="What do you need?"
              htmlFor={composerId}
              hint="Plain words. You do not need to know who does what."
            >
              <Textarea
                id={composerId}
                name="message"
                rows={variant === "dock" ? 2 : 3}
                required
                maxLength={2000}
                placeholder="How much No 02 have we got?"
              />
            </Field>
            <SubmitButton tone="primary">Ask the team</SubmitButton>
          </form>
        ) : (
          <Callout title={WHY_SIGN_IN.title}>
            <p>{WHY_SIGN_IN.body}</p>
            <p className="mt-2.5">
              <AdminSignInLink />
            </p>
          </Callout>
        )}
      </div>
    </div>
  );
}

/**
 * Every conversation she has had, so she can reopen one.
 *
 * Links rather than a `<select>` that submits on change: a control that moves
 * under a keyboard user while they are still reading the options is a control
 * that loses them their place. Each one says when it was last used and whether
 * anything in it is waiting on her.
 */
function SessionList({
  view,
  variant,
}: {
  // Two in the floating panel, twelve on the page. The panel is a few hundred
  // pixels tall on a phone and every chip is a line the conversation does not
  // get; the page has room, and "see the rest" is what the page is for.

  view: ChatView;
  variant: "page" | "dock";
}) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {view.sessions.slice(0, variant === "dock" ? 2 : 12).map((session) => {
        const active = session.id === view.current?.id;
        return (
          <li key={session.id}>
            <Link
              href={`/admin/chat?s=${session.id}`}
              aria-current={active ? "true" : undefined}
              className={`inline-flex min-h-11 max-w-[18rem] items-center gap-1.5 rounded-md border px-2.5 py-1 text-caption sm:min-h-0 ${
                active
                  ? "border-hairline bg-surface-page font-medium text-primary"
                  : "border-hairline text-muted hover:bg-surface-page hover:text-primary"
              }`}
            >
              <span className="truncate">{session.title}</span>
              <span className="shrink-0 text-muted">
                {ago(session.lastActivityAt)}
              </span>
              {session.waitingCount > 0 && (
                <span className="shrink-0 rounded-pill bg-surface-accent px-1.5 text-caption font-semibold text-on-accent">
                  {session.waitingCount}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
