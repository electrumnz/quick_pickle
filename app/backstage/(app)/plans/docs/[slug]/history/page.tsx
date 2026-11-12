import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Notice, Panel, Pill } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  getDocumentVersion,
  type DocumentVersionDetail,
} from "@/lib/backstage/plans/ops";
import { countOf } from "@/lib/backstage/plans/shared";
import { formatNzDateTime } from "@/lib/time";

import { restoreDocumentAction } from "../../../actions";
import { Markdown } from "../../../Markdown";
import { BackLink, Flash, PLANS_HOME } from "../../../parts";
import { documentTitle, loadDocument } from "../load";

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  return { title: `History: ${await documentTitle((await params).slug)}` };
}

/**
 * Every saved version of a document, newest first. Open one to read it, and
 * put it back if it was better. Putting one back is itself a new save, so the
 * version it replaces is never lost either.
 */
export default async function DocumentHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ v?: string; notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { slug } = await params;
  const { v, notice, tone } = await searchParams;
  const doc = await loadDocument(slug);
  const canWrite = staff.role !== "viewer";
  const here = `${PLANS_HOME}/docs/${doc.slug}`;

  let shown: DocumentVersionDetail | null = null;
  let missing = false;
  if (v !== undefined && v !== "") {
    try {
      shown = await execute(
        getDocumentVersion,
        { slug: doc.slug, versionId: v },
        await staffCaller(),
      );
    } catch (error) {
      if (
        !(error instanceof OpError) ||
        (error.code !== "not_found" && error.code !== "invalid_input")
      ) {
        throw error;
      }
      missing = true;
    }
  }

  return (
    <div className="mx-auto max-w-[52rem]">
      <BackLink href={here}>{doc.title}</BackLink>
      <h1 className="bk-h1 mt-1">History</h1>
      <p className="bk-muted mb-4 mt-2 leading-snug">
        Every saved version, newest first. Open one to read it or to put it
        back.
      </p>
      <Flash notice={notice} tone={tone} />
      {missing ? (
        <div className="mb-4">
          <Notice tone="bad">That version is not in this history.</Notice>
        </div>
      ) : null}

      {shown !== null ? (
        <Panel
          title={`Saved ${formatNzDateTime(shown.savedAt)}`}
          className="mb-6"
        >
          <div id="version" className="scroll-mt-24">
            <p className="bk-muted leading-snug">
              By {shown.savedByName === "" ? "someone" : shown.savedByName}
              {shown.note === "" ? "" : `. ${shown.note}`}
            </p>
            {shown.sameAsNow ? (
              <p className="mt-3 leading-snug">
                This is what the document says now.
              </p>
            ) : canWrite ? (
              <form action={restoreDocumentAction} className="mt-3">
                <input type="hidden" name="slug" value={doc.slug} />
                <input type="hidden" name="versionId" value={shown.id} />
                <SubmitButton pending="Putting it back">
                  Put this version back
                </SubmitButton>
                <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
                  The document will say this again. What it says now stays in
                  the history.
                </p>
              </form>
            ) : null}
            <div className="border-navy-line mt-5 border-t pt-5">
              {shown.title === doc.title ? null : (
                <p className="mb-4 leading-snug">
                  <span className="font-semibold">Title then:</span>{" "}
                  {shown.title}
                </p>
              )}
              <Markdown
                source={shown.body}
                empty="This version had no text."
                under={2}
              />
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel title={countOf(doc.versionCount, "saved version")} flush>
        <ul className="bk-rows">
          {doc.versions.map((version) => (
            <li key={version.id}>
              <Link
                href={`${here}/history?v=${version.id}#version`}
                aria-current={shown?.id === version.id ? "true" : undefined}
                className="bk-row grid-cols-[1fr_auto]"
              >
                <span className="min-w-0">
                  <span className="block font-semibold tabular-nums">
                    {formatNzDateTime(version.savedAt)}
                  </span>
                  <span className="bk-muted block text-[0.9375rem] leading-snug">
                    {version.savedByName === ""
                      ? "Someone"
                      : version.savedByName}
                    {version.note === "" ? "" : ` · ${version.note}`}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  {version.current ? <Pill tone="done">Now</Pill> : null}
                  <span className="bk-muted text-[0.875rem] whitespace-nowrap">
                    {version.characters.toLocaleString("en-NZ")} characters
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {doc.versionCount > doc.versions.length ? (
          <p className="border-navy-line bk-muted border-t px-4 py-3 text-[0.9375rem]">
            Showing the newest {doc.versions.length}. Older ones are kept.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
