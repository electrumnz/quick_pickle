import type { Metadata } from "next";
import Image from "next/image";

import { load } from "@/components/admin/data/db";
import {
  brandRules,
  type BrandRuleItem,
} from "@/components/admin/data/queries";
import {
  DataUnavailable,
  PageHeader,
  Section,
} from "@/components/admin/ui/page";
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Row,
  Rows,
  TableScroll,
  Td,
  Th,
} from "@/components/admin/ui/primitives";
import {
  Points,
  SimpleCard,
  WhatThisIsFor,
} from "@/components/strategy/pieces";
import { loadStrategyForAdmin } from "@/components/strategy/data";
import { LIGHT_PIGMENTS, TYPE_SCALE } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Identity",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/** The light palette as rows. Values come from lib/brand; none is written here. */
const PIGMENTS = Object.entries(LIGHT_PIGMENTS);

const SEVERITY_TONE: Record<string, "danger" | "accent" | "neutral"> = {
  never: "danger",
  must: "accent",
  should: "neutral",
};

/**
 * Identity — who HALF SOUR is, and the rules that are actually enforced.
 *
 * The brand guide is a long document; this page is not a copy of it. It shows
 * the parts of the identity that are LIVE — the drawn marks, the sanctioned
 * palette, the type scale, and the `brand_rules` rows that gate published
 * copy — and points at the guide for the rest. A screen that
 * paraphrases a document is a third copy to keep in step.
 */
export default async function IdentityPage() {
  const [rules, strategy] = await Promise.all([
    load(() => brandRules()),
    loadStrategyForAdmin(),
  ]);

  return (
    <>
      <PageHeader
        title="Identity"
        lede="Who HALF SOUR is: the marks, the colours, the voice, and the rules published copy is not allowed to break."
        meta={
          <>
            <span>Brand guide v1.0</span>
            <span aria-hidden="true">·</span>
            <span>{PIGMENTS.length} sanctioned colours</span>
            <span aria-hidden="true">·</span>
            <span>{TYPE_SCALE.length} type steps</span>
          </>
        }
      />

      <div className="space-y-8">
        <WhatThisIsFor read="Two minutes.">
          The identity is the part of the company that does not change when the
          plan does. Everything on this page is already enforced somewhere — the
          colours by a contrast test that runs on every build, the rules by a
          scanner that fails the build on a banned word — so this screen is
          where you check what those things currently say, not where you admire
          them.
        </WhatThisIsFor>

        <Section
          title="The marks"
          description="Three cuts of the mark and the wordmark. Never redraw, never recolour, never set the name in another typeface."
        >
          <Card>
            <CardBody className="flex flex-wrap items-center gap-8">
              <figure className="space-y-2">
                <div className="flex h-24 w-48 items-center justify-center rounded-md border border-hairline bg-surface-page px-4">
                  <Image
                    src="/brand/wordmark.svg"
                    alt="The HALF SOUR wordmark, drawn"
                    width={160}
                    height={40}
                  />
                </div>
                <figcaption className="text-caption text-muted">
                  Wordmark — the primary lockup
                </figcaption>
              </figure>
              <figure className="space-y-2">
                <div className="flex h-24 w-48 items-center justify-center rounded-md border border-hairline bg-surface-page px-4">
                  <Image
                    src="/brand/mark.svg"
                    alt="The HALF SOUR mark"
                    width={64}
                    height={64}
                  />
                </div>
                <figcaption className="text-caption text-muted">
                  Mark — for the cap, the favicon, the avatar
                </figcaption>
              </figure>
              <figure className="space-y-2">
                <div className="flex h-24 w-64 items-center justify-center rounded-md border border-hairline bg-surface-page px-4">
                  <Image
                    src="/brand/bottles.svg"
                    alt="Four 500ml HALF SOUR bottles side by side"
                    width={220}
                    height={80}
                  />
                </div>
                <figcaption className="text-caption text-muted">
                  The launch line — all four bottles, each carrying its own
                  label.
                </figcaption>
              </figure>
            </CardBody>
          </Card>
        </Section>

        <Section
          title="The palette"
          description="Nine light pigments. Components never name one of these — they use the semantic layer over it, and a test enforces that."
        >
          <Card>
            <TableScroll>
              <caption className="sr-only">
                The sanctioned light palette, with what each pigment is for
              </caption>
              <thead>
                <tr>
                  <Th>Swatch</Th>
                  <Th>Name</Th>
                  <Th>Value</Th>
                  <Th>What it is for</Th>
                </tr>
              </thead>
              <tbody>
                {PIGMENTS.map(([token, pigment]) => (
                  <tr key={token}>
                    <Td>
                      <span
                        aria-hidden="true"
                        className="inline-block size-6 rounded-sm border border-hairline"
                        style={{ backgroundColor: pigment.hex }}
                      />
                    </Td>
                    <Td>{pigment.label}</Td>
                    <Td>
                      <span className="font-mono text-caption uppercase">
                        {pigment.hex}
                      </span>
                    </Td>
                    <Td>{pigment.role}</Td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          </Card>
        </Section>

        <Section
          title="The rules that gate published copy"
          description="These are rows in brand_rules, not a document. Editing a row changes what the copy scanner enforces with no deploy."
        >
          {!rules.ok ? (
            <DataUnavailable problem={rules.problem} detail={rules.detail} />
          ) : (
            <Card>
              <CardHeader
                title="Live brand rules"
                count={rules.data.length}
                note="Highest priority first"
              />
              <Rows>
                {rules.data.map((rule: BrandRuleItem) => (
                  <Row key={rule.id}>
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-primary">
                          {rule.title}
                          <Badge
                            tone={SEVERITY_TONE[rule.severity] ?? "neutral"}
                          >
                            {rule.severity}
                          </Badge>
                        </p>
                        <p className="mt-1 max-w-prose text-caption text-muted">
                          {rule.rule}
                        </p>
                        {rule.goodExample !== null && (
                          <p className="mt-1.5 text-caption text-muted">
                            <span className="text-primary">Say:</span>{" "}
                            {rule.goodExample}
                          </p>
                        )}
                      </div>
                      <p className="shrink-0 text-caption text-muted">
                        {rule.appliesTo.join(", ")}
                      </p>
                    </div>
                  </Row>
                ))}
              </Rows>
            </Card>
          )}
        </Section>

        <Section
          title="What is enforced, and by what"
          description="The identity is not held together by good intentions."
        >
          <SimpleCard title="Four gates">
            <Points
              items={[
                "Colour: no component may contain a hex. Semantic tokens only, and a unit test fails the build if one appears outside lib/brand.",
                "Contrast: every sanctioned foreground-on-ground pair is measured in CI, not asserted. 23 of 23 pass AA.",
                "Copy: legal/COPY-RULES.md is machine-enforced — node legal/scripts/audit-copy.mjs exits non-zero on a banned term, and the rule set cites the FSANZ and Fair Trading provisions it comes from.",
                "Brand rules: rows in brand_rules feed the copy scanner; a 'never' rule needs trigger keywords so the check can catch it deterministically.",
              ]}
            />
          </SimpleCard>
        </Section>

        <Section
          title="The rest of the guide"
          description="This screen shows what is live. The full document has the reasoning."
        >
          <Callout title="brand/brand-guide.md">
            <p>
              550 lines: the name clearance evidence (trade mark searches run
              through TMview on 27 August 2026), positioning, the target
              customer, twenty real lines of voice, what HALF SOUR never says,
              the competitor landscape, both palettes with every contrast pair
              computed, the type scale, label art direction and the photography
              brief. A rendered version sits at{" "}
              <code className="font-mono">brand/guide.html</code>.
            </p>
          </Callout>
        </Section>

        <Section
          title="Where the identity meets the plan"
          description="These four areas are one destination on purpose."
        >
          <Card>
            <CardBody className="space-y-3">
              <p className="max-w-prose text-body-sm text-primary">
                The identity says how the company sounds. The BrandScript on the{" "}
                <strong>Messaging</strong> tab says what it says — its
                controlling idea is{" "}
                <em>{strategy.strategy.brandScript.derived.controllingIdea}</em>
              </p>
              <p className="max-w-prose text-body-sm text-muted">
                Neither of them decides how much of it there is to sell. That is
                the <strong>Market</strong> tab, and the six parts of the
                business that turn one into the other are the{" "}
                <strong>Plan</strong>.
              </p>
            </CardBody>
          </Card>
        </Section>
      </div>
    </>
  );
}
