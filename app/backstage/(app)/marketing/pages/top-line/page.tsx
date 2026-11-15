import type { Metadata } from "next";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { restrictedIn } from "@/lib/backstage/marketing/copy-check";
import {
  shopTopLine,
  TOP_LINE_ENTITY,
  type TopLineState,
} from "@/lib/backstage/shop/top-line";
import { TOP_LINE_LETTERS, TOP_LINE_MOST } from "@/lib/shop/top-line";
import { formatNzDateTime } from "@/lib/time";

import {
  AreaField,
  CopyCheckResult,
  Flash,
  LookOnly,
  MarketingNav,
  ReadTheWarnings,
  VerdictPill,
} from "../../parts";
import {
  publishTopLineAction,
  resetTopLineAction,
  saveTopLineAction,
} from "../actions";

export const metadata: Metadata = { title: "The line across the top" };

const PREVIEW = "/preview/home?line=draft";

/** A set of lines, one under another, as they will be said. */
function Lines({ lines }: { readonly lines: readonly string[] }) {
  return (
    <ol className="flex list-decimal flex-col gap-1 pl-6 leading-snug">
      {lines.map((line, index) => (
        <li
          key={`${String(index)}:${line}`}
          className="[overflow-wrap:anywhere]"
        >
          {line}
        </li>
      ))}
    </ol>
  );
}

/** Where the line stands, in a sentence a person can act on. */
function standing(line: TopLineState): string {
  if (line.standard) {
    return line.changed
      ? "The shop is showing its standard line. Your draft is not published, so no customer can see it."
      : "The shop is showing its standard line.";
  }
  return line.changed
    ? "The shop is showing the line you published. The draft has changes that customers cannot see yet."
    : "The shop is showing the line you published.";
}

export default async function TopLinePage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const now = new Date();
  const [line, history] = await Promise.all([
    execute(shopTopLine, {}, caller),
    execute(
      listActivity,
      {
        entityType: TOP_LINE_ENTITY.type,
        entityId: TOP_LINE_ENTITY.id,
        limit: 50,
      },
      caller,
    ),
  ]);
  const canWrite = staff.role !== "viewer";
  const warnings = [
    ...new Set(restrictedIn(line.copyCheck).map((finding) => finding.rule)),
  ];
  const blocked = line.verdict === "banned";
  const fits = line.problems.length === 0;

  return (
    <>
      <PageHeader
        title="The line across the top"
        back={{ href: "/backstage/marketing/pages", label: "Landing pages" }}
        lead="The line of words that runs across the very top of the shop, on the standard page and on every landing page."
      />
      <MarketingNav current="pages" />
      <p className="-mt-1 mb-5 flex flex-wrap items-center gap-2">
        <Pill tone={line.standard ? "plain" : "done"}>
          {line.standard ? "The standard line" : "Your own line"}
        </Pill>
        {line.changed ? <Pill tone="doing">Draft not published</Pill> : null}
        {line.changed ? <VerdictPill verdict={line.verdict} /> : null}
      </p>
      <Flash notice={notice} tone={tone} />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel title="The words">
            {canWrite ? (
              <form action={saveTopLineAction} className="flex flex-col gap-3">
                <AreaField
                  id="top-line-words"
                  name="lines"
                  label="One line to a row"
                  rows={TOP_LINE_MOST}
                  defaultValue={line.draft.join("\n")}
                  hint={`Up to ${String(TOP_LINE_MOST)} lines, each up to ${String(TOP_LINE_LETTERS)} letters. They run one after another with a sparkle between, set in capitals. Keep them to things that stay true: a special that is switched on says itself first in the line, by itself.`}
                />
                <SubmitButton pending="Saving" className="bk-btn">
                  Save the draft
                </SubmitButton>
                <p className="bk-muted text-[0.9375rem] leading-snug">
                  Saving changes the draft and the preview beside it. Nothing a
                  customer sees changes until you publish. Saving an empty box
                  puts the draft back to what the shop shows.
                </p>
              </form>
            ) : (
              <Lines lines={line.draft} />
            )}
          </Panel>

          <Panel title="Copy check">
            <CopyCheckResult
              check={line.copyCheck}
              verdict={line.verdict}
              what="line"
            />
          </Panel>

          <Panel title="Publish">
            <div id="publish" className="scroll-mt-24">
              <p className="leading-snug">{standing(line)}</p>
              {line.publishedAt ? (
                <p className="bk-muted mt-1 text-[0.9375rem]">
                  Published {formatNzDateTime(line.publishedAt)}.
                </p>
              ) : null}

              {!canWrite ? (
                <div className="mt-4">
                  <LookOnly />
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-4">
                  {line.changed && !fits ? (
                    <div className="border-pink-deep bg-blush rounded-xl border-2 p-3 leading-snug">
                      <p>
                        <strong>This draft does not fit yet.</strong>
                      </p>
                      <ul className="mt-1 list-disc pl-5">
                        {line.problems.map((problem) => (
                          <li key={problem}>{problem}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {line.changed && fits && blocked ? (
                    <p className="border-pink-deep bg-blush rounded-xl border-2 p-3 leading-snug">
                      <strong>
                        This draft cannot be published as written.
                      </strong>{" "}
                      The copy check above says which words and why. Change them
                      and save the draft again.
                    </p>
                  ) : null}
                  {line.changed && fits && !blocked ? (
                    <form
                      action={publishTopLineAction}
                      className="flex flex-col gap-3"
                    >
                      <p className="font-semibold">
                        These words will go across the top:
                      </p>
                      <Lines lines={line.draft} />
                      {line.draft.map((each, index) => (
                        <input
                          key={`${String(index)}:${each}`}
                          type="hidden"
                          name="shown"
                          value={each}
                        />
                      ))}
                      <ReadTheWarnings
                        id="publish-acknowledge"
                        rules={warnings}
                      />
                      <SubmitButton pending="Publishing" className="bk-btn">
                        Publish this line
                      </SubmitButton>
                      <p className="bk-muted text-[0.9375rem] leading-snug">
                        Have a look at the preview first. Once published, every
                        visitor to the shop reads it.
                      </p>
                    </form>
                  ) : null}
                  {line.standard ? null : (
                    <form action={resetTopLineAction}>
                      <SubmitButton
                        pending="Saving"
                        className="bk-btn bk-btn-quiet"
                      >
                        Put the standard line back
                      </SubmitButton>
                    </form>
                  )}
                </div>
              )}
            </div>
          </Panel>

          <Panel title="What the shop shows now">
            <Lines lines={line.showing} />
            {line.standard ? null : (
              <>
                <p className="mt-4 font-semibold">The standard line</p>
                <div className="bk-muted mt-1">
                  <Lines lines={line.file} />
                </div>
              </>
            )}
          </Panel>

          <Panel title="History" flush>
            <ActivityList
              lines={history}
              now={now}
              empty="Nobody has changed the line. The shop shows the one it came with."
            />
          </Panel>
        </div>

        <Panel title="Preview" className="self-start">
          <p className="leading-snug">
            The shop with the draft across the top, as a customer would see it
            on a phone. The strip above it saying it is a preview is never on
            the real page.
          </p>
          <iframe
            src={PREVIEW}
            title="The shop with the draft of the line across the top, as it looks on a phone"
            loading="lazy"
            className="border-navy mt-4 h-[32rem] w-full max-w-[390px] rounded-[24px] border-[3px] bg-white"
          />
          <p className="mt-4 flex flex-wrap gap-2">
            <a
              href={PREVIEW}
              target="_blank"
              rel="noreferrer"
              className="bk-btn bk-btn-quiet"
            >
              <span className="cap-trim">Open the draft full size</span>
            </a>
            <a
              href="/preview/home"
              target="_blank"
              rel="noreferrer"
              className="bk-btn bk-btn-quiet"
            >
              <span className="cap-trim">Open what is live</span>
            </a>
          </p>
          <p className="bk-muted mt-3 text-[0.9375rem] leading-snug">
            Full size opens in a new tab, so you can make the window as wide as
            a desktop. Looking at a preview is not counted as a visit.
          </p>
        </Panel>
      </div>
    </>
  );
}
