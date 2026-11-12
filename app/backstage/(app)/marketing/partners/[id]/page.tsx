import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { dayLabel } from "@/lib/backstage/marketing/dates";
import {
  getPartner,
  type PartnerDetail,
} from "@/lib/backstage/marketing/partners";
import {
  PARTNER_KIND_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUSES,
} from "@/lib/backstage/marketing/status";

import {
  Flash,
  Fold,
  LookOnly,
  MarketingNav,
  PartnerPill,
  PermissionPill,
  SelectField,
  TextField,
} from "../../parts";
import {
  setPartnerNextStepAction,
  setPartnerPermissionAction,
  setPartnerStatusAction,
  updatePartnerAction,
} from "../actions";
import { PartnerFields } from "../fields";

export const metadata: Metadata = { title: "Partner" };

function Id({ value }: { readonly value: string }) {
  return <input type="hidden" name="id" value={value} />;
}

export default async function PartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const now = new Date();

  let partner: PartnerDetail;
  try {
    partner = await execute(getPartner, { id: decodeURIComponent(id) }, caller);
  } catch (error) {
    if (
      error instanceof OpError &&
      (error.code === "not_found" || error.code === "invalid_input")
    ) {
      notFound();
    }
    throw error;
  }
  const history = await execute(
    listActivity,
    { entityType: "partner", entityId: partner.id, limit: 50 },
    caller,
  );
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title={partner.name}
        back={{ href: "/backstage/marketing/partners", label: "Partners" }}
        lead={`${PARTNER_KIND_LABEL[partner.kind]}${partner.region ? `, ${partner.region}` : ""}.`}
      />
      <MarketingNav current="partners" />
      <p className="-mt-1 mb-5 flex flex-wrap items-center gap-2">
        <PartnerPill status={partner.status} />
        <PermissionPill onFile={partner.permissionOnFile} />
        {partner.due ? <Pill tone="todo">Next step due</Pill> : null}
      </p>
      <Flash notice={notice} tone={tone} />

      {/* The gate comes first, and it is loud on purpose. */}
      <section
        aria-labelledby="permission-title"
        className={`mb-6 rounded-[14px] border-[3px] p-4 md:p-6 ${partner.permissionOnFile ? "border-navy bg-olive-wash" : "border-pink-deep bg-blush"}`}
      >
        <h2 id="permission-title" className="bk-h2">
          <span className="cap-trim">
            {partner.permissionOnFile
              ? "They may be named in public"
              : "Do not name them in public"}
          </span>
        </h2>
        <p className="mt-3 max-w-[44rem] leading-snug">
          {partner.permissionOnFile
            ? `${partner.name} has agreed in writing to be named. Where that is kept: ${partner.permissionNote}`
            : `There is no written yes from ${partner.name} on file. Until there is, they are left off anything a customer can read, and a campaign, a caption or a review that names them cannot be approved.`}
        </p>
        {!partner.permissionOnFile && partner.permissionNote !== "" ? (
          <p className="mt-2 leading-snug">Note: {partner.permissionNote}</p>
        ) : null}

        {canWrite ? (
          <div className="mt-4">
            {partner.permissionOnFile ? (
              <Fold summary="They have taken it back" danger>
                <form
                  action={setPartnerPermissionAction}
                  className="flex max-w-[36rem] flex-col gap-3"
                >
                  <Id value={partner.id} />
                  <input type="hidden" name="onFile" value="false" />
                  <TextField
                    id="permission-note"
                    name="note"
                    label="What happened"
                    maxLength={500}
                    hint="Optional. From now on they are not named anywhere public."
                  />
                  <SubmitButton pending="Saving" className="bk-btn bk-btn-pink">
                    Record that they may not be named
                  </SubmitButton>
                </form>
              </Fold>
            ) : (
              <Fold summary="They have agreed in writing">
                <form
                  action={setPartnerPermissionAction}
                  className="flex max-w-[36rem] flex-col gap-3"
                >
                  <Id value={partner.id} />
                  <input type="hidden" name="onFile" value="true" />
                  <TextField
                    id="permission-note"
                    name="note"
                    label="Where their written yes is kept"
                    required
                    maxLength={500}
                    placeholder="Email from the secretary, 3 November"
                    hint="An email and its date, or a signed form. A phone call or a guess is not enough."
                  />
                  <SubmitButton pending="Saving" className="bk-btn">
                    Record their permission
                  </SubmitButton>
                </form>
              </Fold>
            )}
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel title="Next step">
            <p className="leading-snug">
              {partner.nextStep === ""
                ? "Nothing is written down as next."
                : `${partner.nextStep}${partner.nextStepOn ? `, by ${dayLabel(partner.nextStepOn)}` : ""}.`}
            </p>
            {canWrite ? (
              <>
                <form
                  action={setPartnerNextStepAction}
                  className="mt-4 flex flex-col gap-3"
                >
                  <Id value={partner.id} />
                  <TextField
                    id="next-step"
                    name="nextStep"
                    label="What happens next"
                    required
                    maxLength={280}
                    defaultValue={partner.nextStep}
                  />
                  <TextField
                    id="next-step-on"
                    name="nextStepOn"
                    type="date"
                    label="By when"
                    defaultValue={partner.nextStepOn ?? undefined}
                    hint="Optional. On that day it shows as due."
                  />
                  <SubmitButton pending="Saving" className="bk-btn">
                    Save the next step
                  </SubmitButton>
                </form>
                {partner.nextStep === "" ? null : (
                  <form action={setPartnerNextStepAction} className="mt-3">
                    <Id value={partner.id} />
                    <input type="hidden" name="done" value="true" />
                    <SubmitButton
                      pending="Saving"
                      className="bk-btn bk-btn-quiet"
                    >
                      Done, nothing next
                    </SubmitButton>
                  </form>
                )}
              </>
            ) : null}
          </Panel>

          <Panel title="Who they are">
            {canWrite ? (
              <form
                action={updatePartnerAction}
                className="flex flex-col gap-3"
              >
                <Id value={partner.id} />
                <PartnerFields values={partner} />
                <SubmitButton pending="Saving" className="bk-btn bk-btn-quiet">
                  Save the details
                </SubmitButton>
              </form>
            ) : (
              <>
                <dl className="bk-kv">
                  <dt>Contact</dt>
                  <dd>{partner.contactName || "Nobody yet"}</dd>
                  <dt>Email</dt>
                  <dd>{partner.email ?? "None"}</dd>
                  <dt>Phone</dt>
                  <dd>{partner.phone ?? "None"}</dd>
                </dl>
                <p className="mt-4 leading-snug whitespace-pre-wrap">
                  {partner.notes || "No notes."}
                </p>
              </>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Where things are up to">
            {canWrite ? (
              <form
                action={setPartnerStatusAction}
                className="flex flex-col gap-3"
              >
                <Id value={partner.id} />
                <SelectField
                  id="partner-status"
                  name="status"
                  label="Stage"
                  defaultValue={partner.status}
                  options={PARTNER_STATUSES.map((status) => ({
                    value: status,
                    label: PARTNER_STATUS_LABEL[status],
                  }))}
                />
                <SubmitButton pending="Saving" className="bk-btn bk-btn-quiet">
                  Save the stage
                </SubmitButton>
              </form>
            ) : (
              <>
                <p className="leading-snug">
                  {PARTNER_STATUS_LABEL[partner.status]}.
                </p>
                <div className="mt-3">
                  <LookOnly />
                </div>
              </>
            )}
          </Panel>

          <Panel title="History" flush>
            <ActivityList lines={history} now={now} />
          </Panel>
        </div>
      </div>
    </>
  );
}
