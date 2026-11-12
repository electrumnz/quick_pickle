"use server";

import { parsePercent } from "@/lib/backstage/plans/budget";
import {
  COMPLIANCE_AREAS,
  COMPLIANCE_STATUSES,
  COST_BASES,
  DOCUMENT_KINDS,
} from "@/lib/backstage/plans/labels";
import {
  addComplianceItem,
  addCost,
  addQuestion,
  addTask,
  answerQuestion,
  confirmCost,
  createDocument,
  deleteCost,
  deleteDocument,
  deleteTask,
  editComplianceItem,
  editCost,
  editQuestion,
  editTask,
  finishTask,
  loadStarter,
  parkQuestion,
  reopenQuestion,
  reopenTask,
  restoreDocument,
  saveDocument,
  setComplianceStatus,
  startTask,
  updateDocument,
} from "@/lib/backstage/plans/ops";
import { formCents, formText, submit } from "@/lib/backstage/ui/submit";

/**
 * Every button in Plans. Each one runs a single operation and returns to a
 * Plans screen with a line saying what happened.
 *
 * Where to return to is always built here, from a short list of known
 * screens. Nothing a form sends is ever used as an address to send the
 * browser to.
 */

const HOME = "/backstage/plans";

/** One of a fixed list, or the fallback. */
function oneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((item) => item === value) ?? fallback;
}

/** One of a fixed list, or the value itself so the operation can refuse it. */
function choice<T extends string>(form: FormData, key: string): T {
  return formText(form, key) as T;
}

/** A whole number from a field, or NaN so the operation refuses it. */
function formNumber(form: FormData, key: string): number {
  const raw = formText(form, key);
  return /^\d{1,6}$/.test(raw) ? Number(raw) : Number.NaN;
}

/** An id as a path or query part. Ids are letters, digits and underscores. */
function safePart(value: string): string {
  return encodeURIComponent(value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80));
}

/* -------------------------------------------------------------- starter */

export async function loadStarterAction(form: FormData): Promise<void> {
  const restoreDeleted = formText(form, "restoreDeleted") === "true";
  await submit(
    loadStarter,
    { restoreDeleted },
    {
      back: HOME,
      done: (out) => {
        if (out.total === 0) {
          return "The starter drafts are all here already. Nothing was added.";
        }
        const parts = [
          [out.added.documents.length, "document"],
          [out.added.questions, "question"],
          [out.added.compliance, "checklist line"],
          [out.added.costs, "cost line"],
        ] as const;
        const said = parts
          .filter(([n]) => n > 0)
          .map(([n, word]) => `${String(n)} ${word}${n === 1 ? "" : "s"}`)
          .join(", ");
        return `Added ${said}. Nothing you had written was changed.`;
      },
    },
  );
}

/* ------------------------------------------------------------ documents */

const docPath = (slug: string) => `${HOME}/docs/${safePart(slug)}`;

export async function createDocumentAction(form: FormData): Promise<void> {
  await submit(
    createDocument,
    {
      title: formText(form, "title"),
      kind: choice<(typeof DOCUMENT_KINDS)[number]>(form, "kind"),
      summary: formText(form, "summary"),
    },
    {
      back: `${HOME}/docs/new`,
      to: (out) => `${docPath(out.slug)}/edit`,
      done: "Started. Write it below, then save.",
    },
  );
}

export async function saveDocumentAction(form: FormData): Promise<void> {
  const slug = formText(form, "slug");
  const body = form.get("body");
  const basedOn = formText(form, "basedOn");
  await submit(
    saveDocument,
    {
      slug,
      title: formText(form, "title"),
      body: typeof body === "string" ? body : "",
      note: formText(form, "note"),
      basedOn: basedOn === "" ? undefined : basedOn,
    },
    {
      back: `${docPath(slug)}/edit`,
      to: docPath(slug),
      done: (out) =>
        !out.changed
          ? "Nothing had changed, so nothing was saved."
          : out.overlapped
            ? "Saved. Someone else saved this document while you were writing. Both versions are in the history."
            : "Saved.",
    },
  );
}

export async function restoreDocumentAction(form: FormData): Promise<void> {
  const slug = formText(form, "slug");
  await submit(
    restoreDocument,
    { slug, versionId: formText(form, "versionId") },
    {
      back: `${docPath(slug)}/history`,
      to: docPath(slug),
      done: (out) =>
        out.changed
          ? "Put back. The version it replaced is still in the history."
          : "The document already says exactly that.",
    },
  );
}

export async function updateDocumentAction(form: FormData): Promise<void> {
  const slug = formText(form, "slug");
  await submit(
    updateDocument,
    {
      slug,
      kind: choice<(typeof DOCUMENT_KINDS)[number]>(form, "kind"),
      summary: formText(form, "summary"),
      sort: formNumber(form, "sort"),
    },
    { back: docPath(slug), done: "Saved." },
  );
}

export async function deleteDocumentAction(form: FormData): Promise<void> {
  const slug = formText(form, "slug");
  await submit(
    deleteDocument,
    { slug },
    { back: docPath(slug), to: HOME, done: "Document deleted." },
  );
}

/* ------------------------------------------------------------ questions */

const QUESTION_VIEWS = ["open", "answered", "parked", "all"] as const;

/** Back to the questions list, on the same tab and near the same topic. */
function questionsPath(form: FormData): string {
  const view = oneOf(formText(form, "view"), QUESTION_VIEWS, "open");
  const at = safePart(formText(form, "at"));
  const blocking = formText(form, "blocking") === "1" ? "&blocking=1" : "";
  return `${HOME}/questions?status=${view}${blocking}${at === "" ? "" : `&at=${at}#t-${at}`}`;
}

export async function addQuestionAction(form: FormData): Promise<void> {
  await submit(
    addQuestion,
    {
      topic: formText(form, "topic"),
      question: formText(form, "question"),
      why: formText(form, "why"),
      askOf: formText(form, "askOf"),
      blocksLaunch: formText(form, "blocksLaunch") === "on",
    },
    { back: `${HOME}/questions?status=open`, done: "Question added." },
  );
}

export async function answerQuestionAction(form: FormData): Promise<void> {
  await submit(
    answerQuestion,
    { id: formText(form, "id"), answer: formText(form, "answer") },
    { back: questionsPath(form), done: "Answered." },
  );
}

export async function parkQuestionAction(form: FormData): Promise<void> {
  await submit(
    parkQuestion,
    { id: formText(form, "id") },
    { back: questionsPath(form), done: "Parked. It is under Parked now." },
  );
}

export async function reopenQuestionAction(form: FormData): Promise<void> {
  await submit(
    reopenQuestion,
    { id: formText(form, "id") },
    { back: questionsPath(form), done: "Reopened. It is under Open again." },
  );
}

export async function editQuestionAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  await submit(
    editQuestion,
    {
      id,
      topic: formText(form, "topic"),
      question: formText(form, "question"),
      why: formText(form, "why"),
      askOf: formText(form, "askOf"),
      blocksLaunch: formText(form, "blocksLaunch") === "on",
    },
    {
      back: `${HOME}/questions?status=all&edit=${safePart(id)}#edit`,
      to: questionsPath(form),
      done: "Question updated.",
    },
  );
}

/* ---------------------------------------------------------------- tasks */

const TASK_VIEWS = ["open", "done", "all"] as const;

/** Back to the task list, keeping the tab and what the list is about. */
function tasksPath(form: FormData): string {
  const view = oneOf(formText(form, "view"), TASK_VIEWS, "open");
  const entityType = safePart(formText(form, "aboutType"));
  const entityId = safePart(formText(form, "aboutId"));
  const about =
    entityType === "" || entityId === ""
      ? ""
      : `&entityType=${entityType}&entityId=${entityId}`;
  return `${HOME}/tasks?status=${view}${about}`;
}

export async function addTaskAction(form: FormData): Promise<void> {
  const dueOn = formText(form, "dueOn");
  const assigneeId = formText(form, "assigneeId");
  const entityType = formText(form, "aboutType");
  const entityId = formText(form, "aboutId");
  await submit(
    addTask,
    {
      title: formText(form, "title"),
      notes: formText(form, "notes"),
      dueOn: dueOn === "" ? undefined : dueOn,
      assigneeId: assigneeId === "" ? undefined : assigneeId,
      area: formText(form, "area"),
      entityType: entityType === "" ? undefined : entityType,
      entityId: entityId === "" ? undefined : entityId,
    },
    { back: tasksPath(form), done: "Task added." },
  );
}

export async function editTaskAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  const dueOn = formText(form, "dueOn");
  const assigneeId = formText(form, "assigneeId");
  await submit(
    editTask,
    {
      id,
      title: formText(form, "title"),
      notes: formText(form, "notes"),
      dueOn: dueOn === "" ? null : dueOn,
      assigneeId: assigneeId === "" ? null : assigneeId,
      area: formText(form, "area"),
    },
    {
      back: `${tasksPath(form)}&edit=${safePart(id)}#edit`,
      to: tasksPath(form),
      done: "Task updated.",
    },
  );
}

export async function startTaskAction(form: FormData): Promise<void> {
  await submit(
    startTask,
    { id: formText(form, "id") },
    { back: tasksPath(form), done: "Started." },
  );
}

export async function finishTaskAction(form: FormData): Promise<void> {
  await submit(
    finishTask,
    { id: formText(form, "id") },
    { back: tasksPath(form), done: "Done. It is under Done now." },
  );
}

export async function reopenTaskAction(form: FormData): Promise<void> {
  await submit(
    reopenTask,
    { id: formText(form, "id") },
    { back: tasksPath(form), done: "Back on the to-do list." },
  );
}

export async function deleteTaskAction(form: FormData): Promise<void> {
  await submit(
    deleteTask,
    { id: formText(form, "id") },
    { back: tasksPath(form), done: "Task deleted." },
  );
}

/* ----------------------------------------------------------- compliance */

/** Back to the checklist, at the line that was changed. */
function compliancePath(id: string): string {
  const at = safePart(id);
  return `${HOME}/compliance${at === "" ? "" : `?at=${at}#c-${at}`}`;
}

export async function addComplianceAction(form: FormData): Promise<void> {
  await submit(
    addComplianceItem,
    {
      area: choice<(typeof COMPLIANCE_AREAS)[number]>(form, "area"),
      title: formText(form, "title"),
      detail: formText(form, "detail"),
      basis: formText(form, "basis"),
      status: "check",
    },
    { back: `${HOME}/compliance`, done: "Added to the checklist." },
  );
}

export async function editComplianceAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  await submit(
    editComplianceItem,
    {
      id,
      area: choice<(typeof COMPLIANCE_AREAS)[number]>(form, "area"),
      title: formText(form, "title"),
      detail: formText(form, "detail"),
      basis: formText(form, "basis"),
    },
    {
      back: `${HOME}/compliance?edit=${safePart(id)}#edit`,
      to: compliancePath(id),
      done: "Line updated.",
    },
  );
}

export async function setComplianceStatusAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  const reviewOn = formText(form, "reviewOn");
  await submit(
    setComplianceStatus,
    {
      id,
      status: choice<(typeof COMPLIANCE_STATUSES)[number]>(form, "status"),
      evidence: formText(form, "evidence"),
      reviewOn: reviewOn === "" ? null : reviewOn,
    },
    { back: compliancePath(id), done: "Updated." },
  );
}

/* ---------------------------------------------------------------- costs */

const BUDGET = `${HOME}/budget`;

/**
 * The amount field means dollars for most costs and a percentage for a share
 * of the sale. Anything unreadable becomes NaN, which the operation refuses
 * with a sentence.
 */
function costAmount(form: FormData, basis: string): number {
  if (basis === "sale") {
    return parsePercent(formText(form, "amount")) ?? Number.NaN;
  }
  return formCents(form, "amount");
}

export async function addCostAction(form: FormData): Promise<void> {
  const basis = choice<(typeof COST_BASES)[number]>(form, "basis");
  await submit(
    addCost,
    {
      name: formText(form, "name"),
      basis,
      amount: costAmount(form, basis),
      confirmed: formText(form, "confirmed") === "on",
      notes: formText(form, "notes"),
    },
    { back: `${BUDGET}#costs`, done: "Cost added." },
  );
}

export async function editCostAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  const basis = choice<(typeof COST_BASES)[number]>(form, "basis");
  await submit(
    editCost,
    {
      id,
      name: formText(form, "name"),
      basis,
      amount: costAmount(form, basis),
      confirmed: formText(form, "confirmed") === "on",
      notes: formText(form, "notes"),
    },
    {
      back: `${BUDGET}?edit=${safePart(id)}#edit`,
      to: `${BUDGET}#costs`,
      done: "Cost updated.",
    },
  );
}

export async function confirmCostAction(form: FormData): Promise<void> {
  const undo = formText(form, "undo") === "true";
  await submit(
    confirmCost,
    { id: formText(form, "id"), undo },
    {
      back: `${BUDGET}#costs`,
      done: undo ? "Marked as a stand-in again." : "Confirmed.",
    },
  );
}

export async function deleteCostAction(form: FormData): Promise<void> {
  await submit(
    deleteCost,
    { id: formText(form, "id") },
    { back: `${BUDGET}#costs`, done: "Cost deleted." },
  );
}
