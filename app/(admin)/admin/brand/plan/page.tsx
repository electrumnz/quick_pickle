import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/admin/ui/page";
import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  DefinitionList,
  Row,
  Rows,
  Stat,
  StatGrid,
  TableScroll,
  Td,
  Th,
} from "@/components/admin/ui/primitives";
import { loadStrategyForAdmin } from "@/components/strategy/data";
import {
  ConfidenceBadge,
  Field,
  NextActions,
  Points,
  Verbatim,
  WhatThisIsFor,
} from "@/components/strategy/pieces";
import { formatCents } from "@/content/strategy/market";
import {
  monthlyOverheadCents,
  weeklyHours,
  wingEconomics,
} from "@/content/strategy/flight-plan";
import { inputValue } from "@/content/strategy/market";

export const metadata: Metadata = {
  title: "Plan",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/**
 * Plan — the Small Business Flight Plan, six parts.
 *
 * The aeroplane is not decoration: it is what makes neglect diagnosable. Each
 * section therefore carries both what it holds and what goes wrong when it is
 * starved, so a bad month can be traced to a part rather than absorbed as a
 * mood.
 *
 * The margins in the wings section are computed here from the cost breakdown
 * and the live GST and trade-discount assumptions, never typed in — so a price
 * change on this page cannot leave a stale percentage beside it.
 */
export default async function PlanPage() {
  const loaded = await loadStrategyForAdmin();
  const plan = loaded.strategy.flightPlan;
  const gst = inputValue(loaded.strategy.inputs, "gstRate");
  const discount = inputValue(loaded.strategy.inputs, "tradeDiscountRate");
  const overhead = monthlyOverheadCents(plan);
  const hours = weeklyHours(plan);

  return (
    <>
      <PageHeader
        title="Plan"
        lede="The whole business on one page, in six parts — so that when something feels wrong you can tell which part is starved."
        meta={
          <>
            <span>Flight Plan v{plan.version}</span>
            <span aria-hidden="true">·</span>
            <span>{hours} hours in the modelled week</span>
            <span aria-hidden="true">·</span>
            <span>{formatCents(overhead)} fixed a month</span>
          </>
        }
      />

      <div className="space-y-8">
        <WhatThisIsFor read="Ten minutes once, then a page you come back to.">
          {plan.purpose}
        </WhatThisIsFor>

        <Callout title="How to read the aeroplane">
          <p>
            The cockpit points it somewhere. The two engines — marketing and
            sales — pull it forward. The wings hold it up, which is the products
            and their margins. The body is the weight it carries. The fuel tanks
            decide how far it goes. Parts are not interchangeable: more
            marketing never fixes a wing, and a strong engine cannot carry an
            overloaded body.
          </p>
        </Callout>

        {/* ---------------------------------------------------- cockpit */}
        <Section
          title={`${plan.cockpit.aircraft} · ${plan.cockpit.discipline}`}
          description={plan.cockpit.purpose}
          id="cockpit"
        >
          <div className="space-y-4">
            <Verbatim note="Miller's shape: a specific goal, a date, and the reasons that make it worth doing. Say it out loud; if it does not survive that, it is not the mission.">
              {plan.cockpit.mission.statement}
            </Verbatim>

            <Card>
              <CardHeader
                title="Guiding principles"
                count={plan.cockpit.guidingPrinciples.length}
                note="A principle that settles no argument is a poster"
              />
              <Rows>
                {plan.cockpit.guidingPrinciples.map((item) => (
                  <Row key={item.principle}>
                    <p className="text-body-sm font-medium text-primary">
                      {item.principle}
                    </p>
                    <p className="mt-1 max-w-prose text-caption text-muted">
                      Settles: {item.settles}
                    </p>
                  </Row>
                ))}
              </Rows>
            </Card>

            <Card>
              <CardHeader
                title="Key characteristics"
                note="What anyone working here has to be"
              />
              <CardBody>
                <DefinitionList
                  items={plan.cockpit.keyCharacteristics.map((item) => ({
                    term: item.characteristic,
                    value: item.looksLike,
                  }))}
                />
              </CardBody>
            </Card>

            <FailureMode text={plan.cockpit.failureMode} />
          </div>
        </Section>

        {/* ----------------------------------------------- right engine */}
        <Section
          title={`${plan.rightEngine.aircraft} · ${plan.rightEngine.discipline}`}
          description={plan.rightEngine.purpose}
          id="marketing"
        >
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Driven by the BrandScript"
                note="Every line below names the field it came from"
              />
              <CardBody className="space-y-4">
                <Field label="The one-liner in use">
                  {plan.rightEngine.oneLiner}
                </Field>
                <Field
                  label={`Lead generator — ${plan.rightEngine.leadGenerator.name}`}
                  hint={plan.rightEngine.leadGenerator.format}
                >
                  {plan.rightEngine.leadGenerator.promise}
                </Field>
              </CardBody>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <SequenceCard
                title="Nurture sequence"
                note="Useful before it is a sell"
                emails={plan.rightEngine.nurtureSequence}
              />
              <SequenceCard
                title="Sales sequence"
                note="The BrandScript, one element per email"
                emails={plan.rightEngine.salesSequence}
              />
            </div>

            <Card>
              <CardHeader
                title="Channels"
                count={plan.rightEngine.channels.length}
              />
              <TableScroll>
                <caption className="sr-only">
                  Marketing channels, cadence, and the BrandScript field each
                  one is derived from
                </caption>
                <thead>
                  <tr>
                    <Th>Channel</Th>
                    <Th>Cadence</Th>
                    <Th>Its job</Th>
                    <Th>Derived from</Th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rightEngine.channels.map((channel) => (
                    <tr key={channel.channel}>
                      <Td>{channel.channel}</Td>
                      <Td>{channel.cadence}</Td>
                      <Td>{channel.job}</Td>
                      <Td>
                        <span className="font-mono text-caption break-words text-muted">
                          {channel.derivedFrom}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableScroll>
            </Card>

            <FailureMode text={plan.rightEngine.failureMode} />
          </div>
        </Section>

        {/* ------------------------------------------------ left engine */}
        <Section
          title={`${plan.leftEngine.aircraft} · ${plan.leftEngine.discipline}`}
          description={plan.leftEngine.purpose}
          id="sales"
        >
          <div className="space-y-4">
            {plan.leftEngine.processes.map((process) => (
              <Card key={process.id}>
                <CardHeader
                  title={process.name}
                  count={process.stages.length}
                  note={`${process.stages.length} stages`}
                />
                <CardBody className="space-y-3 border-b border-hairline">
                  <p className="max-w-prose text-body-sm text-primary">
                    {process.mechanism}
                  </p>
                  <p className="max-w-prose text-caption text-muted">
                    <span className="font-medium text-primary">Cadence.</span>{" "}
                    {process.cadence}
                  </p>
                </CardBody>
                <TableScroll>
                  <caption className="sr-only">
                    {`Stages of the ${process.name} process`}
                  </caption>
                  <thead>
                    <tr>
                      <Th>Stage</Th>
                      <Th>The question that finishes it</Th>
                      <Th>What you do</Th>
                      <Th>What you count</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {process.stages.map((stage) => (
                      <tr key={stage.stage}>
                        <Td>
                          <span className="font-mono text-caption text-muted tabular-nums">
                            {stage.stage}
                          </span>{" "}
                          {stage.name}
                        </Td>
                        <Td>{stage.qualifyingQuestion}</Td>
                        <Td>{stage.action}</Td>
                        <Td>{stage.measure}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableScroll>
              </Card>
            ))}
            <FailureMode text={plan.leftEngine.failureMode} />
          </div>
        </Section>

        {/* ------------------------------------------------------ wings */}
        <Section
          title={`${plan.wings.aircraft} · ${plan.wings.discipline}`}
          description={plan.wings.purpose}
          id="products"
        >
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="The range, and what is left after costs"
                note={`Trade price is ${Math.round(discount * 100)}% off the GST-exclusive shelf price`}
              />
              <TableScroll>
                <caption className="sr-only">
                  Each bottle with its shelf price, cost to make, and margin
                  direct and to trade
                </caption>
                <thead>
                  <tr>
                    <Th>Bottle</Th>
                    <Th>What it is for</Th>
                    <Th numeric>Shelf</Th>
                    <Th numeric>Net of GST</Th>
                    <Th numeric>Costs</Th>
                    <Th numeric>Direct margin</Th>
                    <Th numeric>Trade margin</Th>
                  </tr>
                </thead>
                <tbody>
                  {plan.wings.wings.map((wing) => {
                    const economics = wingEconomics(wing, gst, discount);
                    return (
                      <tr key={wing.sku}>
                        <Td>
                          <span className="font-medium">{wing.name}</span>
                          <span className="mt-0.5 block font-mono text-caption text-muted">
                            {wing.sku}
                          </span>
                        </Td>
                        <Td>{wing.job}</Td>
                        <Td numeric>{formatCents(wing.shelfPriceCents)}</Td>
                        <Td numeric>{formatCents(economics.netShelfCents)}</Td>
                        <Td numeric>{formatCents(economics.cogsCents)}</Td>
                        <Td numeric>
                          {formatCents(economics.directMarginCents)}
                          <span className="mt-0.5 block text-caption text-muted">
                            {economics.directMarginPercent}%
                          </span>
                        </Td>
                        <Td numeric>
                          {wing.sku === "HS-SET-3" ? (
                            <span className="text-caption text-muted">
                              not sold to trade
                            </span>
                          ) : (
                            <>
                              {formatCents(economics.tradeMarginCents)}
                              <span className="mt-0.5 block text-caption text-muted">
                                {economics.tradeMarginPercent}%
                              </span>
                            </>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableScroll>
              <CardBody className="border-t border-hairline">
                <p className="text-caption text-muted">
                  Every cost line is an estimate and none has been checked
                  against an invoice. <ConfidenceBadge confidence="estimate" />{" "}
                  Cost one real run and these numbers become worth arguing
                  about.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="What the arithmetic says"
                count={plan.wings.findings.length}
                note="Findings, not opinions — each one falls out of the table above"
              />
              <CardBody>
                <Points items={plan.wings.findings} />
              </CardBody>
            </Card>

            <FailureMode text={plan.wings.failureMode} />
          </div>
        </Section>

        {/* ------------------------------------------------------- body */}
        <Section
          title={`${plan.body.aircraft} · ${plan.body.discipline}`}
          description={plan.body.purpose}
          id="overhead"
        >
          <div className="space-y-4">
            <Card>
              <CardBody>
                <StatGrid columns={3}>
                  <Stat
                    label="Hours in the week"
                    value={`${hours} h`}
                    hint="Across six working days. Sunday is a line item, not a gap."
                  />
                  <Stat
                    label="Fixed overhead"
                    value={`${formatCents(overhead)} / month`}
                    hint="What the business costs before it sells anything."
                  />
                  <Stat
                    label="A year of it"
                    value={formatCents(overhead * 12)}
                    hint="The number the year 2 revenue has to clear before anything is left."
                  />
                </StatGrid>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="The week, as it actually runs"
                note="In a company of one, the overhead is the calendar"
              />
              <TableScroll>
                <caption className="sr-only">
                  The founder&rsquo;s modelled week, day by day
                </caption>
                <thead>
                  <tr>
                    <Th>Day</Th>
                    <Th>What happens</Th>
                    <Th numeric>Hours</Th>
                  </tr>
                </thead>
                <tbody>
                  {plan.body.week.map((block) => (
                    <tr key={block.day}>
                      <Td>{block.day}</Td>
                      <Td>{block.work}</Td>
                      <Td numeric>{block.hours === 0 ? "—" : block.hours}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableScroll>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <Card>
                <CardHeader
                  title="Fixed costs, every month"
                  count={plan.body.fixedOverhead.length}
                />
                <TableScroll>
                  <caption className="sr-only">Fixed monthly overhead</caption>
                  <thead>
                    <tr>
                      <Th>Item</Th>
                      <Th numeric>Per month</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.body.fixedOverhead.map((line) => (
                      <tr key={line.item}>
                        <Td>{line.item}</Td>
                        <Td numeric>{formatCents(line.centsPerMonth)}</Td>
                      </tr>
                    ))}
                    <tr>
                      <Td className="font-medium">Total</Td>
                      <Td numeric className="font-medium">
                        {formatCents(overhead)}
                      </Td>
                    </tr>
                  </tbody>
                </TableScroll>
              </Card>

              <Card>
                <CardHeader
                  title="What every parcel costs"
                  note="Charged per parcel, not per bottle"
                />
                <Rows>
                  {plan.body.perOrderCosts.map((line) => (
                    <Row key={line.item}>
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="text-body-sm text-primary">{line.item}</p>
                        <p className="shrink-0 text-body-sm text-primary tabular-nums">
                          {formatCents(line.cents)}
                        </p>
                      </div>
                      <p className="mt-1 max-w-prose text-caption text-muted">
                        {line.note}
                      </p>
                    </Row>
                  ))}
                </Rows>
              </Card>
            </div>

            <Card>
              <CardHeader title="The constraints that do not move" />
              <CardBody>
                <Points items={plan.body.constraints} />
              </CardBody>
            </Card>

            <FailureMode text={plan.body.failureMode} />
          </div>
        </Section>

        {/* -------------------------------------------------- fuel tanks */}
        <Section
          title={`${plan.fuelTanks.aircraft} · ${plan.fuelTanks.discipline}`}
          description={plan.fuelTanks.purpose}
          id="cash"
        >
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Five accounts"
                note={`Operating account holds ${plan.fuelTanks.operatingBufferMonths} months of cost before anything is swept`}
              />
              <Rows>
                {plan.fuelTanks.accounts.map((account) => (
                  <Row key={account.account}>
                    <p className="text-body-sm font-medium text-primary">
                      {account.account}
                    </p>
                    <p className="mt-0.5 max-w-prose text-caption text-muted">
                      {account.holds}
                    </p>
                    <p className="mt-1 max-w-prose text-body-sm text-primary">
                      {account.rule}
                    </p>
                  </Row>
                ))}
              </Rows>
            </Card>

            <Card>
              <CardHeader
                title="GST"
                note={`${plan.fuelTanks.gst.ratePercent}% · ${plan.fuelTanks.gst.filingBasis}`}
              />
              <CardBody className="space-y-3">
                <p className="text-body-sm text-primary">
                  <span className="text-muted">Registration threshold</span>{" "}
                  <span className="font-medium tabular-nums">
                    {formatCents(plan.fuelTanks.gst.registrationThresholdCents)}
                  </span>{" "}
                  <span className="text-muted">in any 12 months</span>
                </p>
                <p className="max-w-prose text-body-sm text-primary">
                  {plan.fuelTanks.gst.note}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="The rules that keep it working" />
              <CardBody>
                <Points items={plan.fuelTanks.rules} />
              </CardBody>
            </Card>

            <FailureMode text={plan.fuelTanks.failureMode} />
          </div>
        </Section>

        <NextActions actions={plan.nextActions} />
      </div>
    </>
  );
}

function FailureMode({ text }: { text: string }) {
  return (
    <Callout title="What goes wrong when this part is starved">{text}</Callout>
  );
}

function SequenceCard({
  title,
  note,
  emails,
}: {
  title: string;
  note: string;
  emails: readonly {
    readonly email: number;
    readonly subject: string;
    readonly job: string;
  }[];
}) {
  return (
    <Card>
      <CardHeader title={title} count={emails.length} note={note} />
      <Rows>
        {emails.map((entry) => (
          <Row key={entry.email}>
            <div className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 font-mono text-caption text-muted tabular-nums"
              >
                {entry.email}
              </span>
              <div className="min-w-0">
                <p className="text-body-sm font-medium text-primary">
                  {entry.subject}
                </p>
                <p className="mt-0.5 max-w-prose text-caption text-muted">
                  {entry.job}
                </p>
              </div>
            </div>
          </Row>
        ))}
      </Rows>
    </Card>
  );
}
