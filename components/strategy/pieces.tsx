import type { ReactNode } from "react";

import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
} from "@/components/admin/ui/primitives";
import type { Confidence, NextAction } from "@/content/strategy/types";

/**
 * The furniture the four Brand & Plan screens share.
 *
 * Everything here is built on `components/admin/ui/primitives` rather than
 * beside it, so these screens are the same product as the other eight
 * destinations. Nothing in this file names a colour.
 */

/**
 * What a framework is FOR, before the framework itself.
 *
 * She is not an MBA. A page that opens with "StoryBrand BrandScript" and a
 * seven-item list is a page she closes; a page that opens with one sentence
 * saying what it is for is a page she uses. It is a required prop on every
 * framework block for that reason.
 */
export function WhatThisIsFor({
  children,
  read,
}: {
  children: ReactNode;
  /** How long it takes to read, so she can decide now or later. */
  read?: string;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-sunken px-4 py-3.5">
      <p className="text-eyebrow uppercase text-muted">What this is for</p>
      <p className="mt-1.5 max-w-prose text-body-sm text-primary">{children}</p>
      {read !== undefined && (
        <p className="mt-1.5 text-caption text-muted">{read}</p>
      )}
    </div>
  );
}

const CONFIDENCE_WORDS: Record<Confidence, string> = {
  sourced: "Published figure",
  derived: "Worked out from published figures",
  estimate: "Our estimate",
};

/** How much weight a number carries, in words rather than a colour. */
export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <Badge tone={confidence === "estimate" ? "neutral" : "quiet"}>
      {CONFIDENCE_WORDS[confidence]}
    </Badge>
  );
}

/**
 * The bit that makes a framework worth having: what to DO next.
 *
 * Every action carries a date and a way of knowing it is finished, because a
 * next step with neither is a wish.
 */
export function NextActions({
  actions,
  title = "What to do next",
}: {
  actions: readonly NextAction[];
  title?: string;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        count={actions.length}
        note="Each one has a date and a way of knowing it is done"
      />
      <ol className="divide-y divide-hairline">
        {actions.map((action, index) => (
          <li key={action.id} className="px-4 py-3.5">
            <div className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 font-mono text-caption text-muted tabular-nums"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-medium text-primary">
                  {action.action}
                </p>
                <p className="mt-1 max-w-prose text-caption text-muted">
                  {action.because}
                </p>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-caption sm:grid-cols-2">
                  <div className="flex gap-2">
                    <dt className="text-muted">By</dt>
                    <dd className="text-primary">{action.by}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-muted">Done when</dt>
                    <dd className="text-primary">{action.doneWhen}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** A labelled block of body copy inside a card. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-eyebrow uppercase text-muted">{label}</p>
      {hint !== undefined && (
        <p className="mt-0.5 text-caption text-muted">{hint}</p>
      )}
      <div className="mt-1.5 max-w-prose text-body-sm text-primary">
        {children}
      </div>
    </div>
  );
}

/** A quoted line meant to be used verbatim. */
export function Verbatim({
  children,
  note,
}: {
  children: ReactNode;
  note?: string;
}) {
  return (
    <figure className="rounded-md border border-hairline bg-surface-sunken px-4 py-3">
      <blockquote className="max-w-prose font-display text-heading-3 leading-snug text-primary">
        {children}
      </blockquote>
      {note !== undefined && (
        <figcaption className="mt-2 text-caption text-muted">{note}</figcaption>
      )}
    </figure>
  );
}

/** A plain bulleted list at the admin's measure. */
export function Points({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-body-sm text-primary">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted">
            &#8226;
          </span>
          <span className="max-w-prose">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Where this page's numbers and claims came from. */
export function SourceNote({ children }: { children: ReactNode }) {
  return <Callout title="Where this comes from">{children}</Callout>;
}

/** A card whose whole body is padded prose. */
export function SimpleCard({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} {...(note === undefined ? {} : { note })} />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}
