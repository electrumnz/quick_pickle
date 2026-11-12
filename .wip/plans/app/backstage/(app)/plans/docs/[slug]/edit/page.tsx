import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { requireStaff } from "@/lib/backstage/auth/current";
import { MAX_BODY } from "@/lib/backstage/plans/ops";

import { saveDocumentAction } from "../../../actions";
import { BackLink, Flash, Hint, PLANS_HOME, Reveal } from "../../../parts";
import { documentTitle, loadDocument } from "../load";

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  return { title: `Edit: ${await documentTitle((await params).slug)}` };
}

/**
 * A document, to write. One plain text box in one plain form, so it works on
 * a phone with a poor connection and with scripting off. Saving goes to the
 * reading page, which is the preview; every save is kept, so nothing is lost
 * by trying.
 */
export default async function EditDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { slug } = await params;
  const { notice, tone } = await searchParams;
  const doc = await loadDocument(slug);
  const here = `${PLANS_HOME}/docs/${doc.slug}`;

  return (
    <div className="mx-auto max-w-[52rem]">
      <BackLink href={here}>{doc.title}</BackLink>
      <h1 className="bk-h1 mb-4 mt-1">Edit</h1>
      <Flash notice={notice} tone={tone} />

      {staff.role === "viewer" ? (
        <p className="bk-muted leading-snug">
          Your account can look but not change things.
        </p>
      ) : (
        <form action={saveDocumentAction} className="flex flex-col gap-4">
          <input type="hidden" name="slug" value={doc.slug} />
          <input
            type="hidden"
            name="basedOn"
            value={doc.versions[0]?.id ?? ""}
          />
          <div>
            <label htmlFor="title" className="field-label">
              Title
            </label>
            <input
              id="title"
              name="title"
              required
              maxLength={120}
              defaultValue={doc.title}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="body" className="field-label">
              The document
            </label>
            <textarea
              id="body"
              name="body"
              rows={22}
              maxLength={MAX_BODY}
              defaultValue={doc.body}
              aria-describedby="body-hint"
              spellCheck
              className="field min-h-[60vh] font-mono text-[0.9375rem] leading-relaxed"
            />
            <Hint id="body-hint">
              Plain text. A blank line starts a new paragraph, and a single line
              break is kept as one.
            </Hint>
            <details className="mt-1">
              <Reveal>How to add headings, lists and links</Reveal>
              <div className="bk-panel bk-panel-pad mt-1 font-mono text-[0.875rem] leading-relaxed">
                <p>## A heading</p>
                <p>**bold** and *italic*</p>
                <p>- a bullet point</p>
                <p>1. a numbered step</p>
                <p>1. [ ] a step with a box to tick on paper</p>
                <p>[words to press](https://example.co.nz)</p>
                <p>&gt; a note set apart from the rest</p>
                <p>| A table | With columns |</p>
                <p>| --- | --- |</p>
                <p>| one | two |</p>
                <p>____ a blank to fill in</p>
              </div>
            </details>
          </div>
          <div>
            <label htmlFor="note" className="field-label">
              What changed
            </label>
            <input
              id="note"
              name="note"
              maxLength={200}
              aria-describedby="note-hint"
              className="field"
            />
            <Hint id="note-hint">
              Optional. A few words for the history, so the next person knows
              why.
            </Hint>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton pending="Saving">Save</SubmitButton>
            <Link href={here} className="bk-btn bk-btn-quiet">
              <span className="cap-trim">Cancel</span>
            </Link>
          </div>
          <p className="bk-muted text-[0.9375rem] leading-snug">
            Saving takes you to the document as others will read it. Every save
            is kept in its history, so an earlier version can always be put
            back.
          </p>
        </form>
      )}
    </div>
  );
}
