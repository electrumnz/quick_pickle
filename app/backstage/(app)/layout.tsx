import Link from "next/link";
import type { ReactNode } from "react";

import { DESTINATIONS } from "@/components/backstage/nav";
import { ShopLink } from "@/components/backstage/ShopLink";
import { RailNav, TabNav } from "@/components/backstage/NavLinks";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { countWaiting } from "@/lib/backstage/mail/ops";
import { backstageMode } from "@/lib/backstage/mode";
import { countOrders } from "@/lib/backstage/orders/ops";

import { signOutAction } from "../(door)/actions";

const ROLE_LABEL = {
  owner: "Owner",
  staff: "Staff",
  viewer: "Viewer",
} as const;

/**
 * Everything behind the door. A signed-in member of staff, or a redirect to
 * the sign-in page, on every request.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const demo = backstageMode() === "demo";
  const isOwner = staff.role === "owner";
  // Per-destination "waiting on you" counts. Each area adds its own.
  const counts: Record<string, number> = {};
  for (const item of DESTINATIONS) counts[item.href] = 0;
  const caller = await staffCaller();
  const orders = await execute(countOrders, {}, caller);
  counts["/backstage/orders"] = orders.paid;
  const inbox = await execute(countWaiting, {}, caller);
  counts["/backstage/inbox"] = inbox.needsReply;

  return (
    <div className="bk-shell">
      <a
        href="#main"
        className="bk-btn sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        <span className="cap-trim">Skip to the page</span>
      </a>

      <aside className="bk-side">
        <Link href="/backstage" className="bk-wordmark px-3">
          <span className="cap-trim">Quick Pickle</span>
        </Link>
        <p className="label text-cream px-3 text-[0.95rem]">Backstage</p>
        <RailNav isOwner={isOwner} counts={counts} />
        <div className="bk-user">
          <p className="font-semibold">{staff.name}</p>
          <p className="text-cream/80">{ROLE_LABEL[staff.role]}</p>
          <div className="mt-3 flex flex-col gap-1">
            <ShopLink className="label text-cream inline-flex min-h-11 items-center text-[1.05rem] decoration-2 underline-offset-4 hover:underline">
              <span className="cap-trim">View the shop</span>
            </ShopLink>
            {demo ? null : (
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="label text-cream inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]"
                >
                  <span className="cap-trim">Sign out</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </aside>

      <header className="bk-top">
        <Link href="/backstage" className="bk-wordmark">
          <span className="cap-trim">Quick Pickle</span>
          <span className="bk-wordmark-tag cap-trim">Backstage</span>
        </Link>
        <ShopLink className="label text-cream inline-flex min-h-11 items-center text-[1.05rem] decoration-2 underline-offset-4 hover:underline">
          <span className="cap-trim">Shop</span>
        </ShopLink>
      </header>

      <div className="bk-body">
        {demo ? (
          <p className="bk-demo">
            <strong>Demo.</strong> No database is connected, so these records
            are made up and reset whenever the server restarts.
          </p>
        ) : null}
        <main id="main" className="bk-main">
          {children}
        </main>
      </div>

      <TabNav isOwner={isOwner} />
    </div>
  );
}
