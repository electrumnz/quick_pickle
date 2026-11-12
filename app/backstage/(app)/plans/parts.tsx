import Link from "next/link";
import type { ReactNode } from "react";

import { Notice, Pill, type PillTone } from "@/components/backstage/ui";
import {
  COMPLIANCE_STATUS_LABEL,
  type ComplianceStatus,
  type TaskStatus,
} from "@/lib/backstage/plans/labels";

/**
 * The small parts the Plans screens share: the row of links between them, the
 * line that says how the last press went, and the pills.
 */

export const PLANS_HOME = "/backstage/plans";

const SECTIONS = [
  { key: "overview", href: PLANS_HOME, label: "Overview" },
  { key: "questions", href: `${PLANS_HOME}/questions`, label: "Questions" },
  { key: "tasks", href: `${PLANS_HOME}/tasks`, label: "Tasks" },
  { key: "compliance", href: `${PLANS_HOME}/compliance`, label: "Compliance" },
  { key: "budget", href: `${PLANS_HOME}/budget`, label: "Budget" },
] as const;

export type PlansSection = (typeof SECTIONS)[number]["key"];

/** The way between the Plans screens. Scrolls sideways on a phone. */
export function PlansNav({ current }: { readonly current: PlansSection }) {
  return (
    <nav aria-label="Plans" className="bk-noprint mb-5">
      <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {SECTIONS.map((section) => (
          <li key={section.key} className="shrink-0">
            <Link
              href={section.href}
              aria-current={section.key === current ? "page" : undefined}
              className={`bk-btn ${section.key === current ? "" : "bk-btn-quiet"}`}
            >
              <span className="cap-trim">{section.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** How the last press went, carried in the address by `submit()`. */
export function Flash({
  notice,
  tone,
}: {
  readonly notice?: string;
  readonly tone?: string;
}) {
  if (notice === undefined || notice === "") return null;
  return (
    <div className="bk-noprint mb-4">
      <Notice tone={tone === "bad" ? "bad" : "good"}>{notice}</Notice>
    </div>
  );
}

/** The quiet link back to where you came from, above a page's title. */
export function BackLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="label bk-muted inline-flex min-h-11 items-center text-[1.05rem]"
    >
      <span className="cap-trim">&larr; {children}</span>
    </Link>
  );
}

/** A `<summary>` that looks like the back end's other quiet controls. */
export function Reveal({
  children,
  tone = "plain",
}: {
  readonly children: ReactNode;
  readonly tone?: "plain" | "danger";
}) {
  return (
    <summary
      className={`label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem] ${tone === "danger" ? "text-pink-deep" : ""}`}
    >
      <span className="cap-trim">{children}</span>
    </summary>
  );
}

const COMPLIANCE_TONE: Readonly<Record<ComplianceStatus, PillTone>> = {
  "to-do": "todo",
  check: "doing",
  "in-place": "done",
  "not-needed": "off",
};

export function CompliancePill({
  status,
}: {
  readonly status: ComplianceStatus;
}) {
  return (
    <Pill tone={COMPLIANCE_TONE[status]}>
      {COMPLIANCE_STATUS_LABEL[status]}
    </Pill>
  );
}

export function TaskPill({
  status,
  overdue,
  dueToday,
}: {
  readonly status: TaskStatus;
  readonly overdue: boolean;
  readonly dueToday: boolean;
}) {
  if (status === "done") return <Pill tone="done">Done</Pill>;
  if (overdue) return <Pill tone="todo">Overdue</Pill>;
  if (dueToday) return <Pill tone="doing">Due today</Pill>;
  if (status === "doing") return <Pill tone="doing">Doing</Pill>;
  return null;
}

/** A hint under a field. Give the field `aria-describedby` with the same id. */
export function Hint({
  id,
  children,
}: {
  readonly id?: string;
  readonly children: ReactNode;
}) {
  return (
    <p id={id} className="bk-muted mt-1.5 text-[0.9375rem] leading-snug">
      {children}
    </p>
  );
}
