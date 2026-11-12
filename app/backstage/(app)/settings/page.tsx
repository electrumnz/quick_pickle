import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff } from "@/lib/backstage/auth/current";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  {
    href: "/backstage/settings/staff",
    label: "Staff",
    blurb:
      "Who can sign in, and as what. Invite someone, change a role, switch an account off.",
    ownerOnly: true,
  },
  {
    href: "/backstage/settings/activity",
    label: "Activity log",
    blurb: "Every change made in the back end: who, when and what.",
    ownerOnly: false,
  },
  {
    href: "/backstage/settings/go-live",
    label: "Go-live list",
    blurb: "What still stands between this site and taking real money.",
    ownerOnly: false,
  },
] as const;

export default async function SettingsPage() {
  const staff = await requireStaff("/backstage/settings");
  const items = SECTIONS.filter(
    (item) => staff.role === "owner" || !item.ownerOnly,
  );

  return (
    <>
      <PageHeader title="Settings" />
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
    </>
  );
}
