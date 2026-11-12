import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { restrictedIn } from "@/lib/backstage/marketing/copy-check";
import { numbersSummary } from "@/lib/backstage/numbers/ops";
import { getPage, type PageRow } from "@/lib/backstage/pages/ops";
import { formatNzdExact } from "@/lib/shop/money";
import { siteUrl } from "@/lib/site";
import { formatNzDateTime } from "@/lib/time";

import {
  CopyCheckResult,
  Flash,
  LookOnly,
  MarketingNav,
  ReadTheWarnings,
  VerdictPill,
} from "../../parts";
import {
  publishPageAction,
  setPageLiveAction,
  updatePageAction,
} from "../actions";
import { PageFields, PagePill } from "../fields";

export const metadata: Metadata = { title: "Landing page" };

function Id({ value }: { readonly value: string }) {
  return <input type="hidden" name="id" value={value} />;
}

/** Where the page stands, in a sentence a person can act on. */
function standing(page: PageRow, site: string): string {
  const address = `${site}${page.path}`;
  switch (page.state) {
    case "draft":
      return "Not published. Nobody outside can see it, and its address shows the standard page.";
    case "live":
      return page.changed
        ? `Live at ${address}. The draft has changes that customers cannot see yet.`
        : `Live at ${address}. The draft is the same as what customers see.`;
    case "off":
      return `Taken down. ${address} shows the standard page until it is put back.`;
  }
}

export default async function LandingPageEditor({
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

  let page: PageRow;
  try {
    page = await execute(getPage, { id: decodeURIComponent(id) }, caller);
  } catch (error) {
    if (
      error instanceof OpError &&
      (error.code === "not_found" || error.code === "invalid_input")
    ) {
      notFound();
    }
    throw error;
  }
  const [history, numbers] = await Promise.all([
    execute(
      listActivity,
      { entityType: "page", entityId: page.id, limit: 50 },
      caller,
    ),
    execute(numbersSummary, { days: 30 }, caller),
  ]);
  const canWrite = staff.role !== "viewer";
  const site = siteUrl();
  const seen = numbers.pages.find((row) => row.page === page.slug);
  const preview = `/preview/${encodeURIComponent(page.id)}`;
  const warnings = [
    ...new Set(
      (page.copyCheck === null ? [] : restrictedIn(page.copyCheck)).map(
        (finding) => finding.rule,
      ),
    ),
  ];
  const blocked = page.verdict === "banned";
  // There is something to publish when the draft is not what is out there.
  const toPublish = page.state === "draft" || page.changed;

  return (
    <>
      <PageHeader
        title={page.name}
        back={{ href: "/backstage/marketing/pages", label: "Landing pages" }}
        lead={`${site}${page.path}`}
      />
      <MarketingNav current="pages" />
      <p className="-mt-1 mb-5 flex flex-wrap items-center gap-2">
        <PagePill state={page.state} />
        {page.state !== "draft" && page.changed ? (
          <Pill tone="doing">Changes not published</Pill>
        ) : null}
        <VerdictPill verdict={page.verdict} />
      </p>
      <Flash notice={notice} tone={tone} />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel title="The words">
            {canWrite ? (
              <form action={updatePageAction} className="flex flex-col gap-3">
                <Id value={page.id} />
                <PageFields values={page} />
                <SubmitButton pending="Saving" className="bk-btn">
                  Save the draft
                </SubmitButton>
                <p className="bk-muted text-[0.9375rem] leading-snug">
                  Saving changes the draft and the preview beside it. Nothing a
                  customer sees changes until you publish.
                </p>
              </form>
            ) : (
              <dl className="bk-kv">
                <dt>Small heading</dt>
                <dd>{page.draft.eyebrow || "None"}</dd>
                <dt>Headline</dt>
                <dd className="whitespace-pre-line">{page.draft.headline}</dd>
                <dt>Sentence</dt>
                <dd>{page.draft.lead || "None"}</dd>
              </dl>
            )}
          </Panel>

          <Panel title="Copy check">
            <CopyCheckResult
              check={page.copyCheck}
              verdict={page.verdict}
              what="page"
            />
          </Panel>

          <Panel title="Publish">
            <div id="publish" className="scroll-mt-24">
              <p className="leading-snug">{standing(page, site)}</p>
              {page.publishedAt ? (
                <p className="bk-muted mt-1 text-[0.9375rem]">
                  Last published {formatNzDateTime(page.publishedAt)}.
                </p>
              ) : null}

              {!canWrite ? (
                <div className="mt-4">
                  <LookOnly />
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-4">
                  {toPublish && blocked ? (
                    <p className="border-pink-deep bg-blush rounded-xl border-2 p-3 leading-snug">
                      <strong>
                        This draft cannot be published as written.
                      </strong>{" "}
                      The copy check above says which words and why. Change them
                      and save the draft again.
                    </p>
                  ) : null}
                  {toPublish && !blocked ? (
                    <form
                      action={publishPageAction}
                      className="flex flex-col gap-3"
                    >
                      <Id value={page.id} />
                      <ReadTheWarnings
                        id="publish-acknowledge"
                        rules={warnings}
                      />
                      <SubmitButton pending="Publishing" className="bk-btn">
                        {page.state === "draft"
                          ? "Publish this page"
                          : page.state === "off"
                            ? "Publish the changes and put it back up"
                            : "Publish the changes"}
                      </SubmitButton>
                      <p className="bk-muted text-[0.9375rem] leading-snug">
                        Have a look at the preview first. Once published, anyone
                        with the address can read it.
                      </p>
                    </form>
                  ) : null}
                  {page.state === "off" && !page.changed ? (
                    <form action={setPageLiveAction}>
                      <Id value={page.id} />
                      <input type="hidden" name="live" value="true" />
                      <SubmitButton pending="Saving" className="bk-btn">
                        Put it back up
                      </SubmitButton>
                    </form>
                  ) : null}
                  {page.state === "live" ? (
                    <form action={setPageLiveAction}>
                      <Id value={page.id} />
                      <input type="hidden" name="live" value="false" />
                      <SubmitButton
                        pending="Saving"
                        className="bk-btn bk-btn-quiet"
                      >
                        Take it down
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Its numbers, last 30 days">
            {seen === undefined ? (
              <p className="bk-muted leading-snug">
                {page.state === "live"
                  ? "Nobody has visited it yet."
                  : "Nothing yet. Numbers start once it is published and somebody visits."}
              </p>
            ) : (
              <dl className="bk-kv">
                <dt>Visits</dt>
                <dd>{seen.visits}</dd>
                <dt>Put something in the jar</dt>
                <dd>{seen.added}</dd>
                <dt>Orders placed</dt>
                <dd>
                  {seen.ordered}
                  {seen.visits === 0
                    ? ""
                    : `, or ${String(Math.round((seen.ordered / seen.visits) * 100))} for every 100 visits`}
                </dd>
                <dt>Sales</dt>
                <dd>{formatNzdExact(seen.salesCents)}</dd>
              </dl>
            )}
            <p className="mt-4">
              <Link href="/backstage/numbers" className="underline">
                All the numbers, page by page
              </Link>
            </p>
          </Panel>

          <Panel title="Send people to it">
            <p className="leading-snug">
              Its address is{" "}
              <span className="font-mono font-semibold [overflow-wrap:anywhere]">
                {site}
                {page.path}
              </span>
              . Put that in an advert as it is, or make a short link to it: a
              short link counts its clicks, can carry a promo code, and has a QR
              code to print.
            </p>
            {canWrite ? (
              <p className="mt-3">
                <Link
                  href={`/backstage/marketing/links?target=${encodeURIComponent(page.path)}#new`}
                  className="bk-btn bk-btn-quiet"
                >
                  <span className="cap-trim">Make a short link to it</span>
                </Link>
              </p>
            ) : null}
          </Panel>

          <Panel title="History" flush>
            <ActivityList lines={history} now={now} />
          </Panel>
        </div>

        <Panel title="Preview" className="self-start">
          <p className="leading-snug">
            The draft, as a customer would see it on a phone. It has a strip
            across the top saying it is a preview, which is never on the real
            page.
          </p>
          <iframe
            src={preview}
            title={`The draft of ${page.name}, as it looks on a phone`}
            loading="lazy"
            className="border-navy mt-4 h-[44rem] w-full max-w-[390px] rounded-[24px] border-[3px] bg-white"
          />
          <p className="mt-4 flex flex-wrap gap-2">
            <a
              href={preview}
              target="_blank"
              rel="noreferrer"
              className="bk-btn bk-btn-quiet"
            >
              <span className="cap-trim">Open the draft full size</span>
            </a>
            {page.published === null ? null : (
              <a
                href={`${preview}?show=live`}
                target="_blank"
                rel="noreferrer"
                className="bk-btn bk-btn-quiet"
              >
                <span className="cap-trim">Open what is live</span>
              </a>
            )}
          </p>
          <p className="bk-muted mt-3 text-[0.9375rem] leading-snug">
            Full size opens in a new tab, so you can make the window as wide as
            a desktop or as narrow as a phone. Looking at a preview is not
            counted as a visit.
          </p>
        </Panel>
      </div>
    </>
  );
}
