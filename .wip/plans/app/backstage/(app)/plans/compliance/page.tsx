import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Empty, PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { formatDateKey } from "@/lib/backstage/plans/dates";
import {
  COMPLIANCE_AREA_BLURB,
  COMPLIANCE_AREA_LABEL,
  COMPLIANCE_AREAS,
  COMPLIANCE_STATUS_LABEL,
  COMPLIANCE_STATUSES,
} from "@/lib/backstage/plans/labels";
import {
  getComplianceItem,
  listCompliance,
  listTasks,
  type ComplianceRow,
} from "@/lib/backstage/plans/ops";
import { countOf } from "@/lib/backstage/plans/shared";

import {
  addComplianceAction,
  editComplianceAction,
  setComplianceStatusAction,
} from "../actions";
import { CompliancePill, Flash, Hint, PlansNav, Reveal } from "../parts";

export const metadata: Metadata = { title: "Compliance" };

const HERE = "/backstage/plans/compliance";

/**
 * The compliance checklist: a short list of things for the owner to look
 * into, each with the body to ask. It records what she finds. It does not
 * interpret the law, and it says so at the top.
 */
export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{
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

  const [items, linked] = await Promise.all([
    execute(listCompliance, {}, caller),
    execute(
      listTasks,
      { status: "open", entityType: "compliance_item", limit: 500 },
      caller,
    ),
  ]);
  const openTasks = new Map<string, number>();
  for (const task of linked) {
    if (task.entityId !== null) {
      openTasks.set(task.entityId, (openTasks.get(task.entityId) ?? 0) + 1);
    }
  }

  let editing: ComplianceRow | null = null;
  if (canWrite && params.edit !== undefined && params.edit !== "") {
    try {
      editing = await execute(getComplianceItem, { id: params.edit }, caller);
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
    }
  }

  const waiting = items.filter(
    (item) => item.status === "to-do" || item.status === "check",
  ).length;
  const settled = items.length - waiting;
  const reviews = items.filter((item) => item.reviewDue).length;
  const noticeAt = items.some((item) => item.id === params.at)
    ? params.at
    : undefined;

  return (
    <>
      <PageHeader
        title="Compliance"
        back={{ href: "/backstage/plans", label: "Plans" }}
        lead="A short list of things to look into, for a small business selling a packaged food online in New Zealand."
      />
      <PlansNav current="compliance" />

      <p className="bk-notice mb-4">
        <strong>This is a checklist, not legal advice.</strong> Work through it
        with each body&apos;s own guidance, and with a lawyer or accountant
        where it says so. Nothing on it is settled until someone has checked it
        and written down what they found. Every line is New Zealand&apos;s:
        selling in another country would need its own list.
      </p>
      {noticeAt === undefined ? (
        <Flash notice={params.notice} tone={params.tone} />
      ) : null}

      {items.length === 0 ? null : (
        <p className="mb-5 leading-snug">
          {waiting === 0
            ? "Every line has been looked at."
            : `${countOf(waiting, "line")} still to look at.`}{" "}
          {settled > 0 ? `${String(settled)} settled. ` : ""}
          {reviews > 0 ? `${countOf(reviews, "line")} due another look.` : ""}
        </p>
      )}

      {editing !== null ? (
        <Panel title="Change the wording" className="mb-6">
          <form
            id="edit"
            action={editComplianceAction}
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <input type="hidden" name="id" value={editing.id} />
            <div>
              <label htmlFor="edit-area" className="field-label">
                Area
              </label>
              <select
                id="edit-area"
                name="area"
                defaultValue={editing.area}
                className="field"
              >
                {COMPLIANCE_AREAS.map((area) => (
                  <option key={area} value={area}>
                    {COMPLIANCE_AREA_LABEL[area]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="edit-title" className="field-label">
                What it is
              </label>
              <input
                id="edit-title"
                name="title"
                required
                maxLength={160}
                defaultValue={editing.title}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="edit-detail" className="field-label">
                What to check
              </label>
              <textarea
                id="edit-detail"
                name="detail"
                rows={3}
                maxLength={2000}
                defaultValue={editing.detail}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="edit-basis" className="field-label">
                Where it comes from, and who to ask
              </label>
              <input
                id="edit-basis"
                name="basis"
                maxLength={300}
                defaultValue={editing.basis}
                className="field"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton pending="Saving">Save the wording</SubmitButton>
              <Link href={HERE} className="bk-btn bk-btn-quiet">
                <span className="cap-trim">Cancel</span>
              </Link>
            </div>
          </form>
        </Panel>
      ) : null}

      {items.length === 0 ? (
        <Panel>
          <Empty title="Nothing on the list">
            The things a food business has to have looked at are kept here, each
            with the body to ask.
            {canWrite ? " Add the first line below." : ""}
          </Empty>
        </Panel>
      ) : (
        <div className="flex flex-col gap-6">
          {COMPLIANCE_AREAS.map((area) => {
            const inArea = items.filter((item) => item.area === area);
            if (inArea.length === 0) return null;
            return (
              <Panel key={area} title={COMPLIANCE_AREA_LABEL[area]} flush>
                <p className="bk-muted border-navy-line border-b px-4 py-2 text-[0.9375rem]">
                  {COMPLIANCE_AREA_BLURB[area]}
                </p>
                <ul className="bk-rows">
                  {inArea.map((item) => {
                    const tasks = openTasks.get(item.id) ?? 0;
                    const taskHref = `/backstage/plans/tasks?entityType=compliance_item&entityId=${item.id}&title=${encodeURIComponent(`Check: ${item.title}`)}`;
                    return (
                      <li
                        key={item.id}
                        id={`c-${item.id}`}
                        className="bk-row scroll-mt-24 grid-cols-1"
                      >
                        {noticeAt === item.id ? (
                          <Flash notice={params.notice} tone={params.tone} />
                        ) : null}
                        <p className="flex flex-wrap items-center gap-2">
                          <span
                            id={`ct-${item.id}`}
                            className="leading-snug font-semibold"
                          >
                            {item.title}
                          </span>
                          <CompliancePill status={item.status} />
                          {item.reviewDue ? (
                            <Pill tone="todo">Look again</Pill>
                          ) : null}
                        </p>
                        {item.detail === "" ? null : (
                          <p className="leading-snug">{item.detail}</p>
                        )}
                        {item.basis === "" ? null : (
                          <p className="bk-muted text-[0.9375rem] leading-snug">
                            {item.basis}
                          </p>
                        )}
                        {item.evidence === "" ? null : (
                          <p className="bk-notice mt-1 text-[0.9375rem] whitespace-pre-wrap">
                            <span className="font-semibold">Noted: </span>
                            {item.evidence}
                          </p>
                        )}
                        {item.reviewOn === null ? null : (
                          <p className="bk-muted text-[0.875rem]">
                            To look at again on {formatDateKey(item.reviewOn)}
                          </p>
                        )}

                        {/* One row of quiet controls. Opening "Update" gives
                            its form the whole width and pushes the links
                            beside it down a line. */}
                        <div className="flex flex-wrap items-start gap-x-5">
                          {canWrite ? (
                            <details className="open:basis-full">
                              <Reveal>
                                Update
                                <span className="sr-only">: {item.title}</span>
                              </Reveal>
                              <form
                                action={setComplianceStatusAction}
                                className="mt-1 mb-3 flex flex-col gap-3"
                              >
                                <input
                                  type="hidden"
                                  name="id"
                                  value={item.id}
                                />
                                <div>
                                  <label
                                    htmlFor={`st-${item.id}`}
                                    className="field-label"
                                  >
                                    Where it stands
                                  </label>
                                  <select
                                    id={`st-${item.id}`}
                                    name="status"
                                    defaultValue={item.status}
                                    className="field"
                                  >
                                    {COMPLIANCE_STATUSES.map((status) => (
                                      <option key={status} value={status}>
                                        {COMPLIANCE_STATUS_LABEL[status]}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label
                                    htmlFor={`ev-${item.id}`}
                                    className="field-label"
                                  >
                                    What you found
                                  </label>
                                  <textarea
                                    id={`ev-${item.id}`}
                                    name="evidence"
                                    rows={2}
                                    maxLength={1000}
                                    defaultValue={item.evidence}
                                    aria-describedby={`evh-${item.id}`}
                                    className="field"
                                  />
                                  <Hint id={`evh-${item.id}`}>
                                    What shows it is in place (a number, a file,
                                    a date), or why it is not needed. Needed for
                                    either of those.
                                  </Hint>
                                </div>
                                <div>
                                  <label
                                    htmlFor={`rv-${item.id}`}
                                    className="field-label"
                                  >
                                    Look again on
                                  </label>
                                  <input
                                    id={`rv-${item.id}`}
                                    name="reviewOn"
                                    type="date"
                                    defaultValue={item.reviewOn ?? ""}
                                    className="field"
                                  />
                                </div>
                                <div>
                                  <SubmitButton
                                    pending="Saving"
                                    className="bk-btn bk-btn-quiet"
                                  >
                                    Save
                                  </SubmitButton>
                                </div>
                              </form>
                            </details>
                          ) : null}
                          {tasks > 0 ? (
                            <Link
                              href={`/backstage/plans/tasks?entityType=compliance_item&entityId=${item.id}`}
                              aria-describedby={`ct-${item.id}`}
                              className="label bk-muted inline-flex min-h-11 items-center text-[1.05rem]"
                            >
                              <span className="cap-trim">
                                {countOf(tasks, "task")} open
                              </span>
                            </Link>
                          ) : null}
                          {canWrite ? (
                            <>
                              <Link
                                href={taskHref}
                                aria-describedby={`ct-${item.id}`}
                                className="label bk-muted inline-flex min-h-11 items-center text-[1.05rem]"
                              >
                                <span className="cap-trim">
                                  Give it to someone
                                </span>
                              </Link>
                              <Link
                                href={`${HERE}?edit=${item.id}#edit`}
                                aria-describedby={`ct-${item.id}`}
                                className="label bk-muted inline-flex min-h-11 items-center text-[1.05rem]"
                              >
                                <span className="cap-trim">
                                  Change the wording
                                </span>
                              </Link>
                            </>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}

      {canWrite ? (
        <details className="mt-6">
          <Reveal>Add a line</Reveal>
          <form
            action={addComplianceAction}
            className="mt-2 flex max-w-[40rem] flex-col gap-3"
          >
            <div>
              <label htmlFor="new-area" className="field-label">
                Area
              </label>
              <select id="new-area" name="area" className="field">
                {COMPLIANCE_AREAS.map((area) => (
                  <option key={area} value={area}>
                    {COMPLIANCE_AREA_LABEL[area]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="new-title" className="field-label">
                What it is
              </label>
              <input
                id="new-title"
                name="title"
                required
                maxLength={160}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="new-detail" className="field-label">
                What to check
              </label>
              <textarea
                id="new-detail"
                name="detail"
                rows={2}
                maxLength={2000}
                aria-describedby="new-detail-hint"
                className="field"
              />
              <Hint id="new-detail-hint">
                One line, in plain words. If you are not sure what the rule
                says, write it as something to check.
              </Hint>
            </div>
            <div>
              <label htmlFor="new-basis" className="field-label">
                Where it comes from, and who to ask
              </label>
              <input
                id="new-basis"
                name="basis"
                maxLength={300}
                className="field"
              />
            </div>
            <div>
              <SubmitButton pending="Adding">Add to the checklist</SubmitButton>
            </div>
          </form>
        </details>
      ) : null}
    </>
  );
}
