import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel } from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { restrictedIn } from "@/lib/backstage/marketing/copy-check";
import {
  getReview,
  type ReviewDetail,
} from "@/lib/backstage/marketing/reviews";
import { formatNzDateTime } from "@/lib/time";

import {
  CopyCheckResult,
  Flash,
  Fold,
  LookOnly,
  MarketingNav,
  ReadTheWarnings,
  ReviewPill,
  TextField,
  VerdictPill,
} from "../../parts";
import {
  publishReviewAction,
  rejectReviewAction,
  unpublishReviewAction,
} from "../actions";

export const metadata: Metadata = { title: "Review" };

function Id({ value }: { readonly value: string }) {
  return <input type="hidden" name="id" value={value} />;
}

/** What to do with this review now. Only what its stage allows is offered. */
function Decide({
  review,
  canWrite,
}: {
  readonly review: ReviewDetail;
  readonly canWrite: boolean;
}) {
  const can = (action: string) =>
    review.next.some((allowed) => allowed === action);
  const warnings = [
    ...new Set(restrictedIn(review.copyCheck).map((finding) => finding.rule)),
  ];
  const decided = review.decidedAt
    ? ` on ${formatNzDateTime(review.decidedAt)}${review.decidedByName ? ` by ${review.decidedByName}` : ""}`
    : "";

  return (
    <div className="flex flex-col gap-5">
      <p className="leading-snug">
        {review.status === "pending"
          ? "Waiting to be read. Nobody outside the back end can see it."
          : review.status === "published"
            ? `Published${decided}. The shop does not show reviews yet.`
            : `Rejected${decided}${review.rejectedReason ? `: ${review.rejectedReason}` : "."}`}
      </p>

      {!canWrite ? <LookOnly /> : null}

      {canWrite && can("publish") ? (
        review.verdict === "banned" ? (
          <p className="leading-snug">
            This one cannot be published. The copy check found words we may not
            put our name to, and a customer&rsquo;s review becomes ours the
            moment we publish it, however kind it is. Its words cannot be
            changed either: they are the customer&rsquo;s.
          </p>
        ) : (
          <form action={publishReviewAction} className="flex flex-col gap-3">
            <Id value={review.id} />
            <ReadTheWarnings id="publish-read" rules={warnings} />
            <SubmitButton pending="Publishing" className="bk-btn w-full">
              Publish it
            </SubmitButton>
            <p className="bk-muted text-[0.9375rem] leading-snug">
              Publishing says you have read it and are happy for it to be shown
              as it stands.
            </p>
          </form>
        )
      ) : null}

      {canWrite && can("reject") ? (
        <Fold summary="Reject this review" danger>
          <form action={rejectReviewAction} className="flex flex-col gap-3">
            <Id value={review.id} />
            <TextField
              id="reject-reason"
              name="reason"
              label="Why"
              required
              maxLength={280}
              hint="Only staff see this."
            />
            <SubmitButton
              pending="Rejecting"
              className="bk-btn bk-btn-pink w-full"
            >
              Reject it
            </SubmitButton>
            <p className="bk-muted text-[0.9375rem] leading-snug">
              It is kept, with your reason, and never shown. Not liking what a
              review says is not a reason to reject it.
            </p>
          </form>
        </Fold>
      ) : null}

      {canWrite && can("unpublish") ? (
        <form action={unpublishReviewAction} className="flex flex-col gap-2">
          <Id value={review.id} />
          <SubmitButton pending="Saving" className="bk-btn bk-btn-quiet w-full">
            Take it down
          </SubmitButton>
          <p className="bk-muted text-[0.9375rem] leading-snug">
            It goes back to the waiting pile, where it can be published again or
            rejected.
          </p>
        </form>
      ) : null}
    </div>
  );
}

export default async function ReviewPage({
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

  let review: ReviewDetail;
  try {
    review = await execute(getReview, { id: decodeURIComponent(id) }, caller);
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
    { entityType: "review", entityId: review.id, limit: 50 },
    caller,
  );
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title={`${String(review.rating)} out of 5`}
        back={{ href: "/backstage/marketing/reviews", label: "Reviews" }}
        lead={`From ${review.displayName}, received ${formatNzDateTime(review.createdAt)}.`}
      />
      <MarketingNav current="reviews" />
      <p className="-mt-1 mb-5 flex flex-wrap items-center gap-2">
        <ReviewPill status={review.status} />
        <VerdictPill verdict={review.verdict} />
      </p>
      <Flash notice={notice} tone={tone} />

      {/* One list, in the order a phone shows it: the review, the decision,
          then its history. On a desk the decision sits in a second column. */}
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        <Panel title="What they wrote" className="lg:col-start-1">
          <p className="leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
            {review.body}
          </p>
          <dl className="bk-kv border-navy-line mt-5 border-t pt-4">
            <dt>Shown as</dt>
            <dd>{review.displayName}</dd>
            <dt>Order</dt>
            <dd>
              {review.orderNumber ? (
                <Link
                  href={`/backstage/orders/${review.orderNumber}`}
                  className="link"
                >
                  {review.orderNumber}
                </Link>
              ) : (
                "Not tied to an order"
              )}
            </dd>
            {review.customerId ? (
              <>
                <dt>Customer</dt>
                <dd>
                  <Link
                    href={`/backstage/customers/${review.customerId}`}
                    className="link"
                  >
                    {review.customerName ?? "Open the customer"}
                  </Link>
                </dd>
              </>
            ) : null}
          </dl>
          <p className="bk-muted mt-4 text-[0.9375rem] leading-snug">
            A review is never edited. These are the customer&rsquo;s words, and
            changing them would be making a review up.
          </p>
        </Panel>

        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
          <Panel title="Copy check">
            <CopyCheckResult
              check={review.copyCheck}
              verdict={review.verdict}
              what="review"
            />
          </Panel>
          <Panel title="Decide">
            <Decide review={review} canWrite={canWrite} />
          </Panel>
        </div>

        <Panel title="History" flush className="lg:col-start-1">
          <ActivityList lines={history} now={now} />
        </Panel>
      </div>
    </>
  );
}
