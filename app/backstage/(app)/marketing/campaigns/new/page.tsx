import type { Metadata } from "next";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  getCampaign,
  type CampaignDetail,
} from "@/lib/backstage/marketing/campaigns";

import { Flash, LookOnly, MarketingNav } from "../../parts";
import { createCampaignAction } from "../actions";
import { CampaignFields } from "../fields";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { from, notice, tone } = await searchParams;
  const canWrite = staff.role !== "viewer";

  // "Start a new draft from this one": the words of an earlier campaign.
  let source: CampaignDetail | null = null;
  if (from) {
    try {
      source = await execute(getCampaign, { id: from }, await staffCaller());
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
    }
  }

  return (
    <>
      <PageHeader
        title="New campaign"
        back={{ href: "/backstage/marketing/campaigns", label: "Campaigns" }}
        lead="A draft goes nowhere. It is checked against the copy rules when you save it, then a person approves it, and only then can it be sent."
      />
      <MarketingNav current="campaigns" />
      <Flash notice={notice} tone={tone} />

      <Panel title={source ? `Starting from "${source.name}"` : "The email"}>
        {canWrite ? (
          <form action={createCampaignAction} className="flex flex-col gap-4">
            <CampaignFields
              values={
                source
                  ? {
                      name: `${source.name} (copy)`.slice(0, 120),
                      subject: source.subject,
                      preheader: source.preheader,
                      body: source.body,
                      audience: source.audience,
                    }
                  : undefined
              }
            />
            <SubmitButton pending="Saving">Save the draft</SubmitButton>
          </form>
        ) : (
          <LookOnly />
        )}
      </Panel>
    </>
  );
}
