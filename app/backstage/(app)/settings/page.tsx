import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff } from "@/lib/backstage/auth/current";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  {
    href: "/backstage/settings/shop",
    label: "The shop",
    blurb:
      "Prices, delivery, the ship date, pre-order or live, and whether orders are being taken.",
    ownerOnly: false,
  },
  {
    href: "/backstage/settings/label",
    label: "The label and the company",
    blurb:
      "What is printed on the label, and the legal name, NZBN and GST number behind the shop.",
    ownerOnly: false,
  },
  {
    href: "/backstage/marketing/pages/top-line",
    label: "The line across the top",
    blurb:
      "The line of words that runs across the top of the shop. It is kept with the landing pages, under Marketing.",
    ownerOnly: false,
  },
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
    href: "/backstage/settings/clock",
    label: "Clock and failed steps",
    blurb:
      "Whether the timer that retries things is running, and anything that failed and needs a person.",
    ownerOnly: false,
  },
  {
    href: "/backstage/settings/morning-email",
    label: "Morning email",
    blurb:
      "One email a day saying how many things need you. Off unless you switch it on.",
    ownerOnly: false,
  },
  {
    href: "/backstage/settings/claude",
    label: "Claude",
    blurb:
      "Connect your own Claude, so it can look things up and do the day-to-day. Off unless an owner switches it on.",
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
