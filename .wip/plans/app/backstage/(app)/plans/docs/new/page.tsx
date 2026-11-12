import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { requireStaff } from "@/lib/backstage/auth/current";
import {
  DOCUMENT_KINDS,
  KIND_BLURB,
  KIND_LABEL,
} from "@/lib/backstage/plans/labels";

import { createDocumentAction } from "../../actions";
import { BackLink, Flash, Hint, PLANS_HOME } from "../../parts";

export const metadata: Metadata = { title: "New document" };

/**
 * Start a document: a title, what kind it is and one line on what it is for.
 * The writing happens on the next screen, so nothing typed here can be lost
 * to a slip.
 */
export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { notice, tone } = await searchParams;

  return (
    <div className="mx-auto max-w-[40rem]">
      <BackLink href={PLANS_HOME}>Plans</BackLink>
      <h1 className="bk-h1 mb-4 mt-1">New document</h1>
      <Flash notice={notice} tone={tone} />

      {staff.role === "viewer" ? (
        <p className="bk-muted leading-snug">
          Your account can look but not change things.
        </p>
      ) : (
        <form action={createDocumentAction} className="flex flex-col gap-4">
          <div>
            <label htmlFor="title" className="field-label">
              Title
            </label>
            <input
              id="title"
              name="title"
              required
              maxLength={120}
              aria-describedby="title-hint"
              className="field"
            />
            <Hint id="title-hint">
              The page&apos;s address is made from the title and does not change
              afterwards. The title itself can.
            </Hint>
          </div>
          <fieldset>
            <legend className="field-label">Kind</legend>
            <div className="flex flex-col gap-2">
              {DOCUMENT_KINDS.map((kind) => (
                <label
                  key={kind}
                  className="bk-panel flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5"
                >
                  <input
                    type="radio"
                    name="kind"
                    value={kind}
                    defaultChecked={kind === "note"}
                    className="accent-navy mt-1 size-5 shrink-0"
                  />
                  <span>
                    <span className="block font-semibold">
                      {KIND_LABEL[kind]}
                    </span>
                    <span className="bk-muted block text-[0.9375rem] leading-snug">
                      {KIND_BLURB[kind]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="summary" className="field-label">
              One line on what it is for
            </label>
            <input
              id="summary"
              name="summary"
              maxLength={240}
              aria-describedby="summary-hint"
              className="field"
            />
            <Hint id="summary-hint">
              Optional. Shown under the title in lists.
            </Hint>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton pending="Starting">Start writing</SubmitButton>
            <Link href={PLANS_HOME} className="bk-btn bk-btn-quiet">
              <span className="cap-trim">Cancel</span>
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
