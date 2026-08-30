import type { Metadata } from "next";

import { load } from "@/components/admin/data/db";
import { Card, DataUnavailable, PageHeader } from "@/components/admin";
import { ChatPanel } from "@/components/admin/chat/ChatPanel";
import { chatView } from "@/components/admin/chat/data";
import { Flash } from "@/components/admin/write/flash";
import { adminFormToken, requireAdminAccess } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Ask the team",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Ask the team — the whole company behind one box.
 *
 * The other nine destinations are places: you go to Stock to look at stock. This
 * one is a question. She says what she needs in her own words, and the routing
 * that has been sitting in `lib/agents/boundary/handoff.ts` since it was written
 * works out which job that is and who does it. She is never asked to name an
 * agent, and the answer tells her who picked it up and why, so using it teaches
 * her the roster instead of requiring her to know it already.
 *
 * The page and the floating panel draw the same component over the same read.
 * There is one conversation, not two.
 *
 * **Reads are open on a demonstration; asking is not.** Everything below is
 * visible without a session, because a conversation with no messages in it is
 * not a secret. The composer is replaced by the sentence saying why this one
 * asks for a password — it starts a real job and spends real money — rather
 * than bouncing her to a login page with nothing said. See
 * `components/admin/chat/actions.ts`.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await requireAdminAccess();
  const csrfToken = adminFormToken(access);
  const params = await searchParams;
  const raw = params["s"];
  const sessionId = (Array.isArray(raw) ? raw[0] : raw)?.trim();

  const result = await load(async () =>
    access.kind === "session"
      ? chatView(
          access.session.operatorId,
          sessionId === "" ? undefined : sessionId,
        )
      : null,
  );

  return (
    <>
      <PageHeader
        title="Ask the team"
        lede="Say what you need in plain words. It goes to whoever does that job, and the answer says who picked it up and why."
      />
      <Flash searchParams={params} />
      {!result.ok ? (
        <DataUnavailable problem={result.problem} detail={result.detail} />
      ) : (
        <Card>
          <ChatPanel
            view={
              result.data ?? {
                sessions: [],
                current: null,
                turns: [],
                approvals: new Map(),
                waiting: 0,
              }
            }
            csrfToken={csrfToken}
            back="/admin/chat"
          />
        </Card>
      )}
    </>
  );
}
