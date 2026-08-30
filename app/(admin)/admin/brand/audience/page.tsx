import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/admin/ui/page";
import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Row,
  Rows,
} from "@/components/admin/ui/primitives";
import { AuditBoard } from "@/components/strategy/AuditBoard";
import { AvatarCard } from "@/components/strategy/AvatarCard";
import { runStorefrontAudit } from "@/components/strategy/audit-data";
import { loadStrategyForAdmin } from "@/components/strategy/data";
import { NextActions, WhatThisIsFor } from "@/components/strategy/pieces";

export const metadata: Metadata = {
  title: "Audience",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/**
 * Audience — the two customers, and the store's score against them.
 *
 * The avatars are loaded from `strategy_avatars`, so what is on this screen is
 * the text sitting in the agents' system prompts. The score above them is not a
 * stored number: the audit runs when this page is requested, fetching the real
 * storefront over HTTP and asking each check its question. A score that came
 * out of a table would be a score from whenever the table was last written, and
 * the founder would have no way of telling which.
 */
export default async function AudiencePage() {
  const [loaded, audit] = await Promise.all([
    loadStrategyForAdmin(),
    runStorefrontAudit(),
  ]);
  const avatars = loaded.strategy.avatars;

  return (
    <>
      <PageHeader
        title="Audience"
        lede="The two people this company sells to, in enough detail to settle an argument — and what the live store currently does for each of them."
        meta={
          <>
            <span>Avatars v{avatars.version}</span>
            <span aria-hidden="true">·</span>
            <span>
              {loaded.kind === "database"
                ? "Live from strategy_avatars"
                : "Showing the deployed copy — database unreachable"}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {audit.kind === "ran"
                ? `${String(audit.run.passed)} of ${String(audit.run.total)} storefront checks passing`
                : "Storefront unreachable"}
            </span>
          </>
        }
      />

      <div className="space-y-8">
        <WhatThisIsFor read="The score first. The two people it is a score against are underneath it.">
          {avatars.purpose}
        </WhatThisIsFor>

        <Section
          id="score"
          title="The store, against the two of them"
          description="Seventeen binary questions, asked of the real pages just now. Each one says which customer it serves and what failing it costs."
        >
          {audit.kind === "ran" ? (
            <AuditBoard
              run={audit.run}
              avatars={avatars}
              baseUrl={audit.baseUrl}
              elapsedMs={audit.elapsedMs}
            />
          ) : (
            <Callout
              title="The audit could not reach the storefront"
              tone="danger"
            >
              <p>
                Nothing answered at {audit.baseUrl}, so there is no score to
                show — an audit that reports a pass because it could not read
                the page is worse than one that says it could not run.
              </p>
              <p className="mt-2 font-mono break-words">{audit.detail}</p>
              <p className="mt-2">
                The same checks run from the command line:{" "}
                <span className="font-mono">
                  npx vitest run tests/strategy/storefront-audit.test.ts
                </span>
                .
              </p>
            </Callout>
          )}
        </Section>

        <Section
          id="how-the-audit-works"
          title="What the score is, and what it is not"
          description="So the number can be trusted or argued with, rather than believed."
        >
          <Card>
            <CardBody className="space-y-3">
              <p className="max-w-prose text-body-sm text-primary">
                Every check fetches a real page and reads the HTML a browser
                would have been served. None of them reads the avatars, because
                a check that read the same document it was written from would
                pass for ever and prove nothing.
              </p>
              <p className="max-w-prose text-body-sm text-primary">
                A failing check is not a bug report. It is one sentence about
                one page, with the fix attached, and several of them are cleared
                by the same piece of work — which is what &ldquo;what to fix
                first&rdquo; is counting.
              </p>
              <p className="max-w-prose text-body-sm text-primary">
                The same checks run in the test suite, against the same pages:{" "}
                <span className="font-mono text-caption">
                  npx vitest run tests/strategy/storefront-audit.test.ts
                </span>
                . They are red there today, on purpose.
              </p>
            </CardBody>
          </Card>
        </Section>

        <Section
          id="friday-host"
          title={`${avatars.avatars.b2c.label} — the direct customer`}
          description="The person buying one bottle for their own kitchen."
        >
          <AvatarCard avatar={avatars.avatars.b2c} />
        </Section>

        <Section
          id="bar-manager"
          title={`${avatars.avatars.b2b.label} — the trade customer`}
          description="The person who signs off what goes on a venue's list, in a market that is tightening."
        >
          <AvatarCard avatar={avatars.avatars.b2b} />
        </Section>

        <Section
          id="contradictions"
          title="Where these disagree with the rest of the plan"
          description="Written down rather than smoothed over, with a side taken on each."
        >
          <Card>
            <CardHeader
              title="Pairs that cannot both be right"
              count={avatars.contradictions.length}
              note="Each one names which is wrong, and what would settle it"
            />
            <Rows>
              {avatars.contradictions.map((contradiction) => (
                <Row key={contradiction.id}>
                  <p className="text-body-sm font-medium text-primary">
                    {contradiction.between[0]}{" "}
                    <span className="text-muted">versus</span>{" "}
                    {contradiction.between[1]}
                  </p>
                  <p className="mt-1.5 max-w-prose text-caption text-muted">
                    {contradiction.says}
                  </p>
                  <p className="mt-1.5 max-w-prose text-caption text-muted">
                    <span className="text-primary">Which is wrong:</span>{" "}
                    {contradiction.wrongOne}
                  </p>
                  <p className="mt-1.5 max-w-prose text-caption text-muted">
                    <span className="text-primary">Settled by:</span>{" "}
                    {contradiction.settledBy}
                  </p>
                </Row>
              ))}
            </Rows>
          </Card>
        </Section>

        <NextActions actions={avatars.nextActions} />
      </div>
    </>
  );
}
