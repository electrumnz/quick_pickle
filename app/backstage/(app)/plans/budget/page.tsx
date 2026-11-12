import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Empty, PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import {
  centsField,
  formatShare,
  formatSignedCents,
  formatTenths,
  shareField,
  type BreakEven,
  type PackEconomics,
} from "@/lib/backstage/plans/budget";
import {
  COST_BASES,
  COST_BASIS_BLURB,
  COST_BASIS_LABEL,
  type CostBasis,
} from "@/lib/backstage/plans/labels";
import {
  buildBudget,
  formatCostAmount,
  listCosts,
  type CostRow,
} from "@/lib/backstage/plans/ops";
import { countOf } from "@/lib/backstage/plans/shared";
import { factNow, shopOffer } from "@/lib/backstage/shop/ops";
import { formatNzdExact } from "@/lib/shop/money";

import {
  addCostAction,
  confirmCostAction,
  deleteCostAction,
  editCostAction,
} from "../actions";
import { Flash, Hint, PlansNav, Reveal } from "../parts";

export const metadata: Metadata = { title: "Budget" };

const HERE = "/backstage/plans/budget";

/** How a group's lines add up, said the way its amounts are written. */
function groupTotal(basis: CostBasis, lines: readonly CostRow[]): string {
  const sum = lines.reduce((total, line) => total + line.amount, 0);
  return formatCostAmount(basis, sum);
}

function breakEvenText(result: BreakEven): string {
  if (result.packsPerMonth === null) {
    return "Never. At these costs a pack leaves nothing to put towards the month.";
  }
  if (result.packsPerMonth === 0) return "Nothing to cover yet.";
  return `${countOf(result.packsPerMonth, "pack")} a month, about ${String(result.packsPerWeek ?? 0)} a week.`;
}

/** One pack's sums, with and without GST, side by side. */
function PackTable({
  plain,
  withGst,
  saleShare,
}: {
  readonly plain: PackEconomics;
  readonly withGst: PackEconomics;
  readonly saleShare: number;
}) {
  const row = (
    label: string,
    pick: (pack: PackEconomics) => string,
    strong = false,
  ) => (
    <tr>
      <td className={strong ? "font-semibold" : ""}>{label}</td>
      <td className={`bk-num ${strong ? "font-semibold" : ""}`}>
        {pick(plain)}
      </td>
      <td className={`bk-num ${strong ? "font-semibold" : ""}`}>
        {pick(withGst)}
      </td>
    </tr>
  );
  return (
    <div
      className="bk-table-wrap"
      role="region"
      aria-label={`${plain.name}: what one pack leaves`}
      tabIndex={0}
    >
      <table className="bk-table">
        <thead>
          <tr>
            <td className="border-navy border-b-2" />
            <th scope="col" className="bk-num">
              No GST
            </th>
            <th scope="col" className="bk-num">
              With GST
            </th>
          </tr>
        </thead>
        <tbody>
          {row("Price on the site", (pack) => formatNzdExact(pack.priceCents))}
          {row("Delivery the customer pays", (pack) =>
            pack.deliveryChargedCents === 0
              ? "Free"
              : formatNzdExact(pack.deliveryChargedCents),
          )}
          {row("The customer pays", (pack) => formatNzdExact(pack.paidCents))}
          {row("GST to pass on", (pack) =>
            pack.gstRegistered ? formatNzdExact(pack.gstCents) : "None",
          )}
          {row("You keep", (pack) => formatNzdExact(pack.keptCents), true)}
          {row(`${String(plain.shots)} shots`, (pack) =>
            formatNzdExact(pack.shotCostsCents),
          )}
          {row("The pack", (pack) => formatNzdExact(pack.packCostsCents))}
          {row("The order", (pack) => formatNzdExact(pack.orderCostsCents))}
          {row(`Share of the sale (${formatShare(saleShare)})`, (pack) =>
            formatNzdExact(pack.saleCostsCents),
          )}
          {row("Costs in all", (pack) => formatNzdExact(pack.costsCents), true)}
          {row(
            "What is left",
            (pack) => formatSignedCents(pack.leftCents),
            true,
          )}
          {row("As a share of what you keep", (pack) =>
            pack.marginTenths === null
              ? "Nothing kept"
              : formatTenths(pack.marginTenths),
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The budget: what a shot, a pack and a month cost, what a pack leaves, and
 * how many packs a month cover the fixed costs. For setting prices. It is
 * not accounting.
 */
export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const caller = await staffCaller();
  const canWrite = staff.role !== "viewer";
  const text = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };

  const costs = await execute(listCosts, {}, caller);
  // The prices and delivery rates the shop is selling at right now.
  const { offer } = await execute(shopOffer, {}, caller);

  const mix: Record<string, number> = {};
  for (const pack of offer.packs) {
    const raw = text(`m-${pack.sku}`);
    if (raw !== undefined && /^\d{1,3}$/.test(raw)) mix[pack.sku] = Number(raw);
  }
  const plain = buildBudget(costs, { offer, gstRegistered: false, mix });
  const withGst = buildBudget(costs, { offer, gstRegistered: true, mix });
  const { totals } = plain;

  const editId = text("edit");
  const editing =
    canWrite && editId !== undefined
      ? (costs.find((cost) => cost.id === editId) ?? null)
      : null;
  const standInPrices = offer.unconfirmed.some(
    (item) => item.key === "packs" || item.key === "shipping-rates",
  );
  const mixSaid = offer.packs
    .map((pack) => `${String(plain.mix[pack.sku] ?? 0)} of ${pack.name}`)
    .join(", ");

  return (
    <>
      <PageHeader
        title="Budget"
        back={{ href: "/backstage/plans", label: "Plans" }}
        lead="What a shot, a pack and a month really cost, and what a pack leaves. It is for setting prices. It is not accounting: that is Xero's job."
      />
      <PlansNav current="budget" />
      <Flash notice={text("notice")} tone={text("tone")} />

      <p className="bk-notice mb-5">
        <strong>These numbers are only as good as the costs entered.</strong>{" "}
        {totals.lines === 0
          ? "No costs have been entered yet."
          : totals.unconfirmed === 0
            ? `All ${String(totals.lines)} costs are confirmed.`
            : `${String(totals.unconfirmed)} of ${String(totals.lines)} costs ${totals.unconfirmed === 1 ? "is still a stand-in" : "are still stand-ins"}, not from a real quote or invoice.`}{" "}
        {standInPrices
          ? "The pack prices and delivery charges come from the site, and they are stand-ins too. "
          : ""}
        Every amount is in New Zealand dollars.
      </p>

      {editing !== null ? (
        <Panel title="Change a cost" className="mb-6">
          <form
            id="edit"
            action={editCostAction}
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <input type="hidden" name="id" value={editing.id} />
            <div>
              <label htmlFor="edit-name" className="field-label">
                What it is
              </label>
              <input
                id="edit-name"
                name="name"
                required
                maxLength={80}
                defaultValue={editing.name}
                className="field"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="edit-basis" className="field-label">
                  Paid
                </label>
                <select
                  id="edit-basis"
                  name="basis"
                  defaultValue={editing.basis}
                  className="field"
                >
                  {COST_BASES.map((basis) => (
                    <option key={basis} value={basis}>
                      {COST_BASIS_LABEL[basis]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="edit-amount" className="field-label">
                  Amount
                </label>
                <input
                  id="edit-amount"
                  name="amount"
                  required
                  inputMode="decimal"
                  defaultValue={
                    editing.basis === "sale"
                      ? shareField(editing.amount)
                      : centsField(editing.amount)
                  }
                  aria-describedby="edit-amount-hint"
                  className="field"
                />
              </div>
            </div>
            <Hint id="edit-amount-hint">
              Dollars and cents, like 1.25. For a share of each sale, a
              percentage, like 1.5. Whole cents only: round a part-cent up.
            </Hint>
            <div>
              <label htmlFor="edit-notes" className="field-label">
                Notes
              </label>
              <textarea
                id="edit-notes"
                name="notes"
                rows={3}
                maxLength={600}
                defaultValue={editing.notes}
                className="field"
              />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                name="confirmed"
                defaultChecked={editing.confirmed}
                className="accent-navy size-5 shrink-0"
              />
              <span>This figure is from a real quote or invoice</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton pending="Saving">Save the cost</SubmitButton>
              <Link href={`${HERE}#costs`} className="bk-btn bk-btn-quiet">
                <span className="cap-trim">Cancel</span>
              </Link>
            </div>
          </form>
          <details className="mt-3">
            <Reveal tone="danger">Delete this cost</Reveal>
            <form action={deleteCostAction} className="mt-2">
              <input type="hidden" name="id" value={editing.id} />
              <p className="mb-3 leading-snug">
                Only for a cost the business does not have. For one that is real
                but not known yet, leave it at nothing and not confirmed.
                Deleting cannot be undone.
              </p>
              <SubmitButton pending="Deleting" className="bk-btn bk-btn-pink">
                Delete it for good
              </SubmitButton>
            </form>
          </details>
        </Panel>
      ) : null}

      <div className="flex flex-col gap-6">
        <Panel title="What things cost" flush>
          <div id="costs" className="scroll-mt-24">
            {costs.length === 0 ? (
              <Empty title="No costs yet">
                Each cost gets a line here: the juice, a bottle, the courier, a
                month of hosting.
                {canWrite ? " Add the first one below." : ""}
              </Empty>
            ) : (
              COST_BASES.map((basis) => {
                const lines = costs.filter((cost) => cost.basis === basis);
                if (lines.length === 0) return null;
                return (
                  <div
                    key={basis}
                    className="border-navy-line border-b last:border-b-0"
                  >
                    <div className="bg-mist flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                      <h3 className="label text-[1.1rem]">
                        <span className="cap-trim">
                          {COST_BASIS_LABEL[basis]}
                        </span>
                      </h3>
                      <p className="bk-num font-semibold">
                        {groupTotal(basis, lines)}
                      </p>
                      <p className="bk-muted basis-full text-[0.9375rem] leading-snug">
                        {COST_BASIS_BLURB[basis]}
                      </p>
                    </div>
                    <ul className="bk-rows">
                      {lines.map((cost) => (
                        <li
                          key={cost.id}
                          className="bk-row grid-cols-[1fr_auto]"
                        >
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2">
                              <span
                                id={`cn-${cost.id}`}
                                className="leading-snug font-semibold"
                              >
                                {cost.name}
                              </span>
                              {cost.confirmed ? null : (
                                <Pill tone="todo">Not confirmed</Pill>
                              )}
                            </p>
                            {cost.notes === "" ? null : (
                              <p className="bk-muted mt-0.5 text-[0.9375rem] leading-snug">
                                {cost.notes}
                              </p>
                            )}
                          </div>
                          <p className="bk-num self-start font-semibold">
                            {formatCostAmount(cost.basis, cost.amount)}
                          </p>
                          {canWrite ? (
                            <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-1">
                              <Link
                                href={`${HERE}?edit=${cost.id}#edit`}
                                aria-describedby={`cn-${cost.id}`}
                                className="label bk-muted inline-flex min-h-11 items-center text-[1.05rem]"
                              >
                                <span className="cap-trim">Change</span>
                              </Link>
                              {cost.confirmed ? null : (
                                <form action={confirmCostAction}>
                                  <input
                                    type="hidden"
                                    name="id"
                                    value={cost.id}
                                  />
                                  <button
                                    type="submit"
                                    aria-describedby={`cn-${cost.id}`}
                                    className="label bk-muted inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]"
                                  >
                                    <span className="cap-trim">
                                      Confirm as it is
                                    </span>
                                  </button>
                                </form>
                              )}
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
          {canWrite ? (
            <details className="border-navy-line border-t px-4 py-2">
              <Reveal>Add a cost</Reveal>
              <form
                action={addCostAction}
                className="mt-1 mb-2 flex max-w-[40rem] flex-col gap-3"
              >
                <div>
                  <label htmlFor="new-name" className="field-label">
                    What it is
                  </label>
                  <input
                    id="new-name"
                    name="name"
                    required
                    maxLength={80}
                    className="field"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="new-basis" className="field-label">
                      Paid
                    </label>
                    <select id="new-basis" name="basis" className="field">
                      {COST_BASES.map((basis) => (
                        <option key={basis} value={basis}>
                          {COST_BASIS_LABEL[basis]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="new-amount" className="field-label">
                      Amount
                    </label>
                    <input
                      id="new-amount"
                      name="amount"
                      required
                      inputMode="decimal"
                      defaultValue="0.00"
                      aria-describedby="new-amount-hint"
                      className="field"
                    />
                  </div>
                </div>
                <Hint id="new-amount-hint">
                  Dollars and cents, like 1.25. For a share of each sale, a
                  percentage, like 1.5. Leave it at nothing if you do not know
                  yet: do not guess.
                </Hint>
                <div>
                  <label htmlFor="new-notes" className="field-label">
                    Notes
                  </label>
                  <input
                    id="new-notes"
                    name="notes"
                    maxLength={600}
                    aria-describedby="new-notes-hint"
                    className="field"
                  />
                  <Hint id="new-notes-hint">
                    Where the figure comes from, or where it will.
                  </Hint>
                </div>
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    name="confirmed"
                    className="accent-navy size-5 shrink-0"
                  />
                  <span>This figure is from a real quote or invoice</span>
                </label>
                <div>
                  <SubmitButton pending="Adding">Add the cost</SubmitButton>
                </div>
              </form>
            </details>
          ) : null}
        </Panel>

        <Panel title="What a pack leaves">
          <p className="leading-snug">
            One order of one pack, sent to a town address.{" "}
            <strong>No GST</strong> is how it works out if the business is not
            registered for GST in New Zealand. <strong>With GST</strong> is how
            it works out if it is: 3/23 of everything the customer pays is GST
            to pass on.{" "}
            {offer.gstRegistered === null
              ? "Which one applies is not settled yet, so both are shown and neither is assumed."
              : offer.gstRegistered
                ? "The shop is set as registered, so the With GST column is the one that applies."
                : "The shop is set as not registered, so the No GST column is the one that applies."}
          </p>
          <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
            {factNow("shipping-rates", offer)}. The prices and the delivery
            rates come straight from{" "}
            <Link
              href="/backstage/settings/shop"
              className="underline decoration-2 underline-offset-4"
            >
              the shop&apos;s settings
            </Link>
            .
          </p>
          <div className="mt-4 flex flex-col gap-6">
            {plain.packs.map((pack, index) => {
              const other = withGst.packs[index];
              if (other === undefined) return null;
              return (
                <div key={pack.sku}>
                  <h3 className="label mb-1 text-[1.15rem]">
                    <span className="cap-trim">
                      {pack.name}: {pack.shots} shots
                    </span>
                  </h3>
                  <PackTable
                    plain={pack}
                    withGst={other}
                    saleShare={totals.saleShare}
                  />
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Break-even">
          <div id="break-even" className="scroll-mt-24">
            <p className="leading-snug">
              The monthly costs come to{" "}
              <strong>{formatNzdExact(totals.perMonthCents)}</strong>. How many
              packs a month cover them depends on which packs sell.
            </p>

            <form action={`${HERE}#break-even`} method="get" className="mt-4">
              <fieldset>
                <legend className="field-label">
                  Out of the packs you sell, how many are each size
                </legend>
                <div className="grid grid-cols-3 gap-3">
                  {offer.packs.map((pack) => (
                    <div key={pack.sku}>
                      <label
                        htmlFor={`m-${pack.sku}`}
                        className="bk-muted mb-1 block text-[0.9375rem] leading-snug"
                      >
                        {pack.name}
                      </label>
                      <input
                        id={`m-${pack.sku}`}
                        name={`m-${pack.sku}`}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={3}
                        defaultValue={plain.mix[pack.sku] ?? 0}
                        className="field"
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
              <div className="mt-3">
                <button type="submit" className="bk-btn bk-btn-quiet">
                  <span className="cap-trim">Work it out</span>
                </button>
              </div>
            </form>

            <dl className="bk-kv mt-5">
              <dt>The mix</dt>
              <dd>{mixSaid}</dd>
              <dt>No GST</dt>
              <dd className="font-semibold">
                {breakEvenText(plain.breakEven)}
              </dd>
              <dt>With GST</dt>
              <dd className="font-semibold">
                {breakEvenText(withGst.breakEven)}
              </dd>
            </dl>

            <h3 className="label mt-6 mb-1 text-[1.15rem]">
              <span className="cap-trim">If only one size sold</span>
            </h3>
            <div
              className="bk-table-wrap"
              role="region"
              aria-label="Break-even if only one size sold"
              tabIndex={0}
            >
              <table className="bk-table">
                <thead>
                  <tr>
                    <th scope="col">Pack</th>
                    <th scope="col" className="bk-num">
                      No GST
                    </th>
                    <th scope="col" className="bk-num">
                      With GST
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plain.breakEvenAlone.map((alone, index) => {
                    const other = withGst.breakEvenAlone[index];
                    const say = (result: BreakEven | undefined) =>
                      result === undefined || result.packsPerMonth === null
                        ? "Never"
                        : `${String(result.packsPerMonth)} a month`;
                    return (
                      <tr key={alone.sku}>
                        <td>{alone.name}</td>
                        <td className="bk-num">{say(alone.breakEven)}</td>
                        <td className="bk-num">{say(other?.breakEven)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>

        <Panel title="How these sums work">
          <ul className="flex list-disc flex-col gap-2 pl-6 leading-snug">
            <li>
              One order holds one pack. An order with two packs does better than
              this, because the courier and the other per-order costs are
              shared.
            </li>
            <li>
              Delivery is to a town address. The rural extra the customer pays
              is taken to be what the courier charges on top.
            </li>
            <li>
              Costs are used as they were entered. If the business is registered
              for GST, enter costs without GST, because it gets that back. If it
              is not, enter what it actually pays.
            </li>
            <li>
              A per-pack cost is the same for every pack size. If the boxes
              differ a lot, enter the dearest.
            </li>
            <li>
              Everything is in whole cents and rounded against us: a share of a
              sale is rounded up to the next cent, percentages are rounded down,
              and packs to sell are rounded up. GST is 3/23 of what the customer
              pays, to the nearest cent, the same sum the shop uses.
            </li>
            <li>
              This is not the books. It does not know what was really sold or
              spent. Xero and your accountant do that.
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
