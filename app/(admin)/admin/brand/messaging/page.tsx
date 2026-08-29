import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/admin/ui/page";
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Row,
  Rows,
} from "@/components/admin/ui/primitives";
import { loadStrategyForAdmin } from "@/components/strategy/data";
import {
  Field,
  NextActions,
  Points,
  Verbatim,
  WhatThisIsFor,
} from "@/components/strategy/pieces";
import type { AudienceScript } from "@/content/strategy/types";

export const metadata: Metadata = {
  title: "Messaging",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/**
 * Messaging — the StoryBrand BrandScript, as the marketing agent reads it.
 *
 * The seven elements are rendered in SB7 order and numbered, because the order
 * is the framework: a story that puts the plan before the problem is not a
 * story. Everything here is loaded from `strategy_documents`, so what she reads
 * on this screen is literally the text sitting in the marketing agent's system
 * prompt.
 */
export default async function MessagingPage() {
  const loaded = await loadStrategyForAdmin();
  const script = loaded.strategy.brandScript;

  return (
    <>
      <PageHeader
        title="Messaging"
        lede="The seven things a customer needs to hear, in the order they need to hear them — and the exact lines the AI team writes from."
        meta={
          <>
            <span>BrandScript v{script.version}</span>
            <span aria-hidden="true">·</span>
            <span>Two customers, two scripts</span>
            <span aria-hidden="true">·</span>
            <span>
              {loaded.kind === "database"
                ? "Live from strategy_documents"
                : "Showing the deployed copy — database unreachable"}
            </span>
          </>
        }
      />

      <div className="space-y-8">
        <WhatThisIsFor read="Five minutes, and then it is a reference.">
          {script.purpose}
        </WhatThisIsFor>

        <Callout title="The one rule this whole page rests on">
          <p>
            The customer is the hero. HALF SOUR is the guide. Any sentence whose
            subject is us — what we make, how long it takes, how much we care —
            is a sentence to rewrite with them as the subject. That rule is
            written into the agents&rsquo; system prompt in these words, not
            left for them to infer.
          </p>
        </Callout>

        <Section
          title="The lines to use, unchanged"
          description="These three are derived from the script below. Changing the script changes them, and changing them changes what the next caption says."
        >
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-eyebrow uppercase text-muted">
                The one-liner — problem, solution, result
              </p>
              <Verbatim note="Site header, Instagram bio, email footer, spec card. The same words in all four places, or it is a slogan rather than a message.">
                {script.derived.oneLiner}
              </Verbatim>
            </div>
            <div>
              <p className="mb-1.5 text-eyebrow uppercase text-muted">
                The trade one-liner
              </p>
              <Verbatim note="For anything a venue reads. It leads with cost per pour because that is what a bar under wage pressure buys on.">
                {script.derived.tradeOneLiner}
              </Verbatim>
            </div>
            <div>
              <p className="mb-1.5 text-eyebrow uppercase text-muted">
                The controlling idea — governs every other sentence
              </p>
              <Verbatim note="If a draft cannot be squared with this sentence, the draft is wrong.">
                {script.derived.controllingIdea}
              </Verbatim>
            </div>
          </div>
        </Section>

        <Section
          title="The elevator pitch"
          description="Character, problem, plan, success — said out loud, in under thirty seconds, to somebody at a market stall."
        >
          <Card>
            <CardBody>
              <p className="max-w-prose text-body text-primary">
                {script.derived.elevatorPitch}
              </p>
            </CardBody>
          </Card>
        </Section>

        <ScriptBlock
          heading="The Friday host — direct customer"
          script={script.audiences.b2c}
        />
        <ScriptBlock
          heading="The bar manager — trade buyer"
          script={script.audiences.b2b}
        />

        <Section
          title="Who reads this"
          description="The BrandScript is not a document filed somewhere. It is loaded into an agent's system prompt before it writes."
        >
          <Card>
            <CardBody className="space-y-2 text-body-sm text-primary">
              <p className="max-w-prose">
                Ari, the marketing agent, is handed this script scoped to{" "}
                <code className="font-mono text-caption">social</code>,{" "}
                <code className="font-mono text-caption">email</code> and{" "}
                <code className="font-mono text-caption">storefront</code>, with
                the direct customer first. Vic, the trade agent, is handed the
                same script with the venue buyer first, plus the market model.
              </p>
              <p className="max-w-prose text-muted">
                The evidence that this is real rather than decorative is in{" "}
                <code className="font-mono text-caption">
                  components/strategy/evidence/
                </code>
                : the same run, twice, either side of a one-line edit to this
                page&rsquo;s one-liner, with the two captions printed side by
                side.
              </p>
            </CardBody>
          </Card>
        </Section>

        <NextActions actions={script.nextActions} />
      </div>
    </>
  );
}

/** One audience's seven elements, numbered in SB7 order. */
function ScriptBlock({
  heading,
  script,
}: {
  heading: string;
  script: AudienceScript;
}) {
  return (
    <Section
      title={heading}
      description={script.character.who}
      id={`script-${script.character.id}`}
    >
      <div className="space-y-4">
        <Card>
          <CardHeader title="1 · A character" note="One want. Not three." />
          <CardBody className="space-y-4">
            <Field label="What they want">{script.character.wants}</Field>
            <Field label="Why we believe that">
              {script.character.evidence}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="2 · Has a problem"
            note="The internal one is what actually sells"
          />
          <CardBody className="space-y-4">
            <Field label="External" hint="The thing in their way">
              {script.problem.external}
            </Field>
            <Field
              label="Internal"
              hint="How that makes them feel — lead with this"
            >
              <span className="font-medium">{script.problem.internal}</span>
            </Field>
            <Field label="Philosophical" hint="Why it is plain wrong">
              {script.problem.philosophical}
            </Field>
            <Field
              label="The villain"
              hint="One concrete thing that can be defeated"
            >
              <Badge tone="quiet">{script.problem.villain}</Badge>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="3 · And meets a guide"
            note="Empathy, then authority. Never a boast."
          />
          <CardBody className="space-y-4">
            <Field label="Empathy">{script.guide.empathy}</Field>
            <Field
              label="Authority"
              hint="Everything here is checkable, because an unprovable claim is a Fair Trading Act problem"
            >
              <Points items={script.guide.authority} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="4 · Who gives them a plan"
            note="A process plan and an agreement plan"
          />
          <CardBody className="space-y-4">
            <div>
              <p className="text-eyebrow uppercase text-muted">
                The process — what they do
              </p>
              <ol className="mt-2 space-y-2.5">
                {script.plan.process.map((step) => (
                  <li key={step.step} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 font-mono text-caption text-muted tabular-nums"
                    >
                      {step.step}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-body-sm font-medium text-primary">
                        {step.title}
                      </span>
                      <span className="mt-0.5 block max-w-prose text-caption text-muted">
                        {step.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <Field
              label="The agreement — what we promise in return"
              hint="What makes the first order feel less like a risk"
            >
              <Points items={script.plan.agreement} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="5 · And calls them to action"
            note="One direct, one transitional. Never three."
          />
          <Rows>
            <Row>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-primary">
                    Direct: &ldquo;{script.calls.direct.label}&rdquo;
                    {!script.calls.direct.live && (
                      <Badge tone="danger">Route not built yet</Badge>
                    )}
                  </p>
                  <p className="mt-1 max-w-prose text-caption text-muted">
                    {script.calls.direct.note}
                  </p>
                </div>
                <code className="font-mono text-caption text-muted">
                  {script.calls.direct.href}
                </code>
              </div>
            </Row>
            <Row>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-primary">
                    Transitional: &ldquo;{script.calls.transitional.label}
                    &rdquo;
                    {!script.calls.transitional.live && (
                      <Badge tone="danger">Route not built yet</Badge>
                    )}
                  </p>
                  <p className="mt-1 max-w-prose text-caption text-muted">
                    {script.calls.transitional.note}
                  </p>
                </div>
                <code className="font-mono text-caption text-muted">
                  {script.calls.transitional.href}
                </code>
              </div>
            </Row>
          </Rows>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader
              title="6 · That helps them avoid failure"
              note="The stakes, stated once and lightly"
            />
            <CardBody>
              <Points items={script.stakes.failure} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="7 · And ends in success"
              note="What their life looks like after"
            />
            <CardBody className="space-y-4">
              <Points items={script.stakes.success} />
              <Field label="The transformation">
                From &ldquo;{script.stakes.transformation.from}&rdquo; to
                &ldquo;{script.stakes.transformation.to}&rdquo;
              </Field>
            </CardBody>
          </Card>
        </div>
      </div>
    </Section>
  );
}
