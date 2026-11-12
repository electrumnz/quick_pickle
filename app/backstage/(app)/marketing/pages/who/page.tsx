import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { listLinks } from "@/lib/backstage/marketing/links";
import { listPages } from "@/lib/backstage/pages/ops";
import {
  listPageRules,
  listPageTests,
  pageTestResults,
  RULE_KIND_LABEL,
  whoSees,
  type TestResults,
  type WhoSees,
} from "@/lib/backstage/pages/routing-ops";
import { formatNzdExact } from "@/lib/shop/money";
import { RULE_KINDS } from "@/lib/shop/routing";
import { formatNzDateTime } from "@/lib/time";

import {
  CheckField,
  Flash,
  Fold,
  LookOnly,
  MarketingNav,
  SelectField,
  TextField,
} from "../../parts";
import {
  addPageRuleAction,
  movePageRuleAction,
  removePageRuleAction,
  removePageTestAction,
  setPageRuleActiveAction,
  setUpPageTestAction,
  startPageTestAction,
  stopPageTestAction,
} from "../actions";

export const metadata: Metadata = { title: "Who sees which page" };

/**
 * Who sees which page: the rules, the test, and "see it as".
 *
 * Everything on this screen is optional and starts switched off. The first
 * thing it says is what is true right now, in a sentence, because for most
 * of the life of the business that sentence is "everybody sees the standard
 * page" and there is nothing else to read.
 */

function Id({ value }: { readonly value: string }) {
  return <input type="hidden" name="id" value={value} />;
}

const per100 = (part: number, whole: number) =>
  whole === 0 ? "0" : String(Math.round((part / whole) * 1000) / 10);

/** A page's name in the middle of a sentence: a landing page keeps its own. */
const midSentence = (each: {
  readonly pageId: string | null;
  readonly pageName: string;
}) => (each.pageId === null ? "the standard page" : each.pageName);

function TestNumbers({ results }: { readonly results: TestResults }) {
  return (
    <>
      <p className="leading-snug">{results.verdict.sentence}</p>
      <div
        className="bk-table-wrap mt-4"
        role="region"
        aria-label={`The numbers for ${results.name}`}
        tabIndex={0}
      >
        <table className="bk-table">
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col" className="bk-num">
                Visits
              </th>
              <th scope="col" className="bk-num">
                Orders placed
              </th>
              <th scope="col" className="bk-num">
                Per 100 visits
              </th>
              <th scope="col" className="bk-num">
                Sales
              </th>
            </tr>
          </thead>
          <tbody>
            {results.arms.map((arm) => (
              <tr key={arm.arm}>
                <th scope="row">{arm.name}</th>
                <td className="bk-num">{arm.visits}</td>
                <td className="bk-num">{arm.ordered}</td>
                <td className="bk-num">{per100(arm.ordered, arm.visits)}</td>
                <td className="bk-num">{formatNzdExact(arm.salesCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="bk-muted mt-3 text-[0.9375rem] leading-snug">
        Only visitors the test itself put on a page are counted. Somebody who
        reached either page another way is left out, and so is a browser that
        asks not to be tracked.
      </p>
    </>
  );
}

export default async function WhoSeesPage({
  searchParams,
}: {
  searchParams: Promise<{
    notice?: string;
    tone?: string;
    asked?: string;
    via?: string;
    source?: string;
    site?: string;
    code?: string;
    buyer?: string;
  }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const caller = await staffCaller();
  const [rules, tests, pages, links] = await Promise.all([
    execute(listPageRules, {}, caller),
    execute(listPageTests, {}, caller),
    execute(listPages, { limit: 200 }, caller),
    execute(listLinks, { limit: 200 }, caller),
  ]);
  const canWrite = staff.role !== "viewer";

  const open = tests.find((test) => test.status !== "ended") ?? null;
  const lastEnded = tests.find((test) => test.status === "ended") ?? null;
  const shown = open?.status === "running" ? open : lastEnded;
  const results =
    shown === null
      ? null
      : await execute(pageTestResults, { id: shown.id }, caller);

  const working = rules.filter((rule) => rule.active && !rule.waiting);
  const pageChoices = pages.map((page) => ({
    value: page.id,
    label: `${page.name}${page.state === "live" ? "" : page.state === "off" ? " (taken down)" : " (not published yet)"}`,
  }));

  // "See it as": asked with the form at the bottom, answered by the same
  // code the shop runs.
  const asked = params.asked === "1";
  let seen: WhoSees | null = null;
  if (asked) {
    seen = await execute(
      whoSees,
      {
        via: params.via ?? "",
        source: params.source ?? "",
        site: params.site ?? "",
        code: params.code === "on",
        buyer: params.buyer === "on",
      },
      caller,
    );
  }

  const now =
    open?.status === "running"
      ? `A test is running: visitors no rule picks out are split between ${open.a?.name ?? "the standard page"} and ${open.b.name}.`
      : working.length === 0
        ? "Everybody sees the standard page. Nothing here is switched on."
        : `${String(working.length)} ${working.length === 1 ? "rule is" : "rules are"} sending some visitors to a landing page. Everybody else sees the standard page.`;

  return (
    <>
      <PageHeader
        title="Who sees which page"
        back={{ href: "/backstage/marketing/pages", label: "Landing pages" }}
        lead="Send some visitors to a landing page when they come to the front of the shop, or test two pages against each other. All of it is optional."
      />
      <MarketingNav current="pages" />
      <Flash notice={params.notice} tone={params.tone} />

      <p className="border-navy bg-paper mb-6 rounded-[14px] border-2 p-4 leading-snug">
        <strong>Right now:</strong> {now}
      </p>

      <div className="flex flex-col gap-6">
        <Panel title="Rules" flush>
          <div id="rules" className="scroll-mt-24">
            {rules.length === 0 ? (
              <p className="bk-muted bk-panel-pad leading-snug">
                No rules. A rule sends one kind of visitor to a landing page of
                yours when they come to the front of the shop: the people who
                came through a creator&rsquo;s link, say, or from one advert.
                They keep seeing that page for thirty days.
              </p>
            ) : (
              <ol className="bk-rows">
                {rules.map((rule, index) => (
                  <li key={rule.id} className="bk-row grid-cols-1">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <p className="min-w-0 leading-snug">
                        <span className="bk-muted tabular-nums">
                          {index + 1}.
                        </span>{" "}
                        <span className="font-semibold">{rule.who}</span> see{" "}
                        <Link
                          href={`/backstage/marketing/pages/${rule.pageId}`}
                          className="underline"
                        >
                          {rule.pageName}
                        </Link>
                        .
                      </p>
                      <p className="flex flex-wrap items-center gap-2">
                        {rule.active ? null : (
                          <Pill tone="off">Switched off</Pill>
                        )}
                        {rule.waiting ? (
                          <Pill tone="doing">Waiting on its page</Pill>
                        ) : null}
                      </p>
                    </div>
                    {rule.waiting ? (
                      <p className="bk-muted text-[0.9375rem] leading-snug">
                        Its page is not published, so this does nothing yet. It
                        starts by itself when the page goes up.
                      </p>
                    ) : null}
                    {canWrite ? (
                      <div className="flex flex-wrap gap-2">
                        {index === 0 ? null : (
                          <form action={movePageRuleAction}>
                            <Id value={rule.id} />
                            <input type="hidden" name="direction" value="up" />
                            <SubmitButton
                              pending="Moving"
                              className="bk-btn bk-btn-quiet"
                            >
                              Move up
                            </SubmitButton>
                          </form>
                        )}
                        {index === rules.length - 1 ? null : (
                          <form action={movePageRuleAction}>
                            <Id value={rule.id} />
                            <input
                              type="hidden"
                              name="direction"
                              value="down"
                            />
                            <SubmitButton
                              pending="Moving"
                              className="bk-btn bk-btn-quiet"
                            >
                              Move down
                            </SubmitButton>
                          </form>
                        )}
                        <form action={setPageRuleActiveAction}>
                          <Id value={rule.id} />
                          <input
                            type="hidden"
                            name="active"
                            value={rule.active ? "false" : "true"}
                          />
                          <SubmitButton
                            pending="Saving"
                            className="bk-btn bk-btn-quiet"
                          >
                            {rule.active ? "Switch off" : "Switch on"}
                          </SubmitButton>
                        </form>
                        <form action={removePageRuleAction}>
                          <Id value={rule.id} />
                          <SubmitButton
                            pending="Removing"
                            className="bk-btn bk-btn-quiet"
                          >
                            Remove
                          </SubmitButton>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
            {rules.length > 1 ? (
              <p className="bk-muted border-navy-line border-t-2 px-4 py-3 text-[0.9375rem] leading-snug md:px-6">
                They are asked in this order, and the first that fits a visitor
                wins.
              </p>
            ) : null}
            <div className="border-navy-line border-t-2 px-4 py-3 md:px-6">
              {!canWrite ? (
                <LookOnly />
              ) : pages.length === 0 ? (
                <p className="bk-muted leading-snug">
                  A rule needs a landing page to send people to.{" "}
                  <Link
                    href="/backstage/marketing/pages#new"
                    className="underline"
                  >
                    Start one
                  </Link>{" "}
                  first.
                </p>
              ) : (
                <Fold summary="Add a rule">
                  <form
                    action={addPageRuleAction}
                    className="flex max-w-[36rem] flex-col gap-3"
                  >
                    <SelectField
                      id="rule-when"
                      name="when"
                      label="Who it is for"
                      defaultValue="link"
                      options={RULE_KINDS.map((kind) => ({
                        value: kind,
                        label: RULE_KIND_LABEL[kind],
                      }))}
                    />
                    <TextField
                      id="rule-value"
                      name="value"
                      label="Which one"
                      maxLength={120}
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="kai"
                      hint="For a short link, what comes after /go/. For an advert, its label (the utm_source on its address). For a website, its name, like instagram.com. Leave empty for the last two."
                    />
                    <SelectField
                      id="rule-page"
                      name="pageId"
                      label="The page they see"
                      options={pageChoices}
                    />
                    <SubmitButton pending="Saving" className="bk-btn">
                      Add the rule
                    </SubmitButton>
                    <p className="bk-muted text-[0.9375rem] leading-snug">
                      It is switched on as soon as it is added. A visitor it
                      picks out gets a small cookie so they keep seeing the same
                      page. Nobody else gets one.
                    </p>
                  </form>
                </Fold>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="A test between two pages">
          <div id="test" className="scroll-mt-24">
            {open === null ? (
              <p className="leading-snug">
                No test is set up. A test splits the visitors no rule picks out
                evenly between two pages, keeps each on the one they landed on,
                and counts which sells more.
              </p>
            ) : open.status === "off" ? (
              <>
                <p className="leading-snug">
                  <strong>
                    &ldquo;{open.name}&rdquo; is set up and switched off.
                  </strong>{" "}
                  {open.a?.name ?? "The standard page"} against {open.b.name}.
                  Nothing changes for anybody until you start it.
                </p>
                {open.blocked !== null ? (
                  <p className="border-pink-deep bg-blush mt-3 rounded-xl border-2 p-3 leading-snug">
                    {open.blocked}
                  </p>
                ) : null}
                {canWrite ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {open.blocked === null ? (
                      <form action={startPageTestAction}>
                        <Id value={open.id} />
                        <SubmitButton pending="Starting" className="bk-btn">
                          Start the test
                        </SubmitButton>
                      </form>
                    ) : null}
                    <form action={removePageTestAction}>
                      <Id value={open.id} />
                      <SubmitButton
                        pending="Removing"
                        className="bk-btn bk-btn-quiet"
                      >
                        Remove it
                      </SubmitButton>
                    </form>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="mb-3 flex flex-wrap items-center gap-2">
                  <Pill tone="doing">Running</Pill>
                  <span className="font-semibold">{open.name}</span>
                  {open.startedAt ? (
                    <span className="bk-muted text-[0.9375rem]">
                      since {formatNzDateTime(open.startedAt)}
                    </span>
                  ) : null}
                </p>
                {results !== null ? <TestNumbers results={results} /> : null}
                {canWrite ? (
                  <form action={stopPageTestAction} className="mt-4">
                    <Id value={open.id} />
                    <SubmitButton pending="Stopping" className="bk-btn">
                      Stop the test
                    </SubmitButton>
                  </form>
                ) : null}
              </>
            )}

            {open?.status !== "running" &&
            lastEnded !== null &&
            results !== null ? (
              <div className="border-navy-line mt-5 border-t-2 pt-4">
                <p className="mb-3 flex flex-wrap items-center gap-2">
                  <Pill tone="off">Finished</Pill>
                  <span className="font-semibold">{lastEnded.name}</span>
                  {lastEnded.endedAt ? (
                    <span className="bk-muted text-[0.9375rem]">
                      stopped {formatNzDateTime(lastEnded.endedAt)}
                    </span>
                  ) : null}
                </p>
                <TestNumbers results={results} />
              </div>
            ) : null}

            {open === null && canWrite ? (
              <div className="mt-4">
                {pages.length === 0 ? (
                  <p className="bk-muted leading-snug">
                    A test needs a landing page to try against the standard one.{" "}
                    <Link
                      href="/backstage/marketing/pages#new"
                      className="underline"
                    >
                      Start one
                    </Link>{" "}
                    first.
                  </p>
                ) : (
                  <Fold summary="Set one up">
                    <form
                      action={setUpPageTestAction}
                      className="flex max-w-[36rem] flex-col gap-3"
                    >
                      <TextField
                        id="test-name"
                        name="name"
                        label="What you call it"
                        required
                        maxLength={80}
                        placeholder="Standard page against the clubs page"
                      />
                      <SelectField
                        id="test-a"
                        name="aPageId"
                        label="This page"
                        defaultValue=""
                        options={[
                          { value: "", label: "The standard page" },
                          ...pageChoices,
                        ]}
                      />
                      <SelectField
                        id="test-b"
                        name="bPageId"
                        label="Against this one"
                        options={pageChoices}
                      />
                      <SubmitButton pending="Saving" className="bk-btn">
                        Set it up, switched off
                      </SubmitButton>
                      <p className="bk-muted text-[0.9375rem] leading-snug">
                        Setting it up changes nothing for anybody. It only runs
                        once you press Start, and only one runs at a time.
                      </p>
                    </form>
                  </Fold>
                )}
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="See it as">
          <div id="see" className="scroll-mt-24">
            <p className="leading-snug">
              Describe a visitor and see which page they would get, worked out
              by the same code the shop itself runs. It changes nothing.
            </p>
            <form
              action="/backstage/marketing/pages/who#see"
              method="get"
              className="mt-4 flex max-w-[36rem] flex-col gap-3"
            >
              <input type="hidden" name="asked" value="1" />
              <SelectField
                id="see-via"
                name="via"
                label="Came through this short link"
                defaultValue={params.via ?? ""}
                options={[
                  { value: "", label: "None" },
                  ...links.map((link) => ({
                    value: link.slug,
                    label: `${link.path}${link.label === "" ? "" : ` (${link.label})`}`,
                  })),
                ]}
              />
              <TextField
                id="see-source"
                name="source"
                label="From an advert labelled"
                maxLength={60}
                autoCapitalize="none"
                spellCheck={false}
                defaultValue={params.source}
                placeholder="facebook"
              />
              <TextField
                id="see-site"
                name="site"
                label="From this website"
                maxLength={100}
                autoCapitalize="none"
                spellCheck={false}
                defaultValue={params.site}
                placeholder="instagram.com"
              />
              <CheckField
                id="see-code"
                name="code"
                label="Arrived carrying a promo code"
                defaultChecked={params.code === "on"}
              />
              <CheckField
                id="see-buyer"
                name="buyer"
                label="Has bought before"
                defaultChecked={params.buyer === "on"}
              />
              <button type="submit" className="bk-btn">
                <span className="cap-trim">See what they would get</span>
              </button>
            </form>

            {seen !== null ? (
              <div
                role="status"
                className="border-navy bg-olive-wash mt-5 rounded-[14px] border-2 p-4"
              >
                <p className="leading-snug">
                  <strong>
                    They would see{" "}
                    {seen.orElse === null
                      ? midSentence(seen)
                      : `${midSentence(seen)} or ${midSentence(seen.orElse)}`}
                    .
                  </strong>{" "}
                  {seen.because}
                </p>
                <div className="mt-4 flex flex-wrap gap-4">
                  {[seen, ...(seen.orElse === null ? [] : [seen.orElse])].map(
                    (each) => (
                      <figure key={each.page} className="min-w-0">
                        <figcaption className="label mb-2 text-[1rem]">
                          <span className="cap-trim">{each.pageName}</span>
                        </figcaption>
                        <iframe
                          src={
                            each.pageId === null
                              ? "/preview/home"
                              : `/preview/${encodeURIComponent(each.pageId)}?show=live`
                          }
                          title={`${each.pageName}, as it looks on a phone`}
                          loading="lazy"
                          className="border-navy h-[40rem] w-full max-w-[360px] rounded-[24px] border-[3px] bg-white"
                        />
                      </figure>
                    ),
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    </>
  );
}
