import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Notice } from "@/components/backstage/ui";
import { requireStaff } from "@/lib/backstage/auth/current";
import {
  DOCUMENT_KINDS,
  KIND_LABEL,
  STARTER_AUTHOR,
} from "@/lib/backstage/plans/labels";
import { countOf } from "@/lib/backstage/plans/shared";
import { formatNzDate } from "@/lib/time";

import { deleteDocumentAction, updateDocumentAction } from "../../actions";
import { Markdown } from "../../Markdown";
import { BackLink, Flash, Hint, PLANS_HOME, Reveal } from "../../parts";
import { documentTitle, loadDocument } from "./load";

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  return { title: await documentTitle((await params).slug) };
}

/**
 * A document, to read. On paper only the document itself prints: the links
 * and forms around it are for the screen.
 */
export default async function DocumentPage({
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
  const canWrite = staff.role !== "viewer";
  const latest = doc.versions[0];
  const here = `${PLANS_HOME}/docs/${doc.slug}`;

  return (
    <div className="mx-auto max-w-[52rem]">
      <div className="bk-noprint mb-3 flex flex-wrap items-center justify-between gap-2">
        <BackLink href={PLANS_HOME}>Plans</BackLink>
        <div className="flex flex-wrap gap-2">
          {canWrite ? (
            <Link href={`${here}/edit`} className="bk-btn">
              <span className="cap-trim">Edit</span>
            </Link>
          ) : null}
          <Link href={`${here}/history`} className="bk-btn bk-btn-quiet">
            <span className="cap-trim">History</span>
          </Link>
        </div>
      </div>

      <Flash notice={notice} tone={tone} />
      {doc.starterDraft ? (
        <div className="bk-noprint mb-4">
          <Notice>
            A starter draft. Nobody has changed it yet. Read it, fill in the
            blanks and make it yours.
          </Notice>
        </div>
      ) : null}

      <article className="bk-panel bk-panel-pad">
        <header className="border-navy mb-5 border-b-2 pb-4">
          <p className="label bk-muted text-[1rem]">
            <span className="cap-trim">{KIND_LABEL[doc.kind]}</span>
          </p>
          <h1 className="varsity mt-2 text-[clamp(1.5rem,6vw,2.1rem)] leading-[1.05]">
            {doc.title}
          </h1>
          <p className="bk-muted mt-3 text-[0.9375rem] leading-snug">
            Last changed {formatNzDate(doc.updatedAt)}
            {latest !== undefined && latest.savedByName !== STARTER_AUTHOR
              ? ` by ${latest.savedByName}`
              : ""}
            <span className="bk-noprint">
              {" · "}
              {countOf(doc.versionCount, "saved version")}
            </span>
          </p>
        </header>
        <Markdown
          source={doc.body}
          empty={
            canWrite
              ? "Nothing has been written here yet. Press Edit to start."
              : "Nothing has been written here yet."
          }
        />
      </article>

      <p className="bk-noprint bk-muted mt-3 text-[0.9375rem] leading-snug">
        To print it, use your browser&apos;s print. Only the document prints.
      </p>

      {canWrite ? (
        <details className="bk-noprint mt-4">
          <Reveal>How it is filed</Reveal>
          <form
            action={updateDocumentAction}
            className="mt-2 flex max-w-[34rem] flex-col gap-3"
          >
            <input type="hidden" name="slug" value={doc.slug} />
            <div>
              <label htmlFor="kind" className="field-label">
                Kind
              </label>
              <select
                id="kind"
                name="kind"
                defaultValue={doc.kind}
                className="field"
              >
                {DOCUMENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="summary" className="field-label">
                One line on what it is for
              </label>
              <input
                id="summary"
                name="summary"
                defaultValue={doc.summary}
                maxLength={240}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="sort" className="field-label">
                Place in the list
              </label>
              <input
                id="sort"
                name="sort"
                inputMode="numeric"
                pattern="[0-9]*"
                defaultValue={doc.sort}
                aria-describedby="sort-hint"
                className="field"
              />
              <Hint id="sort-hint">
                A number. Lower numbers come first within their kind.
              </Hint>
            </div>
            <SubmitButton pending="Saving" className="bk-btn bk-btn-quiet">
              Save
            </SubmitButton>
            <p className="bk-muted text-[0.9375rem] leading-snug">
              The address of this page,{" "}
              <span className="font-mono text-[0.875rem]">{doc.slug}</span>,
              stays the same so links to it keep working. To change the title,
              use Edit.
            </p>
          </form>
        </details>
      ) : null}

      {staff.role === "owner" ? (
        <details className="bk-noprint mt-2">
          <Reveal tone="danger">Delete this document</Reveal>
          <form
            action={deleteDocumentAction}
            className="mt-2 flex max-w-[34rem] flex-col gap-3"
          >
            <input type="hidden" name="slug" value={doc.slug} />
            <p className="leading-snug">
              This deletes &ldquo;{doc.title}&rdquo; and its whole history (
              {countOf(doc.versionCount, "saved version")}). It cannot be
              undone.
            </p>
            <SubmitButton pending="Deleting" className="bk-btn bk-btn-pink">
              Delete it for good
            </SubmitButton>
          </form>
        </details>
      ) : null}
    </div>
  );
}
