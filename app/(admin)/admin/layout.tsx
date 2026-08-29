import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminSignOutForm } from "@/components/auth/admin-sign-out-form";
import { AdminShell } from "@/components/admin/shell/AdminShell";
import type { NavCounts } from "@/components/admin/shell/SidebarNav";
import { THEME_BOOTSTRAP_SCRIPT } from "@/components/admin/shell/theme";
import { navCounts } from "@/components/admin/data/search";
import { operator } from "@/components/admin/data/queries";
import { requireAdminSession } from "@/lib/auth/server";

/**
 * The admin, behind the gate.
 *
 * `requireAdminSession` is the second check, not the first: the proxy already
 * turned an unauthenticated visitor away. It runs again here because a matcher
 * change should never be able to silently open the door, and because this is
 * where the session's operator and CSRF token come from.
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
  const { session, csrfToken } = await requireAdminSession();

  // The shell must render even when the database is unreachable, or a failed
  // connection would take the navigation down with it and leave her with no
  // way to get anywhere.
  let counts: NavCounts = {};
  let name = "Signed in";
  let role = "Owner";
  try {
    const [nav, person] = await Promise.all([
      navCounts(),
      operator(session.operatorId),
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
        signOut={<AdminSignOutForm csrfToken={csrfToken} />}
      >
        {children}
      </AdminShell>
    </>
  );
}
