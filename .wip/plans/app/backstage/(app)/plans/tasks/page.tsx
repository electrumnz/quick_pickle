import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Empty, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { describeDue } from "@/lib/backstage/plans/dates";
import {
  getComplianceItem,
  getTask,
  listTaskAreas,
  listTasks,
  overview,
  type TaskRow,
} from "@/lib/backstage/plans/ops";
import { countOf } from "@/lib/backstage/plans/shared";
import { listStaff } from "@/lib/backstage/staff/ops";
import { formatNzDate } from "@/lib/time";

import {
  addTaskAction,
  deleteTaskAction,
  editTaskAction,
  finishTaskAction,
  reopenTaskAction,
  startTaskAction,
} from "../actions";
import { Flash, Hint, PlansNav, Reveal, TaskPill } from "../parts";

export const metadata: Metadata = { title: "Tasks" };

const HERE = "/backstage/plans/tasks";

const TABS = [
  { key: "open", label: "To do" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type About = { readonly type: string; readonly id: string };

/** What a task is about, said plainly. Ids are shown, not followed. */
function aboutText(task: Pick<TaskRow, "entityType" | "entityId">): string {
  if (task.entityType === null || task.entityId === null) return "";
  return `About: ${task.entityType.replace(/_/g, " ")} ${task.entityId}`;
}

/** The fields every button on a task sends, so it returns to this view. */
function Where({
  id,
  view,
  about,
}: {
  readonly id?: string;
  readonly view: TabKey;
  readonly about: About | null;
}) {
  return (
    <>
      {id === undefined ? null : <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="view" value={view} />
      {about === null ? null : (
        <>
          <input type="hidden" name="aboutType" value={about.type} />
          <input type="hidden" name="aboutId" value={about.id} />
        </>
      )}
    </>
  );
}

/**
 * The to-do list. Open tasks by due date, with a box at the top to add one.
 * A link from elsewhere can ask for the tasks about one record, and anything
 * added from that view is about the same record.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    mine?: string;
    entityType?: string;
    entityId?: string;
    title?: string;
    edit?: string;
    notice?: string;
    tone?: string;
  }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const caller = await staffCaller();
  const now = new Date();
  const canWrite = staff.role !== "viewer";
  const view: TabKey =
    TABS.find((tab) => tab.key === params.status)?.key ?? "open";
  const mine = params.mine === "1";
  const about: About | null =
    params.entityType && params.entityId
      ? { type: params.entityType, id: params.entityId }
      : null;

  let tasks: TaskRow[] = [];
  let aboutProblem = false;
  try {
    tasks = await execute(
      listTasks,
      {
        status: view,
        assigneeId: mine ? staff.id : undefined,
        entityType: about?.type,
        entityId: about?.id,
      },
      caller,
    );
  } catch (error) {
    // A mangled "about" in the address is an empty list, not a broken page.
    if (!(error instanceof OpError) || error.code !== "invalid_input") {
      throw error;
    }
    aboutProblem = true;
  }
  const [summary, people, areas] = await Promise.all([
    execute(overview, {}, caller),
    execute(listStaff, {}, caller),
    execute(listTaskAreas, {}, caller),
  ]);
  const assignable = people.filter((person) => !person.disabled);

  // The checklist is ours, so a task about one of its lines can say which.
  let aboutLabel =
    about === null
      ? ""
      : aboutText({ entityType: about.type, entityId: about.id });
  if (about !== null && about.type === "compliance_item") {
    try {
      const item = await execute(getComplianceItem, { id: about.id }, caller);
      aboutLabel = `About the checklist line: ${item.title}`;
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
    }
  }

  let editing: TaskRow | null = null;
  if (canWrite && params.edit !== undefined && params.edit !== "") {
    try {
      editing = await execute(getTask, { id: params.edit }, caller);
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
    }
  }

  const query = (key: TabKey, onlyMine: boolean) => {
    const parts = [`status=${key}`];
    if (onlyMine) parts.push("mine=1");
    if (about !== null) {
      parts.push(
        `entityType=${encodeURIComponent(about.type)}`,
        `entityId=${encodeURIComponent(about.id)}`,
      );
    }
    return `${HERE}?${parts.join("&")}`;
  };
  const counts = summary.tasks;

  return (
    <>
      <PageHeader
        title="Tasks"
        back={{ href: "/backstage/plans", label: "Plans" }}
        lead={
          counts.open === 0
            ? "Nothing on the list."
            : `${countOf(counts.open, "task")} to do${
                counts.overdue > 0 ? `, ${String(counts.overdue)} overdue` : ""
              }${counts.dueToday > 0 ? `, ${String(counts.dueToday)} due today` : ""}.`
        }
      />
      <PlansNav current="tasks" />
      <Flash notice={params.notice} tone={params.tone} />

      {about !== null ? (
        <p className="bk-notice mb-4">
          {aboutProblem
            ? "That link is not one this list understands."
            : aboutLabel}{" "}
          <Link href={HERE} className="link">
            Show every task
          </Link>
        </p>
      ) : null}

      {editing !== null ? (
        <Panel title="Change a task" className="mb-6">
          <form
            id="edit"
            action={editTaskAction}
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <Where id={editing.id} view={view} about={about} />
            <div>
              <label htmlFor="edit-title" className="field-label">
                What needs doing
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
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="edit-dueOn" className="field-label">
                  Due
                </label>
                <input
                  id="edit-dueOn"
                  name="dueOn"
                  type="date"
                  defaultValue={editing.dueOn ?? ""}
                  className="field"
                />
              </div>
              <div>
                <label htmlFor="edit-assigneeId" className="field-label">
                  Who
                </label>
                <select
                  id="edit-assigneeId"
                  name="assigneeId"
                  defaultValue={editing.assigneeId ?? ""}
                  className="field"
                >
                  <option value="">Nobody yet</option>
                  {assignable.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="edit-area" className="field-label">
                  Area
                </label>
                <input
                  id="edit-area"
                  name="area"
                  maxLength={40}
                  defaultValue={editing.area}
                  list="areas"
                  autoCapitalize="none"
                  className="field"
                />
              </div>
            </div>
            <div>
              <label htmlFor="edit-notes" className="field-label">
                Notes
              </label>
              <textarea
                id="edit-notes"
                name="notes"
                rows={3}
                maxLength={2000}
                defaultValue={editing.notes}
                className="field"
              />
            </div>
            {editing.entityType === null ? null : (
              <p className="bk-muted text-[0.9375rem]">{aboutText(editing)}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton pending="Saving">Save the task</SubmitButton>
              <Link href={query(view, mine)} className="bk-btn bk-btn-quiet">
                <span className="cap-trim">Cancel</span>
              </Link>
            </div>
          </form>
          <details className="mt-3">
            <Reveal tone="danger">Delete this task</Reveal>
            <form action={deleteTaskAction} className="mt-2">
              <Where id={editing.id} view={view} about={about} />
              <p className="mb-3 leading-snug">
                For a task added by mistake. One that has been done is better
                marked as done, so it stays on record. Deleting cannot be
                undone.
              </p>
              <SubmitButton pending="Deleting" className="bk-btn bk-btn-pink">
                Delete it for good
              </SubmitButton>
            </form>
          </details>
        </Panel>
      ) : null}

      {canWrite && editing === null ? (
        <Panel title="Add a task" className="mb-6">
          <form action={addTaskAction} className="flex flex-col gap-3">
            <Where view={view} about={about} />
            <div>
              <label htmlFor="title" className="field-label">
                What needs doing
              </label>
              <input
                id="title"
                name="title"
                required
                maxLength={160}
                defaultValue={(params.title ?? "").slice(0, 160)}
                className="field"
              />
            </div>
            {/* The extras stay folded away so adding one is a line and a
                press. They open by themselves when the task is being given
                to someone from another screen. */}
            <details open={about !== null}>
              <Reveal>A date, a person, an area or notes</Reveal>
              <div className="mt-1 flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="dueOn" className="field-label">
                      Due
                    </label>
                    <input
                      id="dueOn"
                      name="dueOn"
                      type="date"
                      className="field"
                    />
                  </div>
                  <div>
                    <label htmlFor="assigneeId" className="field-label">
                      Who
                    </label>
                    <select
                      id="assigneeId"
                      name="assigneeId"
                      defaultValue=""
                      className="field"
                    >
                      <option value="">Nobody yet</option>
                      {assignable.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="area" className="field-label">
                      Area
                    </label>
                    <input
                      id="area"
                      name="area"
                      maxLength={40}
                      list="areas"
                      autoCapitalize="none"
                      aria-describedby="area-hint"
                      className="field"
                    />
                    <Hint id="area-hint">
                      One word for the part of the business, like orders or
                      production.
                    </Hint>
                  </div>
                </div>
                <div>
                  <label htmlFor="notes" className="field-label">
                    Notes
                  </label>
                  <textarea
                    id="notes"
                    name="notes"
                    rows={3}
                    maxLength={2000}
                    className="field"
                  />
                </div>
              </div>
            </details>
            <div>
              <SubmitButton pending="Adding">Add task</SubmitButton>
            </div>
          </form>
        </Panel>
      ) : null}

      <nav aria-label="Which tasks" className="mb-4">
        <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {TABS.map((tab) => (
            <li key={tab.key} className="shrink-0">
              <Link
                href={query(tab.key, mine)}
                aria-current={tab.key === view ? "page" : undefined}
                className={`bk-btn ${tab.key === view ? "" : "bk-btn-quiet"}`}
              >
                <span className="cap-trim">
                  {tab.label}
                  {tab.key === "open" ? ` ${String(counts.open)}` : ""}
                </span>
              </Link>
            </li>
          ))}
          <li className="shrink-0">
            <Link
              href={query(view, !mine)}
              aria-current={mine ? "true" : undefined}
              className={`bk-btn ${mine ? "bk-btn-olive" : "bk-btn-quiet"}`}
            >
              <span className="cap-trim">Only mine</span>
            </Link>
          </li>
        </ul>
      </nav>

      <Panel flush>
        {tasks.length === 0 ? (
          <Empty title={view === "done" ? "Nothing done yet" : "Nothing to do"}>
            {mine
              ? "Nothing here is given to you."
              : view === "done"
                ? "Finished tasks are kept here."
                : about !== null
                  ? "No tasks about this yet."
                  : "Add the first one above."}
          </Empty>
        ) : (
          <ul className="bk-rows">
            {tasks.map((task) => {
              const facts = [
                task.status === "done"
                  ? task.doneAt === null
                    ? "Done"
                    : `Done ${formatNzDate(task.doneAt)}`
                  : task.dueOn === null
                    ? "No date"
                    : `Due ${describeDue(task.dueOn, now)}`,
                task.assigneeName ?? "Nobody yet",
                task.area,
                aboutText(task),
              ].filter((fact) => fact !== "");
              return (
                <li
                  key={task.id}
                  id={`k-${task.id}`}
                  className="bk-row scroll-mt-24 grid-cols-1 md:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span
                        id={`kt-${task.id}`}
                        className={`leading-snug font-semibold ${task.status === "done" ? "line-through" : ""}`}
                      >
                        {task.title}
                      </span>
                      <TaskPill
                        status={task.status}
                        overdue={task.overdue}
                        dueToday={task.dueToday}
                      />
                    </p>
                    <p className="bk-muted mt-0.5 text-[0.9375rem] leading-snug [overflow-wrap:anywhere]">
                      {facts.join(" · ")}
                    </p>
                    {task.notes === "" ? null : (
                      <p className="mt-1 text-[0.9375rem] leading-snug whitespace-pre-wrap">
                        {task.notes}
                      </p>
                    )}
                  </div>
                  {canWrite ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {task.status === "done" ? (
                        <form action={reopenTaskAction}>
                          <Where id={task.id} view={view} about={about} />
                          <button
                            type="submit"
                            aria-describedby={`kt-${task.id}`}
                            className="bk-btn bk-btn-quiet"
                          >
                            <span className="cap-trim">Not done after all</span>
                          </button>
                        </form>
                      ) : (
                        <>
                          <form action={finishTaskAction}>
                            <Where id={task.id} view={view} about={about} />
                            <button
                              type="submit"
                              aria-describedby={`kt-${task.id}`}
                              className="bk-btn"
                            >
                              <span className="cap-trim">Done</span>
                            </button>
                          </form>
                          {task.status === "todo" ? (
                            <form action={startTaskAction}>
                              <Where id={task.id} view={view} about={about} />
                              <button
                                type="submit"
                                aria-describedby={`kt-${task.id}`}
                                className="bk-btn bk-btn-quiet"
                              >
                                <span className="cap-trim">Start</span>
                              </button>
                            </form>
                          ) : (
                            <form action={reopenTaskAction}>
                              <Where id={task.id} view={view} about={about} />
                              <button
                                type="submit"
                                aria-describedby={`kt-${task.id}`}
                                className="bk-btn bk-btn-quiet"
                              >
                                <span className="cap-trim">Put down</span>
                              </button>
                            </form>
                          )}
                        </>
                      )}
                      <Link
                        href={`${query(view, mine)}&edit=${task.id}#edit`}
                        aria-describedby={`kt-${task.id}`}
                        className="label bk-muted inline-flex min-h-11 items-center px-1 text-[1.05rem]"
                      >
                        <span className="cap-trim">Change</span>
                      </Link>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <datalist id="areas">
        {areas.map((entry) => (
          <option key={entry.area} value={entry.area} />
        ))}
      </datalist>
    </>
  );
}
