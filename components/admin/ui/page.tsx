import Link from "next/link";
import type { ReactNode } from "react";

import { Callout } from "./primitives";

/**
 * Page furniture shared by every admin destination.
 *
 * A page is: a header that says where you are and what this place is for, then
 * sections. Nothing else. Keeping that in one file is what stops nine screens
 * from drifting into nine different products.
 */

/**
 * The top of every page.
 *
 * `lede` is not decoration. She is not technical, and one sentence saying what
 * a section is for is the difference between a screen she uses and a screen she
 * avoids. It is required for that reason.
 */
export function PageHeader({
  title,
  lede,
  meta,
  actions,
}: {
  title: string;
  lede: string;
  /** Small facts that belong with the title: a date, a count, a status. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-hairline pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-heading-1 tracking-tight text-primary">
          {title}
        </h1>
        <p className="mt-1.5 max-w-prose text-body-sm text-muted">{lede}</p>
        {meta !== undefined && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-muted">
            {meta}
          </div>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

/** A titled block within a page, with an optional explanation under it. */
export function Section({
  title,
  description,
  id,
  action,
  children,
}: {
  title: string;
  description?: string;
  id?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="font-sans text-body font-semibold tracking-tight text-primary">
            {title}
          </h2>
          {description !== undefined && (
            <p className="mt-1 max-w-prose text-caption text-muted">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Vertical rhythm between the sections of a page. */
export function PageSections({ children }: { children: ReactNode }) {
  return <div className="space-y-8">{children}</div>;
}

/**
 * "On this page" — anchors for a long reference page.
 *
 * Plain anchors, no JavaScript: it works before hydration, it survives a
 * printout, and every entry goes somewhere that exists.
 */
export function PageNav({
  items,
  label = "On this page",
}: {
  items: readonly { readonly id: string; readonly label: string }[];
  label?: string;
}) {
  return (
    <nav
      aria-label={label}
      className="rounded-lg border border-hairline bg-surface-raised px-4 py-3"
    >
      <p className="text-eyebrow uppercase text-muted">{label}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="rounded-sm text-caption text-link underline underline-offset-4 hover:no-underline"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * What this section will become, said plainly.
 *
 * The founder is running the company on this admin while it is still being
 * built. A screen that pretends to be finished costs her a decision she then
 * has to unwind; a screen that says "reading works, changing does not, here is
 * what is coming" costs her nothing.
 */
export function NotBuiltYet({
  works,
  coming,
  blurb,
}: {
  /** What this page can already do. */
  works: readonly string[];
  /** What is still to come, in the order it is expected. */
  coming: readonly string[];
  /**
   * The sentence under the heading. The default is true of a read-only page;
   * a page that can genuinely change something has to say so instead, or this
   * block becomes the thing on the screen that is lying.
   */
  blurb?: string;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-raised">
      <div className="border-b border-hairline px-4 py-3">
        <h2 className="font-sans text-body-sm font-semibold text-primary">
          What works here, and what does not yet
        </h2>
        <p className="mt-1 text-caption text-muted">
          {blurb ??
            "This page reads the real business database. It cannot change anything yet — the buttons that would do that are not built, so they are not drawn."}
        </p>
      </div>
      <div className="grid gap-x-8 gap-y-5 px-4 py-4 sm:grid-cols-2">
        <div>
          <p className="text-eyebrow uppercase text-muted">Working now</p>
          <ul className="mt-2 space-y-1.5">
            {works.map((item) => (
              <li key={item} className="flex gap-2 text-caption text-primary">
                <span aria-hidden="true" className="text-muted">
                  &#8226;
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-eyebrow uppercase text-muted">Not built yet</p>
          <ul className="mt-2 space-y-1.5">
            {coming.map((item) => (
              <li key={item} className="flex gap-2 text-caption text-muted">
                <span aria-hidden="true">&#8226;</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * The page could not read the database.
 *
 * She gets a sentence she can act on; the stack detail is folded away for
 * whoever fixes it.
 */
export function DataUnavailable({
  problem,
  detail,
}: {
  problem: string;
  detail: string;
}) {
  return (
    <Callout title="This page cannot reach the business database" tone="danger">
      <p>{problem}</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-caption text-muted">
          Technical detail
        </summary>
        <p className="mt-1 font-mono text-caption break-words text-muted">
          {detail}
        </p>
      </details>
    </Callout>
  );
}

/** A quiet link that reads as an action: "See all orders". */
export function ActionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-sm text-caption font-medium text-link underline underline-offset-4 hover:no-underline"
    >
      {children}
    </Link>
  );
}
