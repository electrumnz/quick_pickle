import type { Metadata } from "next";
import Link from "next/link";

import { ShopLink } from "@/components/backstage/ShopLink";
import { DESTINATIONS } from "@/components/backstage/nav";
import { PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff } from "@/lib/backstage/auth/current";
import { isPinLogin } from "@/lib/backstage/auth/pin";
import { backstageMode } from "@/lib/backstage/mode";

import { signOutAction } from "../../(door)/actions";

export const metadata: Metadata = { title: "More" };

/** Everything the phone's tab bar has no room for. */
export default async function MorePage() {
  const staff = await requireStaff("/backstage/more");
  const demo = backstageMode() === "demo";
  const items = DESTINATIONS.filter(
    (item) => staff.role === "owner" || item.ownerOnly !== true,
  );

  return (
    <>
      <PageHeader title="More" />
      <Panel flush>
        <ul className="bk-rows">
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="bk-row grid-cols-1">
                <span className="bk-h2">
                  <span className="cap-trim">{item.label}</span>
                </span>
                <span className="bk-muted text-[0.9375rem] leading-snug">
                  {item.blurb}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="You" className="mt-6">
        <p className="font-semibold">{staff.name}</p>
        <p className="bk-muted">
          {isPinLogin(staff) ? "Signed in with the PIN" : staff.email}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ShopLink className="bk-btn bk-btn-quiet">
            <span className="cap-trim">View the shop</span>
          </ShopLink>
          {demo ? null : (
            <form action={signOutAction}>
              <button type="submit" className="bk-btn">
                <span className="cap-trim">Sign out</span>
              </button>
            </form>
          )}
        </div>
      </Panel>
    </>
  );
}
