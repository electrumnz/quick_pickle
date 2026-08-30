import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminSignInLink } from "@/components/auth/admin-sign-in-link";
import { AdminSignOutForm } from "@/components/auth/admin-sign-out-form";
import { AdminShell } from "@/components/admin/shell/AdminShell";
import type { NavCounts } from "@/components/admin/shell/SidebarNav";
import { THEME_BOOTSTRAP_SCRIPT } from "@/components/admin/shell/theme";
import { navCounts } from "@/components/admin/data/search";
import { operator } from "@/components/admin/data/queries";
import { Callout } from "@/components/admin/ui/primitives";
import { DEMO_ADMIN_OPEN } from "@/components/demo/copy";
import { requireAdminAccess } from "@/lib/auth/server";

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
 * The shell's `notice` slot carries what the founder needs to know before she
 * reads the page under it — today, only that this is an open demonstration and
 * nobody is signed in. A `Callout` in that slot rather than a second banner
 * system: the storefront's `DemoBanner` is fixed to the bottom of every page
 * and speaks to a customer, and this speaks to whoever is at the desk.
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
          signedIn ? null : (
            <Callout title={DEMO_ADMIN_OPEN.title}>
              {DEMO_ADMIN_OPEN.body}
            </Callout>
          )
        }
      >
        {children}
      </AdminShell>
    </>
  );
}
