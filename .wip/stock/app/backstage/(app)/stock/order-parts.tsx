import Link from "next/link";
import type { ReactNode } from "react";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Panel, Pill } from "@/components/backstage/ui";
import type { OrderStatus } from "@/db/schema";
import { formatDateKey } from "@/lib/backstage/stock/dates";
import type { OrderStock } from "@/lib/backstage/stock/ops";
import { mixFieldName } from "@/lib/backstage/stock/pack-form";

import { recordOrderBatchAction } from "./actions";
import { count, Hint, shots } from "./parts";

/**
 * Stock's part of an order's own page: which batch goes in the box when it
 * is packed, and which batch it did come from afterwards. Kept here, beside
 * the rest of Stock, and dropped into the order page.
 *
 * The batch on record is always the one the person packing says is in the
 * box. The screen suggests the batch to use first; it never decides.
 */

type Choice = OrderStock["choices"][number];

/*
 * The word that matters comes first: on a phone the closed list only has
 * room for the start of the line.
 */
function choiceLabel(choice: Choice, suggested: boolean): string {
  const date =
    choice.bestBefore === null
      ? "no best-before date"
      : `best before ${formatDateKey(choice.bestBefore)}`;
  const mark = !choice.enough ? " (not enough)" : suggested ? " (use first)" : "";
  return `${choice.code}${mark}: ${count(choice.onHand)} on hand, ${date}`;
}

/**
 * The boxes that say which batch is in the box. Posts `batchCode` for a box
 * from one batch, or a `mix-<code>` number for each batch in a mixed one
 * (see lib/backstage/stock/pack-form.ts, which reads them back).
 */
function BatchInBox({
  form,
  stock,
}: {
  /** A word for the form, so two on a page never share an id. */
  readonly form: string;
  readonly stock: OrderStock;
}) {
  const plan = stock.plan ?? [];
  const suggested = plan.length === 1 ? plan[0]?.code : undefined;
  const split = plan.length > 1;
  const share = (code: string) =>
    plan.find((take) => take.code === code)?.shots;

  const mix = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {stock.choices.map((choice) => (
          <div key={choice.code}>
            <label
              htmlFor={`${form}-mix-${choice.code}`}
              className="field-label"
            >
              Shots from {choice.code}
            </label>
            <input
              id={`${form}-mix-${choice.code}`}
              name={mixFieldName(choice.code)}
              inputMode="numeric"
              defaultValue={split ? (share(choice.code) ?? "") : ""}
              aria-describedby={`${form}-mix-hint`}
              className="field"
            />
          </div>
        ))}
      </div>
      <Hint id={`${form}-mix-hint`}>
        They have to add up to {count(stock.need)}.{" "}
        {stock.choices
          .map((choice) => `${choice.code} has ${count(choice.onHand)}`)
          .join(", ")}
        .
      </Hint>
    </div>
  );

  if (split) {
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="field-label">Which batches are in the box?</legend>
        <p className="leading-snug">
          No one batch can fill this order, so it has to be a mix. Check the
          codes on the bottles and change the numbers if the box is
          different.
        </p>
        {mix}
      </fieldset>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <label htmlFor={`${form}-batch`} className="field-label">
          Which batch is in the box?
        </label>
        <select
          id={`${form}-batch`}
          name="batchCode"
          defaultValue={suggested ?? ""}
          aria-describedby={`${form}-batch-hint`}
          className="field"
        >
          {stock.choices.map((choice) => (
            <option
              key={choice.code}
              value={choice.code}
              disabled={!choice.enough}
            >
              {choiceLabel(choice, choice.code === suggested)}
            </option>
          ))}
        </select>
        <Hint id={`${form}-batch-hint`}>
          Check the code on the bottles. This is what a recall would go by.
        </Hint>
      </div>
      {stock.choices.length > 1 ? (
        <details>
          <summary className="label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]">
            <span className="cap-trim">The box mixes batches</span>
          </summary>
          <div className="mt-2">{mix}</div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Goes inside the "Mark as packed" form, around its button. Asks which
 * batch is in the box whenever there is stock to take it from, and says in
 * a sentence what packing will do when there is not.
 */
export function PackFrom({
  stock,
  children,
}: {
  readonly stock: OrderStock;
  readonly children: ReactNode;
}) {
  // Nothing to choose: a test order, or no batch with stock on sale.
  if (stock.isTest || (stock.choices.length === 0 && !stock.blocked)) {
    return (
      <>
        {children}
        <p className="bk-muted text-[0.9375rem] leading-snug">
          {stock.summary}
        </p>
      </>
    );
  }
  // There is stock, but this order cannot be packed from it as things are.
  if (stock.blocked) {
    return (
      <p className="bk-notice bk-notice-bad">
        {stock.summary}{" "}
        <Link href="/backstage/stock" className="link">
          Open Stock
        </Link>
      </p>
    );
  }
  return (
    <>
      <BatchInBox form="pack" stock={stock} />
      {children}
    </>
  );
}

/**
 * Goes inside the "Cancel this order" form. A packed box holds shots from a
 * batch; they only go back on the shelf if the person cancelling says so.
 */
export function CancelRestock({ stock }: { readonly stock: OrderStock }) {
  const held = stock.filled.reduce((sum, batch) => sum + batch.shots, 0);
  if (held === 0) return null;
  const batches = stock.filled.map((batch) => batch.code).join(" and ");
  return (
    <div>
      <label
        htmlFor="cancel-restock"
        className="flex min-h-11 items-center gap-3"
      >
        <input
          id="cancel-restock"
          type="checkbox"
          name="restock"
          value="true"
          aria-describedby="cancel-restock-hint"
          className="accent-navy size-6 shrink-0"
        />
        <span className="leading-snug">
          Its {shots(held)} are going back on the shelf ({batches})
        </span>
      </label>
      <Hint id="cancel-restock-hint">
        Leave this unticked and they are written off instead. Nothing goes
        back into stock unless you say it has.
      </Hint>
    </div>
  );
}

/**
 * Goes under the "Mark as shipped" button on an order that is not packed
 * yet. Shipping takes the stock as well, but has nowhere to say which batch.
 */
export function ShipNote({ stock }: { readonly stock: OrderStock }) {
  // When it cannot be packed at all, the notice above already says why.
  if (!stock.mustChoose || stock.blocked) return null;
  return (
    <Hint>
      More than one batch is on sale, so mark it as packed first. That is
      where you say which batch is in the box.
    </Hint>
  );
}

/** Goes under the "Not packed after all" button. */
export function UnpackNote({ stock }: { readonly stock: OrderStock }) {
  const held = stock.filled.reduce((sum, batch) => sum + batch.shots, 0);
  if (held === 0) return null;
  return (
    <Hint>
      This puts its {shots(held)} back in{" "}
      {stock.filled.map((batch) => batch.code).join(" and ")}.
    </Hint>
  );
}

const PACKED: readonly OrderStatus[] = ["packed", "shipped", "delivered"];

/**
 * Which batch an order was filled from, once it has been packed. An order
 * that went out before batches were recorded says so, and can be given its
 * batch here.
 */
export function OrderStockPanel({
  number,
  status,
  stock,
  canWrite,
}: {
  readonly number: string;
  readonly status: OrderStatus;
  readonly stock: OrderStock;
  readonly canWrite: boolean;
}) {
  if (!PACKED.includes(status) && stock.filled.length === 0) return null;

  return (
    <Panel title="Filled from">
      {stock.filled.length > 0 ? (
        <ul className="flex flex-col">
          {stock.filled.map((batch) => (
            <li
              key={batch.code}
              className="flex flex-wrap items-center justify-between gap-x-4"
            >
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/backstage/stock/batches/${batch.code}`}
                  className="link min-w-11 font-semibold tabular-nums"
                >
                  {batch.code}
                </Link>
                <span className="bk-muted text-[0.9375rem]">{batch.name}</span>
                {batch.status === "recalled" ? (
                  <Pill tone="todo">Recalled</Pill>
                ) : null}
              </span>
              <span className="bk-num font-semibold">{shots(batch.shots)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {stock.isTest ? (
        <p className="bk-muted leading-snug">{stock.summary}</p>
      ) : stock.missing > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="leading-snug">
            {stock.filled.length === 0
              ? "No batch recorded for this order."
              : `No batch is recorded for the other ${count(stock.missing)} of its shots.`}{" "}
            <span className="bk-muted">
              It is on no batch&apos;s recall list until one is.
            </span>
          </p>
          {!canWrite ? null : stock.blocked || stock.choices.length === 0 ? (
            <p className="bk-muted text-[0.9375rem] leading-snug">
              No batch on sale has the stock to record it against yet.
            </p>
          ) : (
            <form
              action={recordOrderBatchAction}
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="number" value={number} />
              <BatchInBox form="record" stock={stock} />
              <SubmitButton
                pending="Saving"
                className="bk-btn bk-btn-quiet w-full"
              >
                Record the batch
              </SubmitButton>
              <Hint>
                This takes its {shots(stock.missing)} out of that batch&apos;s
                count now.
              </Hint>
            </form>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
