import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Notice, PageHeader, Panel } from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { restrictedIn } from "@/lib/backstage/marketing/copy-check";
import { dayLabel } from "@/lib/backstage/marketing/dates";
import {
  getSocialPost,
  type SocialDetail,
} from "@/lib/backstage/marketing/social";
import { FORMAT_LABEL, NETWORK_LABEL } from "@/lib/backstage/marketing/status";
import { formatNzDateTime, formatNzTime, nzDateKey } from "@/lib/time";

import {
  AreaField,
  CopyCheckResult,
  Flash,
  Fold,
  LookOnly,
  MarketingNav,
  ReadTheWarnings,
  SocialPill,
  TextField,
  VerdictPill,
} from "../../parts";
import {
  approveSocialPostAction,
  dropSocialPostAction,
  markSocialPostedAction,
  unapproveSocialPostAction,
  updateSocialNotesAction,
  updateSocialPostAction,
} from "../actions";
import { SocialFields } from "../fields";

export const metadata: Metadata = { title: "Planned post" };

function Id({ value }: { readonly value: string }) {
  return <input type="hidden" name="id" value={value} />;
}

/** What to do with this post now. Only what its stage allows is offered. */
function NextStep({
  post,
  canWrite,
}: {
  readonly post: SocialDetail;
  readonly canWrite: boolean;
}) {
  const can = (action: string) =>
    post.next.some((allowed) => allowed === action);
  const warnings = [
    ...new Set(restrictedIn(post.copyCheck).map((finding) => finding.rule)),
  ];

  return (
    <div className="flex flex-col gap-5">
      <p className="leading-snug">
        {post.status === "idea"
          ? "An idea. Write the caption and it becomes a draft."
          : post.status === "draft"
            ? "A draft. Its caption has to be approved before it is posted."
            : post.status === "approved"
              ? "Approved. Post it by hand in the app, then mark it as posted here."
              : post.status === "posted"
                ? `Posted${post.postedAt ? ` on ${formatNzDateTime(post.postedAt)}` : ""}.`
                : "Dropped. It is not in the plan."}
      </p>
      {post.status === "posted" && post.postUrl ? (
        <p>
          <a
            href={post.postUrl}
            className="link [overflow-wrap:anywhere]"
            rel="noopener noreferrer"
            target="_blank"
          >
            See the post
          </a>
        </p>
      ) : null}

      {!canWrite ? <LookOnly /> : null}

      {canWrite && can("approve") ? (
        post.verdict === "banned" ? (
          <p className="leading-snug">
            It cannot be approved yet. The copy check found wording that is not
            allowed: change the caption and save.
          </p>
        ) : (
          <form
            action={approveSocialPostAction}
            className="flex flex-col gap-3"
          >
            <Id value={post.id} />
            <ReadTheWarnings id="approve-read" rules={warnings} />
            <SubmitButton pending="Approving" className="bk-btn w-full">
              Approve the caption
            </SubmitButton>
            <p className="bk-muted text-[0.9375rem] leading-snug">
              Approving says you have read it and it can go out as it stands. It
              does not post anything.
            </p>
          </form>
        )
      ) : null}

      {canWrite && can("markPosted") ? (
        <form action={markSocialPostedAction} className="flex flex-col gap-3">
          <Id value={post.id} />
          <TextField
            id="post-url"
            name="postUrl"
            type="url"
            inputMode="url"
            label="Link to the post"
            placeholder="https://"
            maxLength={500}
            hint="Optional. A full https address."
          />
          <SubmitButton pending="Saving" className="bk-btn w-full">
            Mark as posted
          </SubmitButton>
        </form>
      ) : null}

      {canWrite && can("unapprove") ? (
        <form action={unapproveSocialPostAction}>
          <Id value={post.id} />
          <SubmitButton pending="Saving" className="bk-btn bk-btn-quiet w-full">
            Back to draft
          </SubmitButton>
        </form>
      ) : null}

      {canWrite && can("pickUp") ? (
        <form action={dropSocialPostAction}>
          <Id value={post.id} />
          <input type="hidden" name="undo" value="true" />
          <SubmitButton pending="Saving" className="bk-btn w-full">
            Pick it back up
          </SubmitButton>
        </form>
      ) : null}

      {canWrite && can("drop") ? (
        <Fold summary="Drop this post" danger>
          <form action={dropSocialPostAction} className="flex flex-col gap-2">
            <Id value={post.id} />
            <SubmitButton
              pending="Dropping"
              className="bk-btn bk-btn-pink w-full"
            >
              Drop it
            </SubmitButton>
            <p className="bk-muted text-[0.9375rem] leading-snug">
              It leaves the plan but is kept, and can be picked back up.
            </p>
          </form>
        </Fold>
      ) : null}
    </div>
  );
}

export default async function SocialPostPage({
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

  let post: SocialDetail;
  try {
    post = await execute(getSocialPost, { id: decodeURIComponent(id) }, caller);
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
    { entityType: "social_post", entityId: post.id, limit: 50 },
    caller,
  );
  const canWrite = staff.role !== "viewer";
  const editable = canWrite && post.next.some((action) => action === "edit");
  const where = `${NETWORK_LABEL[post.network]} ${FORMAT_LABEL[post.format].toLowerCase()}`;
  // Still being written (an idea or a draft), or past that.
  const writing = post.status === "idea" || post.status === "draft";
  const ready = post.status === "approved" || post.status === "posted";

  const copyCheck = (
    <Panel title="Copy check">
      <CopyCheckResult
        check={post.copyCheck}
        verdict={post.verdict}
        what="caption"
      />
    </Panel>
  );

  // The caption in a box that can be selected and copied with scripting off.
  // While it is being edited it is already in the form, so it is not repeated.
  const captionBox =
    post.caption === "" ? null : (
      <Panel
        title={ready ? "The caption, to copy" : "The caption"}
        className="lg:col-start-1"
      >
        <AreaField
          id="caption-copy"
          name="caption-copy"
          label="Caption"
          rows={6}
          readOnly
          defaultValue={post.caption}
          hint={
            ready
              ? "Press and hold inside the box, choose Select All, then Copy, and paste it into the app."
              : "Not approved. It should not be copied anywhere yet."
          }
        />
      </Panel>
    );

  const work = editable ? (
    <Panel title="The post" className="lg:col-start-1">
      <form action={updateSocialPostAction} className="flex flex-col gap-4">
        <Id value={post.id} />
        <SocialFields values={post} />
        <SubmitButton pending="Saving">Save</SubmitButton>
        <p className="bk-muted text-[0.9375rem] leading-snug">
          {post.status === "approved"
            ? "Changing the caption sends it back to draft, to be approved again. Changing anything else does not."
            : "Saving runs the copy check on the caption again."}
        </p>
      </form>
    </Panel>
  ) : (
    <Panel title="Notes" className="lg:col-start-1">
      {canWrite ? (
        <form action={updateSocialNotesAction} className="flex flex-col gap-3">
          <Id value={post.id} />
          <AreaField
            id="post-notes"
            name="notes"
            label="Notes"
            rows={4}
            maxLength={2000}
            defaultValue={post.notes}
            hint="Only staff see this."
          />
          <SubmitButton pending="Saving" className="bk-btn bk-btn-quiet">
            Save the notes
          </SubmitButton>
        </form>
      ) : (
        <p className="leading-snug whitespace-pre-wrap">
          {post.notes || "No notes."}
        </p>
      )}
    </Panel>
  );

  return (
    <>
      <PageHeader
        title={post.title}
        back={{ href: "/backstage/marketing/social", label: "Social planner" }}
        lead={
          post.plannedFor
            ? `${where}, for ${dayLabel(nzDateKey(post.plannedFor))} at ${formatNzTime(post.plannedFor)}.`
            : `${where}. No day yet.`
        }
      />
      <MarketingNav current="social" />
      <p className="-mt-1 mb-5 flex flex-wrap items-center gap-2">
        <SocialPill status={post.status} />
        <VerdictPill verdict={post.verdict} />
      </p>
      <Flash notice={notice} tone={tone} />
      <div className="mb-4">
        <Notice>
          Nothing here posts for you. Posting is done by hand in the app.
        </Notice>
      </div>

      {/* One list, in the order a phone shows it: what you are working on,
          then what to decide. On a desk the deciding sits in a second column. */}
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        {writing && editable ? work : captionBox}

        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:self-start">
          {writing ? copyCheck : null}
          <Panel title="Next step">
            <NextStep post={post} canWrite={canWrite} />
          </Panel>
          {writing ? null : copyCheck}
        </div>

        {writing && editable ? null : work}

        <Panel title="History" flush className="lg:col-start-1">
          <ActivityList lines={history} now={now} />
        </Panel>
      </div>
    </>
  );
}
