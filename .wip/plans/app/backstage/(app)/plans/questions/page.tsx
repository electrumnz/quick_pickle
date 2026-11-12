import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Empty, PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  getQuestion,
  listQuestions,
  overview,
  slugify,
  type QuestionRow,
} from "@/lib/backstage/plans/ops";
import { countOf } from "@/lib/backstage/plans/shared";
import { formatNzDate } from "@/lib/time";

import {
  addQuestionAction,
  answerQuestionAction,
  editQuestionAction,
  parkQuestionAction,
  reopenQuestionAction,
} from "../actions";
import { Flash, Hint, PlansNav, Reveal } from "../parts";

export const metadata: Metadata = { title: "Questions" };

const HERE = "/backstage/plans/questions";

const TABS = [
  { key: "open", label: "Open" },
  { key: "answered", label: "Answered" },
  { key: "parked", label: "Parked" },
  { key: "all", label: "All" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type Group = {
  readonly topic: string;
  readonly slug: string;
  readonly rows: QuestionRow[];
};

/** Questions by topic, topics in the order of their first question. */
function byTopic(rows: readonly QuestionRow[]): Group[] {
  const groups = new Map<string, Group & { first: number }>();
  for (const row of rows) {
    const group = groups.get(row.topic);
    if (group === undefined) {
      groups.set(row.topic, {
        topic: row.topic,
        slug: slugify(row.topic),
        rows: [row],
        first: row.sort,
      });
    } else {
      group.rows.push(row);
      group.first = Math.min(group.first, row.sort);
    }
  }
  return [...groups.values()].sort((a, b) => a.first - b.first);
}

/** The fields every button on a question sends, so it returns to this view. */
function Where({
  id,
  view,
  blocking,
  at,
}: {
  readonly id: string;
  readonly view: TabKey;
  readonly blocking: boolean;
  readonly at: string;
}) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="at" value={at} />
      {blocking ? <input type="hidden" name="blocking" value="1" /> : null}
    </>
  );
}

/**
 * The questions only a person can answer, grouped by topic. Each open one has
 * its answer box right under it, so answering is one thumb and one press.
 */
export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    blocking?: string;
    at?: string;
    edit?: string;
    notice?: string;
    tone?: string;
  }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const caller = await staffCaller();
  const canWrite = staff.role !== "viewer";
  const view: TabKey =
    TABS.find((tab) => tab.key === params.status)?.key ?? "open";
  const blocking = params.blocking === "1";

  const [rows, summary] = await Promise.all([
    execute(
      listQuestions,
      { status: view, blocksLaunch: blocking ? true : undefined },
      caller,
    ),
    execute(overview, {}, caller),
  ]);
  const groups = byTopic(rows);
  const counts = summary.questions;
  const total = counts.open + counts.answered + counts.parked;
  const countFor = (key: TabKey) => (key === "all" ? total : counts[key]);
  const noticeAt = groups.some((group) => group.slug === params.at)
    ? params.at
    : undefined;

  let editing: QuestionRow | null = null;
  if (canWrite && params.edit !== undefined && params.edit !== "") {
    try {
      editing = await execute(getQuestion, { id: params.edit }, caller);
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
    }
  }
  const topics = [...new Set(rows.map((row) => row.topic))];
  const tabHref = (key: TabKey, only: boolean) =>
    `${HERE}?status=${key}${only ? "&blocking=1" : ""}`;

  return (
    <>
      <PageHeader
        title="Questions"
        back={{ href: "/backstage/plans", label: "Plans" }}
        lead={
          counts.open === 0
            ? "Nothing is waiting on an answer."
            : `${countOf(counts.open, "question")} open. ${
                counts.blocking === 0
                  ? "None of them holds up launch."
                  : `${String(counts.blocking)} of them ${counts.blocking === 1 ? "holds" : "hold"} up launch.`
              }`
        }
      />
      <PlansNav current="questions" />
      {noticeAt === undefined ? (
        <Flash notice={params.notice} tone={params.tone} />
      ) : null}

      <nav aria-label="Which questions" className="mb-3">
        <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {TABS.map((tab) => (
            <li key={tab.key} className="shrink-0">
              <Link
                href={tabHref(tab.key, false)}
                aria-current={tab.key === view ? "page" : undefined}
                className={`bk-btn ${tab.key === view ? "" : "bk-btn-quiet"}`}
              >
                <span className="cap-trim">
                  {tab.label} {countFor(tab.key)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {view === "open" && counts.blocking > 0 ? (
        <p className="mb-4">
          <Link href={tabHref("open", !blocking)} className="link">
            {blocking
              ? "Show every open question"
              : `Show only the ${String(counts.blocking)} holding up launch`}
          </Link>
        </p>
      ) : null}

      {editing !== null ? (
        <Panel title="Change the wording" className="mb-6">
          <form
            id="edit"
            action={editQuestionAction}
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <Where
              id={editing.id}
              view={view}
              blocking={blocking}
              at={slugify(editing.topic)}
            />
            <div>
              <label htmlFor="edit-topic" className="field-label">
                Topic
              </label>
              <input
                id="edit-topic"
                name="topic"
                required
                maxLength={60}
                defaultValue={editing.topic}
                list="topics"
                className="field"
              />
            </div>
            <div>
              <label htmlFor="edit-question" className="field-label">
                The question
              </label>
              <textarea
                id="edit-question"
                name="question"
                required
                rows={3}
                maxLength={500}
                defaultValue={editing.question}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="edit-why" className="field-label">
                Why it matters
              </label>
              <textarea
                id="edit-why"
                name="why"
                rows={3}
                maxLength={1000}
                defaultValue={editing.why}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="edit-askOf" className="field-label">
                Who can answer it
              </label>
              <input
                id="edit-askOf"
                name="askOf"
                maxLength={80}
                defaultValue={editing.askOf}
                className="field"
              />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                name="blocksLaunch"
                defaultChecked={editing.blocksLaunch}
                className="accent-navy size-5 shrink-0"
              />
              <span>The site cannot take money until this is answered</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton pending="Saving">Save the wording</SubmitButton>
              <Link
                href={tabHref(view, blocking)}
                className="bk-btn bk-btn-quiet"
              >
                <span className="cap-trim">Cancel</span>
              </Link>
            </div>
          </form>
        </Panel>
      ) : null}

      {groups.length === 0 ? (
        <Panel>
          <Empty
            title={
              view === "open"
                ? "Nothing open"
                : view === "all"
                  ? "No questions yet"
                  : "Nothing here"
            }
          >
            {view === "open"
              ? total === 0
                ? "Questions that only a person can answer are kept here, with what each one holds up."
                : "Every question has been answered or parked."
              : view === "answered"
                ? "Answered questions are kept here, with who answered and when."
                : view === "parked"
                  ? "A parked question is one set aside for now. It can be reopened at any time."
                  : "Add the first one below."}
          </Empty>
        </Panel>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <div
              key={group.topic}
              id={`t-${group.slug}`}
              className="scroll-mt-24"
            >
              {noticeAt === group.slug ? (
                <Flash notice={params.notice} tone={params.tone} />
              ) : null}
              <Panel
                title={group.topic}
                flush
                aside={
                  <span className="bk-muted text-[0.9375rem]">
                    {group.rows.length}
                  </span>
                }
              >
                <ul className="bk-rows">
                  {group.rows.map((question) => (
                    <li
                      key={question.id}
                      id={`q-${question.id}`}
                      className="bk-row scroll-mt-24 grid-cols-1"
                    >
                      {question.blocksLaunch || question.status !== "open" ? (
                        <p className="flex flex-wrap items-center gap-2">
                          {question.blocksLaunch &&
                          question.status !== "answered" ? (
                            <Pill tone="todo">Holding up launch</Pill>
                          ) : null}
                          {question.status === "answered" ? (
                            <Pill tone="done">Answered</Pill>
                          ) : null}
                          {question.status === "parked" ? (
                            <Pill tone="off">Parked</Pill>
                          ) : null}
                        </p>
                      ) : null}
                      <p
                        id={`qt-${question.id}`}
                        className="leading-snug font-semibold"
                      >
                        {question.question}
                      </p>
                      {question.why === "" ? null : (
                        <p className="bk-muted text-[0.9375rem] leading-snug">
                          {question.why}
                        </p>
                      )}
                      <p className="bk-muted text-[0.875rem] leading-snug">
                        Ask: {question.askOf}
                        {question.source === ""
                          ? ""
                          : ` · From: ${question.source}`}
                      </p>

                      {question.status === "answered" ? (
                        <div className="mt-1">
                          <p className="bk-notice whitespace-pre-wrap">
                            {question.answer}
                          </p>
                          <p className="bk-muted mt-1.5 text-[0.875rem]">
                            Answered
                            {question.answeredAt === null
                              ? ""
                              : ` ${formatNzDate(question.answeredAt)}`}
                            {question.answeredByName === null
                              ? ""
                              : ` by ${question.answeredByName}`}
                          </p>
                        </div>
                      ) : null}

                      {canWrite && question.status === "open" ? (
                        <form
                          action={answerQuestionAction}
                          className="mt-1 flex flex-col gap-2"
                        >
                          <Where
                            id={question.id}
                            view={view}
                            blocking={blocking}
                            at={group.slug}
                          />
                          <label
                            id={`al-${question.id}`}
                            htmlFor={`a-${question.id}`}
                            className="field-label"
                          >
                            Answer
                          </label>
                          <textarea
                            id={`a-${question.id}`}
                            name="answer"
                            required
                            rows={2}
                            maxLength={4000}
                            defaultValue={question.answer}
                            aria-labelledby={`al-${question.id} qt-${question.id}`}
                            aria-describedby={
                              question.answer === ""
                                ? undefined
                                : `h-${question.id}`
                            }
                            className="field"
                          />
                          {question.answer === "" ? null : (
                            <Hint id={`h-${question.id}`}>
                              The earlier answer is in the box. Change it, or
                              save it again as it is.
                            </Hint>
                          )}
                          <div>
                            <SubmitButton pending="Saving">
                              Save answer
                            </SubmitButton>
                          </div>
                        </form>
                      ) : null}

                      {canWrite ? (
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                          {question.status === "open" ? (
                            <form action={parkQuestionAction}>
                              <Where
                                id={question.id}
                                view={view}
                                blocking={blocking}
                                at={group.slug}
                              />
                              <button
                                type="submit"
                                aria-describedby={`qt-${question.id}`}
                                className="label bk-muted inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]"
                              >
                                <span className="cap-trim">Park it</span>
                              </button>
                            </form>
                          ) : (
                            <form action={reopenQuestionAction}>
                              <Where
                                id={question.id}
                                view={view}
                                blocking={blocking}
                                at={group.slug}
                              />
                              <button
                                type="submit"
                                aria-describedby={`qt-${question.id}`}
                                className="label bk-muted inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]"
                              >
                                <span className="cap-trim">Reopen</span>
                              </button>
                            </form>
                          )}
                          <Link
                            href={`${tabHref(view, blocking)}&edit=${question.id}#edit`}
                            aria-describedby={`qt-${question.id}`}
                            className="label bk-muted inline-flex min-h-11 items-center text-[1.05rem]"
                          >
                            <span className="cap-trim">Change the wording</span>
                          </Link>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          ))}
        </div>
      )}

      {canWrite ? (
        <details className="mt-6">
          <Reveal>Add a question</Reveal>
          <form
            action={addQuestionAction}
            className="mt-2 flex max-w-[40rem] flex-col gap-3"
          >
            <div>
              <label htmlFor="new-topic" className="field-label">
                Topic
              </label>
              <input
                id="new-topic"
                name="topic"
                required
                maxLength={60}
                list="topics"
                aria-describedby="new-topic-hint"
                className="field"
              />
              <Hint id="new-topic-hint">
                Questions are grouped by topic. Use one that is already here if
                it fits.
              </Hint>
            </div>
            <div>
              <label htmlFor="new-question" className="field-label">
                The question
              </label>
              <textarea
                id="new-question"
                name="question"
                required
                rows={3}
                maxLength={500}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="new-why" className="field-label">
                Why it matters
              </label>
              <textarea
                id="new-why"
                name="why"
                rows={2}
                maxLength={1000}
                aria-describedby="new-why-hint"
                className="field"
              />
              <Hint id="new-why-hint">What waits on the answer.</Hint>
            </div>
            <div>
              <label htmlFor="new-askOf" className="field-label">
                Who can answer it
              </label>
              <input
                id="new-askOf"
                name="askOf"
                maxLength={80}
                defaultValue="Ashleigh"
                className="field"
              />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                name="blocksLaunch"
                className="accent-navy size-5 shrink-0"
              />
              <span>The site cannot take money until this is answered</span>
            </label>
            <div>
              <SubmitButton pending="Adding">Add the question</SubmitButton>
            </div>
          </form>
        </details>
      ) : null}

      <datalist id="topics">
        {topics.map((topic) => (
          <option key={topic} value={topic} />
        ))}
      </datalist>
    </>
  );
}
