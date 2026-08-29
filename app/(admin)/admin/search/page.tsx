import type { Metadata } from "next";

import { load } from "@/components/admin/data/db";
import {
  searchEverything,
  type SearchHit,
} from "@/components/admin/data/search";
import { DESTINATIONS } from "@/components/admin/shell/destinations";
import {
  DataUnavailable,
  PageHeader,
  PageSections,
  Section,
} from "@/components/admin/ui/page";
import {
  Card,
  CardHeader,
  EmptyState,
  Row,
  Rows,
} from "@/components/admin/ui/primitives";
import { SearchForm } from "@/components/admin/ui/search-form";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The full search results page.
 *
 * The command palette is faster, but it is a floating layer: it cannot be
 * bookmarked, linked to, or reached without a keyboard. This page is the same
 * search with a URL, which is what makes a result shareable and a search
 * repeatable.
 */

const SEARCHABLE = [
  "Order numbers and the email on an order",
  "Customer names, company names and email addresses",
  "Products and their prices",
  "Batch codes, ingredients and suppliers",
  "The AI team by name or job",
  "Social posts by what they say",
  "Brand rules and settings",
];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params["q"];
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

  const result = await load(async () =>
    query === "" ? { query, hits: [] } : searchEverything(query, 10),
  );

  const header = (
    <PageHeader
      title="Search"
      lede="One box over the whole company. Every result says which of the nine sections it lives in."
      actions={
        <SearchForm
          action="/admin/search"
          value={query}
          placeholder="Order, customer, batch, supplier…"
          label="Search everything"
        />
      }
    />
  );

  if (!result.ok) {
    return (
      <>
        {header}
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const hits = result.data.hits;
  const bySection = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const bucket = bySection.get(hit.section);
    if (bucket === undefined) bySection.set(hit.section, [hit]);
    else bucket.push(hit);
  }

  return (
    <>
      {header}
      <PageSections>
        {query === "" ? (
          <Section
            title="What search covers"
            description="Type into the box above, or press ⌘K anywhere in the admin."
          >
            <Card>
              <Rows>
                {SEARCHABLE.map((item) => (
                  <Row key={item}>
                    <p className="text-body-sm text-primary">{item}</p>
                  </Row>
                ))}
              </Rows>
            </Card>
          </Section>
        ) : hits.length === 0 ? (
          <Card>
            <EmptyState
              headline={`Nothing matches “${query}”`}
              fills="Search needs at least two letters, and it looks at names and numbers rather than at the text inside a description."
            >
              It covers {SEARCHABLE.join(", ").toLowerCase()}.
            </EmptyState>
          </Card>
        ) : (
          [...bySection.entries()].map(([section, sectionHits]) => (
            <Section key={section} title={section}>
              <Card>
                <CardHeader title={section} count={sectionHits.length} />
                <Rows>
                  {sectionHits.map((hit) => (
                    <Row key={hit.id} href={hit.href}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="text-body-sm text-primary">{hit.title}</p>
                        <span className="text-caption text-muted">
                          {hit.kind}
                        </span>
                      </div>
                      <p className="mt-0.5 text-caption text-muted">
                        {hit.subtitle}
                      </p>
                    </Row>
                  ))}
                </Rows>
              </Card>
            </Section>
          ))
        )}

        <Section title="Or go straight to a section">
          <Card>
            <Rows>
              {DESTINATIONS.map((destination) => (
                <Row key={destination.id} href={destination.href}>
                  <p className="text-body-sm text-primary">
                    {destination.label}
                  </p>
                  <p className="mt-0.5 text-caption text-muted">
                    {destination.blurb}
                  </p>
                </Row>
              ))}
            </Rows>
          </Card>
        </Section>
      </PageSections>
    </>
  );
}

export const dynamic = "force-dynamic";
