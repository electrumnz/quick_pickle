import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Panel, Pill } from "@/components/backstage/ui";
import {
  COST_KIND_LABEL,
  COST_KINDS,
} from "@/lib/backstage/marketing/collab-sums";
import type { PartnerResults } from "@/lib/backstage/marketing/collabs";
import { dayLabel } from "@/lib/backstage/marketing/dates";
import { plural } from "@/lib/backstage/marketing/shared";
import { formatNzd, formatNzdExact } from "@/lib/shop/money";

import {
  Figure,
  perDollar,
  SalesSmallPrint,
  TakingsList,
} from "../../collab-parts";
import { Fold, PromoPill, SelectField, TextField } from "../../parts";
import {
  addPartnerCostAction,
  removePartnerCostAction,
  setPartnerCutAction,
} from "../actions";

/**
 * A partner's collab, on their own page: what they have brought in, what
 * working with them has cost, and what came back for each dollar.
 *
 * Written to be read by someone who does not want to learn how any of it
 * works. The top line is one sentence. Everything under it is where that
 * sentence came from.
 */

function Id({ value }: { readonly value: string }) {
  return <input type="hidden" name="id" value={value} />;
}

/** The whole reckoning as one or two sentences. */
function inAWord(results: PartnerResults): string {
  const { takings, result, name } = results;
  const nothingIn = takings.orders === 0;
  const nothingOut = result.spendCents === 0;
  if (nothingIn && nothingOut) {
    return `Nothing yet. Give ${name} a promo code or a short link of their own, and the orders that come from them are counted here.`;
  }
  const brought = nothingIn
    ? `No paid orders have come from ${name} yet.`
    : `${name} ${takings.orders === 1 ? "has" : "have"} brought in ${plural(takings.orders, "paid order")} worth ${formatNzdExact(takings.salesCents)}.`;
  if (nothingOut) {
    return `${brought} Nothing has been written down as spent on them, so there is no return to work out yet.`;
  }
  const cost = `Working with them has cost ${formatNzdExact(result.spendCents)} so far`;
  if (nothingIn || result.backPerDollarCents === null) {
    return `${brought} ${cost}.`;
  }
  return `${brought} ${cost}, so ${perDollar(result.backPerDollarCents)} in sales has come back for every $1 spent.`;
}

export function Collab({
  results,
  canWrite,
  today,
  site,
}: {
  readonly results: PartnerResults;
  readonly canWrite: boolean;
  /** Today in New Zealand, as 2026-11-12: the latest day a cost can carry. */
  readonly today: string;
  readonly site: string;
}) {
  const { takings, result, spend, costs, codes, links } = results;
  const id = results.partnerId;

  return (
    <div className="mb-6 grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
      <div className="flex flex-col gap-6">
        <Panel title="What they have brought in">
          <p className="leading-snug">{inAWord(results)}</p>
          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            <Figure label="Sales" value={formatNzd(takings.salesCents)} />
            <Figure label="Paid orders" value={takings.orders} />
            <Figure label="Cost" value={formatNzd(result.spendCents)} />
            <Figure
              label="Back per $1"
              value={
                result.backPerDollarCents === null
                  ? "n/a"
                  : perDollar(result.backPerDollarCents)
              }
            />
          </div>
          <div className="mt-5">
            <TakingsList takings={takings} brief />
          </div>
          <SalesSmallPrint>
            This is sales, not profit: what the product and the postage cost you
            is not taken off. The budget under Plans has that.
          </SalesSmallPrint>
        </Panel>

        <Panel title="Their codes and links" flush>
          {codes.length === 0 && links.length === 0 ? (
            <p className="bk-muted bk-panel-pad leading-snug">
              They have no promo code or short link yet. An order is counted as
              theirs when it is placed with their code, or by someone who came
              through their link.
            </p>
          ) : (
            <ul className="bk-rows">
              {codes.map((promo) => (
                <li key={promo.id}>
                  <Link
                    href={`/backstage/marketing/promo-codes/${promo.id}`}
                    className="bk-row grid-cols-[1fr_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono font-semibold [overflow-wrap:anywhere]">
                        {promo.code}
                      </span>
                      <span className="block">Promo code: {promo.label}</span>
                      <span className="bk-muted block text-[0.9375rem]">
                        {promo.orders === 0
                          ? "No paid orders yet"
                          : `${plural(promo.orders, "paid order")}, ${formatNzdExact(promo.salesCents)} in sales, ${formatNzdExact(promo.discountCents)} taken off`}
                      </span>
                    </span>
                    <PromoPill state={promo.state} />
                  </Link>
                </li>
              ))}
              {links.map((link) => (
                <li key={link.id} className="bk-row grid-cols-[1fr_auto]">
                  <span className="min-w-0">
                    <span className="block font-mono font-semibold [overflow-wrap:anywhere]">
                      {site}
                      {link.path}
                    </span>
                    <span className="block">
                      Short link{link.label === "" ? "" : `: ${link.label}`}
                      {link.code === null ? "" : `. Carries ${link.code}`}
                    </span>
                    <span className="bk-muted block text-[0.9375rem]">
                      {plural(link.clicks, "click")},{" "}
                      {link.orders === 0
                        ? "no paid orders yet"
                        : `${plural(link.orders, "paid order")}, ${formatNzdExact(link.salesCents)} in sales`}
                    </span>
                  </span>
                  {link.active ? null : <Pill tone="off">Switched off</Pill>}
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <p className="border-navy-line flex flex-wrap gap-2 border-t-2 px-4 py-3 md:px-6">
              <Link
                href={`/backstage/marketing/promo-codes/new?partner=${encodeURIComponent(id)}`}
                className="bk-btn bk-btn-quiet"
              >
                <span className="cap-trim">Make them a code</span>
              </Link>
              <Link
                href={`/backstage/marketing/links?partner=${encodeURIComponent(id)}#new`}
                className="bk-btn bk-btn-quiet"
              >
                <span className="cap-trim">Make them a link</span>
              </Link>
            </p>
          ) : null}
        </Panel>
      </div>

      <div className="flex flex-col gap-6">
        <Panel title="What it has cost">
          <div id="costs" className="scroll-mt-24">
            <dl className="bk-kv">
              <dt>Flat payments</dt>
              <dd>{formatNzdExact(spend.fee)}</dd>
              <dt>Product given away</dt>
              <dd>{formatNzdExact(spend.product)}</dd>
              <dt>Anything else</dt>
              <dd>{formatNzdExact(spend.other)}</dd>
              <dt>Their cut</dt>
              <dd>
                {formatNzdExact(takings.commissionCents)} earned,{" "}
                {formatNzdExact(spend.commission)} paid out
              </dd>
              <dt>In all</dt>
              <dd className="font-semibold">
                {formatNzdExact(result.spendCents)}
              </dd>
            </dl>
            {result.cutOwingCents > 0 ? (
              <p className="border-navy bg-olive-wash mt-4 rounded-xl border-2 p-3 leading-snug">
                <strong>
                  {formatNzdExact(result.cutOwingCents)} of their cut is still
                  to pay.
                </strong>{" "}
                When you pay it, write it down below as &ldquo;Their cut, paid
                out&rdquo;.
              </p>
            ) : null}

            {costs.length === 0 ? (
              <p className="bk-muted mt-4 leading-snug">
                Nothing written down yet. Add what you pay them or send them and
                the return works itself out.
              </p>
            ) : (
              <ul className="border-navy-line mt-4 flex flex-col border-t-2">
                {costs.map((cost) => (
                  <li
                    key={cost.id}
                    className="border-navy-line flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b-2 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold tabular-nums">
                        {formatNzdExact(cost.amountCents)}
                      </span>
                      <span className="bk-muted block text-[0.9375rem] [overflow-wrap:anywhere]">
                        {COST_KIND_LABEL[cost.kind]}, {dayLabel(cost.paidOn)}
                        {cost.note === "" ? "" : `. ${cost.note}`}
                      </span>
                    </span>
                    {canWrite ? (
                      <form action={removePartnerCostAction}>
                        <Id value={id} />
                        <input type="hidden" name="costId" value={cost.id} />
                        <SubmitButton
                          pending="Removing"
                          className="link inline-flex min-h-11 items-center text-[0.9375rem]"
                        >
                          Take off
                        </SubmitButton>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {canWrite ? (
              <div className="mt-4">
                <Fold summary="Write down a cost">
                  <form
                    action={addPartnerCostAction}
                    className="flex flex-col gap-3"
                  >
                    <Id value={id} />
                    <SelectField
                      id="cost-kind"
                      name="kind"
                      label="What it was"
                      defaultValue="fee"
                      options={COST_KINDS.map((kind) => ({
                        value: kind,
                        label: COST_KIND_LABEL[kind],
                      }))}
                      hint="A flat payment is a fee for a post, a reel, a stall or a season. Product given away goes in at what it is worth."
                    />
                    <TextField
                      id="cost-amount"
                      name="amount"
                      label="How much, in dollars"
                      required
                      inputMode="decimal"
                      maxLength={10}
                      placeholder="150"
                    />
                    <TextField
                      id="cost-day"
                      name="paidOn"
                      type="date"
                      label="When"
                      max={today}
                      hint="Leave empty for today."
                    />
                    <TextField
                      id="cost-note"
                      name="note"
                      label="Note"
                      maxLength={280}
                      placeholder="One reel and two stories"
                    />
                    <SubmitButton pending="Saving" className="bk-btn">
                      Write it down
                    </SubmitButton>
                    <p className="bk-muted text-[0.9375rem] leading-snug">
                      This is a note for working out the return. It pays nobody
                      and it is not the accounts: those are Xero&rsquo;s.
                    </p>
                  </form>
                </Fold>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Their cut">
          <div id="cut" className="scroll-mt-24">
            <p className="leading-snug">
              {results.commissionPercent === 0
                ? "They are not on a cut. If you pay them a flat amount, write it down as a cost above."
                : `They get ${String(results.commissionPercent)}% of each sale they bring in: what the buyer paid for the goods, after any promo code and not counting delivery.`}
            </p>
            {canWrite ? (
              <div className="mt-3">
                <Fold summary="Change their cut">
                  <form
                    action={setPartnerCutAction}
                    className="flex flex-col gap-3"
                  >
                    <Id value={id} />
                    <TextField
                      id="cut-percent"
                      name="commissionPercent"
                      label="Percentage of each sale"
                      inputMode="numeric"
                      maxLength={3}
                      defaultValue={
                        results.commissionPercent === 0
                          ? undefined
                          : String(results.commissionPercent)
                      }
                      placeholder="10"
                      hint="A whole number from 0 to 100. Leave empty for no cut. Orders already placed keep the cut they had."
                    />
                    <SubmitButton pending="Saving" className="bk-btn">
                      Save their cut
                    </SubmitButton>
                  </form>
                </Fold>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}
