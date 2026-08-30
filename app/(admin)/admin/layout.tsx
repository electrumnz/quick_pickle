import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminSignInLink } from "@/components/auth/admin-sign-in-link";
import { AdminSignOutForm } from "@/components/auth/admin-sign-out-form";
import { ChatDock } from "@/components/admin/chat/ChatDock";
import { ChatPanel } from "@/components/admin/chat/ChatPanel";
import { chatViewOrEmpty } from "@/components/admin/chat/data";
import { AdminShell } from "@/components/admin/shell/AdminShell";
import type { NavCounts } from "@/components/admin/shell/SidebarNav";
import { THEME_BOOTSTRAP_SCRIPT } from "@/components/admin/shell/theme";
import { navCounts } from "@/components/admin/data/search";
import { operator } from "@/components/admin/data/queries";
import { Callout } from "@/components/admin/ui/primitives";
import { DEMO_ADMIN_OPEN } from "@/components/demo/copy";
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
 * The shell's `notice` slot carries whatever the founder needs to know before
 * she reads the page under it. Today that is at most two things: that this is an
 * open demonstration, and that the models behind the team are on a clock. Both
 * are `Callout`s in the same slot rather than a second banner system — the
 * storefront's `DemoBanner` is fixed to the bottom of every page and there is no
 * reason for a customer to see an operational note about model billing.
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
  const modelNotice = rosterModelNotice();

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
  // Nobody signed in means no conversation to read and nothing to ask with: the
  // panel then holds only the sentence saying why this one wants a password.
  const chat =
    access.kind === "session"
      ? await chatViewOrEmpty(access.session.operatorId)
      : null;

  // Built as a list so the shell's slot stays genuinely empty when there is
  // nothing to say: an always-rendered fragment is truthy, and would leave a
  // margin above every page for a notice that is not there.
  const notices = [
    signedIn ? null : (
      <Callout key="demo" title={DEMO_ADMIN_OPEN.title}>
        {DEMO_ADMIN_OPEN.body}
      </Callout>
    ),
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
          <ChatDock bannerOnScreen={isDemoMode()} waiting={chat?.waiting ?? 0}>
            <ChatPanel
              view={
                chat ?? {
                  sessions: [],
                  current: null,
                  turns: [],
                  approvals: new Map(),
                  waiting: 0,
                }
              }
              csrfToken={adminFormToken(access)}
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
