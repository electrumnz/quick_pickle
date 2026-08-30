import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminSignInLink } from "@/components/auth/admin-sign-in-link";
import { AdminSignOutForm } from "@/components/auth/admin-sign-out-form";
import { ChatDock } from "@/components/admin/chat/ChatDock";
import { ChatPanel } from "@/components/admin/chat/ChatPanel";
import { canAsk, chatViewOrEmpty } from "@/components/admin/chat/data";
import { AdminShell } from "@/components/admin/shell/AdminShell";
import type { NavCounts } from "@/components/admin/shell/SidebarNav";
import { THEME_BOOTSTRAP_SCRIPT } from "@/components/admin/shell/theme";
import { navCounts } from "@/components/admin/data/search";
import { operator } from "@/components/admin/data/queries";
import { Callout } from "@/components/admin/ui/primitives";
import { rosterModelNotice } from "@/lib/agents";
import { adminFormToken, requireAdminAccess } from "@/lib/auth/server";
import { isDemoMode } from "@/lib/demo/mode";

/**
 * The admin, behind the gate.
 *
 * `requireAdminAccess` is the second check, not the first: the proxy already
 * decided whether this request may be here. It runs again because a matcher
 * change should never be able to silently open the door, and because this is
 * where the session's operator and CSRF token come from.
 *
 * It answers one of two ways. A live session is the ordinary answer and nothing
 * about it has changed. `"open"` is the demonstration answer — nobody is signed
 * in, there is no operator and no CSRF token, and the shell says so in words
 * rather than dressing an anonymous visitor up as the founder. Outside demo
 * mode the second answer cannot occur; the call redirects instead, exactly as
 * it always did.
 *
 * The shell's `notice` slot used to carry two `Callout`s above every screen:
 * that this is an open demonstration, and that the models behind the team are
 * on a clock. The founder asked for both to come down into the bar already
 * fixed to the bottom of every page, and they have —
 * `components/demo/DemoBanner.tsx` carries the whole account.
 *
 * What is left here is the case that bar does not cover. Outside demo mode
 * there IS no bar, and the model warning is the one that matters most on a real
 * deployment, so it stays above every admin screen exactly as it was. Inside
 * demo mode the slot is empty and the bar is the only place either warning
 * appears — moved, not duplicated, and not dropped.
 *
 * The demonstration notice itself is gone from here outright rather than
 * conditionally: it could only ever appear when nobody was signed in, and
 * nobody can be unsigned-in on an admin screen unless demo mode opened the
 * door. `app/(admin)/admin/settings/page.tsx` still carries the long form for
 * someone who goes looking.
 *
 * `rosterModelNotice` returns `null` in the ordinary case, so the slot is empty
 * unless something is actually true. A banner that is always there is a banner
 * nobody reads.
 */

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Half Sour admin" },
  robots: { index: false, follow: false, nocache: true },
};

/** Every admin screen reads live business data, so nothing here is cached. */
export const dynamic = "force-dynamic";

const ROLE_WORDS: Readonly<Record<string, string>> = {
  owner: "Owner",
  operator: "Operator",
  agent_service: "Agent runtime",
  viewer: "Viewer",
};

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await requireAdminAccess();
  const signedIn = access.kind === "session";
  // Reads the environment and the clock only — no database, so it still says
  // what it needs to say on a deployment whose Postgres is unreachable.
  //
  // Only when there is no demonstration bar to carry it. With one on screen
  // this would be the same warning twice, and the founder asked for it once,
  // at the bottom.
  const modelNotice = isDemoMode() ? null : rosterModelNotice();

  // The shell must render even when the database is unreachable, or a failed
  // connection would take the navigation down with it and leave her with no
  // way to get anywhere.
  let counts: NavCounts = {};
  // Not "Signed in" and not a stand-in name: there is no operator row behind an
  // open demo, and inventing one here would put a person's name on a screen
  // nobody signed in to.
  let name = signedIn ? "Signed in" : "Not signed in";
  let role = signedIn ? "Owner" : "Open demonstration";
  try {
    const [nav, person] = await Promise.all([
      navCounts(),
      access.kind === "session" ? operator(access.session.operatorId) : null,
    ]);
    counts = {
      today: nav.needsYou,
      orders: nav.toPack,
      stock: nav.stockLow,
      social: nav.socialWaiting,
    };
    if (person !== null) {
      name = person.name;
      role = ROLE_WORDS[person.role] ?? person.role;
    }
  } catch {
    counts = {};
  }

  // The floating "Ask the team" panel, rendered here rather than per page so it
  // is on every screen and holds one conversation across all of them: opening it
  // from Stock and opening it from Money is the same thread. Its contents are
  // server-rendered, so the composer inside it is a plain form and the panel is
  // never a message behind the page it floats over.
  //
  // Nobody signed in is no longer nothing to read. On an open demonstration the
  // panel reads the demonstration's own conversation — see `chatReaderId` — so
  // a visitor who asked something on one screen finds the answer on the next.
  // Outside demo mode this is an empty view and the panel holds the sentence
  // saying why this one wants a password.
  const chat = await chatViewOrEmpty(access);

  // Built as a list so the shell's slot stays genuinely empty when there is
  // nothing to say: an always-rendered fragment is truthy, and would leave a
  // margin above every page for a notice that is not there.
  const notices = [
    modelNotice === null ? null : (
      <Callout key="models" title={modelNotice.title} tone={modelNotice.tone}>
        {modelNotice.body}
      </Callout>
    ),
  ].filter((node) => node !== null);

  return (
    <>
      <script
        // Sets the remembered scheme before first paint. See shell/theme.ts.
        dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
      />
      <AdminShell
        counts={counts}
        operatorName={name}
        operatorRole={role}
        signOut={
          access.kind === "session" ? (
            <AdminSignOutForm csrfToken={access.csrfToken} />
          ) : (
            <AdminSignInLink />
          )
        }
        notice={
          notices.length === 0 ? null : (
            <div className="space-y-3">{notices}</div>
          )
        }
        dock={
          <ChatDock bannerOnScreen={isDemoMode()} waiting={chat.waiting}>
            <ChatPanel
              view={chat}
              csrfToken={adminFormToken(access)}
              canAsk={canAsk(access)}
              back="/admin/chat"
              variant="dock"
            />
          </ChatDock>
        }
      >
        {children}
      </AdminShell>
    </>
  );
}
