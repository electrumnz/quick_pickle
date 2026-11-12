/**
 * The fixed lists in Plans, and what each value is called on screen. One
 * place, read by the operations (which only accept what is listed) and by the
 * screens (which only offer it).
 */

import type {
  complianceItems,
  costItems,
  DocumentKind,
  questions,
  tasks,
} from "@/db/schema";

export type { DocumentKind };
export type QuestionStatus = (typeof questions.$inferSelect)["status"];
export type TaskStatus = (typeof tasks.$inferSelect)["status"];
export type ComplianceArea = (typeof complianceItems.$inferSelect)["area"];
export type ComplianceStatus = (typeof complianceItems.$inferSelect)["status"];
export type CostBasis = (typeof costItems.$inferSelect)["basis"];

/* -------------------------------------------------------------- documents */

/** In the order they are listed. */
export const DOCUMENT_KINDS = [
  "plan",
  "how-to",
  "policy",
  "note",
] as const satisfies readonly DocumentKind[];

export const KIND_LABEL: Readonly<Record<DocumentKind, string>> = {
  plan: "Plan",
  "how-to": "How-to sheet",
  policy: "Policy",
  note: "Note",
};

export const KIND_HEADING: Readonly<Record<DocumentKind, string>> = {
  plan: "Plans",
  "how-to": "How-to sheets",
  policy: "Policies",
  note: "Notes",
};

export const KIND_BLURB: Readonly<Record<DocumentKind, string>> = {
  plan: "Where the business is going and how.",
  "how-to": "Checklists to follow on the day.",
  policy: "The rules we hold ourselves to.",
  note: "Anything else worth keeping.",
};

/** The name on a version that came from the starter drafts. */
export const STARTER_AUTHOR = "Starter content";

/* -------------------------------------------------------------- questions */

export const QUESTION_STATUSES = [
  "open",
  "answered",
  "parked",
] as const satisfies readonly QuestionStatus[];

export const QUESTION_STATUS_LABEL: Readonly<Record<QuestionStatus, string>> = {
  open: "Open",
  answered: "Answered",
  parked: "Parked",
};

/* ------------------------------------------------------------------ tasks */

export const TASK_STATUSES = [
  "todo",
  "doing",
  "done",
] as const satisfies readonly TaskStatus[];

export const TASK_STATUS_LABEL: Readonly<Record<TaskStatus, string>> = {
  todo: "To do",
  doing: "Doing",
  done: "Done",
};

/* ------------------------------------------------------------- compliance */

/** In the order the register is read. */
export const COMPLIANCE_AREAS = [
  "food",
  "label",
  "selling",
  "privacy",
  "email",
  "company",
  "tax",
] as const satisfies readonly ComplianceArea[];

export const COMPLIANCE_AREA_LABEL: Readonly<Record<ComplianceArea, string>> = {
  food: "Making food",
  label: "The label",
  selling: "Selling and advertising",
  privacy: "Privacy",
  email: "Marketing email",
  company: "The business",
  tax: "Tax",
};

export const COMPLIANCE_AREA_BLURB: Readonly<Record<ComplianceArea, string>> = {
  food: "Registration, the food plan, batch records, tracing and recall.",
  label: "What the bottle has to say, and what it must not.",
  selling: "Being straight with customers, on the site and in ads.",
  privacy: "Looking after the details customers give us.",
  email: "Who we may email, and what every email must carry.",
  company: "The legal entity, the name, the people and insurance.",
  tax: "GST, records and what the accountant needs.",
};

export const COMPLIANCE_STATUSES = [
  "to-do",
  "check",
  "in-place",
  "not-needed",
] as const satisfies readonly ComplianceStatus[];

export const COMPLIANCE_STATUS_LABEL: Readonly<
  Record<ComplianceStatus, string>
> = {
  "to-do": "To do",
  check: "To check",
  "in-place": "In place",
  "not-needed": "Not needed",
};

/** Statuses that mean somebody still has something to do. */
export const COMPLIANCE_OPEN: readonly ComplianceStatus[] = ["to-do", "check"];

/* ------------------------------------------------------------------ costs */

/** In the order the budget lists them. */
export const COST_BASES = [
  "shot",
  "pack",
  "order",
  "sale",
  "month",
] as const satisfies readonly CostBasis[];

export const COST_BASIS_LABEL: Readonly<Record<CostBasis, string>> = {
  shot: "Per shot",
  pack: "Per pack",
  order: "Per order",
  sale: "Share of each sale",
  month: "Per month",
};

export const COST_BASIS_BLURB: Readonly<Record<CostBasis, string>> = {
  shot: "Paid once for every bottle: what is in it and what it is in.",
  pack: "Paid once for every pack sold, whatever its size.",
  order: "Paid once for every order sent.",
  sale: "A percentage of everything the customer pays, delivery included.",
  month: "Paid every month whether anything sells or not.",
};
