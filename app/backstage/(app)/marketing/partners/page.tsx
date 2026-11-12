import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  Empty,
  Notice,
  PageHeader,
  Panel,
  Pill,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { dayLabel } from "@/lib/backstage/marketing/dates";
import { listPartners } from "@/lib/backstage/marketing/partners";
import {
  PARTNER_KIND_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUSES,
} from "@/lib/backstage/marketing/status";

import {
  FilterTabs,
  Flash,
  MarketingNav,
  PartnerPill,
  PermissionPill,
  SelectField,
} from "../parts";
import { addPartnerAction } from "./actions";
import { PartnerFields } from "./fields";

export const metadata: Metadata = { title: "Partners" };

const TABS = [
  { key: "open", label: "In play" },
  { key: "due", label: "Next step due" },
  { key: "paused", label: "On hold" },
  { key: "no", label: "Said no" },
  { key: "all", label: "All" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{
    show?: string;
    due?: string;
    q?: string;
    notice?: string;
    tone?: string;
  }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const show: TabKey =
    TABS.find((tab) => tab.key === params.show)?.key ??
    (params.due === "1" ? "due" : q === "" ? "open" : "all");
  const rows = await execute(
    listPartners,
    {
      status: show === "due" ? "all" : show,
      due: show === "due",
      q: q === "" ? undefined : q,
      limit: 200,
    },
    await staffCaller(),
  );
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title="Partners"
        lead="Clubs, stockists, events, ambassadors and press: who we are talking to and what happens next."
      />
      <MarketingNav current="partners" />
      <Flash notice={params.notice} tone={params.tone} />
      <div className="mb-4">
        <Notice>
          Nobody is named in public without their written yes on file. Until it
          is recorded on their page, a campaign, a caption or a review that
          names them cannot be approved.
        </Notice>
      </div>

      <form
        action="/backstage/marketing/partners"
        method="get"
        role="search"
        className="mb-4 flex flex-wrap items-end gap-2"
      >
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="partner-search" className="field-label">
            Find a partner
          </label>
          <input
            id="partner-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, contact or place"
            className="field"
          />
        </div>
        <button type="submit" className="bk-btn">
          <span className="cap-trim">Search</span>
        </button>
      </form>

      <FilterTabs
        label="Partner stages"
        current={show}
        tabs={TABS.map((tab) => ({
          key: tab.key,
          label: tab.label,
          href: `/backstage/marketing/partners?show=${tab.key}${q === "" ? "" : `&q=${encodeURIComponent(q)}`}`,
        }))}
      />

      <Panel flush>
        {rows.length === 0 ? (
          <Empty title={q === "" ? "Nobody here" : "No match"}>
            {q === ""
              ? show === "due"
                ? "No next step is due."
                : "Nobody at this stage. Add someone below."
              : `Nobody matches "${q}" here. Try All.`}
          </Empty>
        ) : (
          <ul className="bk-rows">
            {rows.map((partner) => (
              <li key={partner.id}>
                <Link
                  href={`/backstage/marketing/partners/${partner.id}`}
                  className="bk-row grid-cols-[1fr_auto]"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold [overflow-wrap:anywhere]">
                      {partner.name}
                    </span>
                    <span className="bk-muted block text-[0.9375rem]">
                      {PARTNER_KIND_LABEL[partner.kind]}
                      {partner.region ? ` · ${partner.region}` : ""}
                      {partner.contactName ? ` · ${partner.contactName}` : ""}
                    </span>
                    {partner.nextStep === "" ? null : (
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[0.9375rem]">
                        {partner.due ? <Pill tone="todo">Due</Pill> : null}
                        <span className="[overflow-wrap:anywhere]">
                          Next: {partner.nextStep}
                          {partner.nextStepOn
                            ? ` (${dayLabel(partner.nextStepOn)})`
                            : ""}
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <PartnerPill status={partner.status} />
                    <PermissionPill onFile={partner.permissionOnFile} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canWrite ? (
        <Panel title="Add a partner" className="mt-6">
          <form
            id="new"
            action={addPartnerAction}
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <PartnerFields />
            <SelectField
              id="partner-status"
              name="status"
              label="Where things are up to"
              defaultValue="lead"
              options={PARTNER_STATUSES.map((status) => ({
                value: status,
                label: PARTNER_STATUS_LABEL[status],
              }))}
            />
            <SubmitButton pending="Adding">Add them</SubmitButton>
            <p className="bk-muted text-[0.9375rem] leading-snug">
              They start as someone we may not name in public. That is recorded
              on their own page once they have agreed in writing.
            </p>
          </form>
        </Panel>
      ) : null}
    </>
  );
}
