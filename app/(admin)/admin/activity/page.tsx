import type { Metadata } from "next";
import Link from "next/link";

import { load } from "@/components/admin/data/db";
import { dayAndTime } from "@/components/admin/data/format";
import { activity, type ActivityFilter } from "@/components/admin/data/queries";
import { DataUnavailable, PageHeader } from "@/components/admin/ui/page";
import {
  Card,
  CardBody,
  EmptyState,
  Row,
  Rows,
} from "@/components/admin/ui/primitives";

export const metadata: Metadata = {
  title: "Activity",
  robots: { index: false, follow: false, nocache: true },
};

const FILTERS: readonly {
  readonly id: ActivityFilter;
  readonly label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "stock", label: "Stock" },
  { id: "batches", label: "Batches" },
  { id: "orders", label: "Orders" },
  { id: "other", label: "Other" },
];

function parseFilter(raw: string | string[] | undefined): ActivityFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (
    value === "stock" ||
    value === "batches" ||
    value === "orders" ||
    value === "other"
  ) {
    return value;
  }
  return "all";
}

/**
 * Activity — what changed in the business, from `public.audit_log`.
 *
 * Newest first. New Zealand time. Agent-runtime rows stay hidden; Grok Bot
 * work shows up when someone uses this admin as a person.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filter = parseFilter(params["filter"]);
  const result = await load(() => activity(50, filter));

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Activity" lede="What changed while you were away." />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const rows = result.data;

  return (
    <>
      <PageHeader
        title="Activity"
        lede="Every write that landed in the audit log — packing, stock, posts, settings — newest first, New Zealand time."
        meta={<span>Pacific/Auckland</span>}
      />

      <div
        className="mb-4 flex flex-wrap gap-2"
        role="navigation"
        aria-label="Filter activity"
      >
        {FILTERS.map((entry) => {
          const active = entry.id === filter;
          const href =
            entry.id === "all"
              ? "/admin/activity"
              : `/admin/activity?filter=${entry.id}`;
          return (
            <Link
              key={entry.id}
              href={href}
              className={
                active
                  ? "rounded-md border border-hairline bg-surface-raised px-3 py-1.5 text-caption font-medium text-primary"
                  : "rounded-md border border-transparent px-3 py-1.5 text-caption text-muted hover:text-primary"
              }
              aria-current={active ? "page" : undefined}
            >
              {entry.label}
            </Link>
          );
        })}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            headline="Nothing to show yet"
            fills="Grok Bot work appears when it uses this admin."
          >
            Packing an order, correcting a count, or changing a setting will
            leave a line here. Sign-ins and the old in-site agent runtime are
            not listed.
          </EmptyState>
        ) : (
          <Rows>
            {rows.map((entry) => (
              <Row key={entry.id} href={entry.href ?? undefined}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-body-sm text-primary">{entry.summary}</p>
                    <p className="mt-0.5 text-caption text-muted">
                      {entry.actor}
                      {entry.entityLabel === null
                        ? ""
                        : ` · ${entry.entityLabel}`}
                    </p>
                  </div>
                  <p className="shrink-0 text-caption text-muted tabular-nums">
                    {dayAndTime(entry.occurredAt)}
                  </p>
                </div>
              </Row>
            ))}
          </Rows>
        )}
        <CardBody className="border-t border-hairline">
          <p className="text-caption text-muted">
            Source: <code className="text-primary">public.audit_log</code>. Rows
            stamped as the old agent runtime stay hidden.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
