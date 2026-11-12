import type { Metadata } from "next";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff } from "@/lib/backstage/auth/current";

import { Flash, LookOnly, MarketingNav, TextField } from "../../parts";
import { createPromoCodeAction } from "../actions";
import { PromoFields } from "../fields";

export const metadata: Metadata = { title: "New promo code" };

export default async function NewPromoCodePage({
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
        title="New promo code"
        back={{
          href: "/backstage/marketing/promo-codes",
          label: "Promo codes",
        }}
        lead="The code is what a customer types. Once it is made it cannot be renamed, because it may already be on a flyer: switch it off and make another."
      />
      <MarketingNav current="promo-codes" />
      <Flash notice={notice} tone={tone} />

      <Panel title="The code">
        {canWrite ? (
          <form action={createPromoCodeAction} className="flex flex-col gap-4">
            <TextField
              id="promo-code"
              name="code"
              label="Code"
              required
              maxLength={30}
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="CREW10"
              hint="3 to 24 letters, numbers or hyphens. It is stored in capitals."
            />
            <PromoFields />
            <SubmitButton pending="Saving">Make the code</SubmitButton>
          </form>
        ) : (
          <LookOnly />
        )}
      </Panel>
    </>
  );
}
