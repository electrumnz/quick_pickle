import type { Metadata } from "next";
import Link from "next/link";

import {
  Empty,
  Notice,
  PageHeader,
  Panel,
  Pill,
  When,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { listCampaigns } from "@/lib/backstage/marketing/campaigns";
import { plural } from "@/lib/backstage/marketing/shared";
import { AUDIENCE_LABEL } from "@/lib/backstage/marketing/status";
import { formatNzDateTime } from "@/lib/time";

import {
  CampaignPill,
  FilterTabs,
  Flash,
  MarketingNav,
  VerdictPill,
} from "../parts";

export const metadata: Metadata = { title: "Campaigns" };

const TABS = [
  { key: "open", label: "In progress" },
  { key: "sent", label: "Sent" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const status: TabKey =
    TABS.find((tab) => tab.key === params.status)?.key ?? "open";
  const now = new Date();
  const rows = await execute(
    listCampaigns,
    { status, limit: 100 },
    await staffCaller(),
  );
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title="Campaigns"
        lead="Emails to the Pickle Crew: the people who asked to hear from us."
        actions={
          canWrite ? (
            <Link href="/backstage/marketing/campaigns/new" className="bk-btn">
              <span className="cap-trim">New campaign</span>
            </Link>
          ) : null
        }
      />
      <MarketingNav current="campaigns" />
      <Flash notice={params.notice} tone={params.tone} />
      <div className="mb-4">
        <Notice>
          Email is not connected yet. Sending a campaign lines its emails up,
          one per person, and they wait until it is. Nothing leaves today.
        </Notice>
      </div>

      <FilterTabs
        label="Campaign stages"
        current={status}
        tabs={TABS.map((tab) => ({
          key: tab.key,
          label: tab.label,
          href: `/backstage/marketing/campaigns?status=${tab.key}`,
        }))}
      />

      <Panel flush>
        {rows.length === 0 ? (
          <Empty title="Nothing here">
            {status === "open"
              ? "No campaign is being written or sent. Start one with New campaign."
              : "No campaigns at this stage."}
          </Empty>
        ) : (
          <ul className="bk-rows">
            {rows.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  href={`/backstage/marketing/campaigns/${campaign.id}`}
                  className="bk-row grid-cols-[1fr_auto]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {campaign.name}
                    </span>
                    <span className="bk-muted block truncate text-[0.9375rem]">
                      {campaign.subject === ""
                        ? "No subject yet"
                        : campaign.subject}
                    </span>
                    <span className="bk-muted block text-[0.9375rem]">
                      {AUDIENCE_LABEL[campaign.audience]}
                      {campaign.status === "sending" ||
                      campaign.status === "sent"
                        ? ` · ${String(campaign.sent)} sent, ${String(campaign.queued)} waiting${campaign.problems > 0 ? `, ${plural(campaign.problems, "problem")}` : ""}`
                        : ""}
                      {campaign.status === "approved" && campaign.sendAt
                        ? ` · set for ${formatNzDateTime(campaign.sendAt)}`
                        : ""}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <CampaignPill status={campaign.status} />
                    {campaign.held ? (
                      <Pill tone="todo">Stopped itself</Pill>
                    ) : null}
                    <VerdictPill verdict={campaign.verdict} />
                    <span className="bk-muted text-[0.875rem] whitespace-nowrap">
                      <When at={campaign.updatedAt} now={now} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
