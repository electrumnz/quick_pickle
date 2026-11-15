import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Notice, PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { STORE } from "@/content/offer";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  getCampaign,
  listCampaignSends,
  skippedInWords,
  type CampaignDetail,
} from "@/lib/backstage/marketing/campaigns";
import { restrictedIn } from "@/lib/backstage/marketing/copy-check";
import {
  dateInputValue,
  timeInputValue,
} from "@/lib/backstage/marketing/dates";
import { EMAIL_WORDS } from "@/lib/backstage/marketing/email";
import { mapText, parseMarkdown } from "@/lib/backstage/marketing/markdown";
import {
  howCampaignsGo,
  type HowCampaignsGo,
} from "@/lib/backstage/marketing/sender";
import { people, plural } from "@/lib/backstage/marketing/shared";
import { AUDIENCE_LABEL } from "@/lib/backstage/marketing/status";
import { siteUrl } from "@/lib/site";
import { formatNzDateTime, nzDateKey } from "@/lib/time";

import {
  CampaignPill,
  CopyCheckResult,
  Flash,
  Fold,
  LookOnly,
  MarkdownPreview,
  MarketingNav,
  ReadTheWarnings,
  TextField,
  VerdictPill,
} from "../../parts";
import {
  approveCampaignAction,
  cancelCampaignAction,
  scheduleCampaignAction,
  sendCampaignAction,
  unapproveCampaignAction,
  updateCampaignAction,
} from "../actions";
import { CampaignFields } from "../fields";

type Params = { id: string };

export const metadata: Metadata = { title: "Campaign" };

function Id({ value }: { readonly value: string }) {
  return <input type="hidden" name="id" value={value} />;
}

/** What to do with this campaign now. Only what its stage allows is offered. */
function NextStep({
  campaign,
  canWrite,
  now,
  how,
}: {
  readonly campaign: CampaignDetail;
  readonly canWrite: boolean;
  readonly now: Date;
  /** Whether a campaign sent from here really goes, and a sentence for it. */
  readonly how: HowCampaignsGo;
}) {
  const can = (action: string) =>
    campaign.next.some((allowed) => allowed === action);
  const warnings = [
    ...new Set(restrictedIn(campaign.copyCheck).map((finding) => finding.rule)),
  ];
  const audience = campaign.audienceCount ?? 0;
  const skipped = campaign.audienceSkipped;
  const problems =
    campaign.sends.failed + campaign.sends.bounced + campaign.sends.complained;

  return (
    <div className="flex flex-col gap-5">
      {campaign.status === "draft" ? (
        <p className="leading-snug">
          A draft. It goes nowhere until a person has approved it.
        </p>
      ) : null}
      {campaign.status === "approved" ? (
        <p className="leading-snug">
          Approved
          {campaign.approvedByName ? ` by ${campaign.approvedByName}` : ""}
          {campaign.approvedAt
            ? ` on ${formatNzDateTime(campaign.approvedAt)}`
            : ""}
          .{" "}
          {campaign.sendAt
            ? `Set to go at ${formatNzDateTime(campaign.sendAt)}, New Zealand time.`
            : "Not sent yet."}
        </p>
      ) : null}
      {campaign.status === "sending" ? (
        <p className="leading-snug">
          On its way. {plural(campaign.sends.queued, "email")} waiting,{" "}
          {String(campaign.sends.sent)} sent
          {problems > 0 ? `, ${String(problems)} not delivered` : ""}.{" "}
          {campaign.held === null && campaign.stuck === null ? how.says : ""}
        </p>
      ) : null}
      {campaign.stuck === null || campaign.held !== null ? null : (
        <Notice tone="bad">
          The emails that are waiting cannot be sent right now. {campaign.stuck}{" "}
          Nobody has been marked as not delivered for it: they go by themselves,
          a few minutes after it is put right.
        </Notice>
      )}
      {campaign.held === null ? null : (
        <Notice tone="bad">
          It has stopped itself: {campaign.held}. Nothing more will go. Stop it
          below and find out why before trying again. There is no way to carry
          on from where it stopped yet.
        </Notice>
      )}
      {campaign.status === "sent" ? (
        <p className="leading-snug">
          Finished
          {campaign.sentAt
            ? ` on ${formatNzDateTime(campaign.sentAt)}`
            : ""}: {String(campaign.sends.sent)} sent
          {problems > 0 ? `, ${String(problems)} not delivered` : ""}.
        </p>
      ) : null}
      {campaign.status === "cancelled" ? (
        <p className="leading-snug">Cancelled. It will not be sent.</p>
      ) : null}

      {!canWrite ? <LookOnly /> : null}

      {canWrite && can("approve") ? (
        campaign.verdict === "banned" ? (
          <p className="leading-snug">
            It cannot be approved yet. The copy check found wording that is not
            allowed: change it and save.
          </p>
        ) : campaign.subject === "" || campaign.body === "" ? (
          <p className="leading-snug">
            Give it a subject and something to say, then it can be approved.
          </p>
        ) : (
          <form action={approveCampaignAction} className="flex flex-col gap-3">
            <Id value={campaign.id} />
            <ReadTheWarnings id="approve-read" rules={warnings} />
            <SubmitButton pending="Approving" className="bk-btn w-full">
              Approve it
            </SubmitButton>
            <p className="bk-muted text-[0.9375rem] leading-snug">
              Approving says you have read every word and it can go to customers
              as it stands. It does not send anything.
            </p>
          </form>
        )
      ) : null}

      {canWrite && can("send") ? (
        audience === 0 ? (
          <p className="leading-snug">
            Nobody on the list would get this right now, so there is nothing to
            send.
          </p>
        ) : (
          <>
            <form action={sendCampaignAction} className="flex flex-col gap-3">
              <Id value={campaign.id} />
              <input type="hidden" name="recipients" value={audience} />
              <SubmitButton pending="Queuing" className="bk-btn w-full">
                {`Send to ${people(audience)} now`}
              </SubmitButton>
              <p className="bk-muted text-[0.9375rem] leading-snug">
                {how.says}
                {how.goes
                  ? " Once they have gone they cannot be called back."
                  : ""}
              </p>
              {skipped !== null && skipped.total > 0 ? (
                <p className="bk-muted text-[0.9375rem] leading-snug">
                  {`${people(skipped.total)} on the list will be left out, because ${skipped.total === 1 ? "their address is" : "their addresses are"} on the do-not-email list (${skippedInWords(skipped)}).`}
                </p>
              ) : null}
            </form>

            <form
              action={scheduleCampaignAction}
              className="border-navy-line flex flex-col gap-3 border-t pt-4"
            >
              <Id value={campaign.id} />
              <input type="hidden" name="recipients" value={audience} />
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  id="send-date"
                  name="date"
                  type="date"
                  label="Or on this day"
                  required
                  min={nzDateKey(now)}
                  defaultValue={
                    campaign.sendAt ? dateInputValue(campaign.sendAt) : ""
                  }
                />
                <TextField
                  id="send-time"
                  name="time"
                  type="time"
                  label="At this time"
                  required
                  defaultValue={
                    campaign.sendAt ? timeInputValue(campaign.sendAt) : "07:30"
                  }
                />
              </div>
              <SubmitButton
                pending="Saving"
                className="bk-btn bk-btn-quiet w-full"
              >
                {campaign.sendAt ? "Change the time" : "Set the time"}
              </SubmitButton>
              <p className="bk-muted text-[0.9375rem] leading-snug">
                New Zealand time. It goes to whoever is on the list then (today
                that is {people(audience)}), and starts within a few minutes of
                the time you set. If it cannot go when the time comes, it stays
                here as approved and its history says why.
              </p>
            </form>
          </>
        )
      ) : null}

      {canWrite && can("unapprove") ? (
        <form action={unapproveCampaignAction}>
          <Id value={campaign.id} />
          <SubmitButton pending="Saving" className="bk-btn bk-btn-quiet w-full">
            Back to draft, to edit it
          </SubmitButton>
        </form>
      ) : null}

      {canWrite && can("cancel") ? (
        campaign.status === "sending" ? (
          <form action={cancelCampaignAction} className="flex flex-col gap-2">
            <Id value={campaign.id} />
            <SubmitButton
              pending="Stopping"
              className="bk-btn bk-btn-pink w-full"
            >
              Stop sending
            </SubmitButton>
            <p className="bk-muted text-[0.9375rem] leading-snug">
              Emails still waiting will not go. Any that have already gone stay
              gone. This cannot be undone.
            </p>
          </form>
        ) : (
          <Fold summary="Cancel this campaign" danger>
            <form action={cancelCampaignAction} className="flex flex-col gap-2">
              <Id value={campaign.id} />
              <SubmitButton
                pending="Cancelling"
                className="bk-btn bk-btn-pink w-full"
              >
                Cancel the campaign
              </SubmitButton>
              <p className="bk-muted text-[0.9375rem] leading-snug">
                It cannot be undone, but its words can be copied into a new
                draft afterwards.
              </p>
            </form>
          </Fold>
        )
      ) : null}

      {canWrite &&
      (campaign.status === "sent" || campaign.status === "cancelled") ? (
        <Link
          href={`/backstage/marketing/campaigns/new?from=${campaign.id}`}
          className="bk-btn bk-btn-quiet"
        >
          <span className="cap-trim">Start a new draft from this one</span>
        </Link>
      ) : null}
    </div>
  );
}

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const now = new Date();

  let campaign: CampaignDetail;
  try {
    campaign = await execute(
      getCampaign,
      { id: decodeURIComponent(id) },
      caller,
    );
  } catch (error) {
    if (
      error instanceof OpError &&
      (error.code === "not_found" || error.code === "invalid_input")
    ) {
      notFound();
    }
    throw error;
  }

  const queued = campaign.sends.total > 0;
  const [history, problems] = await Promise.all([
    execute(
      listActivity,
      { entityType: "campaign", entityId: campaign.id, limit: 50 },
      caller,
    ),
    queued
      ? execute(
          listCampaignSends,
          { id: campaign.id, status: "problems", limit: 50 },
          caller,
        )
      : Promise.resolve([]),
  ]);
  const canWrite = staff.role !== "viewer";
  const editable = canWrite && campaign.status === "draft";
  const site = siteUrl();
  // Shown the way it would read for somebody called Sam.
  const sample = (text: string) => text.replace(/\{\{\s*name\s*\}\}/gi, "Sam");
  const blocks = mapText(parseMarkdown(campaign.body), sample);
  const copyCheck = (
    <Panel title="Copy check">
      <CopyCheckResult
        check={campaign.copyCheck}
        verdict={campaign.verdict}
        what="campaign"
      />
    </Panel>
  );

  return (
    <>
      <PageHeader
        title={campaign.name}
        back={{ href: "/backstage/marketing/campaigns", label: "Campaigns" }}
        lead={`${AUDIENCE_LABEL[campaign.audience]}${campaign.audienceCount === null ? "" : `: ${people(campaign.audienceCount)} right now`}.`}
      />
      <MarketingNav current="campaigns" />

      <p className="-mt-1 mb-5 flex flex-wrap items-center gap-2">
        <CampaignPill status={campaign.status} />
        {campaign.held === null ? null : (
          <Pill tone="todo">Stopped itself</Pill>
        )}
        {campaign.stuck === null || campaign.held !== null ? null : (
          <Pill tone="todo">Cannot send right now</Pill>
        )}
        <VerdictPill verdict={campaign.verdict} />
        {campaign.status === "approved" && campaign.sendAt ? (
          <Pill>Has a time</Pill>
        ) : null}
      </p>

      <Flash notice={notice} tone={tone} />

      {/* One list, in the order a phone shows it. On a desk the two panels
          about deciding sit in a second column beside the rest. */}
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        {editable ? (
          <Panel title="The email" className="lg:col-start-1">
            <form action={updateCampaignAction} className="flex flex-col gap-4">
              <Id value={campaign.id} />
              <CampaignFields values={campaign} />
              <SubmitButton pending="Saving">Save the draft</SubmitButton>
              <p className="bk-muted text-[0.9375rem] leading-snug">
                Saving runs the copy check again.
              </p>
            </form>
          </Panel>
        ) : null}

        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:self-start">
          {campaign.status === "draft" ? copyCheck : null}
          <Panel title="Next step">
            <NextStep
              campaign={campaign}
              canWrite={canWrite}
              now={now}
              how={howCampaignsGo()}
            />
          </Panel>
          {campaign.status === "draft" ? null : copyCheck}
        </div>

        <Panel title="How it will read" className="lg:col-start-1">
          <dl className="bk-kv mb-4">
            <dt>From</dt>
            <dd>{STORE.name}</dd>
            <dt>Subject</dt>
            <dd>
              {campaign.subject === ""
                ? "No subject yet"
                : sample(campaign.subject)}
            </dd>
            {campaign.preheader === "" ? null : (
              <>
                <dt>Preview line</dt>
                <dd>{sample(campaign.preheader)}</dd>
              </>
            )}
          </dl>
          <div className="border-navy-line border-t pt-4">
            {blocks.length === 0 ? (
              <p className="bk-muted">Nothing written yet.</p>
            ) : (
              <MarkdownPreview blocks={blocks} siteUrl={site} />
            )}
          </div>
          <div className="border-navy-line bk-muted mt-5 border-t pt-4 text-[0.9375rem] leading-snug">
            <p>{EMAIL_WORDS.why}</p>
            <p className="mt-1">
              <span className="underline">{EMAIL_WORDS.leave}</span>{" "}
              {EMAIL_WORDS.leaveAfter}
            </p>
            <p className="mt-1 [overflow-wrap:anywhere]">
              {STORE.name}
              <br />
              {campaign.foot ?? "A line saying how to reach us."}
            </p>
          </div>
          <p className="bk-muted mt-4 text-[0.9375rem] leading-snug">
            Shown as it would read for somebody called Sam. The lines under the
            rule are added to every campaign email.{" "}
            {campaign.foot === null
              ? `The line saying how to reach us cannot be written yet. ${campaign.footMissing ?? ""}`
              : "The last one is who the company is (Settings, The label and the company) and the address customers write to (Settings, The shop)."}
          </p>
        </Panel>

        {queued ? (
          <Panel title="Who it went to" className="lg:col-start-1">
            <dl className="bk-kv">
              <dt>Waiting</dt>
              <dd className="bk-num">{campaign.sends.queued}</dd>
              <dt>Sent</dt>
              <dd className="bk-num">{campaign.sends.sent}</dd>
              <dt>Failed</dt>
              <dd className="bk-num">{campaign.sends.failed}</dd>
              <dt>Bounced</dt>
              <dd className="bk-num">{campaign.sends.bounced}</dd>
              <dt>Marked as spam</dt>
              <dd className="bk-num">{campaign.sends.complained}</dd>
            </dl>
            {problems.length > 0 ? (
              <ul className="border-navy-line mt-4 flex flex-col gap-2 border-t pt-4 text-[0.9375rem]">
                {problems.map((row) => (
                  <li key={row.email} className="[overflow-wrap:anywhere]">
                    <span className="font-semibold">{row.email}</span>
                    {": "}
                    {row.status === "complained"
                      ? "marked it as spam"
                      : row.status}
                    {row.error ? `. ${row.error}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        ) : null}

        <Panel title="History" flush className="lg:col-start-1">
          <ActivityList lines={history} now={now} />
        </Panel>
      </div>
    </>
  );
}
