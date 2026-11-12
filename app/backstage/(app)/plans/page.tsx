import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  Empty,
  PageHeader,
  Panel,
  Pill,
  Stat,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { describeDue } from "@/lib/backstage/plans/dates";
import {
  COMPLIANCE_AREA_LABEL,
  COMPLIANCE_OPEN,
  DOCUMENT_KINDS,
  KIND_BLURB,
  KIND_HEADING,
} from "@/lib/backstage/plans/labels";
import {
  listCompliance,
  listDocuments,
  listQuestions,
  listTasks,
  overview,
} from "@/lib/backstage/plans/ops";
import { countOf } from "@/lib/backstage/plans/shared";
import { addDays, formatNzDate, nzDateKey } from "@/lib/time";

import { loadStarterAction } from "./actions";
import { CompliancePill, Flash, PlansNav, Reveal, TaskPill } from "./parts";

export const metadata: Metadata = { title: "Plans" };

/**
 * Plans, at a glance: what is holding up launch, what is due, what still
 * needs checking, and then the documents themselves.
 */
export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const now = new Date();
  const canWrite = staff.role !== "viewer";
  const isOwner = staff.role === "owner";

  const [summary, blocking, due, register, docs] = await Promise.all([
    execute(overview, {}, caller),
    execute(
      listQuestions,
      { status: "open", blocksLaunch: true, limit: 6 },
      caller,
    ),
    execute(
      listTasks,
      { status: "open", dueBy: addDays(nzDateKey(now), 7), limit: 6 },
      caller,
    ),
    execute(listCompliance, {}, caller),
    execute(listDocuments, {}, caller),
  ]);
  const toCheck = register.filter((item) =>
    COMPLIANCE_OPEN.includes(item.status),
  );
  const { starter } = summary;

  return (
    <>
      <PageHeader
        title="Plans"
        lead="The thinking behind the business: what is decided, what is not, and what to do next."
        actions={
          canWrite ? (
            <Link href="/backstage/plans/docs/new" className="bk-btn">
              <span className="cap-trim">New document</span>
            </Link>
          ) : null
        }
      />
      <Flash notice={notice} tone={tone} />

      {starter.notLoaded > 0 ? (
        <Panel title="Starter drafts" className="mb-5">
          <p className="leading-snug">
            {countOf(starter.notLoaded, "starter draft")}{" "}
            {starter.notLoaded === 1 ? "is" : "are"} ready to load: plans,
            how-to sheets, policies, the questions only a person can answer, a
            short compliance checklist and the budget&apos;s empty cost lines.
            Loading only adds what is not here. It never changes anything
            already written.
          </p>
          {isOwner ? (
            <form action={loadStarterAction} className="mt-4">
              <SubmitButton pending="Loading">
                Load the starter drafts
              </SubmitButton>
            </form>
          ) : (
            <p className="bk-muted mt-3 leading-snug">
              An owner can load them.
            </p>
          )}
        </Panel>
      ) : null}

      <PlansNav current="overview" />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Stat
          label="Holding up launch"
          value={summary.questions.blocking}
          note={`${countOf(summary.questions.open, "question")} open in all`}
        />
        <Stat
          label="Tasks due"
          value={summary.tasks.dueSoon}
          note={
            summary.tasks.overdue > 0
              ? `${String(summary.tasks.overdue)} overdue`
              : "In the next week"
          }
        />
        <Stat
          label="To check"
          value={summary.compliance["to-do"] + summary.compliance.check}
          note="On the compliance checklist"
        />
        <Stat
          label="Costs to confirm"
          value={summary.costs.unconfirmed}
          note={`Of ${String(summary.costs.total)} on the budget`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel
            title="Holding up launch"
            flush
            aside={
              <Link
                href="/backstage/plans/questions"
                className="link text-[0.9375rem]"
              >
                All questions
              </Link>
            }
          >
            {blocking.length === 0 ? (
              <Empty title="Nothing in the way">
                {summary.questions.open === 0
                  ? "There are no open questions."
                  : "No open question is holding up launch."}
              </Empty>
            ) : (
              <ul className="bk-rows">
                {blocking.map((question) => (
                  <li key={question.id}>
                    <Link
                      href={`/backstage/plans/questions?status=open&blocking=1#q-${question.id}`}
                      className="bk-row grid-cols-1"
                    >
                      <span className="leading-snug font-semibold">
                        {question.question}
                      </span>
                      <span className="bk-muted text-[0.9375rem] leading-snug">
                        {question.topic} · Ask: {question.askOf}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {summary.questions.blocking > blocking.length ? (
              <p className="border-navy-line bk-muted border-t px-4 py-3 text-[0.9375rem]">
                And {summary.questions.blocking - blocking.length} more.
              </p>
            ) : null}
          </Panel>

          <Panel
            title="Tasks due"
            flush
            aside={
              <Link
                href="/backstage/plans/tasks"
                className="link text-[0.9375rem]"
              >
                All tasks
              </Link>
            }
          >
            {due.length === 0 ? (
              <Empty title="Nothing due">
                {summary.tasks.open === 0
                  ? "The to-do list is empty."
                  : "Nothing is overdue or due in the next week."}
              </Empty>
            ) : (
              <ul className="bk-rows">
                {due.map((task) => (
                  <li key={task.id}>
                    <Link
                      href={`/backstage/plans/tasks#k-${task.id}`}
                      className="bk-row grid-cols-[1fr_auto]"
                    >
                      <span className="min-w-0">
                        <span className="block leading-snug font-semibold">
                          {task.title}
                        </span>
                        <span className="bk-muted block text-[0.9375rem]">
                          {task.dueOn === null
                            ? "No date"
                            : `Due ${describeDue(task.dueOn, now)}`}
                          {task.assigneeName ? ` · ${task.assigneeName}` : ""}
                        </span>
                      </span>
                      <TaskPill
                        status={task.status}
                        overdue={task.overdue}
                        dueToday={task.dueToday}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Compliance to check"
            flush
            aside={
              <Link
                href="/backstage/plans/compliance"
                className="link text-[0.9375rem]"
              >
                The checklist
              </Link>
            }
          >
            {toCheck.length === 0 ? (
              <Empty title="All looked at">
                {register.length === 0
                  ? "The compliance checklist is empty."
                  : "Every line on the checklist is in place or not needed."}
              </Empty>
            ) : (
              <ul className="bk-rows">
                {toCheck.slice(0, 5).map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/backstage/plans/compliance#c-${item.id}`}
                      className="bk-row grid-cols-[1fr_auto]"
                    >
                      <span className="min-w-0">
                        <span className="block leading-snug font-semibold">
                          {item.title}
                        </span>
                        <span className="bk-muted block text-[0.9375rem]">
                          {COMPLIANCE_AREA_LABEL[item.area]}
                        </span>
                      </span>
                      <CompliancePill status={item.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {toCheck.length > 5 ? (
              <p className="border-navy-line bk-muted border-t px-4 py-3 text-[0.9375rem]">
                And {toCheck.length - 5} more. It is a checklist to work
                through, not legal advice.
              </p>
            ) : null}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {docs.length === 0 ? (
            <Panel title="Documents">
              <Empty title="Nothing written yet">
                Plans, how-to sheets and policies live here.
                {canWrite ? " Start one with New document." : ""}
              </Empty>
            </Panel>
          ) : (
            DOCUMENT_KINDS.map((kind) => {
              const ofKind = docs.filter((doc) => doc.kind === kind);
              if (ofKind.length === 0) return null;
              return (
                <Panel key={kind} title={KIND_HEADING[kind]} flush>
                  <p className="bk-muted border-navy-line border-b px-4 py-2 text-[0.9375rem]">
                    {KIND_BLURB[kind]}
                  </p>
                  <ul className="bk-rows">
                    {ofKind.map((doc) => (
                      <li key={doc.id}>
                        <Link
                          href={`/backstage/plans/docs/${doc.slug}`}
                          className="bk-row grid-cols-1"
                        >
                          <span className="flex flex-wrap items-center gap-2 leading-snug font-semibold">
                            {doc.title}
                            {doc.starterDraft ? (
                              <Pill tone="off">Starter draft</Pill>
                            ) : null}
                          </span>
                          {doc.summary === "" ? null : (
                            <span className="bk-muted text-[0.9375rem] leading-snug">
                              {doc.summary}
                            </span>
                          )}
                          <span className="bk-muted text-[0.875rem]">
                            Last changed {formatNzDate(doc.updatedAt)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              );
            })
          )}
        </div>
      </div>

      {isOwner && starter.notLoaded === 0 && starter.deleted > 0 ? (
        <details className="mt-6">
          <Reveal>
            {countOf(starter.deleted, "starter draft")}{" "}
            {starter.deleted === 1 ? "has" : "have"} been deleted
          </Reveal>
          <form action={loadStarterAction} className="mt-2">
            <input type="hidden" name="restoreDeleted" value="true" />
            <p className="bk-muted mb-3 max-w-[40rem] leading-snug">
              Deleted starter drafts stay deleted. If one went by mistake, this
              puts back every deleted one in its original wording. Nothing that
              is here now is changed.
            </p>
            <SubmitButton pending="Loading" className="bk-btn bk-btn-quiet">
              Put the deleted drafts back
            </SubmitButton>
          </form>
        </details>
      ) : null}
    </>
  );
}
