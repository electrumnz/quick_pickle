import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/admin/ui/page";
import {
  Card,
  CardBody,
  CardHeader,
  Row,
  Rows,
} from "@/components/admin/ui/primitives";
import { loadStrategyForAdmin } from "@/components/strategy/data";
import { MarketExplorer } from "@/components/strategy/MarketExplorer";
import { NextActions, WhatThisIsFor } from "@/components/strategy/pieces";

export const metadata: Metadata = {
  title: "Market",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/**
 * Market — TAM, SAM, SOM, with the arithmetic open.
 *
 * The assumptions are rendered as inputs rather than as a list, because the
 * only honest way to present a market size to the person betting on it is to
 * let her push it and watch it move. The editor is local — the SQL that would
 * make a change permanent is shown rather than run, since the stored values in
 * `strategy_assumptions` are the source of truth and a screen that silently
 * diverged from them would be worse than one that cannot edit at all.
 */
export default async function MarketPage() {
  const loaded = await loadStrategyForAdmin();
  const market = loaded.strategy.market;
  const sourced = loaded.strategy.inputs.filter(
    (input) => input.confidence !== "estimate",
  ).length;

  return (
    <>
      <PageHeader
        title="Market"
        lede="How much money is on the table, how much of it you can reach, and how much you can win in two years — with every assumption open to argument."
        meta={
          <>
            <span>Market model v{market.version}</span>
            <span aria-hidden="true">·</span>
            <span>
              {loaded.strategy.inputs.length} assumptions, {sourced} of them
              sourced
            </span>
            <span aria-hidden="true">·</span>
            <span>New Zealand, expanding to Australia</span>
          </>
        }
      />

      <div className="space-y-8">
        <WhatThisIsFor read="The four numbers at the top are the whole thing. The rest is there so you can disagree with them.">
          {market.purpose}
        </WhatThisIsFor>

        <MarketExplorer
          inputs={loaded.strategy.inputs}
          sources={loaded.strategy.sources}
          storedFromDatabase={loaded.kind === "database"}
        />

        <Section
          title="The sources"
          description="Every figure not labelled an estimate came from one of these, on the date shown."
        >
          <Card>
            <CardHeader title="Cited" count={loaded.strategy.sources.length} />
            <Rows>
              {loaded.strategy.sources.map((source) => (
                <Row key={source.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-body-sm font-medium text-primary">
                      <a
                        href={source.url}
                        rel="noreferrer noopener"
                        target="_blank"
                        className="text-link underline underline-offset-4"
                      >
                        {source.title}
                      </a>
                    </p>
                    <p className="text-caption text-muted">
                      {source.publisher} · read {source.retrieved}
                    </p>
                  </div>
                  <p className="mt-1 max-w-prose text-caption text-muted">
                    {source.supports}
                  </p>
                  <p className="mt-1 font-mono text-caption text-muted">
                    {source.id}
                  </p>
                </Row>
              ))}
            </Rows>
            <CardBody className="border-t border-hairline">
              <p className="max-w-prose text-caption text-muted">
                Three of these are aggregate market figures supplied as build
                anchors rather than read from the publisher directly, and their
                links point at the Restaurant Association&rsquo;s research index
                rather than at the release itself. They are used as orders of
                magnitude, and the two they most affect — the venue base and the
                global category — are cross-checked against each other above.
              </p>
            </CardBody>
          </Card>
        </Section>

        <NextActions actions={market.nextActions} />
      </div>
    </>
  );
}
