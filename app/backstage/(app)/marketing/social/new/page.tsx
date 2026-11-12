import type { Metadata } from "next";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff } from "@/lib/backstage/auth/current";

import { Flash, LookOnly, MarketingNav } from "../../parts";
import { addSocialPostAction } from "../actions";
import { SocialFields } from "../fields";

export const metadata: Metadata = { title: "New post idea" };

export default async function NewSocialPostPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { notice, tone } = await searchParams;
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title="New post idea"
        back={{ href: "/backstage/marketing/social", label: "Social planner" }}
        lead="A title is enough to start. Add the caption and a day when you have them."
      />
      <MarketingNav current="social" />
      <Flash notice={notice} tone={tone} />

      <Panel title="The idea">
        {canWrite ? (
          <form action={addSocialPostAction} className="flex flex-col gap-4">
            <SocialFields />
            <SubmitButton pending="Saving">Add to the planner</SubmitButton>
          </form>
        ) : (
          <LookOnly />
        )}
      </Panel>
    </>
  );
}
