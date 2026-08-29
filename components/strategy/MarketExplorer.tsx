"use client";

import { useMemo, useState } from "react";

import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Rows,
  Row,
  Stat,
  StatGrid,
  TableScroll,
  Td,
  Th,
} from "@/components/admin/ui/primitives";
import {
  computeMarket,
  formatCents,
  formatCentsShort,
} from "@/content/strategy/market";
import type {
  MarketInput,
  MarketLayer,
  StrategySource,
} from "@/content/strategy/types";

import { ConfidenceBadge } from "./pieces";

/**
 * The market model, with its assumptions open to the touch.
 *
 * A TAM whose assumptions cannot be inspected is decoration. So every number on
 * this screen is either an input she can change or a line of arithmetic that
 * says which inputs it consumed — and changing an input recomputes the whole
 * model in front of her, using `computeMarket`, which is the same function the
 * agent runtime calls. There is no second copy of the sums for the UI.
 *
 * Editing here is local: it answers "what if" without committing to it. The
 * SQL that would make a change permanent is shown at the bottom, because the
 * stored values are what the AI team reasons from, and quietly diverging the
 * two would be worse than not letting her edit at all.
 */

const MICRO = 1_000_000;

function formatValue(input: MarketInput, value: number): string {
  switch (input.unit) {
    case "cents":
      return formatCents(value);
    case "ratio":
      return `${(value * 100).toFixed(value * 100 < 10 ? 1 : 0)}%`;
    case "multiplier":
      return `× ${value.toFixed(2)}`;
    case "per_year":
      return `${value.toLocaleString("en-NZ")} a year`;
    case "years":
      return `${value.toLocaleString("en-NZ")} years`;
    default:
      return value.toLocaleString("en-NZ");
  }
}

function stepValue(calculation: { value: number; unit: string }): string {
  return calculation.unit === "cents"
    ? formatCents(calculation.value)
    : calculation.value.toLocaleString("en-NZ", { maximumFractionDigits: 2 });
}

function LayerTable({ layer }: { layer: MarketLayer }) {
  return (
    <Card>
      <CardHeader title={layer.name} note={layer.scope} />
      <CardBody className="border-b border-hairline">
        <p className="max-w-prose text-body-sm text-muted">{layer.meaning}</p>
      </CardBody>
      <TableScroll>
        <caption className="sr-only">
          {`Every line of arithmetic behind ${layer.name}`}
        </caption>
        <thead>
          <tr>
            <Th>Step</Th>
            <Th>The sum, with the numbers in it</Th>
            <Th numeric>Result</Th>
          </tr>
        </thead>
        <tbody>
          {layer.steps.map((step) => (
            <tr key={step.id}>
              <Td>
                <span className="font-medium">{step.label}</span>
                {step.uses.length > 0 && (
                  <span className="mt-0.5 block text-caption text-muted">
                    uses {step.uses.join(", ")}
                  </span>
                )}
              </Td>
              <Td>
                <span className="font-mono text-caption break-words">
                  {step.expression}
                </span>
              </Td>
              <Td numeric>{stepValue(step)}</Td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
    </Card>
  );
}

export function MarketExplorer({
  inputs,
  sources,
  storedFromDatabase,
}: {
  inputs: readonly MarketInput[];
  sources: readonly StrategySource[];
  /** True when these values came out of strategy_assumptions rather than code. */
  storedFromDatabase: boolean;
}) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const edited = useMemo(
    () =>
      inputs.map((input) =>
        input.id in overrides
          ? { ...input, value: overrides[input.id] ?? input.value }
          : input,
      ),
    [inputs, overrides],
  );

  const model = useMemo(() => computeMarket(edited), [edited]);
  const baseline = useMemo(() => computeMarket(inputs), [inputs]);
  const changed = Object.keys(overrides).filter((id) => {
    const original = inputs.find((input) => input.id === id);
    return original !== undefined && original.value !== overrides[id];
  });

  const sourceFor = (id: string | undefined): StrategySource | undefined =>
    id === undefined ? undefined : sources.find((entry) => entry.id === id);

  return (
    <div className="space-y-8">
      <section aria-labelledby="market-headline">
        <h2 id="market-headline" className="sr-only">
          The three market layers
        </h2>
        <Card>
          <CardBody>
            <StatGrid columns={4}>
              <Stat
                label="TAM — New Zealand"
                value={formatCentsShort(model.tam.totalCents)}
                hint="Everyone here who could plausibly buy, spending for a year. Nobody ever gets this."
              />
              <Stat
                label="TAM — with Australia"
                value={formatCentsShort(model.tamWithAustralia.totalCents)}
                hint="The same sum across the Tasman. Not reachable yet, and not in the plan."
              />
              <Stat
                label="SAM — reachable"
                value={formatCentsShort(model.sam.totalCents)}
                hint="The slice the three channels you actually have can reach."
              />
              <Stat
                label="SOM — year 2"
                value={formatCents(model.som.totalCents)}
                hint="What one person can make and sell by month 24. This is the promise."
              />
            </StatGrid>
            <p className="mt-5 border-t border-hairline pt-4 text-caption text-muted">
              {model.basis} Cumulative over 24 months:{" "}
              <span className="font-medium text-primary tabular-nums">
                {formatCents(model.somCumulative24MonthCents)}
              </span>
              .
            </p>
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="market-targets" className="space-y-3">
        <div>
          <h2
            id="market-targets"
            className="font-sans text-body font-semibold tracking-tight text-primary"
          >
            What the SOM means on a Tuesday
          </h2>
          <p className="mt-1 max-w-prose text-caption text-muted">
            The same number, in things you can count and act on this week. If
            these look impossible, the model is wrong — not you.
          </p>
        </div>
        <Card>
          <Rows>
            {model.targets.map((target) => (
              <Row key={target.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-body-sm font-medium text-primary">
                    {target.label}
                  </p>
                  <p className="font-sans text-heading-3 font-semibold text-primary tabular-nums">
                    {target.value}
                  </p>
                </div>
                <p className="mt-1 max-w-prose text-caption text-muted">
                  {target.derivation}
                </p>
              </Row>
            ))}
          </Rows>
        </Card>
      </section>

      <section aria-labelledby="market-assumptions" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div>
            <h2
              id="market-assumptions"
              className="font-sans text-body font-semibold tracking-tight text-primary"
            >
              The assumptions — change one and watch everything move
            </h2>
            <p className="mt-1 max-w-prose text-caption text-muted">
              Every figure above is either one of these {inputs.length} numbers
              or arithmetic over them. Editing here changes this screen only;
              the stored values are what the AI team reasons from.
            </p>
          </div>
          {changed.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setOverrides({});
              }}
              className="rounded-sm border border-hairline px-3 py-1.5 text-caption font-medium text-primary hover:bg-surface-sunken"
            >
              Reset {changed.length} change{changed.length === 1 ? "" : "s"}
            </button>
          )}
        </div>

        <Card>
          <ul className="divide-y divide-hairline">
            {edited.map((input) => {
              const original = inputs.find((entry) => entry.id === input.id);
              const isChanged =
                original !== undefined && original.value !== input.value;
              const source = sourceFor(input.sourceId);
              return (
                <li key={input.id} className="px-4 py-3.5">
                  <div className="grid gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={`assumption-${input.id}`}
                          className="text-body-sm font-medium text-primary"
                        >
                          {input.label}
                        </label>
                        <ConfidenceBadge confidence={input.confidence} />
                        {isChanged && <Badge tone="accent">Changed</Badge>}
                      </div>
                      <p className="mt-1 max-w-prose text-caption text-muted">
                        {input.rationale}
                      </p>
                      {source !== undefined && (
                        <p className="mt-1 text-caption text-muted">
                          Source:{" "}
                          <a
                            href={source.url}
                            rel="noreferrer noopener"
                            target="_blank"
                            className="text-link underline underline-offset-4"
                          >
                            {source.publisher} — {source.title}
                          </a>{" "}
                          (read {source.retrieved})
                        </p>
                      )}
                      <p className="mt-1 font-mono text-caption text-muted">
                        {input.id}
                      </p>
                    </div>
                    <div className="lg:text-right">
                      <input
                        id={`assumption-${input.id}`}
                        type="number"
                        value={input.value}
                        min={input.min}
                        max={input.max}
                        step={input.step}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (!Number.isFinite(next)) return;
                          const clamped = Math.min(
                            Math.max(next, input.min),
                            input.max,
                          );
                          setOverrides((current) => ({
                            ...current,
                            [input.id]: clamped,
                          }));
                        }}
                        className="w-full rounded-sm border border-hairline bg-surface-page px-3 py-2 text-right font-mono text-body-sm text-primary tabular-nums"
                      />
                      <p className="mt-1 text-caption text-muted">
                        {formatValue(input, input.value)}
                        {isChanged && original !== undefined && (
                          <> (was {formatValue(original, original.value)})</>
                        )}
                      </p>
                      <p className="mt-0.5 text-caption text-muted">
                        range {formatValue(input, input.min)} –{" "}
                        {formatValue(input, input.max)}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        {changed.length > 0 && (
          <Callout title="To make these the numbers the AI team uses">
            <p>
              This screen is showing a what-if. The agents read
              <code className="mx-1 font-mono">strategy_assumptions</code>, so
              run this to make it permanent — editing from the admin is not
              built yet, and pretending otherwise would leave the two copies
              disagreeing.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-sm border border-hairline bg-surface-page px-3 py-2 font-mono text-caption text-primary">
              {changed
                .map((id) => {
                  const value = overrides[id] ?? 0;
                  return `update public.strategy_assumptions set value_micro = ${String(
                    Math.round(value * MICRO),
                  )} where slug = '${id}';`;
                })
                .join("\n")}
            </pre>
            <p className="mt-2">
              Year 2 revenue moves from{" "}
              <strong>{formatCents(baseline.som.totalCents)}</strong> to{" "}
              <strong>{formatCents(model.som.totalCents)}</strong>, and the
              reachable market from{" "}
              <strong>{formatCentsShort(baseline.sam.totalCents)}</strong> to{" "}
              <strong>{formatCentsShort(model.sam.totalCents)}</strong>.
            </p>
          </Callout>
        )}

        {!storedFromDatabase && (
          <Callout
            title="These are the deployed values, not the stored ones"
            tone="danger"
          >
            The database could not be reached, so this page is showing the
            assumptions as they stand in the code. The AI team may be using
            different ones.
          </Callout>
        )}
      </section>

      <section aria-labelledby="market-arithmetic" className="space-y-4">
        <div>
          <h2
            id="market-arithmetic"
            className="font-sans text-body font-semibold tracking-tight text-primary"
          >
            The arithmetic, in full
          </h2>
          <p className="mt-1 max-w-prose text-caption text-muted">
            Every line, with the numbers substituted in. Nothing on this page is
            a figure somebody typed — if it is not an assumption above, it is
            one of these sums.
          </p>
        </div>
        <LayerTable layer={model.tam} />
        <LayerTable layer={model.tamWithAustralia} />
        <LayerTable layer={model.sam} />
        <LayerTable layer={model.som} />
      </section>

      <section aria-labelledby="market-crosschecks" className="space-y-3">
        <div>
          <h2
            id="market-crosschecks"
            className="font-sans text-body font-semibold tracking-tight text-primary"
          >
            Testing the model from outside it
          </h2>
          <p className="mt-1 max-w-prose text-caption text-muted">
            Three questions the arithmetic above cannot answer about itself.
          </p>
        </div>
        <Card>
          <Rows>
            {model.crossChecks.map((check) => (
              <Row key={check.id}>
                <p className="text-body-sm font-medium text-primary">
                  {check.question}
                </p>
                <p className="mt-1 max-w-prose text-caption text-muted">
                  {check.workings}
                </p>
                <p className="mt-1.5 max-w-prose text-body-sm text-primary">
                  {check.reading}
                </p>
              </Row>
            ))}
          </Rows>
        </Card>
      </section>

      <section aria-labelledby="market-headwinds" className="space-y-3">
        <div>
          <h2
            id="market-headwinds"
            className="font-sans text-body font-semibold tracking-tight text-primary"
          >
            What this model refuses to assume
          </h2>
          <p className="mt-1 max-w-prose text-caption text-muted">
            Hospitality is not growing. Nothing here is modelled as if it were.
          </p>
        </div>
        <Card>
          <Rows>
            {model.headwinds.map((headwind) => (
              <Row key={headwind}>
                <p className="max-w-prose text-body-sm text-primary">
                  {headwind}
                </p>
              </Row>
            ))}
          </Rows>
        </Card>
      </section>
    </div>
  );
}
