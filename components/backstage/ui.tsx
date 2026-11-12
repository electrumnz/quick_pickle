import Link from "next/link";
import type { ReactNode } from "react";

import { formatNzDateTime, formatNzRelative } from "@/lib/time";

/**
 * The back end's small parts. Server components, no state: anything that
 * needs to react to a press lives beside the form that uses it.
 */

export function PageHeader({
  title,
  lead,
  actions,
  back,
}: {
  readonly title: string;
  readonly lead?: ReactNode;
  readonly actions?: ReactNode;
  readonly back?: { readonly href: string; readonly label: string };
}) {
  return (
    <header className="mb-6">
      {back ? (
        <Link
          href={back.href}
          className="label bk-muted mb-2 inline-flex min-h-11 items-center text-[1.05rem]"
        >
          <span className="cap-trim">&larr; {back.label}</span>
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="bk-h1">{title}</h1>
          {lead ? (
            <p className="bk-muted mt-2 max-w-[44rem] leading-snug">{lead}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

export function Panel({
  title,
  aside,
  children,
  flush = false,
  className = "",
}: {
  readonly title?: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  /** No padding: for a list or table that runs edge to edge. */
  readonly flush?: boolean;
  readonly className?: string;
}) {
  return (
    <section className={`bk-panel min-w-0 ${className}`}>
      {title ? (
        <div className="border-navy flex flex-wrap items-center justify-between gap-2 border-b-2 px-4 py-3 md:px-6">
          <h2 className="bk-h2">
            <span className="cap-trim">{title}</span>
          </h2>
          {aside}
        </div>
      ) : null}
      <div className={flush ? "" : "bk-panel-pad"}>{children}</div>
    </section>
  );
}

export type PillTone = "plain" | "todo" | "doing" | "done" | "off";

export function Pill({
  tone = "plain",
  children,
}: {
  readonly tone?: PillTone;
  readonly children: ReactNode;
}) {
  const style = tone === "plain" ? "" : ` bk-pill-${tone}`;
  return (
    <span className={`bk-pill${style}`}>
      <span className="cap-trim">{children}</span>
    </span>
  );
}

/** A moment, said the way a person would, with the exact time on hover. */
export function When({ at, now }: { readonly at: Date; readonly now?: Date }) {
  return (
    <time dateTime={at.toISOString()} title={`${formatNzDateTime(at)} NZ time`}>
      {formatNzRelative(at, now)}
    </time>
  );
}

export function Notice({
  tone = "good",
  children,
}: {
  readonly tone?: "good" | "bad";
  readonly children: ReactNode;
}) {
  return (
    <p
      role={tone === "bad" ? "alert" : "status"}
      className={`bk-notice${tone === "bad" ? " bk-notice-bad" : ""}`}
    >
      {children}
    </p>
  );
}

export function Empty({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="bk-h2">
        <span className="cap-trim">{title}</span>
      </p>
      {children ? (
        <p className="bk-muted mx-auto mt-2 max-w-[30rem] leading-snug">
          {children}
        </p>
      ) : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly note?: ReactNode;
}) {
  return (
    <div className="bk-panel bk-panel-pad min-w-0">
      <p className="label bk-muted text-[1rem] leading-none">
        <span className="cap-trim">{label}</span>
      </p>
      <p className="varsity mt-2 text-[2rem] leading-none tabular-nums">
        {value}
      </p>
      {note ? (
        <p className="bk-muted mt-1.5 text-[0.9375rem] leading-snug">{note}</p>
      ) : null}
    </div>
  );
}
