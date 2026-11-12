import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
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
import { countReviews, listReviews } from "@/lib/backstage/marketing/reviews";

import {
  AreaField,
  FilterTabs,
  Flash,
  MarketingNav,
  ReviewPill,
  SelectField,
  TextField,
  VerdictPill,
} from "../parts";
import { addReviewAction } from "./actions";

export const metadata: Metadata = { title: "Reviews" };

const TABS = [
  { key: "pending", label: "Waiting" },
  { key: "published", label: "Published" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const status: TabKey =
    TABS.find((tab) => tab.key === params.status)?.key ?? "pending";
  const caller = await staffCaller();
  const now = new Date();
  const [rows, counts] = await Promise.all([
    execute(listReviews, { status, limit: 100 }, caller),
    execute(countReviews, {}, caller),
  ]);
  const total = counts.pending + counts.published + counts.rejected;
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title="Reviews"
        lead={
          counts.pending === 0
            ? "Nothing waiting to be read."
            : `${String(counts.pending)} waiting to be read.`
        }
      />
      <MarketingNav current="reviews" />
      <Flash notice={params.notice} tone={params.tone} />
      <div className="mb-4">
        <Notice>
          Every review is read by a person before anyone else sees it. Once we
          publish a customer&rsquo;s words they count as ours, so one that says
          what the product did to somebody&rsquo;s body cannot be published. The
          shop does not show reviews yet.
        </Notice>
      </div>

      <FilterTabs
        label="Review stages"
        current={status}
        tabs={TABS.map((tab) => ({
          key: tab.key,
          label: `${tab.label} ${String(tab.key === "all" ? total : counts[tab.key])}`,
          href: `/backstage/marketing/reviews?status=${tab.key}`,
        }))}
      />

      <Panel flush>
        {rows.length === 0 ? (
          <Empty title="Nothing here">
            {status === "pending"
              ? "When a review comes in it waits here to be read."
              : "No reviews at this stage."}
          </Empty>
        ) : (
          <ul className="bk-rows">
            {rows.map((review) => (
              <li key={review.id}>
                <Link
                  href={`/backstage/marketing/reviews/${review.id}`}
                  className="bk-row grid-cols-[1fr_auto]"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {review.rating} out of 5
                      <span className="font-normal">
                        from {review.displayName}
                      </span>
                      {review.verified ? <Pill>Has an order</Pill> : null}
                    </span>
                    <span className="bk-muted block text-[0.9375rem] [overflow-wrap:anywhere]">
                      {review.body}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <ReviewPill status={review.status} />
                    <VerdictPill verdict={review.verdict} />
                    <span className="bk-muted text-[0.875rem] whitespace-nowrap">
                      <When at={review.createdAt} now={now} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canWrite ? (
        <Panel title="Add a review by hand" className="mt-6">
          <form
            id="by-hand"
            action={addReviewAction}
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <p className="bk-muted leading-snug">
              For one a customer sent some other way, such as by email. Type it
              exactly as they wrote it: a review has to be their own words.
              Never write one yourself.
            </p>
            <SelectField
              id="review-rating"
              name="rating"
              label="Rating"
              defaultValue="5"
              options={[5, 4, 3, 2, 1].map((rating) => ({
                value: String(rating),
                label: `${String(rating)} out of 5`,
              }))}
            />
            <AreaField
              id="review-body"
              name="body"
              label="What they wrote"
              rows={4}
              required
              maxLength={1500}
            />
            <TextField
              id="review-name"
              name="displayName"
              label="How they want to be named"
              required
              maxLength={60}
              placeholder="Sam, Ōtaki"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                id="review-order"
                name="orderNumber"
                label="Order number"
                maxLength={20}
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="QP-7K2M9X"
              />
              <TextField
                id="review-email"
                name="email"
                type="email"
                label="Email on that order"
                maxLength={254}
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <p className="bk-muted -mt-1 text-[0.9375rem] leading-snug">
              Optional. If the number and the email match an order, the review
              is tied to it.
            </p>
            <SubmitButton pending="Adding">Add the review</SubmitButton>
          </form>
        </Panel>
      ) : null}
    </>
  );
}
